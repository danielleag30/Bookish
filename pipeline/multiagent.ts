/**
 * Three specialised agents instead of one.
 *
 *   extractor  one per chunk, run concurrently, each seeing only its own chunk
 *   verifier   re-reads the chunk and rules on every edge the extractor claimed
 *   resolver   merges the surviving chunk graphs and settles contradictions
 *
 * WHY SPLIT AT ALL
 * The single-agent baseline produced one invented edge and one wrong type on a
 * single chunk. Those are exactly the errors a second pass with a narrower job
 * can catch, because judging "does this passage support this claim?" is an
 * easier question than "what does this passage contain?".
 *
 * WHAT ISOLATION MEANS HERE
 * Context isolation, not process isolation. Each extractor is given one chunk
 * and nothing else, so nothing from book 3 can bleed into a book 1 extraction.
 * That is the property that matters for a spoiler-bounded project. Concurrency
 * is capped because a single local model serves every request — running twenty
 * at once would queue, not parallelise, and would misreport as speed.
 *
 * EVERYTHING IS RECORDED
 * Each agent's outcome, every handoff, every verifier verdict and every conflict
 * the resolver settled is written to an audit artifact. A run can be argued with
 * after the fact instead of being taken on trust.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Series } from '../src/schema.ts';
import { RELATIONSHIP_BY_ID } from '../src/relationships.ts';
import { call, DEFAULT_MODEL, OllamaError } from './ollama.ts';
import {
  checkGraph, checkPlan,
  prunePlan, normaliseIds, collapseAliases, dropNonPeople, dropPlaceholderRoles, graphSchema,
  type ExtractedGraph, type ExtractedCharacter, type Plan,
} from './extract.ts';

const RUNS_DIR = resolve(import.meta.dirname, 'runs');

export type AgentRole = 'extractor' | 'verifier' | 'resolver';
export type AgentStatus = 'ok' | 'partial' | 'failed' | 'recovered';

export interface AgentRecord {
  id: string;
  role: AgentRole;
  chunk: number | null;
  status: AgentStatus;
  attempts: number;
  ms: number;
  promptTokens: number;
  responseTokens: number;
  note: string;
}

export interface Handoff {
  from: string;
  to: string;
  chunk: number | null;
  carried: string;
}

export interface Verdict {
  chunk: number;
  edge: string;
  supported: boolean;
  reason: string;
}

export interface Conflict {
  character: string;
  field: string;
  values: { value: string; from: string }[];
  resolution: string;
  why: string;
}

export interface Recovery {
  chunk: number;
  action: 'retried' | 'salvaged' | 'escalated' | 'pruned';
  why: string;
}

/** An empty audit, so the resolver can be exercised on its own. */
export function emptyAudit(model = 'test', concurrency = 1): AuditLog {
  return {
    model, concurrency, agents: [], handoffs: [], verdicts: [], conflicts: [], recoveries: [],
    totals: { ms: 0, calls: 0, promptTokens: 0, responseTokens: 0 },
  };
}

export interface AuditLog {
  model: string;
  concurrency: number;
  agents: AgentRecord[];
  handoffs: Handoff[];
  verdicts: Verdict[];
  conflicts: Conflict[];
  recoveries: Recovery[];
  totals: { ms: number; calls: number; promptTokens: number; responseTokens: number };
}

export interface MultiAgentResult {
  graph: ExtractedGraph;
  audit: AuditLog;
  /** Edges the verifier rejected — kept so the cost of the pass is visible. */
  rejected: { chunk: number; edge: string; reason: string }[];
}

// ── Schemas ────────────────────────────────────────────────────────────────

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    characters: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['characters', 'summary'],
};

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'index of the claim being judged' },
          supported: {
            type: 'boolean',
            description: 'true only if the passage itself states or plainly implies this',
          },
          reason: { type: 'string', description: 'one short sentence' },
        },
        required: ['index', 'supported', 'reason'],
      },
    },
  },
  required: ['verdicts'],
};

function vocabularyBrief(): string {
  return RELATIONSHIP_TYPES_BRIEF;
}
const RELATIONSHIP_TYPES_BRIEF = [...RELATIONSHIP_BY_ID.values()]
  .map((t) => `- ${t.id}: ${t.definition}` + (t.symmetric ? '' : ` (from = ${t.fromIs})`))
  .join('\n');

// ── Agents ─────────────────────────────────────────────────────────────────

/**
 * The verifier is deliberately given a narrower question than the extractor.
 *
 * It is told to default to unsupported when unsure, because the cost of the two
 * mistakes is not symmetric: dropping a true edge loses recall, keeping a false
 * one puts a wrong fact on the chart.
 */
function verifyPrompt(chunk: string, edges: string[]): string {
  return `Judge whether this passage supports each claim.

A claim is supported ONLY if the passage states it or plainly implies it. Do not
use knowledge from outside the passage. If you are unsure, answer false.

PASSAGE:
${chunk}

CLAIMS:
${edges.map((e, i) => `${i}. ${e}`).join('\n')}`;
}

async function runExtractor(
  id: string, chunk: string, index: number, model: string, relTypeIds: string[],
  audit: AuditLog,
): Promise<ExtractedGraph | null> {
  const rec: AgentRecord = {
    id, role: 'extractor', chunk: index, status: 'ok', attempts: 0,
    ms: 0, promptTokens: 0, responseTokens: 0, note: '',
  };
  const relTypeSet = new Set(relTypeIds);

  try {
    const planned = await call<Plan>(
      `List every person or creature named in this passage, then summarise it in one sentence.\n\nPASSAGE:\n${chunk}`,
      { model, format: PLAN_SCHEMA },
    );
    rec.ms += planned.ms;
    rec.promptTokens += planned.promptTokens;
    rec.responseTokens += planned.responseTokens;
    audit.totals.calls++;

    const planProblems = checkPlan(planned.value, chunk);
    // Act on the finding rather than only recording it.
    const { plan: cleanPlan, dropped } = prunePlan(planned.value, chunk);
    if (dropped.length) {
      audit.recoveries.push({
        chunk: index,
        action: 'pruned',
        why: `plan named ${dropped.length} character(s) absent from the passage: ${dropped.join(', ')}`,
      });
    }
    planned.value = cleanPlan;
    if (planned.value.characters.length === 0) {
      rec.status = 'failed';
      rec.note = 'plan named nobody';
      audit.recoveries.push({ chunk: index, action: 'escalated', why: 'plan named nobody' });
      audit.agents.push(rec);
      return null;
    }
    if (planProblems.length) rec.note = `plan warnings: ${planProblems.join('; ')}`;

    audit.handoffs.push({
      from: id, to: `${id}:extract`, chunk: index,
      carried: `${planned.value.characters.length} planned names`,
    });

    let prompt = `Extract a character-relationship graph from this passage.

Names you identified: ${planned.value.characters.join(', ')}

Relationship types:
${vocabularyBrief()}

Rules: ids are lowercase slugs. Every id used in a relationship must appear in
characters. Only state what the passage supports. \`killed\` means the character
died; if they survived use \`enemy\`.

Also separate out places and factions. A realm, city or location goes in
\`places\`. A group, court, army or allegiance goes in \`factions\`. Neither
belongs in \`characters\` — only people go there. An id is always a slug of the
name itself ("zilvaren", "lupo_proelia"), never a counter like "place1".

For each person, set \`place\` and \`faction\` to the id of the place or faction
the passage puts them in. These take an id from the lists above or the empty
string — never a description, never "N/A". If the passage does not say, use "".

PASSAGE:
${chunk}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      rec.attempts = attempt;
      const got = await call<ExtractedGraph>(prompt, { model, format: graphSchema(relTypeIds) });
      rec.ms += got.ms;
      rec.promptTokens += got.promptTokens;
      rec.responseTokens += got.responseTokens;
      audit.totals.calls++;

      const issues = checkGraph(got.value, relTypeSet);
      if (issues.length === 0) {
        audit.agents.push(rec);
        return got.value;
      }
      if (attempt === 3) {
        const ids = new Set(got.value.characters.map((c) => c.id));
        const salvaged: ExtractedGraph = {
          characters: got.value.characters,
          relationships: got.value.relationships.filter(
            (r) => ids.has(r.from) && ids.has(r.to) && relTypeSet.has(r.type) && r.from !== r.to,
          ),
          // Carry these through. Rebuilding the object without them meant a
          // chunk that needed salvaging silently lost every place and faction
          // it had found — a partial result quietly becoming a wrong one.
          ...(got.value.places ? { places: got.value.places } : {}),
          ...(got.value.factions ? { factions: got.value.factions } : {}),
        };
        rec.status = 'partial';
        rec.note = `salvaged after ${issues.length} structural issue(s)`;
        audit.recoveries.push({
          chunk: index, action: 'salvaged',
          why: `${issues.length} structural issue(s) survived ${attempt} attempts; kept the ` +
               `characters and dropped ${got.value.relationships.length - salvaged.relationships.length} bad edge(s)`,
        });
        audit.agents.push(rec);
        return salvaged;
      }
      audit.recoveries.push({
        chunk: index, action: 'retried',
        why: `attempt ${attempt}: ${issues.map((i) => i.kind).join(', ')}`,
      });
      prompt += `\n\nYour previous answer had these problems. Fix them:\n${
        issues.map((i) => `- ${i.kind}: ${i.detail}`).join('\n')}`;
    }
    audit.agents.push(rec);
    return null;
  } catch (err) {
    rec.status = 'failed';
    rec.note = err instanceof OllamaError ? err.message : String(err);
    audit.recoveries.push({ chunk: index, action: 'escalated', why: rec.note });
    audit.agents.push(rec);
    return null;
  }
}

async function runVerifier(
  id: string, chunk: string, index: number, graph: ExtractedGraph, model: string,
  audit: AuditLog,
): Promise<{ kept: ExtractedGraph; rejected: { chunk: number; edge: string; reason: string }[] }> {
  const rec: AgentRecord = {
    id, role: 'verifier', chunk: index, status: 'ok', attempts: 1,
    ms: 0, promptTokens: 0, responseTokens: 0, note: '',
  };
  const rejected: { chunk: number; edge: string; reason: string }[] = [];

  if (graph.relationships.length === 0) {
    rec.note = 'nothing to verify';
    audit.agents.push(rec);
    return { kept: graph, rejected };
  }

  const labelOf = new Map(graph.characters.map((c) => [c.id, c.label]));
  const claims = graph.relationships.map(
    (r) => `${labelOf.get(r.from) ?? r.from} — ${r.type} — ${labelOf.get(r.to) ?? r.to}`,
  );

  try {
    const got = await call<{ verdicts: { index: number; supported: boolean; reason: string }[] }>(
      verifyPrompt(chunk, claims), { model, format: VERDICT_SCHEMA },
    );
    rec.ms += got.ms;
    rec.promptTokens += got.promptTokens;
    rec.responseTokens += got.responseTokens;
    audit.totals.calls++;

    const byIndex = new Map(got.value.verdicts.map((v) => [v.index, v]));
    const kept = graph.relationships.filter((r, i) => {
      // A claim the verifier never ruled on is kept: silence is not a rejection.
      const v = byIndex.get(i);
      if (!v) return true;
      audit.verdicts.push({
        chunk: index, edge: claims[i]!, supported: v.supported, reason: v.reason,
      });
      if (!v.supported) rejected.push({ chunk: index, edge: claims[i]!, reason: v.reason });
      return v.supported;
    });

    rec.note = `${rejected.length} of ${claims.length} claim(s) rejected`;
    audit.agents.push(rec);
    audit.handoffs.push({
      from: id, to: 'resolver', chunk: index,
      carried: `${kept.length} verified edge(s), ${graph.characters.length} character(s)`,
    });
    // Spread the incoming graph rather than naming two fields. Listing fields
    // here meant every field added later — places, factions — was silently
    // dropped by the verifier, which only judges relationships and has no
    // business discarding anything else.
    return { kept: { ...graph, relationships: kept }, rejected };
  } catch (err) {
    // A failed verifier must not delete the extractor's work.
    rec.status = 'failed';
    rec.note = `${err instanceof OllamaError ? err.message : String(err)} — kept all edges unverified`;
    audit.recoveries.push({
      chunk: index, action: 'escalated',
      why: 'verifier failed; edges pass through unverified rather than being dropped',
    });
    audit.agents.push(rec);
    return { kept: graph, rejected };
  }
}

/**
 * Merge the chunk graphs and settle contradictions.
 *
 * This is deterministic rather than a model call. The conflicts that arise are
 * of a kind with clear rules — a definite status beats `unknown`, a filled role
 * beats a blank one — and a model asked to arbitrate would introduce variance
 * without adding judgement. Every decision is logged either way.
 */
export function runResolver(
  parts: { chunk: number; graph: ExtractedGraph }[], audit: AuditLog,
): ExtractedGraph {
  const rec: AgentRecord = {
    id: 'resolver', role: 'resolver', chunk: null, status: 'ok', attempts: 1,
    ms: 0, promptTokens: 0, responseTokens: 0, note: '',
  };
  const started = Date.now();

  const chars = new Map<string, ExtractedCharacter & { from: number }>();
  for (const { chunk, graph } of parts) {
    for (const c of graph.characters) {
      const prev = chars.get(c.id);
      if (!prev) { chars.set(c.id, { ...c, from: chunk }); continue; }

      if (c.status !== prev.status) {
        const definite = (s: string) => s !== 'unknown';
        let resolution: string;
        let why: string;
        if (definite(prev.status) && !definite(c.status)) {
          resolution = prev.status;
          why = `kept the definite value from chunk ${prev.from} over "unknown"`;
        } else if (!definite(prev.status) && definite(c.status)) {
          resolution = c.status;
          why = `took the definite value from chunk ${chunk} over "unknown"`;
        } else {
          // Two definite and different values: the later chunk is later in the
          // story, so it describes a more recent state.
          resolution = c.status;
          why = `both definite; took chunk ${chunk} as the later point in the story`;
        }
        audit.conflicts.push({
          character: c.id, field: 'status',
          values: [
            { value: prev.status, from: `chunk ${prev.from}` },
            { value: c.status, from: `chunk ${chunk}` },
          ],
          resolution, why,
        });
        prev.status = resolution as ExtractedCharacter['status'];
      }

      if (!prev.role && c.role) {
        prev.role = c.role;
      } else if (prev.role && c.role && prev.role !== c.role) {
        audit.conflicts.push({
          character: c.id, field: 'role',
          values: [
            { value: prev.role, from: `chunk ${prev.from}` },
            { value: c.role, from: `chunk ${chunk}` },
          ],
          resolution: prev.role,
          why: `kept the first description; a later chunk restating a role is not evidence it changed`,
        });
      }
    }
  }

  const rels = new Map<string, { from: string; to: string; type: string; label: string }>();
  let duplicates = 0;
  for (const { graph } of parts) {
    for (const r of graph.relationships) {
      const k = `${r.from}>${r.to}:${r.type}`;
      if (rels.has(k)) { duplicates++; continue; }
      rels.set(k, r);
    }
  }

  rec.ms = Date.now() - started;
  rec.note = `${chars.size} characters, ${rels.size} edges, ${audit.conflicts.length} conflict(s) ` +
             `settled, ${duplicates} duplicate edge(s) collapsed`;
  audit.agents.push(rec);

  // Places and factions union by id — book two naming Yvelia again is the same
  // realm, not a second one.
  const places = new Map<string, NonNullable<ExtractedGraph['places']>[number]>();
  const factions = new Map<string, NonNullable<ExtractedGraph['factions']>[number]>();
  for (const { graph } of parts) {
    for (const p of graph.places ?? []) if (!places.has(p.id)) places.set(p.id, p);
    for (const f of graph.factions ?? []) if (!factions.has(f.id)) factions.set(f.id, f);
  }

  // Slugify first, then collapse — the alias rule compares slugs, so it has to
  // run after ids are normalised or "Saeris Fane" and "saeris" never match.
  return dropPlaceholderRoles(dropNonPeople(collapseAliases(normaliseIds({
    characters: [...chars.values()].map(({ from: _from, ...c }) => c),
    relationships: [...rels.values()],
    places: [...places.values()],
    factions: [...factions.values()],
  }))));
}

// ── Orchestration ──────────────────────────────────────────────────────────

/** Run `items` through `fn` with a bounded number in flight at once. */
export async function pooled<T, R>(
  items: T[], limit: number, fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface OrchestrateOptions {
  model?: string;
  /** In-flight extractors. One local model serves them all, so this stays small. */
  concurrency?: number;
  onProgress?: (msg: string) => void;
}

export async function orchestrate(
  series: Series, chunks: string[], opts: OrchestrateOptions = {},
): Promise<MultiAgentResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const concurrency = opts.concurrency ?? 2;
  const relTypeIds = series.relationshipTypes.map((t) => t.id);

  const audit: AuditLog = {
    model, concurrency, agents: [], handoffs: [], verdicts: [], conflicts: [], recoveries: [],
    totals: { ms: 0, calls: 0, promptTokens: 0, responseTokens: 0 },
  };
  const started = Date.now();

  // Extract, concurrently, each agent seeing only its own chunk.
  const extracted = await pooled(chunks, concurrency, async (chunk, i) => {
    opts.onProgress?.(`extractor ${i + 1}/${chunks.length}`);
    return { chunk: i, graph: await runExtractor(`extractor-${i}`, chunk, i, model, relTypeIds, audit) };
  });

  // Verify each surviving graph against its own chunk.
  const rejected: { chunk: number; edge: string; reason: string }[] = [];
  const verified = await pooled(
    extracted.filter((e): e is { chunk: number; graph: ExtractedGraph } => e.graph !== null),
    concurrency,
    async (e, i) => {
      opts.onProgress?.(`verifier ${i + 1}`);
      const r = await runVerifier(`verifier-${e.chunk}`, chunks[e.chunk]!, e.chunk, e.graph, model, audit);
      rejected.push(...r.rejected);
      return { chunk: e.chunk, graph: r.kept };
    },
  );

  const graph = runResolver(verified, audit);

  audit.totals.ms = Date.now() - started;
  audit.totals.promptTokens = audit.agents.reduce((n, a) => n + a.promptTokens, 0);
  audit.totals.responseTokens = audit.agents.reduce((n, a) => n + a.responseTokens, 0);

  return { graph, audit, rejected };
}

/** Write the audit log so a run can be argued with after the fact. */
export function writeAudit(audit: AuditLog, series: string, stamp: string): string {
  mkdirSync(RUNS_DIR, { recursive: true });
  const file = join(RUNS_DIR, `${series}-multiagent-${stamp}.json`);
  writeFileSync(file, JSON.stringify(audit, null, 2) + '\n');
  return file;
}
