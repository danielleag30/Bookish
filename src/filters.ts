/**
 * The filter taxonomy — every dimension a chart can be toggled by.
 *
 * Source of truth for the toggle UI. FILTERS.md is the readable companion.
 *
 * SIX TIERS
 * Tier 0 is a single-select reading position that gates everything below it.
 * Tiers 1-4 filter data. Tier 5 toggles presentation only and never hides a
 * fact, so it is exempt from the spoiler rules.
 *
 * WHAT EARNS A TOGGLE
 * A dimension is only worth a toggle if its values behave like categories.
 * Three tests, applied to the real data:
 *   cardinality  2-20 distinct values
 *   coverage     at least a quarter of the entities carry a value, OR the
 *                dimension is conditional on a subset it fully covers
 *   exclusivity  each entity has at most one value
 *
 * Applying them ruled things out that look tempting:
 *   magic     33 distinct values across 33 DCC characters — one each. Free
 *             text, not a category. Display it, do not filter by it.
 *   trait     14 values across 14 Empyrean characters, each a paragraph.
 *   signet     4 of 72 characters. Too sparse to be a filter; it is a badge.
 *   wing       4 of 72, and its values are "Fourth Wing" vs
 *             "Fourth Wing (Wingleader)" — a rank, not a partition.
 *
 * And it kept two that are conditional rather than global:
 *   den        20 of 72 characters — but 20 of 20 dragons. A real facet
 *             within the dragon subset.
 *   f9         19 of 33 — everyone who fought on Floor 9.
 */

/** How many values a user may have selected at once. */
export type SelectMode =
  | 'single' // exactly one, e.g. reading position
  | 'multi'; // any subset, default all on

/** What the dimension filters. */
export type Target = 'character' | 'relationship' | 'event' | 'display';

export interface FilterDimension {
  id: string;
  label: string;
  tier: number;
  target: Target;
  selectMode: SelectMode;
  /** Where the values come from in the series data. */
  source: string;
  /** One line on what toggling it does. */
  effect: string;
  /**
   * When set, the dimension only applies to entities matching this predicate
   * description — a conditional facet.
   */
  appliesTo?: string;
  /** True when this dimension is bounded by the reading position. */
  spoilerGated: boolean;
  /**
   * Whether the chart engine actually renders a control for this.
   *
   * This taxonomy was designed as the full hierarchy the data could support,
   * and read as a description of the UI — so it claimed nine controls that do
   * not exist. A design document that describes itself as shipped is how a gap
   * survives. `built: false` says "designed, not yet wired", and a test in
   * tests/filters.test.ts fails if the flag and the engine disagree in either
   * direction, so this cannot rot in either direction.
   */
  built: boolean;
}

export const FILTER_DIMENSIONS: FilterDimension[] = [
  // ── Tier 0 · Reading position ────────────────────────────────────────────
  {
    id: 'book',
    label: 'Reading position',
    tier: 0,
    target: 'character',
    selectMode: 'single',
    source: 'series.books[].id',
    effect:
      'Sets how far the reader has read. Gates every other dimension: nothing ' +
      'first appearing after this book may be shown, by any route.',
    built: true,
    spoilerGated: false, // it *is* the gate
  },

  // ── Tier 1 · Who is on the chart ─────────────────────────────────────────
  {
    id: 'band',
    label: 'Region',
    tier: 1,
    target: 'character',
    selectMode: 'multi',
    source: 'series.bands[].id',
    effect: 'Shows or hides a horizontal region of the chart and everyone in it.',
    built: true,
    spoilerGated: true,
  },
  {
    id: 'affil',
    label: 'Faction',
    tier: 1,
    target: 'character',
    selectMode: 'multi',
    source: 'series.affiliations keys',
    effect: 'Filters by allegiance — riders, scribes, venin, gods, Royal Court.',
    built: true,
    spoilerGated: true,
  },
  {
    id: 'charType',
    label: 'Kind',
    tier: 1,
    target: 'character',
    selectMode: 'multi',
    source: 'series.characterTypes keys',
    effect: 'Filters by species or kind, which also controls node shape.',
    appliesTo: 'series that define characterTypes (Empyrean; DCC has none)',
    built: true,
    spoilerGated: true,
  },
  {
    id: 'status',
    label: 'Status',
    tier: 1,
    target: 'character',
    selectMode: 'multi',
    source: 'character.status enum',
    effect: 'Filters by alive / dead / missing / prisoner / unknown.',
    built: true,
    spoilerGated: true,
  },
  {
    id: 'size',
    label: 'Prominence',
    tier: 1,
    target: 'character',
    selectMode: 'multi',
    source: 'character.size',
    effect: 'Shows only main characters, or includes side characters too.',
    built: true,
    spoilerGated: true,
  },

  // ── Tier 2 · Conditional facets, from attrs ──────────────────────────────
  {
    id: 'den',
    label: 'Dragon den',
    tier: 2,
    target: 'character',
    selectMode: 'multi',
    source: 'character.attrs.den · palette in series.subgroups.dens',
    effect: 'Filters dragons by den colour. 8 values across all 20 dragons.',
    // Declared conditional by hand. Its coverage (20 of 72, 28%) actually
    // clears the global-facet threshold, but conditionality is semantic and a
    // coverage number cannot detect it: only dragons can have a den at all.
    appliesTo: 'characters of type dragon or irid',
    built: false,
    spoilerGated: true,
  },
  {
    id: 'f9',
    label: 'Floor 9 faction',
    tier: 2,
    target: 'character',
    selectMode: 'multi',
    source: 'character.attrs.f9',
    effect: 'Filters by Floor 9 war allegiance — Princess Posse or Team Retribution.',
    appliesTo: 'DCC characters who fought on Floor 9 (19 of 33)',
    built: false,
    spoilerGated: true,
  },

  // ── Tier 3 · Edges ───────────────────────────────────────────────────────
  {
    id: 'relType',
    label: 'Relationship type',
    tier: 3,
    target: 'relationship',
    selectMode: 'multi',
    source: 'series.relationshipTypes[].id — the canonical 14',
    effect:
      'Shows or hides edges by type. An edge is drawn only when its type is on ' +
      'AND both endpoints are visible.',
    built: true,
    spoilerGated: true,
  },

  // ── Tier 4 · Events ──────────────────────────────────────────────────────
  {
    id: 'eventKind',
    label: 'Event kind',
    tier: 4,
    target: 'event',
    selectMode: 'multi',
    source: 'event.kind enum',
    effect: 'Filters the event log by death / battle / betrayal / reveal / bond / other.',
    built: false,
    spoilerGated: true,
  },

  // ── Tier 5 · Presentation only ───────────────────────────────────────────
  // These never reveal or conceal a fact, so they are not spoiler-gated.
  {
    id: 'showBands',
    label: 'Region backgrounds',
    tier: 5,
    target: 'display',
    selectMode: 'multi',
    source: 'ui',
    effect: 'Draws the banded background behind the graph.',
    built: true,
    spoilerGated: false,
  },
  {
    id: 'showLabels',
    label: 'Character names',
    tier: 5,
    target: 'display',
    selectMode: 'multi',
    source: 'ui',
    effect: 'Shows names beside nodes.',
    built: true,
    spoilerGated: false,
  },
  {
    id: 'showEdgeLabels',
    label: 'Relationship labels',
    tier: 5,
    target: 'display',
    selectMode: 'multi',
    source: 'ui',
    effect: 'Shows the gloss on each edge, e.g. "mother", "executed him".',
    built: true,
    spoilerGated: false,
  },
  {
    id: 'showGlyphs',
    label: 'Signet badges',
    tier: 5,
    target: 'display',
    selectMode: 'multi',
    source: 'series.glyphs',
    effect: 'Shows the small power badge next to characters that have one.',
    built: false,
    spoilerGated: false,
  },
  {
    id: 'showNewRing',
    label: 'Highlight new this book',
    tier: 5,
    target: 'display',
    selectMode: 'multi',
    source: 'ui',
    effect: 'Rings characters whose first book equals the reading position.',
    built: false,
    spoilerGated: false,
  },
  {
    id: 'legend',
    label: 'Legend',
    tier: 5,
    target: 'display',
    selectMode: 'multi',
    source: 'ui',
    effect: 'Shows, collapses, or hides the draggable legend.',
    built: false,
    spoilerGated: false,
  },
];

export const DIMENSION_BY_ID = new Map(FILTER_DIMENSIONS.map((d) => [d.id, d]));

/**
 * Dimensions deliberately excluded, with the reason. Recorded so the decision
 * is reviewable rather than looking like an oversight.
 */
export const REJECTED_DIMENSIONS: Record<string, string> = {
  magic:
    '33 distinct values across 33 DCC characters — one per character. Free text, ' +
    'not a category. Display it on the character card instead.',
  trait:
    '14 distinct values across 14 Empyrean characters, each a full paragraph of ' +
    'characterisation. Display only.',
  signet:
    'Only 4 of 72 characters carry it, and every value is unique. It is a badge ' +
    '(see the showGlyphs display toggle), not a filter.',
  wing:
    'Only 4 of 72 characters, and the values are "Fourth Wing" versus ' +
    '"Fourth Wing (Wingleader)" — a rank within one wing, not a partition.',
  homeland:
    'Only 4 of 72 characters, with overlapping values ("Navarre" and ' +
    '"Navarre (Basgiath)"). Would need normalising before it could be a facet.',
};

/** Thresholds used to decide whether a candidate dimension earns a toggle. */
export const FACET_RULES = {
  minDistinct: 2,
  maxDistinct: 20,
  /** Fraction of entities that must carry a value, for a global facet. */
  minCoverage: 0.25,
  /** Above this, values are effectively unique and the field is free text. */
  maxUniqueRatio: 0.7,
} as const;

/**
 * Classify a candidate attrs key against FACET_RULES.
 * Used by scripts/audit-filters.ts so new series get checked rather than
 * having someone eyeball the numbers.
 */
export function classifyCandidate(
  values: (string | undefined)[],
  totalEntities: number,
): { verdict: 'facet' | 'conditional-facet' | 'reject'; why: string } {
  const present = values.filter((v): v is string => Boolean(v));
  const distinct = new Set(present).size;
  const coverage = present.length / totalEntities;
  const uniqueRatio = present.length === 0 ? 1 : distinct / present.length;

  if (distinct < FACET_RULES.minDistinct) {
    return { verdict: 'reject', why: `only ${distinct} distinct value(s)` };
  }
  if (distinct > FACET_RULES.maxDistinct) {
    return { verdict: 'reject', why: `${distinct} distinct values exceeds ${FACET_RULES.maxDistinct}` };
  }
  if (uniqueRatio > FACET_RULES.maxUniqueRatio) {
    return {
      verdict: 'reject',
      why: `unique ratio ${uniqueRatio.toFixed(2)} — values are effectively per-entity free text`,
    };
  }
  // Low coverage SUGGESTS conditionality, but it cannot prove it, and clearing
  // the threshold does not disprove it. `den` covers 28% — above the line — yet
  // is still conditional, because only dragons can have a den. Semantic
  // restriction must be declared by setting `appliesTo`.
  if (coverage < FACET_RULES.minCoverage) {
    return {
      verdict: 'conditional-facet',
      why: `coverage ${(coverage * 100).toFixed(0)}% is below ${FACET_RULES.minCoverage * 100}%, ` +
        `so it can only be a facet within the subset it covers — state that subset in appliesTo`,
    };
  }
  return {
    verdict: 'facet',
    why: `${distinct} values, ${(coverage * 100).toFixed(0)}% coverage, unique ratio ${uniqueRatio.toFixed(2)}`,
  };
}
