/**
 * One-time migration: lift the inline chart data out of each chart's
 * index.html and write it to data/<series>.json in the shared schema.
 *
 *   node scripts/extract-charts.mjs
 *
 * Rather than regex-parsing values (which mangles nested quotes, unicode and
 * apostrophes in the bios), this pulls each `const NAME = <literal>` out by
 * balanced-bracket matching and evaluates just that literal. Nothing else in
 * the file runs, so there is no DOM dependency and no side effects.
 *
 * Normalisation applied, and why:
 *  - DCC stores factions across three parallel maps (FC/FL/FEMOJI). Empyrean
 *    uses one AFFIL object. Both become a single `affiliations` map.
 *  - DCC calls the field `faction`, Empyrean calls it `affil`. Both -> `affil`.
 *  - Per-character Y_OFFSETS (Empyrean only) fold into each character.
 *  - REL_TYPES' "all" entry is a UI filter pseudo-type, not a relationship.
 *  - Events are plain strings today. They become objects carrying the ids of
 *    the characters they mention plus a derived `kind`.
 *  - Long-tail series-specific scalars (DCC's f9/magic, Empyrean's den/signet/
 *    wing/homeland/...) move into `attrs` so the core schema stays shared.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dataDir = join(root, 'data');

/** Pull `const NAME = <balanced literal>` out of source and return the literal text. */
function extractConst(src, name) {
  const decl = new RegExp(`const\\s+${name}\\s*=\\s*`);
  const m = decl.exec(src);
  if (!m) return null;

  let i = m.index + m[0].length;
  const open = src[i];
  if (open !== '{' && open !== '[') {
    // Scalar such as `const BH = 105;`
    const end = src.indexOf(';', i);
    return src.slice(i, end);
  }
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }

    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return src.slice(m.index + m[0].length, i + 1);
    }
  }
  throw new Error(`Unbalanced literal for const ${name}`);
}

/** Evaluate the named consts from a chart file into real JS values. */
async function loadConsts(file, names) {
  const src = readFileSync(file, 'utf8');
  const parts = [];
  const found = [];
  for (const n of names) {
    const lit = extractConst(src, n);
    if (lit === null) continue;
    parts.push(`export const ${n} = ${lit};`);
    found.push(n);
  }
  let mod;
  try {
    mod = await import(
      'data:text/javascript;base64,' + Buffer.from(parts.join('\n'), 'utf8').toString('base64')
    );
  } catch (err) {
    // Surface the real cause; dumping the data: URL is useless noise.
    throw new Error(
      `Failed to evaluate extracted consts from ${file}\n` +
      `  extracted: ${found.join(', ')}\n` +
      `  cause: ${err instanceof Error ? err.message : String(err)}\n` +
      `  hint: a literal may reference a helper constant that was not extracted ` +
      `(e.g. BANDS using \`h:BH\`). Add it to the series' \`consts\` list, before its first use.`,
    );
  }
  return { values: mod, found };
}

// ── Relationship direction semantics ───────────────────────────────────────
// Derived by reading the labels in the real data. `from` is the actor:
//   killed    lilith -> fen      "executed him"
//   mentor    devera -> violet   "trustworthy prof"
//   betrayer  markham -> violet  "groomed her"
//   family    violet -> lilith   "mother"   (to IS from's <label>)
// Storage stays directed; queries search both directions. `symmetric` is used
// only to flag redundant reversed duplicates and to decide arrowheads later.
const SYMMETRIC_TYPES = new Set(['mated', 'romantic', 'squad', 'party', 'ally', 'complicated']);

// ── Event kind derivation ──────────────────────────────────────────────────
const KIND_RULES = [
  ['death',     /\b(dies|died|killed|kills|kill|dead|deaths?|sacrifices|executed|slain|murdered|perishes)\b/i],
  ['betrayal',  /\b(betray\w*|turns on|defects?|spy|traitor|abandons?)\b/i],
  ['battle',    /\b(battle|war|siege|assault|attack|defen[cs]e|fight|invasion|raid)\b/i],
  ['reveal',    /\b(reveal\w*|discovers?|truth|uncovers?|learns?|exposed?)\b/i],
  ['bond',      /\b(bonds?|bonded|mated|marri\w+|joins?|forms?|adopts?)\b/i],
];
function deriveKind(text) {
  for (const [kind, re] of KIND_RULES) if (re.test(text)) return kind;
  return 'other';
}

// Titles are not identifying: "Princess" would otherwise link Princess Donut
// to the unrelated "Princess Posse", and "Major" would link Major Varrish to
// any other major.
const TITLE_TOKENS = new Set([
  'king', 'queen', 'prince', 'princess', 'lord', 'lady', 'major', 'colonel',
  'general', 'gen', 'professor', 'prof', 'captain', 'commandant', 'vice',
  'war', 'mage', 'the', 'of', 'and',
]);

/**
 * Build the candidate needles for matching characters inside event text.
 *
 * A bare name token is only usable when it identifies exactly ONE character.
 * Without that rule, surnames wreck the linking: "Violet Sorrengail forced
 * from Scribes" linked all five Sorrengails, and "Falls for Xaden Riorson"
 * dragged in Fen and Talia Riorson.
 */
function buildCandidates(characters) {
  const tokenOwners = new Map(); // token -> Set<characterId>
  const tokensFor = new Map();  // characterId -> string[]

  for (const c of characters) {
    const toks = new Set();

    // Quoted nicknames, e.g. Catriona 'Cat' Cordella -> Cat
    for (const m of c.label.matchAll(/['"“”‘’]([^'"“”‘’]{2,})['"“”‘’]/g)) {
      toks.add(m[1].trim());
    }
    // Plain word tokens
    for (const raw of c.label.split(/[\s·/,]+/)) {
      const t = raw.replace(/['"“”‘’]/g, '').trim();
      if (t.length >= 3 && !TITLE_TOKENS.has(t.toLowerCase())) toks.add(t);
    }

    tokensFor.set(c.id, [...toks]);
    for (const t of toks) {
      if (!tokenOwners.has(t)) tokenOwners.set(t, new Set());
      tokenOwners.get(t).add(c.id);
    }
  }

  const candidates = [];
  for (const c of characters) {
    candidates.push({ id: c.id, needle: c.label });
    for (const t of tokensFor.get(c.id)) {
      if (t === c.label) continue;
      if (tokenOwners.get(t).size !== 1) continue; // ambiguous -> unusable
      candidates.push({ id: c.id, needle: t });
    }
  }
  candidates.sort((a, b) => b.needle.length - a.needle.length);
  return candidates;
}

/** Find which characters an event sentence mentions. */
function deriveInvolves(text, candidates) {
  const hits = new Set();

  for (const { id, needle } of candidates) {
    if (hits.has(id)) continue;
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Trailing boundary must allow an apostrophe so possessives match:
    // "Xaden's venin" -> xaden, "Katia's orchid" -> katia. Excluding `'`
    // here silently dropped those links.
    // Short names are matched case-sensitively, so the common noun "cat"
    // does not link to the character "Cat".
    const flags = needle.length >= 4 ? 'i' : '';
    if (new RegExp(`(?<!\\w)${esc}(?!\\w)`, flags).test(text)) hits.add(id);
  }
  return [...hits];
}

// ── Character normalisation ────────────────────────────────────────────────
const CORE_CHAR_FIELDS = new Set([
  'id', 'label', 'role', 'type', 'affil', 'faction', 'band',
  'book', 'lastBook', 'status', 'size', 'x', 'bio',
]);

/**
 * The two charts used different status vocabularies: Empyrean had seven values,
 * DCC had two. Map to a shared set, keeping `missing` and `prisoner` distinct
 * because those characters are not dead, and preserving the original wording in
 * `statusDetail` since "sacrificed" and "executed" say more than "dead".
 */
const STATUS_MAP = {
  alive: 'alive',
  dead: 'dead',
  killed: 'dead',
  deceased: 'dead',
  sacrificed: 'dead',
  executed: 'dead',
  missing: 'missing',
  prisoner: 'prisoner',
  unknown: 'unknown',
};

function normaliseStatus(raw, id, notes) {
  const key = String(raw ?? '').toLowerCase();
  const mapped = STATUS_MAP[key];
  if (!mapped) {
    notes.push(`unmapped status "${raw}" on "${id}" — defaulted to "unknown"`);
    return { status: 'unknown', statusDetail: String(raw) };
  }
  return { status: mapped, statusDetail: mapped === key ? undefined : key };
}

function normaliseCharacter(n, yOffsets, notes) {
  const attrs = {};
  for (const [k, v] of Object.entries(n)) {
    if (CORE_CHAR_FIELDS.has(k)) continue;
    if (v === undefined || v === null || v === '') continue;
    attrs[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }

  const out = {
    id: n.id,
    label: n.label,
    role: n.role ?? '',
    affil: n.affil ?? n.faction,
    band: n.band,
    book: n.book,
    lastBook: n.lastBook,
    size: n.size ?? 'side',
    x: n.x,
  };
  const { status, statusDetail } = normaliseStatus(n.status, n.id, notes);
  out.status = status;
  if (statusDetail) out.statusDetail = statusDetail;
  if (n.type) out.type = n.type;
  if (n.bio) out.bio = n.bio;
  if (yOffsets && yOffsets[n.id] !== undefined) out.yOffset = yOffsets[n.id];
  if (Object.keys(attrs).length) out.attrs = attrs;
  return out;
}

// ── Canon corrections ──────────────────────────────────────────────────────
/**
 * Corrections to the source data, each verified against series canon rather
 * than guessed. Applied here so they survive re-extraction instead of being
 * hand-edited into the JSON. See DATA-REVIEW.md for the reasoning and sources.
 *
 * Note that the fix direction differs case by case, which is exactly why these
 * were not resolved by one blanket rule:
 *  - Halden and Theophanie genuinely first appear later, so the RELATIONSHIP's
 *    book was wrong.
 *  - Berwyn genuinely appears earlier (he turns Xaden venin at the end of Iron
 *    Flame, book 2), so the CHARACTER's book was wrong.
 */
const CORRECTIONS = {
  empyrean: {
    characters: [
      { id: 'lilith', set: { lastBook: 2 },
        why: 'Dies at the Battle of Basgiath in Iron Flame (book 2); lastBook 1 hid her from the book she dies in' },
      { id: 'aimsir', set: { lastBook: 2 },
        why: "Lilith's dragon — her lifeforce is siphoned into the wardstone in the same book-2 scene" },
      { id: 'berwyn', set: { book: 2 },
        why: 'The venin general who turns Xaden venin at the end of Iron Flame (book 2), not book 3' },
    ],
    relationships: [
      { match: 'king_tauri>halden:family', set: { book: 3 },
        why: 'Halden is referenced in book 1 but first appears on-page in Onyx Storm (book 3)' },
      { match: 'halden>aaric:family', set: { book: 3 },
        why: 'Same — the edge cannot render before Halden appears' },
      { match: 'wyvern_rep>theophanie:ally', set: { book: 3 },
        why: 'Theophanie first appears in Onyx Storm (book 3)' },
      { match: 'wyvern_rep>berwyn:ally', set: { book: 2 },
        why: 'Follows Berwyn moving to book 2' },
    ],
    dropRelationships: [
      { match: 'quinn>theophanie:killed',
        why: 'Quinn is killed by an unnamed venin in a tower at Draithus, and Violet — not Quinn — ' +
             'kills Theophanie. The edge is wrong in both directions; her death is already carried by ' +
             'status "dead" and the book-3 event' },
      { match: 'trager>silaraine:killed',
        why: 'Neither killed the other — rider and gryphon were burned together on Zinhal. ' +
             'A `bonded` edge between them already exists, and the shared death is in both statuses' },
    ],
  },
};

function applyCharacterCorrections(characters, seriesId, notes) {
  for (const c of CORRECTIONS[seriesId]?.characters ?? []) {
    const target = characters.find((x) => x.id === c.id);
    if (!target) {
      notes.push(`correction skipped — no character "${c.id}"`);
      continue;
    }
    for (const [k, v] of Object.entries(c.set)) {
      if (target[k] === v) continue;
      notes.push(`corrected ${c.id}.${k}: ${target[k]} -> ${v} (${c.why})`);
      target[k] = v;
    }
  }
  return characters;
}

// ── Relationship normalisation, incl. reversed-duplicate merge ─────────────
/**
 * Reversed duplicates found in the Empyrean data. Both directions describe one
 * fact, so one edge is dropped and the surviving label is widened to keep the
 * information from both.
 */
const EDGE_MERGES = {
  empyrean: [
    { drop: 'liam>sloane:family', keep: 'sloane>liam:family', label: 'sister' },
    { drop: 'xaden>violet:romantic', keep: 'violet>xaden:romantic', label: 'slow burn → married (Bk3)' },
  ],
};

function normaliseRelationships(edges, seriesId, notes) {
  const merges = EDGE_MERGES[seriesId] ?? [];
  const dropKeys = new Set(merges.map((m) => m.drop));
  const relabel = new Map(merges.filter((m) => m.label).map((m) => [m.keep, m.label]));

  const corr = CORRECTIONS[seriesId] ?? {};
  const setBy = new Map((corr.relationships ?? []).map((r) => [r.match, r]));
  const dropBy = new Map((corr.dropRelationships ?? []).map((r) => [r.match, r]));

  const out = [];
  for (const e of edges) {
    const key = `${e.from}>${e.to}:${e.type}`;
    if (dropKeys.has(key)) {
      notes.push(`merged reversed duplicate: dropped ${key}`);
      continue;
    }
    if (dropBy.has(key)) {
      notes.push(`dropped ${key} — ${dropBy.get(key).why}`);
      continue;
    }
    const rel = { from: e.from, to: e.to, type: e.type, book: e.book, label: e.label ?? '' };
    if (relabel.has(key) && relabel.get(key) !== rel.label) {
      notes.push(`relabelled ${key}: "${rel.label}" -> "${relabel.get(key)}"`);
      rel.label = relabel.get(key);
    }
    if (setBy.has(key)) {
      const { set, why } = setBy.get(key);
      for (const [k, v] of Object.entries(set)) {
        if (rel[k] === v) continue;
        notes.push(`corrected ${key}.${k}: ${rel[k]} -> ${v} (${why})`);
        rel[k] = v;
      }
    }
    out.push(rel);
  }
  return out;
}

function normaliseRelTypes(relTypes) {
  return relTypes
    .filter((r) => r.id !== 'all') // UI filter pseudo-type, not a relationship
    .map((r) => ({
      id: r.id,
      // The legend labelled `killed` as "Killed by", but the data stores
      // killer -> victim, so "Killed by" renders the edge backwards.
      label: r.id === 'killed' ? 'Killed' : r.label,
      color: r.color,
      dash: r.dash ?? null,
      symmetric: SYMMETRIC_TYPES.has(r.id),
    }));
}

function normaliseEvents(keyEvents, characters) {
  const candidates = buildCandidates(characters);
  const out = [];
  for (const [book, list] of Object.entries(keyEvents)) {
    for (const text of list) {
      out.push({
        book: Number(book),
        text,
        involves: deriveInvolves(text, candidates),
        kind: deriveKind(text),
      });
    }
  }
  return out;
}

// ── Series definitions ─────────────────────────────────────────────────────
const SERIES = [
  {
    id: 'empyrean',
    title: 'The Empyrean',
    author: 'Rebecca Yarros',
    file: 'Empyrean-Chart/index.html',
    consts: ['BH', 'BOOKS', 'BANDS', 'AFFIL', 'DRAGON_DEN', 'TYPE_SHAPES', 'SIGNET_GLYPHS',
             'BOOK_TRANSITIONS', 'REL_TYPES', 'KEY_EVENTS', 'NODES', 'EDGES', 'Y_OFFSETS'],
    build(v) {
      return {
        affiliations: v.AFFIL,
        characterTypes: v.TYPE_SHAPES,
        subgroups: { dens: v.DRAGON_DEN },
        glyphs: v.SIGNET_GLYPHS,
        bookTransitions: v.BOOK_TRANSITIONS,
        yOffsets: v.Y_OFFSETS,
      };
    },
  },
  {
    id: 'dcc',
    title: 'Dungeon Crawler Carl',
    author: 'Matt Dinniman',
    file: 'DCC-Chart/index.html',
    consts: ['BH', 'BOOKS', 'BANDS', 'FC', 'FL', 'FEMOJI', 'REL_TYPES', 'KEY_EVENTS', 'NODES', 'EDGES'],
    build(v) {
      // Fold the three parallel faction maps into one affiliations map.
      const affiliations = {};
      for (const id of Object.keys(v.FL ?? {})) {
        affiliations[id] = {
          label: v.FL[id],
          color: v.FC?.[id] ?? '#888888',
          emoji: v.FEMOJI?.[id],
        };
      }
      return { affiliations, yOffsets: null };
    },
  },
];

// ── Run ────────────────────────────────────────────────────────────────────
mkdirSync(dataDir, { recursive: true });

const summary = [];

for (const s of SERIES) {
  const notes = [];
  const { values, found } = await loadConsts(join(root, s.file), s.consts);
  const missing = s.consts.filter((c) => !found.includes(c));
  if (missing.length) notes.push(`consts not present in source: ${missing.join(', ')}`);

  const extra = s.build(values);
  const characters = applyCharacterCorrections(
    values.NODES.map((n) => normaliseCharacter(n, extra.yOffsets, notes)),
    s.id,
    notes,
  );
  const relationships = normaliseRelationships(values.EDGES, s.id, notes);
  const events = normaliseEvents(values.KEY_EVENTS, characters);

  const series = {
    id: s.id,
    title: s.title,
    author: s.author,
    books: values.BOOKS,
    bands: values.BANDS,
    affiliations: extra.affiliations,
    relationshipTypes: normaliseRelTypes(values.REL_TYPES),
    characters,
    relationships,
    events,
  };
  if (extra.characterTypes) series.characterTypes = extra.characterTypes;
  if (extra.subgroups) series.subgroups = extra.subgroups;
  if (extra.glyphs) series.glyphs = extra.glyphs;
  if (extra.bookTransitions) series.bookTransitions = extra.bookTransitions;

  const outFile = join(dataDir, `${s.id}.json`);
  writeFileSync(outFile, JSON.stringify(series, null, 2) + '\n');

  const unlinked = events.filter((e) => e.involves.length === 0).length;
  summary.push({
    series: s.id,
    books: series.books.length,
    characters: characters.length,
    relationships: relationships.length,
    events: events.length,
    eventsWithNoCharacter: unlinked,
    notes,
  });
}

console.log('\nExtraction complete.\n');
for (const s of summary) {
  console.log(`${s.series}`);
  console.log(`  books ${s.books} · characters ${s.characters} · relationships ${s.relationships} · events ${s.events}`);
  console.log(`  events with no character matched: ${s.eventsWithNoCharacter}`);
  for (const n of s.notes) console.log(`  note: ${n}`);
  console.log();
}
