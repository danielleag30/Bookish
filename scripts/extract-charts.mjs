/**
 * One-time migration: lift the inline chart data out of the ORIGINAL hand-built
 * charts and write it to data/<series>.json in the shared schema.
 *
 *   node scripts/extract-charts.mjs
 *
 * Reads from sources/, which holds the three original chart files as they stood
 * before the engine extraction. The live pages under *-Chart/ are now thin
 * shells that load data/*.json, so they no longer contain the inline arrays this
 * script parses — keeping the originals here is what makes the migration
 * re-runnable and auditable. data/*.json is the source of truth going forward;
 * this script exists so every transformation applied to it can be re-derived
 * and reviewed.
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

// Canonical relationship vocabulary — the single source of truth for type ids,
// direction and symmetry. Definitions and rationale live in
// src/relationships.ts and RELATIONSHIPS.md. Node imports the .ts directly.
import { TYPE_ALIASES, RELATIONSHIP_BY_ID } from '../src/relationships.ts';

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
// Storage stays directed; queries search both directions. Symmetry comes from
// the canonical registry rather than a second list here, so the two cannot
// drift apart.

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
/**
 * Nodes that represent a place or a group rather than a person. Plated Prisoner
 * uses a few, and their names collide with event text — "Seventh Kingdom" in an
 * event linked the `seventh_ruins` node and then tripped the temporal checks.
 */
const NON_PERSON_NODES = new Set(['seventh_ruins', 'second_temple', 'auren_parents']);

function buildCandidates(characters) {
  const tokenOwners = new Map(); // token -> Set<characterId>
  const tokensFor = new Map();  // characterId -> string[]

  for (const c of characters) {
    if (NON_PERSON_NODES.has(c.id)) continue;
    const toks = new Set();

    // Quoted nicknames, e.g. Catriona 'Cat' Cordella -> Cat
    for (const m of c.label.matchAll(/['"“”‘’]([^'"“”‘’]{2,})['"“”‘’]/g)) {
      toks.add(m[1].trim());
    }
    // Aliases count as names too, so a surname shared with another character
    // becomes ambiguous and is correctly rejected.
    for (const a of c.aliases ?? []) {
      for (const raw of a.split(/[\s·/,]+/)) {
        const t = raw.replace(/['"“”‘’]/g, '').trim();
        if (t.length >= 3 && !TITLE_TOKENS.has(t.toLowerCase())) toks.add(t);
      }
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
    if (NON_PERSON_NODES.has(c.id)) continue;
    candidates.push({ id: c.id, needle: c.label });
    for (const t of tokensFor.get(c.id) ?? []) {
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
  'id', 'label', 'role', 'type', 'affil', 'faction', 'kingdom', 'band',
  'book', 'lastBook', 'status', 'size', 'x', 'y', 'bio', 'magic', 'signet',
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
  // Plated Prisoner's own vocabulary
  sacrifices: 'dead',
  sacrificed: 'dead',
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

/** Vertical centre of a region, used to turn a Y_OFFSETS nudge into absolute y. */
function regionCentreY(regions, regionId) {
  const r = (regions ?? []).find((x) => x.id === regionId);
  return r ? r.y + r.h / 2 : 0;
}

function normaliseCharacter(n, yOffsets, notes, regions) {
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
    // DCC used `faction`, Plated Prisoner used `kingdom`, Empyrean used `affil`.
    affil: n.affil ?? n.faction ?? n.kingdom,
    // Bands became 2D regions, adopting the Plated Prisoner model.
    region: n.band ?? n.kingdom,
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
  // `magic` becomes first-class, also from Plated Prisoner. Empyrean's sparse
  // `signet` field is the same idea under another name.
  const magic = n.magic ?? n.signet;
  if (magic) out.magic = typeof magic === 'string' ? magic : magic.sym;
  // Fold the hand-tuned Y_OFFSETS nudges into an absolute y, which is what
  // Plated Prisoner already stored. This is what lets that table be deleted.
  if (n.y !== undefined) {
    out.y = n.y;
  } else if (yOffsets && yOffsets[n.id] !== undefined) {
    out.y = regionCentreY(regions, out.region) + yOffsets[n.id];
  }
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
      { id: 'panchek',
        set: { book: 1, affil: 'venin', region: 'leadership', role: 'Commandant · Venin Spy' },
        why: 'Appears across Fourth Wing and Iron Flame at Threshing, squad battles and ' +
             'promotions — the venin reveal in book 3 is a reveal, not a first appearance' },
      { id: 'berwyn', set: { book: 2 },
        why: 'The venin general who turns Xaden venin at the end of Iron Flame (book 2), not book 3' },
    ],
    relationships: [
      { match: 'xaden>liam:family', set: { type: 'friend', label: 'raised together' },
        why: 'Both are Marked Ones raised together in Tyrrendor after their fathers were ' +
             'executed. Not related, so this is friendship, not kinship' },
      { match: 'naolin>brennan:family', set: { type: 'ally', label: 'died saving him' },
        why: "Naolin used his siphon to bring Brennan back at the cost of his own life. " +
             'A sacrifice between allies, not a kinship tie' },
      { match: 'leothan>andarna:family', set: { type: 'mentor', label: 'calls her home to learn Irid ways' },
        why: 'Leothan draws Andarna to the Irids to be taught; she severs her bond and ' +
             'leaves with him in Onyx Storm. That is mentorship' },
      { match: 'varrish>jack:ally', set: { type: 'commands', label: 'wields him as a weapon' },
        why: 'Varrish is Vice Commandant and Jack a cadet, so the control runs through the ' +
             'hierarchy. "Wields him" is direction, not cooperation between equals' },
      { match: 'varrish>nolon:ally', set: { type: 'commands', label: 'orders him to mend Jack' },
        why: 'Varrish orders Nolon, a healer under his authority. Same hierarchy as above' },
      { match: 'king_tauri>halden:family', set: { book: 3 },
        why: 'Halden is referenced in book 1 but first appears on-page in Onyx Storm (book 3)' },
      { match: 'halden>aaric:family', set: { book: 3 },
        why: 'Same — the edge cannot render before Halden appears' },
      // Wyverns are created by venin and ridden as mounts, so the venin is the
      // actor. `bonded` would be wrong twice over: its endpoint rule requires a
      // human bonded to a dragon/irid/gryphon, and an Empyrean bond is mutual
      // and unbreakable, which a manufactured steed is not.
      { match: 'wyvern_rep>theophanie:ally',
        set: { from: 'theophanie', to: 'wyvern_rep', type: 'commands',
               label: 'creates and rides them', book: 3 },
        why: 'Theophanie directs wyverns rather than allying with them; she also first ' +
             'appears in Onyx Storm, so the edge moves to book 3' },
      { match: 'wyvern_rep>berwyn:ally',
        set: { from: 'berwyn', to: 'wyvern_rep', type: 'commands',
               label: 'creates and rides them', book: 2 },
        why: 'Same, and follows Berwyn moving to book 2' },
    ],
    // What readers believed before the reveal. `status` records only the end
    // state, which is not the story as read.
    perceived: [
      { id: 'brennan',
        set: { status: 'dead', role: "Violet's brother (presumed dead)", untilBook: 1,
               note: 'Presumed dead before the series. Revealed alive in the final paragraph of ' +
                     'Fourth Wing, and reveals himself properly in Iron Flame.' } },
      { id: 'aaric',
        set: { identity: 'Aaric Graycastle', untilBook: 2,
               note: "Actually Prince Camlaen Aaric Tauri, King Tauri's youngest son, enlisted " +
                     'under an alias.' } },
      // Resolved 2026-07-27. Canon confirms Panchek appears across Fourth Wing
      // and Iron Flame at Threshing, squad battles and promotions, so book 1 is
      // right and the old book 3 was the Berwyn pattern again.
      //
      // This is `perceived`, not `changes`: he is a venin spy from the start and
      // never switches sides. The reader simply believes he is the Commandant
      // until Onyx Storm exposes him. His true `affil` is therefore venin from
      // book 1 while his `region` stays leadership — which is exactly why the
      // schema keeps allegiance and place separate.
      { id: 'panchek',
        set: { affil: 'faculty', role: 'Commandant · Riders Quadrant', untilBook: 2,
               note: 'Exposed in Onyx Storm as a venin spy bonded to Berwyn. He was one all ' +
                     'along; the reader is simply not told until book 3.' } },
    ],
    // ── Temporal backfill ────────────────────────────────────────────────
    // The base record is state at first appearance; these are what changed
    // later. Before this, single-valued fields reported end-state from book 1 —
    // Jack read as a venin prisoner in Fourth Wing, two reveals early.
    characterChanges: [
      // The source record held Jack's END state, so the base is rewritten to
      // his book-1 state and the reveals become dated changes. The old role
      // even carried an arrow — "Antagonist · Pain · -> Venin" — spelling out
      // the book-2 turn to any reader on book 1.
      { id: 'jack',
        base: { affil: 'riders_other', status: 'alive', role: 'First-year · First Wing · Pain' },
        entries: [
          { book: 2, set: { affil: 'venin', role: 'Returned · VENIN' },
            why: 'Mended by Nolon under Varrish\'s orders and returns as venin in Iron Flame' },
          { book: 3, set: { status: 'prisoner', role: 'Venin prisoner · intel source' },
            why: 'Caught in Onyx Storm and held prisoner; Imogen erases his memory' },
        ]},
      { id: 'xaden',
        base: { role: 'Wingleader · Shadow Wielder · Lt' },
        entries: [
        { book: 3, set: { role: 'Duke of Tyrrendor · turned venin' },
          why: 'Turns venin at the end of Iron Flame to save Violet; carried into Onyx Storm' },
      ]},
      { id: 'devera', entries: [
        { book: 2, set: { affil: 'marked', region: 'aretia' },
          why: 'Defects with the rebels to Aretia when the truth about the venin comes out' },
      ]},
      { id: 'rhiannon',
        base: { role: 'Best Friend · Summoner' },
        entries: [
          { book: 3, set: { role: 'Squad Leader · Summoner' },
            why: 'Becomes Squad Leader in Onyx Storm' },
        ]},
      { id: 'dain',
        base: { role: 'Wingleader · Retrocognition' },
        entries: [
        { book: 2, set: { role: 'Wingleader → turns on Varrish' },
          why: 'Turns on Varrish in Iron Flame, beginning his shift toward Violet\'s side' },
      ]},
    ],
    // Relationships that changed category. Each of these was previously a single
    // `complicated` edge whose label held an arrow, which was unfilterable and
    // ungated. Splitting them into a base type plus a dated change makes both
    // halves real, filterable facts.
    relationshipChanges: [
      { match: 'violet>imogen:complicated',
        set: { type: 'enemy', label: 'tormentor' },
        entries: [
          { book: 2, set: { type: 'ally', label: 'ally — later erases her memory' },
            why: 'Imogen shifts from tormentor to ally after Resson' },
        ]},
    ],
    retypeRelationships: [
      { match: 'fen>brennan:killed', set: { type: 'enemy', label: 'struck him down (survived)' },
        why: 'Brennan survived — his bio says "presumed DEAD before the series. Actually alive". ' +
             '`killed` means the victim died; a survived attempt is `enemy`' },
    ],
    dropRelationships: [
      { match: 'imogen>violet:ally',
        why: 'Redundant. violet>imogen already carries this pair as `enemy` becoming ' +
             '`ally` in book 2, and `ally` is symmetric so the reverse direction adds ' +
             'nothing. The memory erasure it was labelled with is a book-3 event' },
      { match: 'quinn>theophanie:killed',
        why: 'Quinn is killed by an unnamed venin in a tower at Draithus, and Violet — not Quinn — ' +
             'kills Theophanie. The edge is wrong in both directions; her death is already carried by ' +
             'status "dead" and the book-3 event' },
      { match: 'trager>silaraine:killed',
        why: 'Neither killed the other — rider and gryphon were burned together on Zinhal. ' +
             'A `bonded` edge between them already exists, and the shared death is in both statuses' },
    ],
  },
  'plated-prisoner': {
    // Auren and Rip had FOUR source edges describing one evolving relationship:
    // Captor/Captive (bk1), Slow-burn romance (bk1), Love Interest (bk2) and
    // Fated Mates (bk4). Collapsing the phrase-types onto the canonical
    // vocabulary made two of them exact duplicates — which is the schema saying
    // they were never separate relationships, just one relationship over time.
    // The captor edge stays: early on they are genuinely captor and captive AND
    // slow-burning at the same time.
    characters: [
      { id: 'rip', set: { aliases: ['Slade Ravinger', 'King Slade Ravinger', 'Commander Rip'] },
        why: 'His label is "Slade / Rip", so the surname Ravinger was unowned and ' +
             'event text naming him linked Elore Ravinger instead' },
    ],
    relationships: [
      { match: 'nenet>thursil:family', set: { label: 'grandson' },
        why: "Thursil's own role reads \"Nenet's grandson\"" },
      { match: 'cull>elore:family', set: { label: 'co-parents of Slade' },
        why: 'Lord Cull is Slade\'s father and Elore his mother. Recording them as ' +
             'co-parents states what the data supports without asserting a marriage that ' +
             'the chart never claims' },
      { match: 'wick>saira:family', set: { label: 'Turley ancestor' },
        why: 'Saira Turley is an ancestor of the Turley line, which Wick belongs to' },
    ],
    // No hand-written entries needed: the generic duplicate-fold turns
    // "Slow-burn romance" (bk2) + "Love Interest" (bk3) into one `romantic` edge
    // with a dated label change, and "Fated Mates" aliases to `mated`, which is
    // a genuinely different bond and stays its own edge. Hand-authoring the
    // books here was also wrong — the 0-to-1 re-indexing shifts them.
  },
  dcc: {
    // katia|eva was the only pair in either series using TWO edges at different
    // books to express one changing relationship — complicated@bk2 followed by
    // enemy@bk5. That is precisely what `changes` replaces, so the pair becomes
    // one edge with a dated transition and the second edge is dropped.
    relationshipChanges: [
      { match: 'katia>eva:complicated',
        set: { type: 'friend', label: 'friends' },
        entries: [
          { book: 5, set: { type: 'enemy', label: 'Katia hunts and kills her' },
            why: 'Katia leaves the party to hunt Eva on Floor 7 and kills her' },
        ]},
    ],
    relationships: [
      { match: 'donut>kiwi:family', set: { type: 'squad', label: 'Royal Court' },
        why: 'Kiwi is a Royal Court pet bird who joined on Floor 7, not a relative. The ' +
             'Royal Court is a named unit, which is what `squad` means' },
      { match: 'donut>rend:family', set: { type: 'squad', label: 'Royal Court' },
        why: 'Rend was gifted to Carl by Tserendelgor, not to Donut. Carl already has his ' +
             'own edge to Rend, so what remains here is shared Royal Court membership' },
    ],
    dropRelationships: [
      { match: 'katia>eva:enemy',
        why: 'Folded into the katia>eva edge as a book-5 change; keeping both would ' +
             'draw two lines between the same pair' },
    ],
  },
};

function applyCharacterChanges(characters, seriesId, notes) {
  for (const c of CORRECTIONS[seriesId]?.characterChanges ?? []) {
    const target = characters.find((x) => x.id === c.id);
    if (!target) { notes.push(`changes skipped — no character "${c.id}"`); continue; }
    if (c.base) {
      for (const [k, v] of Object.entries(c.base)) {
        if (target[k] === v) continue;
        notes.push(`rebased ${c.id}.${k}: ${JSON.stringify(target[k])} -> ${JSON.stringify(v)} (first-appearance state)`);
        target[k] = v;
      }
    }
    const valid = c.entries.filter((e) => e.book > target.book && e.book <= target.lastBook);
    const dropped = c.entries.length - valid.length;
    if (dropped) notes.push(`dropped ${dropped} out-of-window change(s) for ${c.id}`);
    if (valid.length) {
      target.changes = valid;
      notes.push(`recorded ${valid.length} change(s) for ${c.id}: books ${valid.map((e) => e.book).join(', ')}`);
    }
  }
  return characters;
}

function applyCharacterCorrections(characters, seriesId, notes) {
  for (const p of CORRECTIONS[seriesId]?.perceived ?? []) {
    const target = characters.find((x) => x.id === p.id);
    if (!target) { notes.push(`perceived skipped — no character "${p.id}"`); continue; }
    target.perceived = p.set;
    notes.push(`recorded perceived state for ${p.id} (until book ${p.set.untilBook})`);
  }
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

const canonKeyOf = (r) => `${r.from}>${r.to}:${r.type}`;

function normaliseRelationships(edges, seriesId, notes) {
  const merges = EDGE_MERGES[seriesId] ?? [];
  const dropKeys = new Set(merges.map((m) => m.drop));
  const relabel = new Map(merges.filter((m) => m.label).map((m) => [m.keep, m.label]));

  const corr = CORRECTIONS[seriesId] ?? {};
  const setBy = new Map((corr.relationships ?? []).map((r) => [r.match, r]));
  const dropBy = new Map((corr.dropRelationships ?? []).map((r) => [r.match, r]));
  const retypeBy = new Map((corr.retypeRelationships ?? []).map((r) => [r.match, r]));
  const changeBy = new Map((corr.relationshipChanges ?? []).map((r) => [r.match, r]));

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
    if (retypeBy.has(key)) {
      const { set, why } = retypeBy.get(key);
      notes.push(`retyped ${key} -> ${set.type} (${why})`);
      Object.assign(rel, set);
    }

    if (changeBy.has(key)) {
      const spec = changeBy.get(key);
      Object.assign(rel, spec.set);
      rel.changes = spec.entries;
      notes.push(
        `split ${key} into base ${spec.set.type} + ${spec.entries.length} dated change(s) ` +
        `(was a single \`complicated\` edge with an arrow in its label)`,
      );
    }

    // Map any legacy type string onto the canonical vocabulary. DCC's `party`
    // and Empyrean's `squad` are the same concept; Plated Prisoner's phrase-ids
    // collapse here too.
    const alias = TYPE_ALIASES[rel.type.toLowerCase()];
    if (alias && alias.type !== rel.type) {
      notes.push(`aliased type "${rel.type}" -> "${alias.type}"`);
      rel.type = alias.type;
      if (alias.label && !rel.label) rel.label = alias.label;
    }
    // Corrections may also be keyed on the canonical type rather than the legacy
    // phrase, so re-check those too.
    if (canonKeyOf(rel) !== key && setBy.has(canonKeyOf(rel))) {
      const { set, why } = setBy.get(canonKeyOf(rel));
      for (const [k, v] of Object.entries(set)) {
        if (rel[k] === v) continue;
        notes.push(`corrected ${canonKeyOf(rel)}.${k}: ${JSON.stringify(rel[k])} -> ${JSON.stringify(v)} (${why})`);
        rel[k] = v;
      }
    }

    // Re-check for a change spec keyed on the CANONICAL type: the loop key uses
    // the pre-alias type, so a spec written against `romantic` would never match
    // a legacy "Slow-burn romance" edge.
    const canonKey = `${rel.from}>${rel.to}:${rel.type}`;
    if (canonKey !== key && changeBy.has(canonKey) && !rel.changes) {
      const spec = changeBy.get(canonKey);
      Object.assign(rel, spec.set);
      rel.changes = spec.entries;
      notes.push(`split ${canonKey} into base ${rel.type} + ${spec.entries.length} dated change(s)`);
    }

    // Aliasing can make two legacy types collapse onto one, producing an exact
    // duplicate. Keep the earliest and record the later ones as label changes
    // rather than dropping information on the floor.
    const dupIndex = out.findIndex(
      (x) => x.from === rel.from && x.to === rel.to && x.type === rel.type,
    );
    if (dupIndex >= 0) {
      const keep = out[dupIndex];
      if (rel.book > keep.book) {
        keep.changes = [
          ...(keep.changes ?? []),
          { book: rel.book, set: { label: rel.label }, why:
            `Legacy type collapsed onto "${rel.type}"; kept as a dated label change` },
        ].sort((a, b) => a.book - b.book);
        notes.push(`folded duplicate ${key} into a book-${rel.book} change on the earlier edge`);
      } else {
        notes.push(`dropped duplicate ${key} (same pair and type, not later)`);
      }
      continue;
    }
    out.push(rel);
  }
  return out;
}

/**
 * Ensure every type actually used by an edge is declared in the series registry.
 *
 * A dated change can introduce a type the original chart never had a legend
 * entry for — splitting DCC's katia|eva pair gave it a `friend` base, which DCC
 * had never declared. Colour and dash come from the canonical vocabulary so a
 * newly introduced type looks consistent across series.
 */
function ensureDeclaredTypes(relationshipTypes, relationships, notes) {
  // Aliasing collapses many legacy phrase-types onto one canonical id, so the
  // registry can end up holding duplicates — Plated Prisoner's 21 entries mapped
  // to 11 ids, which would have drawn a legend with repeats. Keep the first of
  // each id, preferring the canonical label so the legend reads consistently.
  const byId = new Map();
  for (const t of relationshipTypes) {
    if (byId.has(t.id)) continue;
    const canon = RELATIONSHIP_BY_ID.get(t.id);
    byId.set(t.id, canon ? { ...t, label: canon.label, symmetric: canon.symmetric } : t);
  }
  const dropped = relationshipTypes.length - byId.size;
  if (dropped > 0) {
    notes.push(`deduplicated ${dropped} relationship type entr(ies) that aliased onto an existing id`);
  }
  relationshipTypes = [...byId.values()];

  const declared = new Set(relationshipTypes.map((t) => t.id));
  const used = new Set();
  for (const r of relationships) {
    used.add(r.type);
    for (const ch of r.changes ?? []) if (ch.set.type) used.add(ch.set.type);
  }
  for (const id of used) {
    if (declared.has(id)) continue;
    const canon = RELATIONSHIP_BY_ID.get(id);
    if (!canon) { notes.push(`cannot declare unknown type "${id}"`); continue; }
    relationshipTypes.push({
      id: canon.id,
      label: canon.label,
      color: canon.color ?? '#8a8a8a',
      dash: null,
      symmetric: canon.symmetric,
    });
    notes.push(`declared type "${id}" — used by an edge but missing from the series legend`);
  }
  return relationshipTypes;
}

function normaliseRelTypes(relTypes) {
  return relTypes
    .filter((r) => r.id !== 'all') // UI filter pseudo-type, not a relationship
    .map((r) => {
      const alias = TYPE_ALIASES[r.id.toLowerCase()];
      return alias && alias.type !== r.id ? { ...r, id: alias.type } : r;
    })
    .map((r) => ({
      id: r.id,
      // The legend labelled `killed` as "Killed by", but the data stores
      // killer -> victim, so "Killed by" renders the edge backwards.
      label: r.id === 'killed' ? 'Killed' : r.label,
      color: r.color,
      dash: r.dash ?? null,
      symmetric: RELATIONSHIP_BY_ID.get(r.id)?.symmetric ?? false,
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
    file: 'sources/Empyrean-Chart.html',
    consts: ['BH', 'BOOKS', 'BANDS', 'AFFIL', 'DRAGON_DEN', 'TYPE_SHAPES', 'SIGNET_GLYPHS',
             'BOOK_TRANSITIONS', 'REL_TYPES', 'KEY_EVENTS', 'NODES', 'EDGES', 'Y_OFFSETS'],
    build(v) {
      return {
        regions: v.BANDS,
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
    file: 'sources/DCC-Chart.html',
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
      return { regions: v.BANDS, affiliations, yOffsets: null };
    },
  },
  {
    id: 'plated-prisoner',
    title: 'The Plated Prisoner',
    author: 'Raven Kennedy',
    file: 'sources/Plated-Prisoner-Chart.html',
    consts: ['BOOKS', 'BOOK_EVENTS', 'KINGDOMS', 'MAGIC_ICONS', 'RELATION_STYLES',
             'ALL_NODES', 'ALL_EDGES'],
    build(v) {
      // Books were bare strings ("Book 1: Gild") and zero-indexed. Rebuild them
      // as objects, 1-indexed, and lift `dominant` off BOOK_EVENTS.
      const books = v.BOOKS.map((raw, i) => {
        const m = /^Book\s*\d+\s*:\s*(.+)$/.exec(raw);
        const short = m ? m[1].trim() : raw;
        const ev = v.BOOK_EVENTS?.[i];
        const b = { id: i + 1, title: short, short };
        if (ev?.dominant && ev.dominant !== '—') b.dominant = ev.dominant;
        return b;
      });

      // Kingdoms are already 2D boxes — the model the other two adopted.
      const regions = Object.entries(v.KINGDOMS).map(([id, k]) => ({
        id, label: k.label, x: k.x, y: k.y, w: k.w, h: k.h,
        ...(k.power && k.power !== '—' ? { power: k.power } : {}),
        color: k.color, border: k.border,
      }));

      // Kingdom doubles as the affiliation. They are separate concepts — Auren
      // belongs to the Sixth while held prisoner in the Fourth — so the split is
      // seeded from the same value and can diverge per character via `changes`.
      const affiliations = {};
      for (const [id, k] of Object.entries(v.KINGDOMS)) {
        affiliations[id] = { label: k.label, color: k.border ?? '#888888' };
      }

      // Events were grouped per book with no character links; deriveInvolves
      // fills those in the same way as the other two series.
      const keyEvents = {};
      (v.BOOK_EVENTS ?? []).forEach((be, i) => { keyEvents[i + 1] = be.events; });

      // RELATION_STYLES is keyed by English phrase; TYPE_ALIASES maps them.
      const relTypes = Object.entries(v.RELATION_STYLES).map(([id, st]) => ({
        id, label: st.label.replace(/^[^\w]+/, '').trim(), color: st.color,
        dash: st.dash && st.dash !== '0' ? st.dash : null,
      }));

      return { books, regions, affiliations, keyEvents, relTypes, yOffsets: null,
               zeroIndexed: true };
    },
  },
];

// ── Run ────────────────────────────────────────────────────────────────────
mkdirSync(dataDir, { recursive: true });

const summary = [];

for (const s of SERIES) {
  const notes = [];
  const { values: rawValues, found } = await loadConsts(join(root, s.file), s.consts);
  // Plated Prisoner names its arrays differently and counts books from zero.
  const values = {
    ...rawValues,
    NODES: rawValues.NODES ?? rawValues.ALL_NODES,
    EDGES: rawValues.EDGES ?? rawValues.ALL_EDGES,
  };
  const missing = s.consts.filter((c) => !found.includes(c));
  if (missing.length) notes.push(`consts not present in source: ${missing.join(', ')}`);

  const extra = s.build(values);
  const regions = extra.regions;

  // Shift zero-indexed books to 1-indexed before anything reads them, so every
  // downstream check and every reader sees the same convention.
  if (extra.zeroIndexed) {
    for (const n of values.NODES) { n.book += 1; n.lastBook += 1; }
    for (const e of values.EDGES) { e.book += 1; }
    notes.push(`re-indexed books from 0-based to 1-based (${values.NODES.length} characters, ${values.EDGES.length} edges)`);
  }
  const characters = applyCharacterChanges(applyCharacterCorrections(
    values.NODES.map((n) => normaliseCharacter(n, extra.yOffsets, notes, regions)),
    s.id,
    notes,
  ), s.id, notes);
  const relationships = normaliseRelationships(values.EDGES, s.id, notes);
  const events = normaliseEvents(extra.keyEvents ?? values.KEY_EVENTS, characters);

  const series = {
    id: s.id,
    title: s.title,
    author: s.author,
    books: extra.books ?? values.BOOKS,
    regions,
    affiliations: extra.affiliations,
    relationshipTypes: ensureDeclaredTypes(
      normaliseRelTypes(extra.relTypes ?? values.REL_TYPES), relationships, notes,
    ),
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
