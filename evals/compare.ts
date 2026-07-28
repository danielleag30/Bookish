/**
 * Scoring an extracted graph against hand-labelled ground truth.
 *
 * The point of this file is that it is boring and explicit. Every judgement
 * call — what counts as the same character, what counts as the same edge — is
 * written down here rather than buried in a prompt, because those calls move the
 * numbers more than the model does.
 *
 * ENTITY RESOLUTION
 * Predicted ids are matched to truth ids by normalising: lowercase, strip
 * punctuation and titles, and try the given name alone. "King Tauri" and
 * "king_tauri" and "tauri" all resolve to the same character. This is generous
 * on purpose: the interesting failures are wrong relationships, not spelling.
 *
 * WHY EDGES ARE SCORED UNDIRECTED FOR SYMMETRIC TYPES
 * `romantic` reads the same both ways, so scoring it directed would punish a
 * coin flip. Directed types are scored directed, because getting `killed`
 * backwards is a real error — it was a real error in the source data.
 */
import type { Series, Character } from '../src/schema.ts';
import { RELATIONSHIP_BY_ID } from '../src/relationships.ts';
import type { ExtractedGraph } from '../pipeline/extract.ts';

const TITLES = new Set([
  'king', 'queen', 'prince', 'princess', 'lord', 'lady', 'major', 'colonel',
  'col', 'general', 'gen', 'professor', 'prof', 'captain', 'commandant',
  'commander', 'vice', 'sir', 'dame', 'the',
]);

/** Every string that should resolve to this character. */
function aliasesOf(c: Character): string[] {
  const out = new Set<string>([c.id, c.label]);
  for (const a of c.aliases ?? []) out.add(a);
  for (const src of [c.label, ...(c.aliases ?? [])]) {
    const words = src.split(/[\s·/,'"]+/).filter(Boolean);
    const meaningful = words.filter((w) => !TITLES.has(w.toLowerCase()));
    if (meaningful.length) {
      out.add(meaningful.join(' '));
      out.add(meaningful[0]!);
      if (meaningful.length > 1) out.add(meaningful[meaningful.length - 1]!);
    }
  }
  return [...out];
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w && !TITLES.has(w))
    .join(' ')
    .trim();
}

/** Build a lookup from any normalised alias to a truth character id. */
export function buildResolver(truth: Series): Map<string, string> {
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  // Exact ids are unique by construction, so they are registered separately and
  // are never dropped as ambiguous. Without this, "king_tauri" normalises to
  // "tauri", collides with "Aaric / Cam Tauri", and resolves to nobody.
  const exact = new Map<string, string>();
  for (const c of truth.characters) exact.set(norm(c.id.replace(/[_-]+/g, ' ')), c.id);
  for (const c of truth.characters) {
    for (const a of aliasesOf(c)) {
      const k = norm(a);
      if (!k) continue;
      const existing = map.get(k);
      if (existing && existing !== c.id) { ambiguous.add(k); continue; }
      map.set(k, c.id);
    }
  }
  // A key that could mean two characters is worse than no key at all: it would
  // credit a hit that might be the wrong person.
  for (const k of ambiguous) map.delete(k);
  // Re-apply the exact-id keys last so they survive the ambiguity sweep.
  for (const [k, id] of exact) if (k) map.set(k, id);
  return map;
}

export interface Prf {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

function prf(tp: number, fp: number, fn: number): Prf {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { truePositives: tp, falsePositives: fp, falseNegatives: fn, precision, recall, f1 };
}

export interface EdgeMiss {
  from: string;
  to: string;
  type: string;
  label: string;
}

export interface WrongType {
  from: string;
  to: string;
  predicted: string;
  actual: string;
}

export interface Reversed {
  from: string;
  to: string;
  type: string;
}

export interface EvalReport {
  nodes: Prf;
  /**
   * Nodes scored only against truth characters the corpus actually names.
   *
   * Overall recall is capped by the corpus: an event log of a few lines per book
   * cannot mention 72 characters, so most misses are a corpus limit rather than a
   * model failure. This is the number that moves when the prompt improves.
   */
  nodesInCorpus: Prf;
  /** Truth characters the corpus never names, so recall could never find them. */
  outOfCorpus: number;
  edges: Prf;
  edgesByType: Record<string, Prf>;
  /** Predicted ids that resolved to no known character. */
  unresolved: string[];
  /** Truth characters the extraction never found. */
  missedCharacters: string[];
  /** Correct pair and direction, wrong relationship type. */
  wrongType: WrongType[];
  /** Correct pair and type, but backwards on a directed type. */
  reversed: Reversed[];
  /** Edges invented that truth has no record of. */
  spuriousEdges: EdgeMiss[];
  /** Truth edges never found. */
  missedEdges: EdgeMiss[];
}

const edgeKey = (from: string, to: string, type: string, symmetric: boolean) =>
  symmetric
    ? `${[from, to].sort().join('|')}:${type}`
    : `${from}>${to}:${type}`;

const isSymmetric = (type: string) => RELATIONSHIP_BY_ID.get(type)?.symmetric ?? false;

/**
 * Score a prediction.
 *
 * `truth` is filtered to the reading position the extraction saw, so recall is
 * not punished for characters the corpus could not have mentioned.
 */
export function evaluate(
  predicted: ExtractedGraph,
  truth: Series,
  truthCharacters: Character[] = truth.characters,
  /** The text the extraction saw, so reachable recall can be separated out. */
  corpus?: string,
): EvalReport {
  const resolver = buildResolver(truth);
  const truthIds = new Set(truthCharacters.map((c) => c.id));

  // ── Nodes ────────────────────────────────────────────────────────────────
  const resolvedPred = new Map<string, string>(); // predicted id -> truth id
  const unresolved: string[] = [];
  for (const c of predicted.characters) {
    const hit = resolver.get(norm(c.id)) ?? resolver.get(norm(c.label));
    if (hit && truthIds.has(hit)) resolvedPred.set(c.id, hit);
    else unresolved.push(c.label || c.id);
  }
  const foundTruth = new Set(resolvedPred.values());
  const missedCharacters = truthCharacters
    .filter((c) => !foundTruth.has(c.id))
    .map((c) => c.label);

  const nodes = prf(foundTruth.size, unresolved.length, missedCharacters.length);

  // Which truth characters could the corpus have yielded at all?
  const inCorpus = corpus === undefined
    ? truthCharacters
    : truthCharacters.filter((c) => {
        const hay = norm(corpus);
        // Only count a name that identifies this character and no other.
        // Matching any alias let the surname in "Violet Sorrengail" mark all
        // five Sorrengails as reachable, deflating in-corpus recall.
        return aliasesOf(c).some((a) => {
          const n = norm(a);
          if (n.length < 3) return false;
          if (resolver.get(n) !== c.id) return false;
          return new RegExp(`(?:^| )${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`).test(hay);
        });
      });
  const inCorpusIds = new Set(inCorpus.map((c) => c.id));
  const foundInCorpus = [...foundTruth].filter((id) => inCorpusIds.has(id)).length;
  const nodesInCorpus = prf(
    foundInCorpus,
    unresolved.length,
    inCorpus.length - foundInCorpus,
  );
  const outOfCorpus = truthCharacters.length - inCorpus.length;

  // ── Edges ────────────────────────────────────────────────────────────────
  const truthEdges = truth.relationships.filter(
    (r) => truthIds.has(r.from) && truthIds.has(r.to),
  );
  const truthByKey = new Map<string, typeof truthEdges[number]>();
  /** pair -> the truth types linking it, for the wrong-type diagnosis. */
  const truthByPair = new Map<string, string[]>();
  for (const r of truthEdges) {
    truthByKey.set(edgeKey(r.from, r.to, r.type, isSymmetric(r.type)), r);
    const pk = [r.from, r.to].sort().join('|');
    truthByPair.set(pk, [...(truthByPair.get(pk) ?? []), r.type]);
  }

  const matched = new Set<string>();
  const wrongType: WrongType[] = [];
  const reversed: Reversed[] = [];
  const spuriousEdges: EdgeMiss[] = [];

  for (const r of predicted.relationships) {
    const from = resolvedPred.get(r.from);
    const to = resolvedPred.get(r.to);
    if (!from || !to || from === to) {
      spuriousEdges.push({ from: r.from, to: r.to, type: r.type, label: r.label });
      continue;
    }
    const sym = isSymmetric(r.type);
    const key = edgeKey(from, to, r.type, sym);
    if (truthByKey.has(key)) { matched.add(key); continue; }

    // Right pair and type, wrong way round — only meaningful when directed.
    if (!sym && truthByKey.has(edgeKey(to, from, r.type, false))) {
      reversed.push({ from, to, type: r.type });
      continue;
    }
    // Right pair, wrong type.
    const pairTypes = truthByPair.get([from, to].sort().join('|'));
    if (pairTypes?.length) {
      wrongType.push({ from, to, predicted: r.type, actual: pairTypes.join('/') });
      continue;
    }
    spuriousEdges.push({ from, to, type: r.type, label: r.label });
  }

  const missedEdges = truthEdges
    .filter((r) => !matched.has(edgeKey(r.from, r.to, r.type, isSymmetric(r.type))))
    .map((r) => ({ from: r.from, to: r.to, type: r.type, label: r.label }));

  // Reversed and wrong-type both count as a miss and a false positive: the
  // prediction is wrong, and the truth edge went unfound.
  const fp = spuriousEdges.length + wrongType.length + reversed.length;
  const edges = prf(matched.size, fp, missedEdges.length);

  // ── Per type ─────────────────────────────────────────────────────────────
  const edgesByType: Record<string, Prf> = {};
  const types = new Set([
    ...truthEdges.map((r) => r.type),
    ...predicted.relationships.map((r) => r.type),
  ]);
  for (const type of types) {
    const sym = isSymmetric(type);
    const tKeys = new Set(
      truthEdges.filter((r) => r.type === type)
        .map((r) => edgeKey(r.from, r.to, type, sym)),
    );
    let tp = 0;
    let typeFp = 0;
    const seen = new Set<string>();
    for (const r of predicted.relationships.filter((x) => x.type === type)) {
      const from = resolvedPred.get(r.from);
      const to = resolvedPred.get(r.to);
      if (!from || !to) { typeFp++; continue; }
      const k = edgeKey(from, to, type, sym);
      if (tKeys.has(k) && !seen.has(k)) { tp++; seen.add(k); } else typeFp++;
    }
    edgesByType[type] = prf(tp, typeFp, tKeys.size - tp);
  }

  return {
    nodes, nodesInCorpus, outOfCorpus, edges, edgesByType, unresolved, missedCharacters,
    wrongType, reversed, spuriousEdges, missedEdges,
  };
}

/**
 * Count entities the prediction named that the reader could not know yet.
 *
 * A temporal leak is the failure this project cares about most: the whole point
 * of the chart is that it does not get ahead of you.
 */
export function temporalLeaks(
  predicted: ExtractedGraph,
  truth: Series,
  position: number,
): string[] {
  const resolver = buildResolver(truth);
  const byId = new Map(truth.characters.map((c) => [c.id, c]));
  const leaks: string[] = [];
  for (const c of predicted.characters) {
    const id = resolver.get(norm(c.id)) ?? resolver.get(norm(c.label));
    const t = id ? byId.get(id) : undefined;
    if (t && t.book > position) leaks.push(`${t.label} (book ${t.book})`);
  }
  return [...new Set(leaks)];
}
