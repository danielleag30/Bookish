import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema, type Series } from '../src/schema.ts';
import { nodeShape, edgePath, edgeMidpoint, trimToRim, nodeRadius } from '../src/engine/shapes.ts';
import { initialState, buildView, toggle } from '../src/engine/view.ts';

const dataDir = resolve(import.meta.dirname, '..', 'data');
const load = (n: string): Series =>
  SeriesSchema.parse(JSON.parse(readFileSync(join(dataDir, n), 'utf8')));
const files = readdirSync(dataDir).filter((f) => f.endsWith('.json'));

describe('shapes', () => {
  it('produces a circle for unknown shape names rather than throwing', () => {
    expect(nodeShape('not-a-shape', 0, 0, 10).tag).toBe('circle');
  });

  it('builds every declared shape', () => {
    for (const s of ['circle', 'diamond', 'triangle', 'hexagon', 'star6', 'star8', 'chevron', 'square']) {
      const spec = nodeShape(s, 50, 50, 12);
      expect(['circle', 'polygon', 'rect']).toContain(spec.tag);
      if (spec.tag === 'polygon') {
        expect(String(spec.attrs['points']).split(' ').length).toBeGreaterThan(2);
        expect(String(spec.attrs['points'])).not.toContain('NaN');
      }
    }
  });

  it('sizes main characters larger than side characters', () => {
    expect(nodeRadius('main')).toBeGreaterThan(nodeRadius('side'));
  });

  it('draws a curved path between two points', () => {
    const d = edgePath(0, 0, 100, 0);
    expect(d).toMatch(/^M 0 0 Q /);
    expect(d).not.toContain('NaN');
  });

  it('survives coincident endpoints without dividing by zero', () => {
    expect(edgePath(10, 10, 10, 10)).not.toContain('NaN');
    expect(edgeMidpoint(10, 10, 10, 10)).not.toHaveProperty('x', NaN);
    expect(trimToRim(5, 5, 5, 5, 10, 10).some(Number.isNaN)).toBe(false);
  });

  it('puts the edge midpoint off the straight line, so labels avoid the chord', () => {
    const m = edgeMidpoint(0, 0, 100, 0);
    expect(m.x).toBeCloseTo(50, 1);
    expect(Math.abs(m.y)).toBeGreaterThan(1);
  });

  it('trims endpoints back by each radius', () => {
    const [x1, , x2] = trimToRim(0, 0, 100, 0, 10, 20);
    expect(x1).toBeCloseTo(10, 5);
    expect(x2).toBeCloseTo(80, 5);
  });
});

describe('view', () => {
  for (const file of files) {
    const series = load(file);

    it(`${file}: starts at the first book with everything on`, () => {
      const st = initialState(series);
      expect(st.book).toBe(Math.min(...series.books.map((b) => b.id)));
      expect(st.filters.relTypes.size).toBe(series.relationshipTypes.length);
      expect(st.filters.regions.size).toBe(series.regions.length);
    });

    it(`${file}: never places a node past the reading position`, () => {
      for (const b of series.books) {
        const view = buildView(series, { ...initialState(series), book: b.id });
        for (const n of view.nodes) expect(n.character.book).toBeLessThanOrEqual(b.id);
      }
    });

    it(`${file}: only draws an edge when both endpoints are placed`, () => {
      for (const b of series.books) {
        const view = buildView(series, { ...initialState(series), book: b.id });
        for (const e of view.edges) {
          expect(view.byId.has(e.relationship.from)).toBe(true);
          expect(view.byId.has(e.relationship.to)).toBe(true);
        }
      }
    });

    it(`${file}: gives every node finite coordinates`, () => {
      const view = buildView(series, initialState(series));
      for (const n of view.nodes) {
        expect(Number.isFinite(n.x), n.character.id).toBe(true);
        expect(Number.isFinite(n.y), n.character.id).toBe(true);
      }
    });

    it(`${file}: hiding a region removes its characters and their edges`, () => {
      const st = initialState(series);
      const first = series.regions[0]!.id;
      const before = buildView(series, st);
      const after = buildView(series, {
        ...st, filters: { ...st.filters, regions: toggle(st.filters.regions, first) },
      });
      expect(after.nodes.every((n) => n.character.region !== first)).toBe(true);
      expect(after.nodes.length).toBeLessThanOrEqual(before.nodes.length);
      for (const e of after.edges) {
        expect(after.byId.has(e.relationship.from)).toBe(true);
      }
    });

    it(`${file}: turning off all relationship types leaves no edges`, () => {
      const st = initialState(series);
      const view = buildView(series, { ...st, filters: { ...st.filters, relTypes: new Set() } });
      expect(view.edges).toEqual([]);
      expect(view.nodes.length).toBeGreaterThan(0);
    });

    it(`${file}: marks exactly the characters introduced in the current book as new`, () => {
      for (const b of series.books) {
        const view = buildView(series, { ...initialState(series), book: b.id });
        for (const n of view.nodes) {
          expect(n.isNew).toBe(n.character.book === b.id);
        }
      }
    });
  }

  it('applies drag overrides in place of stored coordinates', () => {
    const series = load('empyrean.json');
    const st = initialState(series);
    const view = buildView(series, { ...st, moved: { violet: { x: 999, y: 888 } } });
    const violet = view.byId.get('violet');
    expect(violet?.x).toBe(999);
    expect(violet?.y).toBe(888);
  });

  it('skips character-type filtering for a series that declares none', () => {
    // DCC has no characterTypes, so an empty filter set must not hide everyone.
    const dcc = load('dcc.json');
    expect(Object.keys(dcc.characterTypes ?? {})).toHaveLength(0);
    expect(buildView(dcc, initialState(dcc)).nodes.length).toBeGreaterThan(0);
  });
});

describe('toggle', () => {
  it('adds and removes without mutating the original', () => {
    const a = new Set(['x']);
    const b = toggle(a, 'y');
    expect([...a]).toEqual(['x']);
    expect(b.has('y')).toBe(true);
    expect(toggle(b, 'x').has('x')).toBe(false);
  });
});
