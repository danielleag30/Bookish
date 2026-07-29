import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  FILTER_DIMENSIONS,
  DIMENSION_BY_ID,
  REJECTED_DIMENSIONS,
  classifyCandidate,
} from '../src/filters.ts';
import { SeriesSchema } from '../src/schema.ts';

const dataDir = resolve(import.meta.dirname, '..', 'data');
const load = (n: string) => SeriesSchema.parse(JSON.parse(readFileSync(join(dataDir, n), 'utf8')));
const files = readdirSync(dataDir).filter((f) => f.endsWith('.json'));

describe('the taxonomy is well-formed', () => {
  it('has no duplicate dimension ids', () => {
    const ids = FILTER_DIMENSIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every dimension a source and an effect', () => {
    for (const d of FILTER_DIMENSIONS) {
      expect(d.source.length, `${d.id} source`).toBeGreaterThan(0);
      expect(d.effect.length, `${d.id} effect`).toBeGreaterThan(15);
    }
  });

  it('has exactly one single-select dimension, the reading position', () => {
    const single = FILTER_DIMENSIONS.filter((d) => d.selectMode === 'single');
    expect(single).toHaveLength(1);
    expect(single[0]!.id).toBe('book');
    expect(single[0]!.tier).toBe(0);
  });

  it('spoiler-gates every data dimension and no presentation one', () => {
    for (const d of FILTER_DIMENSIONS) {
      if (d.id === 'book') continue; // it is the gate, not gated
      if (d.target === 'display') {
        expect(d.spoilerGated, `${d.id} only changes appearance`).toBe(false);
      } else {
        expect(d.spoilerGated, `${d.id} filters data so must be gated`).toBe(true);
      }
    }
  });

  it('names the subset for every conditional facet', () => {
    for (const d of FILTER_DIMENSIONS.filter((x) => x.tier === 2)) {
      expect(d.appliesTo, `${d.id} is conditional so needs appliesTo`).toBeTruthy();
    }
  });

  it('explains every rejected dimension', () => {
    for (const [id, why] of Object.entries(REJECTED_DIMENSIONS)) {
      expect(why.length, `${id}`).toBeGreaterThan(30);
      expect(DIMENSION_BY_ID.has(id), `${id} is both rejected and active`).toBe(false);
    }
  });
});

describe('classifyCandidate matches the decisions made', () => {
  it("rejects DCC's `magic` — 33 distinct values across 33 characters", () => {
    const values = Array.from({ length: 33 }, (_, i) => `power ${i}`);
    const r = classifyCandidate(values, 33);
    expect(r.verdict).toBe('reject');
    // Cardinality is checked before uniqueness, so 33 > 20 fires first. Either
    // reason is correct; assert only the verdict plus that a reason is given.
    expect(r.why.length).toBeGreaterThan(10);
  });

  it('rejects on uniqueness alone, within the cardinality limit', () => {
    // 15 distinct values across 15 entities: passes cardinality, fails
    // uniqueness. This is the rule that catches per-entity free text.
    const values = Array.from({ length: 15 }, (_, i) => `v${i}`);
    const r = classifyCandidate(values, 15);
    expect(r.verdict).toBe('reject');
    expect(r.why).toMatch(/unique ratio/);
  });

  it('rejects a field with too many distinct values', () => {
    const values = Array.from({ length: 60 }, (_, i) => `v${i % 40}`);
    expect(classifyCandidate(values, 60).verdict).toBe('reject');
  });

  it('rejects a field with only one distinct value', () => {
    expect(classifyCandidate(['same', 'same', 'same'], 10).verdict).toBe('reject');
  });

  it('accepts a well-covered low-cardinality field as a facet', () => {
    // Something like `status`: a few values, everyone has one.
    const values = Array.from({ length: 40 }, (_, i) => ['alive', 'dead', 'missing'][i % 3]!);
    expect(classifyCandidate(values, 40).verdict).toBe('facet');
  });

  it('calls a genuinely sparse field a conditional facet', () => {
    // 10 values across 72 entities — 14% coverage, below the 25% threshold.
    const values = Array.from({ length: 10 }, (_, i) => `v${i % 4}`);
    const r = classifyCandidate(values, 72);
    expect(r.verdict).toBe('conditional-facet');
    expect(r.why).toMatch(/coverage/);
  });

  it('cannot detect semantic conditionality from coverage alone', () => {
    // `den` covers 20 of 72 (28%), which CLEARS the global-facet threshold —
    // yet it is still conditional, because only dragons can have a den. The
    // classifier says `facet`; `appliesTo` has to be set by hand. This test
    // pins that limitation so it is not mistaken for a bug later.
    const values = Array.from({ length: 20 }, (_, i) => `den${i % 8}`);
    expect(classifyCandidate(values, 72).verdict).toBe('facet');
    expect(DIMENSION_BY_ID.get('den')?.appliesTo).toBeTruthy();
  });
});

describe('every active dimension resolves against the real data', () => {
  for (const file of files) {
    const s = load(file);

    // Drafts are scaffolded with one region and one affiliation on purpose —
    // extraction reads notes, it does not invent geography or factions. Held
    // to this bar, a fresh draft would only tempt the next person to make up
    // canon to turn CI green. The bar applies once a human has curated it.
    it.skipIf(s.draft)(`${file}: tier-1 character dimensions have values`, () => {
      expect(new Set(s.characters.map((c) => c.region)).size).toBeGreaterThan(1);
      expect(new Set(s.characters.map((c) => c.affil)).size).toBeGreaterThan(1);
      expect(new Set(s.characters.map((c) => c.status)).size).toBeGreaterThan(1);
      expect(new Set(s.characters.map((c) => c.size)).size).toBeGreaterThan(1);
    });

    it(`${file}: every character's band and affil are declared by the series`, () => {
      const regionIds = new Set(s.regions.map((b: {id:string}) => b.id));
      for (const c of s.characters) {
        expect(regionIds.has(c.region), `${c.id} band`).toBe(true);
        expect(s.affiliations[c.affil], `${c.id} affil`).toBeTruthy();
      }
    });

    it(`${file}: event kinds are all in the enum`, () => {
      const allowed = new Set(['death', 'betrayal', 'battle', 'reveal', 'bond', 'other']);
      for (const e of s.events) expect(allowed.has(e.kind)).toBe(true);
    });
  }
});

describe('perceived state', () => {
  const s = load('empyrean.json');

  it('records that Brennan is presumed dead through book 1', () => {
    const b = s.characters.find((c) => c.id === 'brennan')!;
    expect(b.status).toBe('alive');
    expect(b.perceived?.status).toBe('dead');
    expect(b.perceived?.untilBook).toBe(1);
    expect(b.perceived?.note).toMatch(/Fourth Wing/);
  });

  it('records the alias case', () => {
    const aaric = s.characters.find((c) => c.id === 'aaric')!;
    expect(aaric.perceived?.identity).toBe('Aaric Graycastle');
    expect(aaric.perceived?.untilBook).toBe(2);
  });

  it('records Panchek as a planted spy, not a defector', () => {
    // Canon has him present across Fourth Wing and Iron Flame, so book 1 is
    // right. He is venin from the start and never switches sides, so this is a
    // false belief rather than a change — his true `affil` is venin while his
    // `region` stays leadership, which is why the two are separate fields.
    const panchek = s.characters.find((c) => c.id === 'panchek')!;
    expect(panchek.book).toBe(1);
    expect(panchek.affil).toBe('venin');
    expect(panchek.region).toBe('leadership');
    expect(panchek.perceived?.affil).toBe('faculty');
    expect(panchek.perceived?.untilBook).toBe(2);
    // Not modelled as a change: he did not become venin.
    expect(panchek.changes?.some((ch) => ch.set.affil)).toBeFalsy();
  });

  it('never records a perceived state identical to the real one', () => {
    for (const file of files) {
      for (const c of load(file).characters) {
        if (c.perceived?.status !== undefined) {
          expect(c.perceived.status, `${c.id}`).not.toBe(c.status);
        }
      }
    }
  });

  it('holds every perceived belief from the first book the character appears', () => {
    for (const file of files) {
      for (const c of load(file).characters) {
        if (!c.perceived) continue;
        expect(c.perceived.untilBook, `${c.id}`).toBeGreaterThanOrEqual(c.book);
      }
    }
  });
});

describe('bio spoiler containment', () => {
  it('has no bioByBook segment outside its character window', () => {
    for (const file of files) {
      const series = load(file);
      // Upper bound is the series, not lastBook: `gate()` filters on
      // `book <= position` only, so a character stays on the chart after the
      // book they die in. Liam dies in book one and his bio names someone from
      // book two — that segment belongs at book two.
      const finalBook = Math.max(...series.books.map((b: { id: number }) => b.id));
      for (const c of series.characters) {
        for (const seg of c.bioByBook ?? []) {
          expect(seg.book, `${c.id}`).toBeGreaterThanOrEqual(c.book);
          expect(seg.book, `${c.id}`).toBeLessThanOrEqual(finalBook);
        }
      }
    }
  });

  // Replaces the old placeholder, which asserted bios were NOT segmented and
  // said in its own comment to swap it for a coverage test once they were.
  it('every bio is segmented, so readers get one at their position', () => {
    for (const file of files) {
      for (const c of load(file).characters) {
        if (!c.bio) continue;
        expect(c.bioByBook?.length, `${file}:${c.id} has a bio but no segments`).toBeTruthy();
      }
    }
  });

  it('no bio segment names a character the reader has not met', () => {
    for (const file of files) {
      const series = load(file);
      const firstBook = new Map(series.characters.map((c) => [c.id, c.book]));
      for (const c of series.characters) {
        for (const seg of c.bioByBook ?? []) {
          for (const other of series.characters) {
            if (other.id === c.id || (firstBook.get(other.id) ?? 1) <= seg.book) continue;
            // "Auren's Parents" is a group named after someone already on the
            // chart. Its only distinctive token is the possessive of a visible
            // character, so matching on it flags every bio that mentions Auren.
            if (/['’]s\b/.test(other.label)) continue;
            // Only distinctive names. Some "characters" are groups or places
            // whose labels are common nouns — "Auren's Parents", "Seventh
            // Ruins" — and matching on `parents` flags any bio that mentions
            // somebody's parents.
            const COMMON = new Set([
              'parents', 'temple', 'ruins', 'kingdom', 'council', 'guard',
              'army', 'court', 'house', 'family', 'people', 'system',
            ]);
            const token = other.label
              .split(/[\s·/,]+/)
              .find((t) => t.length >= 5 && !COMMON.has(t.toLowerCase().replace(/[^a-z]/g, '')));
            if (!token) continue;
            const unique =
              series.characters.filter((x) => x.label.includes(token)).length === 1;
            if (!unique) continue;
            expect(
              new RegExp(`(?<!\\w)${token}(?!\\w)`).test(seg.text),
              `${file}:${c.id} book-${seg.book} segment names ${other.label} (book ${other.book})`,
            ).toBe(false);
          }
        }
      }
    }
  });
});

/**
 * The taxonomy must not claim controls the engine does not render.
 *
 * FILTER_DIMENSIONS was designed as the full hierarchy the data could support
 * and read as a description of the UI, so it advertised nine controls that do
 * not exist. A design document that describes itself as shipped is how a gap
 * survives review. This test fails in BOTH directions: mark something built
 * that isn't, or build something and forget to mark it.
 */
describe('declared filters match the engine', () => {
  const engine =
    readFileSync(resolve(import.meta.dirname, '..', 'src', 'engine', 'chart.ts'), 'utf8');

  // Every control the engine renders, by the state it toggles.
  const CONTROLS: Record<string, RegExp> = {
    book: /state\.book\s*=|setBook\(/,
    affil: /state\.filters\.affils/,
    charType: /state\.filters\.charTypes/,
    relType: /state\.filters\.relTypes/,
    band: /state\.filters\.bands/,
    status: /state\.filters\.statuses/,
    size: /state\.filters\.sizes/,
    den: /state\.filters\.dens/,
    f9: /state\.filters\.f9/,
    eventKind: /state\.filters\.eventKinds/,
    showBands: /state\.showRegions/,
    showLabels: /state\.showLabels/,
    showEdgeLabels: /state\.showEdgeLabels/,
    showGlyphs: /state\.showGlyphs/,
    showNewRing: /state\.showNewRing/,
    legend: /state\.showLegend/,
  };

  for (const d of FILTER_DIMENSIONS) {
    const probe = CONTROLS[d.id];
    if (!probe) continue; // a dimension with no known state key yet
    it(`${d.id}: built flag matches the engine`, () => {
      const wired = probe.test(engine);
      expect(
        wired,
        d.built
          ? `${d.id} is marked built but the engine has no control for it`
          : `${d.id} IS wired in the engine — set built: true`,
      ).toBe(d.built);
    });
  }

  it('every tier-1 dimension is either built or honestly flagged', () => {
    const unbuiltTier1 = FILTER_DIMENSIONS.filter((d) => d.tier === 1 && !d.built).map((d) => d.id);
    // Not an assertion that they are all built — they are not. This records the
    // remaining tier-1 gap so shrinking it is visible and growing it fails.
    expect(unbuiltTier1.sort()).toEqual(['band', 'size', 'status']);
  });
});
