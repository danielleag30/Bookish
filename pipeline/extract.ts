/**
 * Extraction pipeline: narrative text in, a schema-shaped character graph out.
 *
 * PLAN, THEN ACT
 * The model is asked twice per chunk. First for a plan — which characters it
 * intends to extract and why — which is validated before anything else happens.
 * Only then is it asked for the graph. That separation is a GH-600 Domain 1
 * requirement ("configure agent planning to be distinct from agent execution",
 * "prevent agent action until the agent checked and approved"), and it earns its
 * keep here: a plan naming two characters from a chunk that mentions twelve is
 * cheap to reject before paying for the full extraction.
 *
 * WHAT IT IS MEASURED AGAINST
 * The corpus is each series' own one-line event log — see evals/README.md. Not
 * book text, which is copyrighted and not ours to process.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Series } from '../src/schema.ts';
import { RELATIONSHIP_TYPES } from '../src/relationships.ts';
import { call, DEFAULT_MODEL, OllamaError } from './ollama.ts';

const RUNS_DIR = resolve(import.meta.dirname, 'runs');

// ── What we ask the model to produce ───────────────────────────────────────

export interface ExtractedCharacter {
  id: string;
  label: string;
  role: string;
  status: 'alive' | 'dead' | 'missing' | 'prisoner' | 'unknown';
}

export interface ExtractedRelationship {
  from: string;
  to: string;
  type: string;
  label: string;
}

export interface ExtractedGraph {
  characters: ExtractedCharacter[];
  relationships: ExtractedRelationship[];
}

export interface Plan {
  /** Names the model can see in this chunk. */
  characters: string[];
  /** One line on what the chunk is about — cheap signal that it was read. */
  summary: string;
}

/**
 * JSON Schema for the graph.
 *
 * Written by hand rather than derived from the Zod series schema, because the
 * extraction target is deliberately narrower: no coordinates, no regions, no
 * book numbers. Those are layout and timeline concerns the model has no basis
 * for. Field descriptions are load-bearing — an early trial filled `label` with
 * "Dragon Companion" because `label` carried no description.
 */
function graphSchema(relTypeIds: string[]): unknown {
  return {
    type: 'object',
    properties: {
      characters: {
        type: 'array',
        description: 'Every character named in the passage.',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description:
                'Lowercase slug of the given name, e.g. "violet", "king_tauri". ' +
                'Never the display name.',
            },
            label: {
              type: 'string',
              description: 'The name as written in the passage, e.g. "Violet Sorrengail".',
            },
            role: {
              type: 'string',
              description: 'Short role or title if the passage states one, otherwise "".',
            },
            status: {
              type: 'string',
              enum: ['alive', 'dead', 'missing', 'prisoner', 'unknown'],
              description: 'Their state by the end of this passage. Use unknown if unstated.',
            },
          },
          required: ['id', 'label', 'role', 'status'],
        },
      },
      relationships: {
        type: 'array',
        description:
          'Relationships the passage states. Only include a relationship if the ' +
          'passage supports it — do not infer from general knowledge.',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'id of the acting character' },
            to: { type: 'string', description: 'id of the other character' },
            type: { type: 'string', enum: relTypeIds },
            label: { type: 'string', description: 'Short gloss, e.g. "mother", "kills him".' },
          },
          required: ['from', 'to', 'type', 'label'],
        },
      },
    },
    required: ['characters', 'relationships'],
  };
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    characters: {
      type: 'array',
      description: 'Names of every person or creature the passage mentions.',
      items: { type: 'string' },
    },
    summary: { type: 'string', description: 'One sentence on what happens.' },
  },
  required: ['characters', 'summary'],
};

/** Direction and meaning of each type, so `from` is not a coin flip. */
function vocabularyBrief(): string {
  return RELATIONSHIP_TYPES.map((t) => {
    const dir = t.symmetric ? 'either direction' : `from = ${t.fromIs}, to = ${t.toIs}`;
    return `- ${t.id}: ${t.definition} (${dir})`;
  }).join('\n');
}

// ── Prompts ────────────────────────────────────────────────────────────────

function planPrompt(chunk: string): string {
  return `List every person or creature named in this passage, then summarise it in one sentence.

Only list names that actually appear. Do not add characters you know from elsewhere.

PASSAGE:
${chunk}`;
}

function extractPrompt(chunk: string, plan: Plan): string {
  return `Extract a character-relationship graph from this passage.

You already identified these names: ${plan.characters.join(', ') || '(none)'}

Use only these relationship types, respecting each one's direction:
${vocabularyBrief()}

Rules:
- ids are lowercase slugs of the given name: "Violet Sorrengail" -> "violet".
- Every id used in a relationship must also appear in characters.
- Only state a relationship the passage supports. Do not infer from prior knowledge.
- \`killed\` means the character died. If they survived, use \`enemy\`.

PASSAGE:
${chunk}`;
}

// ── Validation of the model's output ───────────────────────────────────────

export interface GraphIssue {
  kind: 'dangling-endpoint' | 'unknown-type' | 'self-relationship' | 'duplicate-id' | 'empty-id';
  detail: string;
}

/** Structural checks the schema cannot express. Mirrors src/schema.ts. */
export function checkGraph(g: ExtractedGraph, relTypeIds: Set<string>): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const ids = new Set<string>();
  for (const c of g.characters) {
    if (!c.id.trim()) issues.push({ kind: 'empty-id', detail: c.label });
    else if (ids.has(c.id)) issues.push({ kind: 'duplicate-id', detail: c.id });
    ids.add(c.id);
  }
  for (const r of g.relationships) {
    if (!ids.has(r.from)) {
      issues.push({ kind: 'dangling-endpoint', detail: `${r.from} (in ${r.from}->${r.to})` });
    }
    if (!ids.has(r.to)) {
      issues.push({ kind: 'dangling-endpoint', detail: `${r.to} (in ${r.from}->${r.to})` });
    }
    if (r.from === r.to) issues.push({ kind: 'self-relationship', detail: r.from });
    if (!relTypeIds.has(r.type)) issues.push({ kind: 'unknown-type', detail: r.type });
  }
  return issues;
}

/** A plan is worth acting on only if it looks like the chunk was actually read. */
export function checkPlan(plan: Plan, chunk: string): string[] {
  const problems: string[] = [];
  if (!plan.summary.trim()) problems.push('summary is empty');
  const unseen = plan.characters.filter((n) => {
    const first = n.split(/\s+/)[0];
    return first !== undefined && first.length > 2 && !chunk.toLowerCase().includes(first.toLowerCase());
  });
  if (unseen.length) {
    problems.push(`names not present in the passage: ${unseen.join(', ')}`);
  }
  return problems;
}

// ── Merge ──────────────────────────────────────────────────────────────────

/**
 * Fold per-chunk graphs into one.
 *
 * Characters are matched on id, which is why the prompt is emphatic about
 * slugs — the alternative is entity resolution across chunks, and Phase 5's
 * resolver agent is where that belongs. Here, a later chunk fills in a blank
 * `role` and can move a status away from `unknown`, but never overwrites a
 * definite value with a vaguer one.
 */
/**
 * Force an extracted id into a usable slug.
 *
 * The prompt asks for lowercase slugs, and the model returned "saeris fane".
 * Asking is not enforcing: an id is a key, and a space in one breaks every
 * relationship pointing at it. Normalising here means every consumer — merge,
 * validation, the chart — sees the same shape.
 */
export function slugifyId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'unknown';
}

/** Apply slugifyId across a graph, keeping relationships pointing at the right ids. */
export function normaliseIds(g: ExtractedGraph): ExtractedGraph {
  const map = new Map(g.characters.map((c) => [c.id, slugifyId(c.id)]));
  return {
    characters: g.characters.map((c) => ({ ...c, id: map.get(c.id) ?? slugifyId(c.id) })),
    relationships: g.relationships.map((r) => ({
      ...r,
      from: map.get(r.from) ?? slugifyId(r.from),
      to: map.get(r.to) ?? slugifyId(r.to),
    })),
  };
}

export function mergeGraphs(parts: ExtractedGraph[]): ExtractedGraph {
  const chars = new Map<string, ExtractedCharacter>();
  for (const g of parts) {
    for (const c of g.characters) {
      const prev = chars.get(c.id);
      if (!prev) { chars.set(c.id, { ...c }); continue; }
      if (!prev.role && c.role) prev.role = c.role;
      if (prev.status === 'unknown' && c.status !== 'unknown') prev.status = c.status;
    }
  }
  const rels = new Map<string, ExtractedRelationship>();
  for (const g of parts) {
    for (const r of g.relationships) {
      rels.set(`${r.from}>${r.to}:${r.type}`, r);
    }
  }
  return normaliseIds({ characters: [...chars.values()], relationships: [...rels.values()] });
}

// ── Run ────────────────────────────────────────────────────────────────────

export interface ChunkTrace {
  index: number;
  chunkChars: number;
  plan?: Plan;
  planProblems: string[];
  planRejected: boolean;
  attempts: number;
  issues: GraphIssue[];
  graph?: ExtractedGraph;
  ms: number;
  promptTokens: number;
  responseTokens: number;
  error?: string;
}

export interface RunResult {
  series: string;
  model: string;
  chunks: ChunkTrace[];
  graph: ExtractedGraph;
  totals: { ms: number; promptTokens: number; responseTokens: number; calls: number };
}

export interface RunOptions {
  model?: string;
  /** Bounded so a stubborn chunk cannot loop. */
  maxAttempts?: number;
  onProgress?: (msg: string) => void;
}

export async function extractSeries(
  series: Series,
  chunks: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const maxAttempts = opts.maxAttempts ?? 3;
  const relTypeIds = series.relationshipTypes.map((t) => t.id);
  const relTypeSet = new Set(relTypeIds);
  const schema = graphSchema(relTypeIds);

  const traces: ChunkTrace[] = [];
  const graphs: ExtractedGraph[] = [];
  let calls = 0;

  for (const [index, chunk] of chunks.entries()) {
    const t: ChunkTrace = {
      index, chunkChars: chunk.length, planProblems: [], planRejected: false,
      attempts: 0, issues: [], ms: 0, promptTokens: 0, responseTokens: 0,
    };
    opts.onProgress?.(`chunk ${index + 1}/${chunks.length}`);

    try {
      // 1. Plan.
      const planned = await call<Plan>(planPrompt(chunk), { model, format: PLAN_SCHEMA });
      calls++;
      t.plan = planned.value;
      t.ms += planned.ms;
      t.promptTokens += planned.promptTokens;
      t.responseTokens += planned.responseTokens;

      // 2. Validate the plan before paying for extraction.
      t.planProblems = checkPlan(planned.value, chunk);
      if (planned.value.characters.length === 0) {
        t.planRejected = true;
        traces.push(t);
        continue;
      }

      // 3. Act, retrying with the structural errors fed back.
      let prompt = extractPrompt(chunk, planned.value);
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        t.attempts = attempt;
        const got = await call<ExtractedGraph>(prompt, { model, format: schema });
        calls++;
        t.ms += got.ms;
        t.promptTokens += got.promptTokens;
        t.responseTokens += got.responseTokens;

        const issues = checkGraph(got.value, relTypeSet);
        t.issues = issues;
        if (issues.length === 0) {
          t.graph = got.value;
          graphs.push(got.value);
          break;
        }
        if (attempt === maxAttempts) {
          // Keep what is usable rather than discarding the chunk: drop the
          // relationships that point at nothing and keep the characters.
          const ids = new Set(got.value.characters.map((c) => c.id));
          const salvaged: ExtractedGraph = {
            characters: got.value.characters,
            relationships: got.value.relationships.filter(
              (r) => ids.has(r.from) && ids.has(r.to) && relTypeSet.has(r.type) && r.from !== r.to,
            ),
          };
          t.graph = salvaged;
          graphs.push(salvaged);
          break;
        }
        prompt = `${extractPrompt(chunk, planned.value)}

Your previous answer had these problems. Fix them:
${issues.map((i) => `- ${i.kind}: ${i.detail}`).join('\n')}`;
      }
    } catch (err) {
      t.error = err instanceof OllamaError ? err.message : String(err);
    }
    traces.push(t);
  }

  const totals = traces.reduce(
    (a, t) => ({
      ms: a.ms + t.ms,
      promptTokens: a.promptTokens + t.promptTokens,
      responseTokens: a.responseTokens + t.responseTokens,
      calls,
    }),
    { ms: 0, promptTokens: 0, responseTokens: 0, calls },
  );

  return { series: series.id, model, chunks: traces, graph: mergeGraphs(graphs), totals };
}

/** Persist the full trace, so a run can be inspected after the fact. */
export function writeTrace(run: RunResult, stamp: string): string {
  mkdirSync(RUNS_DIR, { recursive: true });
  const file = join(RUNS_DIR, `${run.series}-${stamp}.json`);
  writeFileSync(file, JSON.stringify(run, null, 2) + '\n');
  return file;
}
