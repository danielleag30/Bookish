/**
 * What the chart currently shows — pure logic, no DOM.
 *
 * Layered on top of `gate()`, so the chart inherits the spoiler boundary by
 * construction rather than re-implementing it. Tiers come from FILTERS.md:
 * tier 0 is the reading position, tiers 1-4 filter data, tier 5 is presentation.
 */
import type { Series, Character, Relationship, Region } from '../schema.ts';
import { gate, type GatedSeries } from '../spoiler.ts';
import { nodeRadius } from './shapes.ts';

export interface ChartFilters {
  /** Relationship type ids that are on. Empty set means none. */
  relTypes: Set<string>;
  /** Character type ids that are on. Empty means the series has none. */
  charTypes: Set<string>;
  /** Region ids that are on. */
  regions: Set<string>;
  /** Affiliation ids that are on. */
  affils: Set<string>;
  /**
   * Statuses that are on — alive, dead, missing, prisoner, unknown.
   *
   * Resolved at the reading position, not from the base record, so "show me who
   * is dead" means dead *as of the book you are on*. Filtering on the raw field
   * would answer with everyone who ever dies.
   */
  statuses: Set<string>;
  /** Prominence values that are on, usually `main` and `side`. */
  sizes: Set<string>;
}

export interface ChartState {
  book: number;
  filters: ChartFilters;
  selected: string | null;
  /** Presentation toggles — tier 5, never spoiler-gated. */
  showRegions: boolean;
  showLabels: boolean;
  showEdgeLabels: boolean;
  pan: { x: number; y: number };
  scale: number;
  /** Per-character position overrides from dragging. */
  moved: Record<string, { x: number; y: number }>;
}

/**
 * Every value a field takes anywhere in the series — base record or any dated
 * change. Filter sets must cover both, or a value that only ever arrives via
 * `changes` is missing from the set and silently filters its holders out.
 */
function valuesOf(series: Series, field: 'status' | 'size'): string[] {
  const out: string[] = [];
  for (const c of series.characters) {
    out.push(c[field]);
    for (const ch of c.changes ?? []) {
      const v = ch.set[field];
      if (typeof v === 'string') out.push(v);
    }
  }
  return out;
}

/** All filters on, everything visible, at the first book. */
export function initialState(series: Series): ChartState {
  return {
    book: Math.min(...series.books.map((b) => b.id)),
    filters: {
      relTypes: new Set(series.relationshipTypes.map((t) => t.id)),
      charTypes: new Set(Object.keys(series.characterTypes ?? {})),
      regions: new Set(series.regions.map((r) => r.id)),
      affils: new Set(Object.keys(series.affiliations)),
      // From the data rather than the enum, so a series where nobody is
      // `missing` does not offer a chip that always yields nothing — but it has
      // to include values that only appear in `changes`. `dead` now lives there
      // almost exclusively: base records hold the first-seen state, so building
      // this from base statuses alone left `dead` out of the set entirely and
      // hid every character at the exact book they died in.
      statuses: new Set(valuesOf(series, 'status')),
      sizes: new Set(valuesOf(series, 'size')),
    },
    selected: null,
    showRegions: true,
    showLabels: true,
    showEdgeLabels: true,
    pan: { x: 20, y: 20 },
    scale: 0.9,
    moved: {},
  };
}

export interface PlacedNode {
  character: Character;
  x: number;
  y: number;
  r: number;
  /** True when this character first appears in the current book. */
  isNew: boolean;
}

export interface PlacedEdge {
  relationship: Relationship;
  from: PlacedNode;
  to: PlacedNode;
}

export interface ChartView {
  gated: GatedSeries;
  regions: Region[];
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  byId: Map<string, PlacedNode>;
  /** Chart-space bounds, used to size the SVG. */
  extent: { w: number; h: number };
}

/** Vertical centre of a region, for characters with no explicit y. */
function regionCentre(regions: Region[], id: string): number {
  const r = regions.find((x) => x.id === id);
  return r ? r.y + r.h / 2 : 0;
}

/**
 * Resolve the current view.
 *
 * Everything flows from `gate()`, so a character or edge past the reading
 * position cannot appear no matter what the filters say.
 */
export function buildView(series: Series, state: ChartState): ChartView {
  const gated = gate(series, state.book);
  const f = state.filters;

  const regions = series.regions.filter((r) => f.regions.has(r.id));
  const regionOn = new Set(regions.map((r) => r.id));

  const nodes: PlacedNode[] = [];
  for (const c of gated.characters) {
    if (!regionOn.has(c.region)) continue;
    if (!f.affils.has(c.affil)) continue;
    // A series with no characterTypes has an empty set, so type filtering is
    // skipped entirely rather than hiding everyone.
    if (f.charTypes.size > 0 && c.type !== undefined && !f.charTypes.has(c.type)) continue;
    // `c` comes from gate(), so its status and size are already resolved to this
    // reading position — Malcolm is `alive` at book 1 and `dead` at book 2, and
    // the filter follows.
    if (!f.statuses.has(c.status)) continue;
    if (!f.sizes.has(c.size)) continue;

    const moved = state.moved[c.id];
    nodes.push({
      character: c,
      x: moved?.x ?? c.x,
      y: moved?.y ?? c.y ?? regionCentre(series.regions, c.region),
      r: nodeRadius(c.size),
      isNew: c.book === state.book,
    });
  }

  const byId = new Map(nodes.map((n) => [n.character.id, n]));

  // An edge draws only when its type is on AND both endpoints are visible. That
  // conjunction is what stops a hidden character being inferred from a dangling
  // line.
  const edges: PlacedEdge[] = [];
  for (const r of gated.relationships) {
    if (!f.relTypes.has(r.type)) continue;
    const from = byId.get(r.from);
    const to = byId.get(r.to);
    if (!from || !to) continue;
    edges.push({ relationship: r, from, to });
  }

  const w = Math.max(
    1000,
    ...series.regions.map((r) => (r.x ?? 0) + (r.w ?? 1000)),
    ...nodes.map((n) => n.x + 120),
  );
  const h = Math.max(600, ...series.regions.map((r) => r.y + r.h), ...nodes.map((n) => n.y + 90));

  return { gated, regions, nodes, edges, byId, extent: { w, h } };
}

/** Toggle one value in a filter set, returning a new set. */
export function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
