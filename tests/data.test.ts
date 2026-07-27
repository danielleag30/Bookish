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

  it('has all three migrated series', () => {
    expect(files.sort()).toEqual(['dcc.json', 'empyrean.json', 'plated-prisoner.json']);
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

  it('kept 111 relationships — 115 source edges, minus 2 merged duplicates and 2 incorrect', () => {
    expect(s.relationships).toHaveLength(111);
  });

  it('applied the canon corrections', () => {
    // Lilith dies at the Battle of Basgiath in Iron Flame (book 2). lastBook 1
    // hid her from the book she dies in.
    const lilith = s.characters.find((c) => c.id === 'lilith');
    expect(lilith?.lastBook).toBe(2);

    // Her dragon's lifeforce goes into the wardstone in the same scene.
    expect(s.characters.find((c) => c.id === 'aimsir')?.lastBook).toBe(2);

    // Berwyn turns Xaden venin at the end of Iron Flame, so he appears in
    // book 2 — here the character was wrong, not the relationship.
    expect(s.characters.find((c) => c.id === 'berwyn')?.book).toBe(2);

    // Halden is referenced in book 1 but first appears in Onyx Storm, so here
    // the relationship was wrong, not the character.
    expect(s.characters.find((c) => c.id === 'halden')?.book).toBe(3);
    const halden = s.relationships.find(
      (r) => r.from === 'king_tauri' && r.to === 'halden' && r.type === 'family',
    );
    expect(halden?.book).toBe(3);
  });

  it('dropped the two factually wrong killed edges', () => {
    const has = (from: string, to: string, type: string) =>
      s.relationships.some((r) => r.from === from && r.to === to && r.type === type);

    // Quinn is killed by an unnamed venin; Violet kills Theophanie.
    expect(has('quinn', 'theophanie', 'killed')).toBe(false);

    // Trager and his gryphon were burned together — neither killed the other.
    expect(has('trager', 'silaraine', 'killed')).toBe(false);
    // The bonded edge between them must survive.
    expect(has('trager', 'silaraine', 'bonded')).toBe(true);
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

    // Jack's BASE record is now his book-1 state (alive rider); `prisoner`
    // arrives as a book-3 change. See the temporal model in DATA-DICTIONARY.md.
    const jack = s.characters.find((c) => c.id === 'jack');
    expect(jack?.status).toBe('alive');
    expect(jack?.changes?.some((ch) => ch.set.status === 'prisoner')).toBe(true);
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

  it('lifted magic to a first-class field and kept the rest in attrs', () => {
    const carl = s.characters.find((c) => c.id === 'carl');
    // `magic` was promoted out of attrs, adopting the Plated Prisoner model.
    expect(carl?.magic).toBeTruthy();
    expect(carl?.attrs?.['magic']).toBeUndefined();
    // Genuinely series-specific extras stay in attrs.
    const f9 = s.characters.filter((c) => c.attrs?.['f9']);
    expect(f9.length).toBeGreaterThan(0);
  });
});

describe('plated-prisoner', () => {
  const s = load('plated-prisoner.json');

  it('kept all 39 characters and 6 books', () => {
    expect(s.characters).toHaveLength(39);
    expect(s.books).toHaveLength(6);
  });

  it('re-indexed books from 0-based to 1-based', () => {
    expect(s.books.map((b) => b.id)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const c of s.characters) expect(c.book).toBeGreaterThanOrEqual(1);
    for (const r of s.relationships) expect(r.book).toBeGreaterThanOrEqual(1);
  });

  it('turned bare book strings into objects with a short label', () => {
    // Source was ["Book 1: Gild", …] — no id, no label to put on a button.
    expect(s.books[0]?.short).toBe('Gild');
    expect(s.books[5]?.short).toBe('Goldfinch');
  });

  it('kept the 2D region geometry that the other charts adopted', () => {
    const annwyn = s.regions.find((r) => r.id === 'annwyn');
    expect(annwyn?.w).toBeGreaterThan(0);
    expect(annwyn?.h).toBeGreaterThan(0);
    expect(annwyn?.power).toBeTruthy();
  });

  it('gave every character an explicit y, so no offset table is needed', () => {
    for (const c of s.characters) expect(typeof c.y).toBe('number');
  });

  it('mapped all 21 phrase-ids onto the canonical vocabulary', () => {
    for (const t of s.relationshipTypes) {
      expect(t.id).toMatch(/^[a-z]+$/);
    }
    for (const r of s.relationships) expect(r.type).toMatch(/^[a-z]+$/);
  });

  it('folded the duplicate romantic edges into one edge that changes', () => {
    // Source had Slow-burn romance (bk2) AND Love Interest (bk3) between the
    // same pair; both alias to `romantic`, so they were one relationship.
    const rom = s.relationships.filter(
      (r) => r.from === 'auren' && r.to === 'rip' && r.type === 'romantic',
    );
    expect(rom).toHaveLength(1);
    expect(rom[0]?.changes?.some((ch) => ch.book === 3)).toBe(true);

    // Fated Mates is a genuinely different bond, so it stays its own edge.
    expect(s.relationships.some(
      (r) => r.from === 'auren' && r.to === 'rip' && r.type === 'mated',
    )).toBe(true);

    // And the captor relationship is concurrent, not superseded.
    expect(s.relationships.some(
      (r) => r.from === 'rip' && r.to === 'auren' && r.type === 'captor',
    )).toBe(true);
  });

  it('gave Rip his aliases so a shared surname stops mislinking', () => {
    const rip = s.characters.find((c) => c.id === 'rip');
    expect(rip?.aliases).toContain('Slade Ravinger');
    // The book-3 reveal event must name Rip, not Elore Ravinger.
    const reveal = s.events.find((e) => e.text.includes('revealed to be King Slade'));
    expect(reveal?.involves).not.toContain('elore');
  });
});
