/**
 * The shared series schema.
 *
 * One schema describes every chart. It is deliberately split in two layers:
 *
 *   1. `SeriesSchema`  — shape and field types (Zod).
 *   2. `checkIntegrity` — cross-references that Zod cannot express, such as
 *      "every relationship endpoint names a character that actually exists".
 *
 * Keeping them separate means integrity problems come back as a readable list
 * with severities, rather than one wall of nested Zod errors.
 *
 * Field descriptions matter here beyond documentation: this schema is handed to
 * the extraction model in Phase 3 as a tool input schema. An early test run
 * filled `label` with "Dragon Companion" instead of a name precisely because
 * `label` carried no description.
 */
import { z } from 'zod';
import { contrastRatio, MIN_ACCENT_CONTRAST } from './contrast.ts';
import {
  RELATIONSHIP_BY_ID,
  RELATIONSHIP_IDS,
  isKinshipLabel,
  VOCAB_EXCEPTIONS,
  VOCAB_PENDING_REVIEW,
} from './relationships.ts';

// ── Primitives ─────────────────────────────────────────────────────────────

/**
 * Normalised character status.
 *
 * The source charts disagreed: Empyrean used seven values (alive, killed,
 * deceased, sacrificed, executed, missing, prisoner) while DCC used two
 * (alive, dead). Four of Empyrean's values all mean "dead", but `missing`
 * and `prisoner` are genuinely distinct states — Garrick, Bodhi and Aaric are
 * missing on the book-3 cliffhanger, and Jack Barlowe is a living captive.
 * Flattening those to `dead` would lose real information, so they are kept.
 *
 * The original wording survives in `statusDetail`, because "sacrificed" and
 * "executed" carry meaning that "dead" does not.
 */
export const StatusSchema = z.enum(['alive', 'dead', 'missing', 'prisoner', 'unknown']);

export const EventKindSchema = z.enum([
  'death',
  'betrayal',
  'battle',
  'reveal',
  'bond',
  'other',
]);

export const BookSchema = z.object({
  id: z.number().int().positive().describe('Book number within the series, starting at 1'),
  title: z.string().min(1).describe('Full published title'),
  short: z.string().min(1).describe('Short label for the timeline buttons'),
  year: z.number().int().optional().describe('Publication year'),
  era: z.string().optional().describe('One-line description of where the story stands'),
  floor: z.string().optional().describe('Dungeon floors covered (Dungeon Crawler Carl only)'),
  dominant: z
    .string()
    .optional()
    .describe(
      'Who is ascendant in this book, e.g. "Third Kingdom (Kaila)". Adopted from ' +
        'the Plated Prisoner chart, which tracked it per book.',
    ),
  future: z.boolean().optional().describe('True for announced-but-unreleased books'),
});

/**
 * A place on the chart.
 *
 * Formerly a full-width horizontal "band". Plated Prisoner modelled its
 * kingdoms as 2D boxes instead, which is strictly more expressive — Annwyn
 * spans the bottom of its chart while the Red Raids occupy a small box in the
 * middle — so that model won. `x` and `w` are optional and default to a
 * full-width band, so the Empyrean and DCC data stays valid unchanged.
 */
export const RegionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).describe('Name shown on the region'),
  x: z.number().optional().describe('Left edge in chart units; omitted means full width'),
  y: z.number().describe('Top edge in chart units'),
  w: z.number().positive().optional().describe('Width in chart units; omitted means full width'),
  h: z.number().positive().describe('Height in chart units'),
  power: z
    .string()
    .optional()
    .describe('What defines this place, e.g. "Rot magic (Slade)". From Plated Prisoner.'),
  color: z.string().optional(),
  border: z.string().optional(),
});

export const AffiliationSchema = z.object({
  label: z.string().min(1).describe('Display name of the faction or group'),
  color: z.string().min(1).describe('Fill colour'),
  border: z.string().optional().describe('Stroke colour'),
  emoji: z.string().optional().describe('Badge emoji'),
});

export const RelationshipTypeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z.string().min(1),
  dash: z.string().nullable().describe('SVG stroke-dasharray, or null for solid'),
  symmetric: z
    .boolean()
    .describe(
      'True when the relationship reads the same in both directions (mated, ' +
        'romantic). False when direction carries meaning: for `killed`, `from` ' +
        'is the killer; for `mentor`, `from` is the mentor; for `family`, `to` ' +
        "is `from`'s <label>.",
    ),
});

export const CharacterTypeSchema = z.object({
  label: z.string().min(1),
  shape: z.string().min(1).describe('Node shape used to render this type'),
});

/**
 * A dated change to a record.
 *
 * The base record describes the subject at its first appearance; every later
 * alteration is a change entry. State at book k = base, plus every entry with
 * `book <= k`, applied in order.
 *
 * This exists because single-valued fields could not tell the story. Jack
 * Barlowe is a first-year rider who is "killed" in book 1, returns as venin in
 * book 2, and is held prisoner in book 3 — three states in one row. Before
 * this, the chart reported him as a venin prisoner from book 1, leaking two
 * later reveals.
 *
 * `why` is required, on the same principle as the canon corrections: a change
 * to the timeline should explain itself.
 */
export function changeSchema<T extends z.ZodRawShape>(settable: T) {
  return z.object({
    book: z.number().int().positive().describe('The book in which this change takes effect'),
    set: z.object(settable).describe('Fields to overwrite from this book onward'),
    why: z.string().min(8).describe('What happened in the story to cause this'),
  });
}

export const CharacterSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9][a-z0-9_-]*$/,
      'must be a lowercase slug: letters, digits, underscore and hyphen only. ' +
        'Ids are keys — a space in one breaks every relationship that points at it.',
    )
    .describe('Stable lowercase slug, e.g. "violet" — never a display name'),
  label: z.string().min(1).describe("The character's name as readers know it, e.g. \"Violet Sorrengail\""),
  aliases: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Other names the same character is known by. Needed for both search and ' +
        'event linking: an event reading "revealed to be King Slade Ravinger" ' +
        'matched Elore Ravinger, because the surname was unique among labels ' +
        'while belonging to someone else entirely.',
    ),
  role: z.string().describe('Short role or title, e.g. "Goddess of War"'),
  type: z.string().optional().describe('Character type id, controls node shape'),
  affil: z.string().min(1).describe('Affiliation id — must exist in the series affiliations'),
  region: z.string().min(1).describe('Region id — must exist in the series regions'),
  book: z.number().int().positive().describe('First book this character appears in'),
  lastBook: z.number().int().positive().describe('Last book this character appears in'),
  status: StatusSchema.describe(
    'Their status WHEN FIRST SEEN, not at the end of the series. A character ' +
      'who dies in book five is `alive` here, with a `changes` entry moving them ' +
      'to `dead` at book five — otherwise the chart reports the death from book ' +
      'one and spoils it. This description previously said "as of the end of the ' +
      'series", and since it is handed to the extraction model as a field ' +
      'description, it was instructing every run to produce exactly that leak.',
  ),
  statusDetail: z
    .string()
    .optional()
    .describe(
      'More specific wording for the status where it differs, e.g. "sacrificed", ' +
        '"executed". Same rule as `status`: this describes them when first seen, ' +
        'and a later change belongs in `changes`.',
    ),
  size: z.string().describe('Relative node size, e.g. "main" or "side"'),
  x: z.number().describe('Horizontal position in chart units'),
  y: z
    .number()
    .optional()
    .describe(
      'Vertical position in chart units. Optional — without it the character is ' +
        'centred in their region. Explicit y replaces the 50-line Y_OFFSETS table ' +
        'of hand-tuned pixel nudges the Empyrean chart needed.',
    ),
  magic: z
    .string()
    .optional()
    .describe('Their power, e.g. "Lightning Wielder", "Rot magic". From Plated Prisoner.'),

  /**
   * What the reader believed before the truth came out.
   *
   * `status` alone records the end state, which is not what a spoiler-aware
   * reader wants. Brennan is presumed dead until the final paragraph of book 1;
   * Aaric serves under an alias; Panchek is not revealed as a venin spy until
   * book 3. A chart that only knows the end state cannot show the reader the
   * story as they experienced it.
   */
  perceived: z
    .object({
      status: StatusSchema.optional().describe('What the reader believed the status was'),
      identity: z.string().optional().describe('The alias or false identity the reader knew'),
      affil: z
        .string()
        .optional()
        .describe(
          'The allegiance the reader believed. A planted spy needs this: Panchek ' +
            'is venin from book 1, but reads as faculty until Onyx Storm exposes ' +
            'him. That is a false belief, not a change of sides — he never ' +
            'switched.',
        ),
      region: z
        .string()
        .optional()
        .describe('The place the reader believed they belonged to.'),
      role: z
        .string()
        .optional()
        .describe(
          'The role as the reader understood it. `role` is spoiler-bearing too: ' +
            "Brennan's real role reads \"Violet's brother · Mender\", but Mender is " +
            'the signet revealed after he is found alive.',
        ),
      untilBook: z
        .number()
        .int()
        .positive()
        .describe('The reader holds this belief through the end of this book'),
      note: z.string().min(1).describe('What actually happened and when it was revealed'),
    })
    .optional(),

  bio: z
    .string()
    .optional()
    .describe(
      'Full biography. SPOILER-BEARING across the whole series — 16 of 48 book-1 ' +
        'Empyrean bios name a character who has not appeared yet. Never serve this ' +
        'below the maximum reading position; use bioByBook where present.',
    ),
  bioByBook: z
    .array(
      z.object({
        book: z.number().int().positive(),
        text: z.string().min(1),
      }),
    )
    .optional()
    .describe(
      'Biography split so each segment only reveals what is known by that book. ' +
        'A reader at book k sees segments where book <= k. Segmenting the existing ' +
        'bios is a Phase 3 pipeline task.',
    ),
  attrs: z
    .record(z.string(), z.string())
    .optional()
    .describe('Series-specific extras, e.g. dragon den, signet, Floor 9 allegiance'),

  changes: z
    .array(
      changeSchema({
        affil: z.string().min(1).optional(),
        region: z.string().min(1).optional(),
        role: z.string().min(1).optional(),
        status: StatusSchema.optional(),
        statusDetail: z.string().optional(),
        label: z.string().min(1).optional(),
        magic: z.string().optional(),
        size: z.string().optional(),
      }),
    )
    .optional()
    .describe('What actually changed about this character, and in which book'),
});

export const RelationshipSchema = z.object({
  from: z.string().min(1).describe('Character id of the actor — see RelationshipType.symmetric'),
  to: z.string().min(1).describe('Character id of the target'),
  type: z.string().min(1).describe('Relationship type id'),
  book: z.number().int().positive().describe('Book in which this relationship is established'),
  untilBook: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Last book this relationship applies. Omitted means it never ends.'),
  label: z.string().describe('Human-readable gloss, e.g. "mother", "executed him"'),
  changes: z
    .array(
      changeSchema({
        type: z.string().min(1).optional(),
        label: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      'Type or label changes over time. This retires `complicated` as an escape ' +
        'hatch: "enemy -> ally" was one unfilterable edge labelled with an arrow, ' +
        'and becomes `enemy` at book 1 then `ally` at book 2 — two real facts.',
    ),
});

export const EventSchema = z.object({
  book: z.number().int().positive(),
  text: z.string().min(1).describe('One-line description of what happened'),
  involves: z
    .array(z.string())
    .describe('Character ids this event concerns — used to answer "what happened to X?"'),
  kind: EventKindSchema,
});

/**
 * How a series looks.
 *
 * This exists so a series' visual identity is *data*, not hand-written CSS in
 * its page. Before this, each chart shell carried its own colours, which meant
 * the only way to theme a new series was to write CSS — nowhere for anything
 * else to make the decision.
 *
 * With it, a theme is a proposable artifact: an agent reading the books can
 * suggest a palette in a pull request, and a human can look at the diff and
 * argue with it. `mood` carries the reasoning so the choice is reviewable
 * rather than arbitrary — a palette with no stated intent is just noise.
 *
 * Everything is optional; a series with no theme falls back to the site default.
 */
export const ThemeSchema = z.object({
  accent: z.string().optional().describe('Headings, active states, glyphs'),
  accent2: z
    .string()
    .optional()
    .describe(
      'Counterpoint accent, for series built on an opposition — Fae & Alchemy ' +
        'is quicksilver against brimstone, ice against fire, and one hue ' +
        'cannot carry that. Optional: most series do not need it.',
    ),
  ground: z.string().optional().describe('Page background'),
  panel: z.string().optional().describe('Sidebar and panel background'),
  line: z.string().optional().describe('Borders and rules'),
  display: z
    .string()
    .optional()
    .describe("Display typeface for headings, e.g. 'Cinzel', serif"),
  mood: z
    .string()
    .optional()
    .describe(
      'One line on why these choices suit the series. Required reading for a ' +
        'reviewer deciding whether a proposed palette is right.',
    ),
});

export const SeriesSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1),
  books: z.array(BookSchema).min(1),
  regions: z.array(RegionSchema).min(1),
  affiliations: z.record(z.string(), AffiliationSchema),
  relationshipTypes: z.array(RelationshipTypeSchema).min(1),
  characters: z.array(CharacterSchema).min(1),
  relationships: z.array(RelationshipSchema),
  events: z.array(EventSchema),

  theme: ThemeSchema.optional(),

  // Set by `npm run add-series`, cleared by a human. A draft has real
  // characters and relationships but only the scaffolded single region and
  // single "Unsorted" affiliation, because extraction deliberately does not
  // invent geography or factions (see pipeline/extract.ts). Tests that demand
  // rich dimensions apply to curated series only — holding a fresh draft to
  // that bar would just pressure the next person to invent canon to make CI
  // green, which is the opposite of what this repo is for.
  draft: z.boolean().optional(),

  // Optional, series-specific presentation data.
  characterTypes: z.record(z.string(), CharacterTypeSchema).optional(),
  subgroups: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.string()))).optional(),
  glyphs: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  bookTransitions: z
    .record(z.string(), z.object({ title: z.string(), changes: z.array(z.string()) }).nullable())
    .optional(),
});

export type Status = z.infer<typeof StatusSchema>;
export type EventKind = z.infer<typeof EventKindSchema>;
export type Book = z.infer<typeof BookSchema>;
export type Region = z.infer<typeof RegionSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type Affiliation = z.infer<typeof AffiliationSchema>;
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type SeriesEvent = z.infer<typeof EventSchema>;
export type Series = z.infer<typeof SeriesSchema>;

// ── Integrity checks ───────────────────────────────────────────────────────

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  rule: string;
  where: string;
  message: string;
}

/**
 * Cross-reference checks that field-level validation cannot catch.
 *
 * Errors are things that would render wrong or crash — a relationship pointing
 * at a character who does not exist, a band id with no band. Warnings are
 * suspicious but survivable, and often indicate a data-entry slip worth a
 * human look rather than an automatic fix.
 */
export function checkIntegrity(series: Series): Issue[] {
  const issues: Issue[] = [];
  const err = (rule: string, where: string, message: string) =>
    issues.push({ severity: 'error', rule, where, message });
  const warn = (rule: string, where: string, message: string) =>
    issues.push({ severity: 'warning', rule, where, message });

  const charById = new Map<string, Character>();
  for (const c of series.characters) {
    if (charById.has(c.id)) {
      err('duplicate-character-id', c.id, `Two characters share the id "${c.id}"`);
      continue;
    }
    charById.set(c.id, c);
  }

  const regionIds = new Set(series.regions.map((r) => r.id));
  const affilIds = new Set(Object.keys(series.affiliations));
  const relTypeById = new Map(series.relationshipTypes.map((r) => [r.id, r]));
  const typeIds = new Set(Object.keys(series.characterTypes ?? {}));
  const bookIds = new Set(series.books.map((b) => b.id));
  const minBook = Math.min(...series.books.map((b) => b.id));
  const maxBook = Math.max(...series.books.map((b) => b.id));

  // Books
  const seenBooks = new Set<number>();
  for (const b of series.books) {
    if (seenBooks.has(b.id)) err('duplicate-book-id', `book ${b.id}`, `Duplicate book id ${b.id}`);
    seenBooks.add(b.id);
  }

  // Regions
  const seenRegions = new Set<string>();
  for (const r of series.regions) {
    if (seenRegions.has(r.id)) err('duplicate-region-id', r.id, `Duplicate region id "${r.id}"`);
    seenRegions.add(r.id);
  }

  // Characters
  for (const c of series.characters) {
    const at = `character "${c.id}"`;
    if (!regionIds.has(c.region)) err('unknown-region', at, `region "${c.region}" is not defined`);
    if (!affilIds.has(c.affil)) err('unknown-affiliation', at, `affil "${c.affil}" is not defined`);
    if (c.type !== undefined && typeIds.size > 0 && !typeIds.has(c.type)) {
      err('unknown-character-type', at, `type "${c.type}" is not defined`);
    }
    if (c.book > c.lastBook) {
      err('book-after-lastbook', at, `book ${c.book} is after lastBook ${c.lastBook}`);
    }
    if (!bookIds.has(c.book)) {
      err('book-out-of-range', at, `book ${c.book} is not one of the series books`);
    }
    if (c.lastBook > maxBook || c.lastBook < minBook) {
      err('lastbook-out-of-range', at, `lastBook ${c.lastBook} is outside books ${minBook}-${maxBook}`);
    }

    // A perceived belief must be held from the character's first appearance and
    // must actually differ from the truth, or it is recording nothing.
    if (c.perceived) {
      if (!bookIds.has(c.perceived.untilBook)) {
        err('book-out-of-range', at, `perceived.untilBook ${c.perceived.untilBook} is not a series book`);
      }
      if (
        c.perceived.status === undefined &&
        c.perceived.identity === undefined &&
        c.perceived.role === undefined &&
        c.perceived.affil === undefined &&
        c.perceived.region === undefined
      ) {
        err('empty-perceived', at,
          'perceived must set at least one of status, identity, role, affil, region');
      }
      if (c.perceived.affil !== undefined && !affilIds.has(c.perceived.affil)) {
        err('unknown-affiliation', at,
          `perceived.affil "${c.perceived.affil}" is not defined`);
      }
      if (c.perceived.region !== undefined && !regionIds.has(c.perceived.region)) {
        err('unknown-region', at, `perceived.region "${c.perceived.region}" is not defined`);
      }
      if (c.perceived.status !== undefined && c.perceived.status === c.status) {
        warn('perceived-matches-actual', at,
          `perceived.status "${c.perceived.status}" equals the real status, so it records nothing`);
      }
    }

    // Change entries must sit inside the character's own window, actually change
    // something, and not collide on a book.
    const seenChangeBooks = new Set<number>();
    for (const ch of c.changes ?? []) {
      if (ch.book < c.book || ch.book > c.lastBook) {
        err('change-out-of-window', at,
          `change for book ${ch.book} is outside this character's ${c.book}-${c.lastBook}`);
      }
      if (ch.book === c.book) {
        err('change-at-first-book', at,
          `change for book ${ch.book} is the character's first book — put it in the base record`);
      }
      if (seenChangeBooks.has(ch.book)) {
        err('duplicate-change-book', at, `two changes for book ${ch.book}; merge them`);
      }
      seenChangeBooks.add(ch.book);
      if (Object.keys(ch.set).length === 0) {
        err('empty-change', at, `change for book ${ch.book} sets nothing`);
      }
      if (ch.set.region !== undefined && !regionIds.has(ch.set.region)) {
        err('unknown-region', at, `change sets region "${ch.set.region}" which is not defined`);
      }
      if (ch.set.affil !== undefined && !affilIds.has(ch.set.affil)) {
        err('unknown-affiliation', at, `change sets affil "${ch.set.affil}" which is not defined`);
      }
    }

    // Segmented bios must not start before the character does. The upper bound
    // is the series, not `lastBook`: `gate()` filters on `book <= position`
    // only, so a character stays on the chart after the book they die in — and
    // a sentence that is only safe once a later character exists still has to
    // land somewhere reachable. Liam dies in book one and his bio names someone
    // from book two; that segment is correct at book two.
    const seriesFinal = Math.max(...series.books.map((b) => b.id));
    for (const seg of c.bioByBook ?? []) {
      if (seg.book < c.book || seg.book > seriesFinal) {
        err('bio-segment-out-of-window', at,
          `bioByBook segment for book ${seg.book} is outside book ${c.book}-${seriesFinal}`);
      }
    }
    // A character marked dead who is still listed through the final book is
    // usually fine (they die in that book), so this is not flagged.
  }

  // Relationships
  const relSeen = new Map<string, Relationship>();
  for (const r of series.relationships) {
    const at = `relationship ${r.from} -> ${r.to} (${r.type})`;

    const from = charById.get(r.from);
    const to = charById.get(r.to);
    if (!from) err('dangling-relationship-endpoint', at, `"${r.from}" is not a character`);
    if (!to) err('dangling-relationship-endpoint', at, `"${r.to}" is not a character`);
    if (r.from === r.to) err('self-relationship', at, `character relates to itself`);

    const relType = relTypeById.get(r.type);
    if (!relType) err('unknown-relationship-type', at, `type "${r.type}" is not defined`);

    if (!bookIds.has(r.book)) {
      err('book-out-of-range', at, `book ${r.book} is not one of the series books`);
    }

    // A relationship cannot predate either participant's first appearance.
    if (from && to) {
      const earliest = Math.max(from.book, to.book);
      if (r.book < earliest) {
        warn(
          'relationship-before-participants',
          at,
          `book ${r.book} precedes first appearance of ` +
            `${from.book > r.book ? `"${from.id}" (book ${from.book})` : `"${to.id}" (book ${to.book})`}`,
        );
      }
    }

    // untilBook and change entries must sit inside the edge's own lifetime.
    if (r.untilBook !== undefined) {
      if (r.untilBook < r.book) {
        err('until-before-book', at, `untilBook ${r.untilBook} precedes book ${r.book}`);
      }
      if (!bookIds.has(r.untilBook)) {
        err('book-out-of-range', at, `untilBook ${r.untilBook} is not a series book`);
      }
    }
    const seenRelChangeBooks = new Set<number>();
    for (const ch of r.changes ?? []) {
      const last = r.untilBook ?? maxBook;
      if (ch.book <= r.book || ch.book > last) {
        err('change-out-of-window', at,
          `change for book ${ch.book} is outside this relationship's ${r.book}-${last}`);
      }
      if (seenRelChangeBooks.has(ch.book)) {
        err('duplicate-change-book', at, `two changes for book ${ch.book}; merge them`);
      }
      seenRelChangeBooks.add(ch.book);
      if (Object.keys(ch.set).length === 0) {
        err('empty-change', at, `change for book ${ch.book} sets nothing`);
      }
      if (ch.set.type !== undefined && !relTypeById.has(ch.set.type)) {
        err('unknown-relationship-type', at, `change sets type "${ch.set.type}" which is not defined`);
      }
    }

    // Exact and reversed duplicates.
    const fwd = `${r.from}>${r.to}:${r.type}`;
    const rev = `${r.to}>${r.from}:${r.type}`;
    if (relSeen.has(fwd)) {
      err('duplicate-relationship', at, `exact duplicate of an earlier relationship`);
    } else if (relSeen.has(rev)) {
      const other = relSeen.get(rev)!;
      if (relType?.symmetric) {
        warn(
          'redundant-reversed-relationship',
          at,
          `"${r.type}" is symmetric, so this duplicates ${other.from} -> ${other.to}. ` +
            `Keep one direction.`,
        );
      }
      // For directed types A->B and B->A can both be legitimate
      // (e.g. two people who each betrayed the other), so no issue is raised.
    }
    relSeen.set(fwd, r);
  }

  // ── Controlled vocabulary ────────────────────────────────────────────────
  // Definitions live in src/relationships.ts. These checks stop the vocabulary
  // drifting as new books are added, which is how the three charts ended up
  // with 38 different type strings for ~14 concepts.
  for (const t of series.relationshipTypes) {
    if (!RELATIONSHIP_IDS.has(t.id)) {
      err(
        'non-canonical-relationship-type',
        `relationshipType "${t.id}"`,
        `not in the canonical vocabulary — add it to RELATIONSHIP_TYPES or map it in TYPE_ALIASES`,
      );
      continue;
    }
    const canon = RELATIONSHIP_BY_ID.get(t.id)!;
    if (canon.symmetric !== t.symmetric) {
      err(
        'symmetry-mismatch',
        `relationshipType "${t.id}"`,
        `series says symmetric=${t.symmetric}, vocabulary says ${canon.symmetric}`,
      );
    }
  }

  for (const r of series.relationships) {
    const key = `${series.id}:${r.from}>${r.to}:${r.type}`;
    if (VOCAB_EXCEPTIONS[key] || VOCAB_PENDING_REVIEW[key]) continue;

    const canon = RELATIONSHIP_BY_ID.get(r.type);
    if (!canon) continue; // already reported above
    const at = `relationship ${r.from} -> ${r.to} (${r.type})`;

    // `family` means kinship. It was collecting "raised together" and
    // "died saving him", which are a friendship and an event respectively.
    if (r.type === 'family' && !isKinshipLabel(r.label)) {
      warn(
        'family-label-not-kinship',
        at,
        `label "${r.label}" is not a kinship term — see KINSHIP_TERMS, or use friend/ally`,
      );
    }

    // `killed` means the victim died. "Struck down" is `enemy`.
    //
    // Read the victim's status at the END of the series, not the base record.
    // `status` is what they are when first seen — a character who dies in book
    // five is `alive` on the base record with a `changes` entry moving them, and
    // reading the field directly called every one of those a false `killed`.
    if (r.type === 'killed') {
      const victim = charById.get(r.to);
      const finalStatus = victim
        ? [...(victim.changes ?? [])]
            .sort((a, b) => a.book - b.book)
            .reduce<string>((acc, ch) => ch.set.status ?? acc, victim.status)
        : undefined;
      if (victim && finalStatus === 'alive') {
        warn(
          'killed-victim-alive',
          at,
          `victim "${victim.id}" has status "alive" — if they survived the attempt ` +
            `this is \`enemy\`, not \`killed\``,
        );
      }
    }

    // Endpoint constraints, e.g. `bonded` joins a person to a creature.
    //
    // Only enforceable when this series actually uses the types the rule names.
    // `bonded` expects dragon/irid/gryphon because that is what a bond is in the
    // Empyrean. Fae & Alchemy's quicksilver bond joins two people, and there is
    // no dragon in the series to expect — applying a rule about creatures that
    // do not exist here would force the wrong relationship type onto correct
    // data. The rule still bites in any series that declares those types.
    const declared = new Set(Object.keys(series.characterTypes ?? {}));
    const enforceable = (types?: string[]) =>
      !types || types.some((t) => declared.has(t));

    const ep = canon.endpoints;
    if (ep) {
      const from = charById.get(r.from);
      const to = charById.get(r.to);
      if (ep.fromTypes && enforceable(ep.fromTypes) && from?.type && !ep.fromTypes.includes(from.type)) {
        warn('endpoint-type-mismatch', at,
          `from "${from.id}" is type "${from.type}"; ${r.type} expects ${ep.fromTypes.join('/')}`);
      }
      if (ep.toTypes && enforceable(ep.toTypes) && to?.type && !ep.toTypes.includes(to.type)) {
        warn('endpoint-type-mismatch', at,
          `to "${to.id}" is type "${to.type}"; ${r.type} expects ${ep.toTypes.join('/')}`);
      }
      if (ep.sameType && from?.type && to?.type && from.type !== to.type) {
        warn('endpoint-type-mismatch', at,
          `${r.type} requires matching types, got "${from.type}" and "${to.type}"`);
      }
    }
  }

  // Theme. A palette can be proposed by an agent reading the cover, so it is
  // checked like any other input: colours must parse, and the accent must be
  // legible on the ground. An unreadable chart is worse than an unstyled one.
  if (series.theme) {
    const t = series.theme;
    for (const [k, v] of Object.entries(t)) {
      if (k === 'mood' || k === 'display' || v === undefined) continue;
      if (contrastRatio(v, '#ffffff') === null) {
        err('theme-colour-unparseable', `theme.${k}`, `"${v}" is not a colour`);
      }
    }
    if (t.accent && t.ground) {
      const ratio = contrastRatio(t.accent, t.ground);
      if (ratio !== null && ratio < MIN_ACCENT_CONTRAST) {
        err('theme-contrast-too-low', 'theme',
          `accent on ground is ${ratio.toFixed(2)}:1, below the ${MIN_ACCENT_CONTRAST}:1 floor`);
      }
    }
    if (t.mood !== undefined && t.mood.trim().length < 30) {
      warn('theme-mood-too-short', 'theme',
        'a palette with no stated reason is unreviewable — say what it is for');
    }
  }

  // Events
  for (const [i, e] of series.events.entries()) {
    const at = `event ${i} (book ${e.book})`;
    if (!bookIds.has(e.book)) {
      err('book-out-of-range', at, `book ${e.book} is not one of the series books`);
    }
    for (const id of e.involves) {
      const c = charById.get(id);
      if (!c) {
        err('dangling-event-participant', at, `"${id}" is not a character`);
        continue;
      }
      // An event cannot involve someone who has not appeared yet: that would
      // leak a later character into an earlier book.
      if (e.book < c.book) {
        warn(
          'event-before-character-appears',
          at,
          `involves "${id}" whose first book is ${c.book}`,
        );
      }
      // The mirror case: the chart hides this character by this book, yet the
      // book's own event log talks about them. One of the two is wrong.
      if (e.book > c.lastBook) {
        warn(
          'event-after-character-leaves',
          at,
          `involves "${id}" whose lastBook is ${c.lastBook}, so the chart hides ` +
            `them in book ${e.book} while this event still references them`,
        );
      }
    }
  }

  return issues;
}

/** Parse and integrity-check in one step. */
export function parseSeries(raw: unknown): { series: Series; issues: Issue[] } {
  const series = SeriesSchema.parse(raw);
  return { series, issues: checkIntegrity(series) };
}
