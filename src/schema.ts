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
  future: z.boolean().optional().describe('True for announced-but-unreleased books'),
});

export const BandSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).describe('Name of this region of the chart'),
  y: z.number().describe('Vertical position of the band in chart units'),
  h: z.number().positive().describe('Band height in chart units'),
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

export const CharacterSchema = z.object({
  id: z.string().min(1).describe('Stable lowercase slug, e.g. "violet" — never a display name'),
  label: z.string().min(1).describe("The character's name as readers know it, e.g. \"Violet Sorrengail\""),
  role: z.string().describe('Short role or title, e.g. "Goddess of War"'),
  type: z.string().optional().describe('Character type id, controls node shape'),
  affil: z.string().min(1).describe('Affiliation id — must exist in the series affiliations'),
  band: z.string().min(1).describe('Band id — must exist in the series bands'),
  book: z.number().int().positive().describe('First book this character appears in'),
  lastBook: z.number().int().positive().describe('Last book this character appears in'),
  status: StatusSchema.describe('Normalised status as of the end of the series'),
  statusDetail: z
    .string()
    .optional()
    .describe('Original, more specific wording where it differs, e.g. "sacrificed", "executed"'),
  size: z.string().describe('Relative node size, e.g. "main" or "side"'),
  x: z.number().describe('Horizontal position in chart units'),
  yOffset: z.number().optional().describe('Manual vertical nudge within the band'),

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
});

export const RelationshipSchema = z.object({
  from: z.string().min(1).describe('Character id of the actor — see RelationshipType.symmetric'),
  to: z.string().min(1).describe('Character id of the target'),
  type: z.string().min(1).describe('Relationship type id'),
  book: z.number().int().positive().describe('Book in which this relationship is established'),
  label: z.string().describe('Human-readable gloss, e.g. "mother", "executed him"'),
});

export const EventSchema = z.object({
  book: z.number().int().positive(),
  text: z.string().min(1).describe('One-line description of what happened'),
  involves: z
    .array(z.string())
    .describe('Character ids this event concerns — used to answer "what happened to X?"'),
  kind: EventKindSchema,
});

export const SeriesSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1),
  books: z.array(BookSchema).min(1),
  bands: z.array(BandSchema).min(1),
  affiliations: z.record(z.string(), AffiliationSchema),
  relationshipTypes: z.array(RelationshipTypeSchema).min(1),
  characters: z.array(CharacterSchema).min(1),
  relationships: z.array(RelationshipSchema),
  events: z.array(EventSchema),

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
export type Band = z.infer<typeof BandSchema>;
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

  const bandIds = new Set(series.bands.map((b) => b.id));
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

  // Bands
  const seenBands = new Set<string>();
  for (const b of series.bands) {
    if (seenBands.has(b.id)) err('duplicate-band-id', b.id, `Duplicate band id "${b.id}"`);
    seenBands.add(b.id);
  }

  // Characters
  for (const c of series.characters) {
    const at = `character "${c.id}"`;
    if (!bandIds.has(c.band)) err('unknown-band', at, `band "${c.band}" is not defined`);
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
      if (c.perceived.status === undefined && c.perceived.identity === undefined) {
        err('empty-perceived', at, 'perceived must set status, identity, or both');
      }
      if (c.perceived.status !== undefined && c.perceived.status === c.status) {
        warn('perceived-matches-actual', at,
          `perceived.status "${c.perceived.status}" equals the real status, so it records nothing`);
      }
    }

    // Segmented bios must stay inside the character's own window.
    for (const seg of c.bioByBook ?? []) {
      if (seg.book < c.book || seg.book > c.lastBook) {
        err('bio-segment-out-of-window', at,
          `bioByBook segment for book ${seg.book} is outside this character's ${c.book}-${c.lastBook}`);
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
    if (r.type === 'killed') {
      const victim = charById.get(r.to);
      if (victim && victim.status === 'alive') {
        warn(
          'killed-victim-alive',
          at,
          `victim "${victim.id}" has status "alive" — if they survived the attempt ` +
            `this is \`enemy\`, not \`killed\``,
        );
      }
    }

    // Endpoint constraints, e.g. `bonded` joins a person to a creature.
    const ep = canon.endpoints;
    if (ep) {
      const from = charById.get(r.from);
      const to = charById.get(r.to);
      if (ep.fromTypes && from?.type && !ep.fromTypes.includes(from.type)) {
        warn('endpoint-type-mismatch', at,
          `from "${from.id}" is type "${from.type}"; ${r.type} expects ${ep.fromTypes.join('/')}`);
      }
      if (ep.toTypes && to?.type && !ep.toTypes.includes(to.type)) {
        warn('endpoint-type-mismatch', at,
          `to "${to.id}" is type "${to.type}"; ${r.type} expects ${ep.toTypes.join('/')}`);
      }
      if (ep.sameType && from?.type && to?.type && from.type !== to.type) {
        warn('endpoint-type-mismatch', at,
          `${r.type} requires matching types, got "${from.type}" and "${to.type}"`);
      }
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
