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
  /** id of a place from `places`, or '' when the notes do not say. */
  place?: string;
  /** id of a faction from `factions`, or '' when the notes do not say. */
  faction?: string;
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

/** A realm, city or location the notes name. */
export interface ExtractedPlace {
  id: string;
  label: string;
  note: string;
}

/** A group, court, army or allegiance the notes name. */
export interface ExtractedFaction {
  id: string;
  label: string;
  note: string;
}

export interface ExtractedGraph {
  characters: ExtractedCharacter[];
  relationships: ExtractedRelationship[];
  places?: ExtractedPlace[];
  factions?: ExtractedFaction[];
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
 * extraction target is deliberately narrower: no coordinates, no book numbers.
 * Those are layout and timeline concerns the model has no basis for. Field
 * descriptions are load-bearing — an early trial filled `label` with "Dragon
 * Companion" because `label` carried no description.
 *
 * `places` and `factions` were originally excluded on the reasoning that a model
 * must not invent geography. Running this on real notes showed the rule backfired:
 * the model identified Zilvaren, Yvelia and Lupo Proelia perfectly well and, given
 * only a `characters` array to put them in, filed all three as characters. The
 * guardrail never prevented the extraction, it just misdirected it. Reading a place
 * that the notes name is not inventing one — so they get their own slots, and the
 * verifier holds them to the same standard as every other claim.
 */
/**
 * Exported because multiagent.ts had grown its own copy of this schema. The two
 * drifted: adding `places` and `factions` here changed nothing at all, because
 * the multi-agent path — the default — was still sending the older shape. One
 * definition, one place to change it.
 */
export function graphSchema(relTypeIds: string[]): unknown {
  return {
    type: 'object',
    properties: {
      characters: {
        type: 'array',
        description:
          'Every *person* named in the passage. People only — a realm, city or ' +
          'court is not a character; those belong in places and factions.',
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
              description:
                'Their role or title AS THE PASSAGE STATES IT — "immortal queen of ' +
                'Zilvaren", "commands the Yvelian army", "vampire king of Sanasroth". ' +
                'Never the word "Character": that is not a role, and it is what ' +
                'gets printed on the chart under their name. Empty string if the ' +
                'passage really does not say.',
            },
            status: {
              type: 'string',
              enum: ['alive', 'dead', 'missing', 'prisoner', 'unknown'],
              description:
                'Their state WHEN THIS PASSAGE FIRST SHOWS THEM, not at the end ' +
                'of it. Someone who is alive for most of the passage and dies at ' +
                'the end is "alive" — the death is a later fact, and reporting it ' +
                'here puts it on the chart from their first appearance. Use ' +
                'unknown if the passage does not say.',
            },
            place: {
              type: 'string',
              description:
                'id of the place from `places` this person belongs to, if the ' +
                'passage says. Empty string if it does not say — do not guess.',
            },
            faction: {
              type: 'string',
              description:
                'id of the group from `factions` this person belongs to, if the ' +
                'passage says. Empty string if it does not say — do not guess.',
            },
          },
          required: ['id', 'label', 'role', 'status', 'place', 'faction'],
        },
      },
      places: {
        type: 'array',
        description:
          'Realms, cities and locations the passage names. Places only — never a ' +
          'person, never a group of people.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Lowercase slug, e.g. "zilvaren".' },
            label: { type: 'string', description: 'The name as written, e.g. "Zilvaren".' },
            note: { type: 'string', description: 'What the passage says about it, or "".' },
          },
          required: ['id', 'label', 'note'],
        },
      },
      factions: {
        type: 'array',
        description:
          'Groups, courts, armies and allegiances the passage names — a side that ' +
          'characters belong to. Never a single person, never a place.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Lowercase slug, e.g. "lupo_proelia".' },
            label: { type: 'string', description: 'The name as written, e.g. "Lupo Proelia".' },
            note: { type: 'string', description: 'What the passage says about it, or "".' },
          },
          required: ['id', 'label', 'note'],
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
    required: ['characters', 'places', 'factions', 'relationships'],
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
/**
 * Drop planned names the passage does not contain.
 *
 * `checkPlan` detected these and the plan was handed to the extractor anyway,
 * hallucinated names included — so a name the planner invented arrived in the
 * extraction prompt as a thing to go and find, which is the most effective way
 * to talk a model into inventing a character. Detecting a problem and then
 * proceeding as if it had not been detected is worse than not checking.
 */
export function prunePlan(plan: Plan, chunk: string): { plan: Plan; dropped: string[] } {
  const lower = chunk.toLowerCase();
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const n of plan.characters) {
    const first = n.split(/\s+/)[0];
    const invented = first !== undefined && first.length > 2 && !lower.includes(first.toLowerCase());
    (invented ? dropped : kept).push(n);
  }
  return { plan: { ...plan, characters: kept }, dropped };
}

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
    // Strip diacritics rather than dropping the letter: "Te Léna" was becoming
    // te_l_na, which is not a name and does not resolve back to the character.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'unknown';
}

/** Apply slugifyId across a graph, keeping relationships pointing at the right ids. */
/**
 * Collapse short-form duplicates of the same character.
 *
 * A two-book run produced `saeris` and `saeris_fane`, `hayden` and `hayden_fane`,
 * `carrion` and `carrion_swift`, `belikon` and `belikon_de_barra` — the notes
 * name people in full once and by first name after, and the extractor took each
 * form as a separate person. Half the relationships then pointed at the stub.
 *
 * The rule is deliberately narrow: merge only when one id's underscore-separated
 * tokens are a leading run of the other's, and keep the longer id as canonical.
 * That catches first-name stubs and nothing else.
 *
 * It will NOT merge `carrion_swift` with `carrion_daianthus`, and that is the
 * point — those are one person under two names, but which name a reader knows
 * depends on how far they have read. Collapsing them here would silently destroy
 * a reveal. It belongs in `perceived`, decided by a human.
 */
/**
 * Drop "characters" that the same run also identified as a place or a faction.
 *
 * Given both a characters list and a places list, the model puts Zilvaren in
 * both — it is not confused about what Zilvaren is, it is hedging. Since the
 * places entry is the one that carries a note and feeds the regions, that is
 * the copy worth keeping, and the character copy is deleted along with any
 * relationship that pointed at it.
 *
 * Deterministic on purpose. Asking a second model call "is Zilvaren a person?"
 * would be slower, cost more and be less reliable than an id comparison.
 */
/**
 * Blank out roles that carry no information.
 *
 * Asked for a role "if the passage states one, otherwise empty", the model
 * answered "Character" for 28 of 29 people — so the chart printed the word
 * "character" under each name, and the ask box led its answer with it. An empty
 * role renders as nothing, which is honest; a placeholder renders as content.
 */
const EMPTY_ROLES = new Set(['character', 'person', 'unknown', 'n/a', 'na', 'none', 'entity']);

export function dropPlaceholderRoles(g: ExtractedGraph): ExtractedGraph {
  return {
    ...g,
    characters: g.characters.map((c) =>
      EMPTY_ROLES.has(c.role.trim().toLowerCase().replace(/[.\s]+$/, '')) ? { ...c, role: '' } : c,
    ),
  };
}

export function dropNonPeople(g: ExtractedGraph): ExtractedGraph {
  // Match on label as well as id. The model called the faction `rebellion` but
  // listed the same group as the character `lupo_proelia`, so an id-only
  // comparison missed it and Lupo Proelia stayed on the chart as a person.
  const norm = (v: string) => slugifyId(v);
  const notPeople = new Set<string>();
  for (const p of g.places ?? []) { notPeople.add(p.id); notPeople.add(norm(p.label)); }
  for (const f of g.factions ?? []) { notPeople.add(f.id); notPeople.add(norm(f.label)); }
  if (notPeople.size === 0) return g;

  const characters = g.characters.filter(
    (c) => !notPeople.has(c.id) && !notPeople.has(norm(c.label)),
  );
  const kept = new Set(characters.map((c) => c.id));
  return {
    ...g,
    characters,
    relationships: g.relationships.filter((r) => kept.has(r.from) && kept.has(r.to)),
  };
}

export function collapseAliases(g: ExtractedGraph): ExtractedGraph {
  const ids = g.characters.map((c) => c.id).sort((a, b) => b.length - a.length);
  const canonical = new Map<string, string>();

  for (const short of ids) {
    if (canonical.has(short)) continue;
    const shortTokens = short.split('_');
    for (const long of ids) {
      if (long === short || long.length <= short.length) continue;
      const longTokens = long.split('_');
      const isPrefix = shortTokens.every((t, i) => longTokens[i] === t);
      if (isPrefix) {
        canonical.set(short, canonical.get(long) ?? long);
        break;
      }
    }
  }
  if (canonical.size === 0) return g;

  const at = (id: string) => canonical.get(id) ?? id;
  const chars = new Map<string, ExtractedCharacter>();
  for (const c of g.characters) {
    const id = at(c.id);
    const prev = chars.get(id);
    if (!prev) {
      chars.set(id, { ...c, id });
      continue;
    }
    // Keep whichever record actually says something.
    chars.set(id, {
      ...prev,
      label: prev.label.length >= c.label.length ? prev.label : c.label,
      role: prev.role || c.role,
      status: prev.status !== 'unknown' ? prev.status : c.status,
    });
  }

  const rels = new Map<string, ExtractedRelationship>();
  for (const r of g.relationships) {
    const from = at(r.from);
    const to = at(r.to);
    if (from === to) continue; // the stub and the full name were the same person
    rels.set(`${from}|${to}|${r.type}`, { ...r, from, to });
  }

  return {
    ...g,
    characters: [...chars.values()],
    relationships: [...rels.values()],
  };
}

export function normaliseIds(g: ExtractedGraph): ExtractedGraph {
  const map = new Map(g.characters.map((c) => [c.id, slugifyId(c.id)]));
  // Place and faction ids are keys too, and a character's `place`/`faction`
  // points at one — so all three have to be slugified with the same rule or the
  // reference stops resolving.
  const placeMap = new Map((g.places ?? []).map((p) => [p.id, slugifyId(p.id)]));
  const factionMap = new Map((g.factions ?? []).map((f) => [f.id, slugifyId(f.id)]));
  return {
    characters: g.characters.map((c) => ({
      ...c,
      id: map.get(c.id) ?? slugifyId(c.id),
      ...(c.place ? { place: placeMap.get(c.place) ?? slugifyId(c.place) } : {}),
      ...(c.faction ? { faction: factionMap.get(c.faction) ?? slugifyId(c.faction) } : {}),
    })),
    relationships: g.relationships.map((r) => ({
      ...r,
      from: map.get(r.from) ?? slugifyId(r.from),
      to: map.get(r.to) ?? slugifyId(r.to),
    })),
    ...(g.places ? { places: g.places.map((p) => ({ ...p, id: placeMap.get(p.id) ?? slugifyId(p.id) })) } : {}),
    ...(g.factions ? { factions: g.factions.map((f) => ({ ...f, id: factionMap.get(f.id) ?? slugifyId(f.id) })) } : {}),
  };
}

export function mergeGraphs(parts: ExtractedGraph[]): ExtractedGraph {
  const chars = new Map<string, ExtractedCharacter>();
  for (const g of parts) {
    for (const c of g.characters) {
      const prev = chars.get(c.id);
      if (!prev) { chars.set(c.id, { ...c }); continue; }
      if (!prev.role && c.role) prev.role = c.role;
      // Later chunk wins. Chunks arrive in book order, so a book-2 `dead` is a
      // later fact than a book-1 `alive` and must replace it. The old rule only
      // upgraded from `unknown`, which meant a character alive in book one
      // stayed alive forever and their death was silently discarded — the
      // multi-agent path already resolved conflicts this way, and the two
      // should not disagree about what a merge means.
      if (c.status !== 'unknown') prev.status = c.status;
    }
  }
  const rels = new Map<string, ExtractedRelationship>();
  for (const g of parts) {
    for (const r of g.relationships) {
      rels.set(`${r.from}>${r.to}:${r.type}`, r);
    }
  }
  // Places and factions are unioned by id across chunks: book two names Yvelia
  // again, and that is the same realm, not a second one.
  const places = new Map<string, ExtractedPlace>();
  const factions = new Map<string, ExtractedFaction>();
  for (const g of parts) {
    for (const p of g.places ?? []) if (!places.has(p.id)) places.set(p.id, p);
    for (const f of g.factions ?? []) if (!factions.has(f.id)) factions.set(f.id, f);
  }

  return normaliseIds({
    characters: [...chars.values()],
    relationships: [...rels.values()],
    places: [...places.values()],
    factions: [...factions.values()],
  });
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
