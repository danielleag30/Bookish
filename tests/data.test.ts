import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema, checkIntegrity } from '../src/schema.ts';

/**
 * Guards the extracted data itself. `npm run validate` does the same checks in
 * CI, but these lock in the counts so a regression in the migration script
 * (a mangled bio, a dropped relationship) fails a test rather than sailing
 * through unnoticed.
 */

const dataDir = resolve(import.meta.dirname, '..', 'data');
const load = (name: string) =>
  SeriesSchema.parse(JSON.parse(readFileSync(join(dataDir, name), 'utf8')));

describe('every data file', () => {
  const files = readdirSync(dataDir).filter((f) => f.endsWith('.json'));

  it('has at least the two migrated series', () => {
    expect(files.sort()).toEqual(['dcc.json', 'empyrean.json']);
  });

  for (const file of files) {
    describe(file, () => {
      it('passes shape validation', () => {
        expect(() => load(file)).not.toThrow();
      });

      it('has no integrity errors', () => {
        const issues = checkIntegrity(load(file));
        const errs = issues.filter((i) => i.severity === 'error');
        expect(errs, JSON.stringify(errs, null, 2)).toEqual([]);
      });

      it('gives every character a unique id', () => {
        const s = load(file);
        const ids = s.characters.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('never has a character whose first book is after their last', () => {
        for (const c of load(file).characters) {
          expect(c.book, `${c.id}`).toBeLessThanOrEqual(c.lastBook);
        }
      });
    });
  }
});

describe('empyrean', () => {
  const s = load('empyrean.json');

  it('kept all 72 characters and 4 books', () => {
    expect(s.characters).toHaveLength(72);
    expect(s.books).toHaveLength(4);
  });

  it('kept 113 relationships — 115 source edges minus the 2 merged duplicates', () => {
    expect(s.relationships).toHaveLength(113);
  });

  it('dropped the reversed duplicates rather than both copies', () => {
    const has = (from: string, to: string, type: string) =>
      s.relationships.some((r) => r.from === from && r.to === to && r.type === type);

    // sibling/sister pair: the more specific direction survives
    expect(has('sloane', 'liam', 'family')).toBe(true);
    expect(has('liam', 'sloane', 'family')).toBe(false);

    // romantic pair: one direction survives, carrying the merged label
    expect(has('violet', 'xaden', 'romantic')).toBe(true);
    expect(has('xaden', 'violet', 'romantic')).toBe(false);
    const rom = s.relationships.find((r) => r.type === 'romantic' && r.from === 'violet');
    expect(rom?.label).toContain('Bk3');
  });

  it('preserved bios verbatim, including apostrophes and unicode', () => {
    const violet = s.characters.find((c) => c.id === 'violet');
    expect(violet?.bio).toBeTruthy();
    // A regex-based extractor would have truncated at the apostrophe.
    const withApostrophe = s.characters.filter((c) => c.bio?.includes("'"));
    expect(withApostrophe.length).toBeGreaterThan(0);
  });

  it('normalised status but kept the original wording', () => {
    const lilith = s.characters.find((c) => c.id === 'lilith');
    expect(lilith?.status).toBe('dead');
    expect(lilith?.statusDetail).toBe('sacrificed');

    const fen = s.characters.find((c) => c.id === 'fen');
    expect(fen?.statusDetail).toBe('executed');
  });

  it('kept "missing" and "prisoner" distinct from "dead"', () => {
    const missing = s.characters.filter((c) => c.status === 'missing').map((c) => c.id);
    expect(missing).toEqual(expect.arrayContaining(['garrick', 'bodhi', 'aaric']));

    const jack = s.characters.find((c) => c.id === 'jack');
    expect(jack?.status).toBe('prisoner');
  });

  it('renamed the killed type so it reads in the stored direction', () => {
    // Data stores killer -> victim (lilith -> fen "executed him"), so a legend
    // reading "Killed by" would render the edge backwards.
    const killed = s.relationshipTypes.find((r) => r.id === 'killed');
    expect(killed?.label).toBe('Killed');
    expect(s.relationships.some((r) => r.from === 'lilith' && r.to === 'fen')).toBe(true);
  });

  it('dropped the "all" filter pseudo-type from relationship types', () => {
    expect(s.relationshipTypes.some((r) => r.id === 'all')).toBe(false);
  });

  it('linked events to characters, including possessive mentions', () => {
    const linked = s.events.filter((e) => e.involves.length > 0);
    expect(linked.length).toBeGreaterThan(s.events.length / 2);

    // "cure for Xaden's venin" must resolve to xaden
    const possessive = s.events.find((e) => e.text.includes("Xaden's venin"));
    expect(possessive?.involves).toContain('xaden');
  });

  it('does not link surnames to the wrong family member', () => {
    // "Violet Sorrengail forced from Scribes" must not pull in the other
    // four Sorrengails.
    const e = s.events.find((x) => x.text.startsWith('Violet Sorrengail forced'));
    expect(e?.involves).toEqual(['violet']);
  });

  it('classifies "Falls for Xaden" as a bond, not a death', () => {
    const e = s.events.find((x) => x.text.startsWith('Falls for Xaden'));
    expect(e?.kind).toBe('bond');
  });
});

describe('dcc', () => {
  const s = load('dcc.json');

  it('kept all 33 characters and 8 books', () => {
    expect(s.characters).toHaveLength(33);
    expect(s.books).toHaveLength(8);
  });

  it('folded the three parallel faction maps into one affiliations map', () => {
    // Source had FC (colour), FL (label) and FEMOJI (emoji) as separate consts.
    expect(Object.keys(s.affiliations).sort()).toEqual([
      'antagonists', 'crawlers', 'gods', 'outside', 'royal',
    ]);
    const royal = s.affiliations['royal'];
    expect(royal?.label).toBe('Royal Court');
    expect(royal?.color).toBeTruthy();
    expect(royal?.emoji).toBeTruthy();
  });

  it('mapped the `faction` field onto the shared `affil` field', () => {
    for (const c of s.characters) expect(s.affiliations[c.affil]).toBeTruthy();
  });

  it('kept series-specific fields in attrs rather than dropping them', () => {
    const carl = s.characters.find((c) => c.id === 'carl');
    expect(carl?.attrs?.['magic']).toBeTruthy();
  });
});
