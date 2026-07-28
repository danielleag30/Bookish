/**
 * The spoiler gate and the deterministic query engine behind the ask box.
 *
 * THE ONE RULE
 * Every read of series data goes through `gate()`. Nothing else in the codebase
 * may filter by reading position, because a second implementation is a second
 * chance to get it wrong. Phase 6's MCP server reuses this module unchanged.
 *
 * The gate lives in the data layer, not in a prompt. A model cannot be talked
 * past it, because it is never handed the data in the first place.
 *
 * WHAT IS GATED
 *  characters      hidden when `book` > position
 *  relationships   hidden when the edge's book > position, or either endpoint is
 *  events          hidden when `book` > position
 *  status          replaced by `perceived.status` while position <= untilBook
 *  identity        replaced by `perceived.identity` on the same rule
 *  affil/region    replaced by `perceived.*` — a planted spy is venin from book 1
 *                  but reads as faculty until exposed, which is a false belief
 *                  rather than a change of sides
 *  role            replaced by `perceived.role` — also spoiler-bearing, since
 *                  Brennan's true role names the signet revealed after the
 *                  reveal itself
 *  attributes      affil, region, role, status, size and magic are resolved from
 *                  `changes`, so nothing set by a later book is ever reported.
 *                  This is what fixes the Jack Barlowe leak: he read as a venin
 *                  prisoner from book 1, two reveals early.
 *  bio             withheld entirely below the final book — the bios are
 *                  whole-series prose and 25 of them name a character who has
 *                  not appeared yet. See scripts/spoiler-audit.ts.
 */
import type { Series, Character, Relationship, SeriesEvent } from './schema.ts';

export interface GatedSeries {
  position: number;
  finalBook: number;
  characters: Character[];
  relationships: Relationship[];
  events: SeriesEvent[];
  byId: Map<string, Character>;
}

/** A character as the reader currently understands them. */
export interface GatedCharacter {
  id: string;
  label: string;
  role: string;
  status: Character['status'];
  /** True when `status` reflects a belief that later turns out to be wrong. */
  statusIsBelief: boolean;
  affil: string;
  region: string;
  type?: string;
  firstBook: number;
  /** Present only at the final book; withheld earlier. See module comment. */
  bio?: string;
  bioWithheld: boolean;
}

/**
 * Build the view of a series available to a reader at `position`.
 * `position` is clamped into the series' own book range.
 */
export function gate(series: Series, position: number): GatedSeries {
  const books = series.books.map((b) => b.id);
  const finalBook = Math.max(...books);
  const minBook = Math.min(...books);
  const pos = Math.min(Math.max(position, minBook), finalBook);

  // Resolve as well as filter. Every consumer reads the gated arrays, so the
  // temporal fold happens exactly once and cannot be forgotten downstream.
  const characters = series.characters
    .filter((c) => c.book <= pos)
    .map((c) => resolveCharacter(c, pos));
  const visible = new Set(characters.map((c) => c.id));

  const relationships = series.relationships
    .filter(
      (r) =>
        r.book <= pos &&
        (r.untilBook === undefined || r.untilBook >= pos) &&
        visible.has(r.from) &&
        visible.has(r.to),
    )
    .map((r) => resolveRelationship(r, pos));

  const events = series.events.filter((e) => e.book <= pos);

  return {
    position: pos,
    finalBook,
    characters,
    relationships,
    events,
    byId: new Map(characters.map((c) => [c.id, c])),
  };
}

/**
 * Fold a character's `changes` up to `position` onto their base record.
 *
 * State at book k = base record, plus every change entry with `book <= k`,
 * applied in book order. Entries after the position are never read, so a later
 * faction, role or status cannot leak.
 */
export function resolveCharacter(c: Character, position: number): Character {
  if (!c.changes?.length) return c;
  const applicable = c.changes
    .filter((ch) => ch.book <= position)
    .sort((a, b) => a.book - b.book);
  if (applicable.length === 0) return c;
  let out: Character = { ...c };
  for (const ch of applicable) out = { ...out, ...ch.set };
  return out;
}

/** The same fold for a relationship's type and label. */
export function resolveRelationship(r: Relationship, position: number): Relationship {
  if (!r.changes?.length) return r;
  const applicable = r.changes
    .filter((ch) => ch.book <= position)
    .sort((a, b) => a.book - b.book);
  if (applicable.length === 0) return r;
  let out: Relationship = { ...r };
  for (const ch of applicable) out = { ...out, ...ch.set };
  return out;
}

/**
 * Present a character as the reader understands them at this position.
 *
 * While `position <= perceived.untilBook`, the perceived status or identity is
 * shown instead of the truth. Brennan reads as dead through book 1 because that
 * is what the reader believes until the final paragraph of Fourth Wing.
 */
export function present(input: Character, g: GatedSeries): GatedCharacter {
  // Resolve defensively. gate() already resolves everything it returns, but a
  // caller holding a raw record from series.characters would otherwise get the
  // end-state answer — which is exactly the leak this module exists to prevent.
  // Resolving is idempotent at a fixed position, so doing it twice is harmless.
  const c = resolveCharacter(input, g.position);
  const believes = c.perceived !== undefined && g.position <= c.perceived.untilBook;

  const status = believes && c.perceived?.status !== undefined ? c.perceived.status : c.status;
  const label = believes && c.perceived?.identity !== undefined ? c.perceived.identity : c.label;
  const role = believes && c.perceived?.role !== undefined ? c.perceived.role : c.role;
  const affil = believes && c.perceived?.affil !== undefined ? c.perceived.affil : c.affil;
  const region = believes && c.perceived?.region !== undefined ? c.perceived.region : c.region;

  // Segmented bios are safe to serve up to the reading position. Unsegmented
  // ones are whole-series prose, so they are withheld until the final book.
  let bio: string | undefined;
  let bioWithheld = false;
  if (c.bioByBook?.length) {
    const segs = c.bioByBook.filter((s) => s.book <= g.position);
    bio = segs.length ? segs.map((s) => s.text).join(' ') : undefined;
    bioWithheld = segs.length < c.bioByBook.length;
  } else if (c.bio) {
    if (g.position >= g.finalBook) bio = c.bio;
    else bioWithheld = true;
  }

  return {
    id: c.id,
    label,
    role,
    status,
    statusIsBelief: believes && c.perceived?.status !== undefined,
    affil,
    region,
    ...(c.type !== undefined ? { type: c.type } : {}),
    firstBook: c.book,
    ...(bio !== undefined ? { bio } : {}),
    bioWithheld,
  };
}

// ── Lookup ─────────────────────────────────────────────────────────────────

/**
 * Find visible characters by name. Exact, then prefix, then substring, then role.
 *
 * Each tier has a minimum query length, and role matching requires a word
 * boundary. Without those guards the matcher was wildly permissive: the
 * two-character fragment "of a" matched Gen Melgren, whose role is "General
 * of all Navarre's armies". That produced confident nonsense answers.
 */
export function findCharacters(g: GatedSeries, query: string): Character[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  // Substring and role matching need enough signal to be meaningful.
  const canSubstring = q.length >= 3;
  const canRole = q.length >= 4;
  const roleRe = canRole
    ? new RegExp(`(?<!\\w)${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`, 'i')
    : null;

  const score = (c: Character) => {
    const l = c.label.toLowerCase();
    const id = c.id.toLowerCase();
    if (l === q || id === q) return 0;
    if (q.length >= 2 && (l.startsWith(q) || id.startsWith(q))) return 1;
    if (canSubstring && l.includes(q)) return 2;
    if (roleRe?.test(c.role)) return 3;
    return 99;
  };
  return g.characters
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s || a.c.label.localeCompare(b.c.label))
    .map((x) => x.c);
}

export interface Connection {
  other: Character;
  type: string;
  label: string;
  book: number;
  /** Which way the stored edge points, relative to the subject. */
  direction: 'outgoing' | 'incoming';
}

/**
 * Every visible relationship touching `id`.
 *
 * Storage is directed but lookup is not: asking about Violet's family must find
 * both `violet -> lilith "mother"` and any edge pointing at her.
 */
export function connectionsOf(g: GatedSeries, id: string, type?: string): Connection[] {
  const out: Connection[] = [];
  for (const r of g.relationships) {
    if (type && r.type !== type) continue;
    if (r.from === id) {
      const other = g.byId.get(r.to);
      if (other) out.push({ other, type: r.type, label: r.label, book: r.book, direction: 'outgoing' });
    } else if (r.to === id) {
      const other = g.byId.get(r.from);
      if (other) out.push({ other, type: r.type, label: r.label, book: r.book, direction: 'incoming' });
    }
  }
  return out.sort((a, b) => a.type.localeCompare(b.type) || a.other.label.localeCompare(b.other.label));
}

/** The most-connected visible character — a better "lead" than data order. */
export function mostConnected(g: GatedSeries): Character | undefined {
  const degree = new Map<string, number>();
  for (const r of g.relationships) {
    degree.set(r.from, (degree.get(r.from) ?? 0) + 1);
    degree.set(r.to, (degree.get(r.to) ?? 0) + 1);
  }
  return [...g.characters]
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0];
}

/** Events that name this character, within the gate. */
export function eventsOf(g: GatedSeries, id: string): SeriesEvent[] {
  return g.events.filter((e) => e.involves.includes(id)).sort((a, b) => a.book - b.book);
}

export interface PathStep {
  from: Character;
  to: Character;
  type: string;
  label: string;
}

/**
 * Shortest relationship path between two visible characters, treating edges as
 * undirected. Breadth-first, so the first path found is a shortest one.
 */
export function pathBetween(g: GatedSeries, fromId: string, toId: string): PathStep[] | null {
  if (fromId === toId) return [];
  if (!g.byId.has(fromId) || !g.byId.has(toId)) return null;

  const adj = new Map<string, { to: string; type: string; label: string }[]>();
  const push = (a: string, b: string, type: string, label: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, type, label });
  };
  for (const r of g.relationships) {
    push(r.from, r.to, r.type, r.label);
    push(r.to, r.from, r.type, r.label);
  }

  const prev = new Map<string, { id: string; type: string; label: string }>();
  const seen = new Set([fromId]);
  const queue = [fromId];

  while (queue.length) {
    const cur = queue.shift()!;
    for (const edge of adj.get(cur) ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      prev.set(edge.to, { id: cur, type: edge.type, label: edge.label });
      if (edge.to === toId) {
        const steps: PathStep[] = [];
        let node = toId;
        while (node !== fromId) {
          const p = prev.get(node)!;
          steps.unshift({
            from: g.byId.get(p.id)!,
            to: g.byId.get(node)!,
            type: p.type,
            label: p.label,
          });
          node = p.id;
        }
        return steps;
      }
      queue.push(edge.to);
    }
  }
  return null;
}

// ── Question routing ───────────────────────────────────────────────────────

export type AnswerKind =
  | 'connections'
  | 'status-list'
  | 'path'
  | 'character'
  | 'events'
  | 'group'
  | 'unknown';

export interface Answer {
  kind: AnswerKind;
  /** One-line summary, safe to render as-is. */
  headline: string;
  lines: string[];
  /** Set when the answer was narrowed by the gate, so the UI can say so. */
  gatedNote?: string;
  subject?: GatedCharacter;
}

const REL_WORDS: Record<string, string> = {
  bonded: 'bonded', bond: 'bonded', dragon: 'bonded',
  family: 'family', related: 'family', relatives: 'family',
  romantic: 'romantic', romance: 'romantic', married: 'romantic', love: 'romantic',
  involved: 'romantic',
  squad: 'squad', party: 'squad',
  friend: 'friend', friends: 'friend',
  ally: 'ally', allies: 'ally', allied: 'ally',
  enemy: 'enemy', enemies: 'enemy',
  mentor: 'mentor', mentors: 'mentor', mentoring: 'mentor',
  killed: 'killed', kill: 'killed',
  betrayer: 'betrayer', betrayed: 'betrayer',
  mated: 'mated', captor: 'captor',
  commands: 'commands', commanding: 'commands',
  complicated: 'complicated',
};

const STATUS_WORDS: Record<string, string> = {
  alive: 'alive', living: 'alive', survives: 'alive',
  dead: 'dead', died: 'dead', dies: 'dead', deaths: 'dead',
  missing: 'missing', prisoner: 'prisoner', captive: 'prisoner',
};

/**
 * Answer a natural-ish question deterministically.
 *
 * No model involved: the data is already structured, so "who is Xaden bonded to
 * as of book 2" is a filter, not a generation problem. That keeps the feature
 * free, instant, and available to every visitor.
 */
/**
 * Reads a relationship type as it would appear in a question. Lives here, not
 * in askbox, because the unknown-question fallback below needs it too and
 * askbox already imports from this file.
 */
export function phrase(type: string): string {
  switch (type) {
    case 'bonded': return 'bonded to';
    case 'family': return 'related to';
    case 'romantic': return 'involved with';
    case 'squad': return 'in a squad with';
    case 'friend': return 'friends with';
    case 'ally': return 'allied with';
    case 'enemy': return 'enemies with';
    case 'mentor': return 'mentoring';
    case 'killed': return 'killed by';
    case 'mated': return 'mated to';
    case 'captor': return 'the captor of';  // "captive" collides with the status word
    case 'commands': return 'commanding';
    case 'betrayer': return 'betrayed by';
    default: return `${type} with`;
  }
}

export function ask(series: Series, position: number, question: string): Answer {
  const g = gate(series, position);
  const q = question.trim();
  const lower = q.toLowerCase();
  const words = lower.split(/[^a-z0-9']+/).filter(Boolean);

  const posBook = series.books.find((b) => b.id === g.position);
  // Include the number: DCC's book-1 short title is "DCC", so a bare short
  // title produced "Answered as of DCC", which reads as the series name.
  const posLabel = posBook ? `Book ${posBook.id} · ${posBook.short}` : `book ${g.position}`;
  // The panel header already states the reading position, so the note only
  // appears when something is genuinely being withheld, and the headlines below
  // do not repeat it either. Three mentions of the same book per answer read as
  // noise.
  const gatedNote =
    g.position < g.finalBook ? 'Later books are hidden.' : undefined;

  // "how are X and Y connected"
  const between = /(?:between|connect\w*)\s+(.+?)\s+(?:and|to|with)\s+(.+?)[?.]?$/i.exec(q)
    ?? /^(?:how (?:are|is)\s+)?(.+?)\s+(?:and|to)\s+(.+?)\s+(?:connected|related)[?.]?$/i.exec(q);
  if (between) {
    const a = findCharacters(g, between[1]!)[0];
    const b = findCharacters(g, between[2]!)[0];
    if (a && b) {
      const path = pathBetween(g, a.id, b.id);
      if (!path) {
        return {
          kind: 'path', gatedNote,
          headline: `No connection between ${a.label} and ${b.label}.`,
          lines: ['They may be linked in a later book.'],
        };
      }
      return {
        kind: 'path', gatedNote,
        headline: `${a.label} → ${b.label} in ${path.length} step${path.length === 1 ? '' : 's'}`,
        lines: path.map(
          (s) => `${s.from.label} —[${s.type}${s.label ? `: ${s.label}` : ''}]→ ${s.to.label}`,
        ),
      };
    }
  }

  // "who is alive / who died"
  const relWordEarly = words.map((w) => REL_WORDS[w]).find(Boolean);
  const statusWord = words.map((w) => STATUS_WORDS[w]).find(Boolean);
  if (statusWord && !relWordEarly && /\b(who|which|list|everyone|all)\b/.test(lower)) {
    const hits = g.characters
      .map((c) => present(c, g))
      .filter((c) => c.status === statusWord);
    return {
      kind: 'status-list', gatedNote,
      headline: `${hits.length} character${hits.length === 1 ? '' : 's'} ${statusWord}`,
      lines: hits.map(
        (c) => `${c.label}${c.role ? ` — ${c.role}` : ''}${c.statusIsBelief ? '  (as far as you know)' : ''}`,
      ),
    };
  }

  // Anything naming a character
  const subject = findCharacters(g, stripQuestionWords(q))[0]
    ?? findCharacters(g, longestNameLike(g, q))[0];

  if (subject) {
    const relWord = words.map((w) => REL_WORDS[w]).find(Boolean);

    if (relWord) {
      const conns = connectionsOf(g, subject.id, relWord);
      const p = present(subject, g);
      return {
        kind: 'connections', gatedNote, subject: p,
        headline: conns.length
          ? `${p.label} — ${relWord} (${conns.length})`
          : `${p.label} has no ${relWord} relationships yet.`,
        lines: conns.map((c) => `${c.other.label}${c.label ? ` — ${c.label}` : ''}`),
      };
    }

    if (/\b(happen|happened|events?|story|arc)\b/.test(lower)) {
      const evs = eventsOf(g, subject.id);
      const p = present(subject, g);
      return {
        kind: 'events', gatedNote, subject: p,
        headline: evs.length
          ? `${p.label} — ${evs.length} event${evs.length === 1 ? '' : 's'}`
          : `Nothing recorded for ${p.label} yet.`,
        lines: evs.map((e) => `Book ${e.book} · ${e.text}`),
      };
    }

    // Default: the character card
    const p = present(subject, g);
    const conns = connectionsOf(g, subject.id);
    const lines: string[] = [];
    if (p.role) lines.push(p.role);
    lines.push(
      `Status: ${p.status}${p.statusIsBelief ? ' — as far as you know at this point' : ''}`,
    );
    lines.push(`First appears: book ${p.firstBook}`);
    if (conns.length) {
      lines.push('');
      lines.push(`Connections (${conns.length}):`);
      for (const c of conns.slice(0, 12)) {
        lines.push(`  ${c.type}: ${c.other.label}${c.label ? ` — ${c.label}` : ''}`);
      }
      if (conns.length > 12) lines.push(`  … and ${conns.length - 12} more`);
    }
    if (p.bio) {
      lines.push('');
      lines.push(p.bio);
    } else if (p.bioWithheld) {
      lines.push('');
      lines.push('(Biography hidden — it describes later books.)');
    }
    return { kind: 'character', gatedNote, subject: p, headline: p.label, lines };
  }

  // Group listing by faction or kind
  for (const [id, aff] of Object.entries(series.affiliations)) {
    if (lower.includes(aff.label.toLowerCase()) || lower.includes(id)) {
      const hits = g.characters.filter((c) => c.affil === id).map((c) => present(c, g));
      return {
        kind: 'group', gatedNote,
        headline: `${aff.label} — ${hits.length} character${hits.length === 1 ? '' : 's'}`,
        lines: hits.map((c) => `${c.label}${c.role ? ` — ${c.role}` : ''}`),
      };
    }
  }

  // Examples come from the reader's own series, gated to their position. The
  // hardcoded set named Xaden, Violet, Dain and Liam, so failing a question on
  // the Fae & Alchemy chart suggested four Empyrean characters — and on any
  // chart it could name someone the reader had not met yet.
  const lead = mostConnected(g);
  const other = g.characters.find((c) => c.id !== lead?.id);
  const examples = ['  who is alive'];
  if (lead) {
    const type = g.relationships.find((r) => r.from === lead.id || r.to === lead.id)?.type;
    if (type) examples.unshift(`  who is ${lead.label} ${phrase(type)}`);
    examples.push(`  what happened to ${lead.label}`);
    if (other) examples.push(`  how are ${lead.label} and ${other.label} connected`);
  }

  return {
    kind: 'unknown', gatedNote,
    headline: "I couldn't match that to anyone on the chart.",
    lines: ['Try a name, or:', ...examples],
  };
}

const QUESTION_WORDS = new Set([
  'who', 'is', 'are', 'was', 'were', 'the', 'a', 'an', 'to', 'of', 'as', 'at',
  'in', 'on', 'by', 'for', 'and', 'or', 'what', 'which', 'how', 'does', 'do',
  'did', 'happened', 'happen', 'tell', 'me', 'about', 'show', 'list', 'all',
  'still', 'now', 'currently', 'book', 'right',
]);

function stripQuestionWords(q: string): string {
  return q
    .replace(/[?.,!]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !QUESTION_WORDS.has(w.toLowerCase()) && !/^\d+$/.test(w))
    .join(' ')
    .trim();
}

/** Longest run of words in the question that matches a visible character. */
function longestNameLike(g: GatedSeries, q: string): string {
  const toks = q.replace(/[?.,!]/g, ' ').split(/\s+/).filter(Boolean);
  for (let len = Math.min(4, toks.length); len >= 1; len--) {
    for (let i = 0; i + len <= toks.length; i++) {
      const run = toks.slice(i, i + len);
      // Skip runs made entirely of stop words. Checking the joined string was
      // not enough: "of a" is not in QUESTION_WORDS even though both words are.
      if (run.every((w) => QUESTION_WORDS.has(w.toLowerCase()))) continue;
      const cand = run.join(' ');
      if (findCharacters(g, cand).length) return cand;
    }
  }
  return '';
}
