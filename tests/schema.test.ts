import { describe, it, expect } from 'vitest';
import { SeriesSchema, checkIntegrity, type Series } from '../src/schema.ts';

/**
 * These tests assert the validator REJECTS broken data. A validator that only
 * accepts good data proves nothing — the whole point is catching the mistakes
 * that hand-entering 72 characters over months inevitably produces.
 */

/** Smallest series that passes every rule; each test breaks one thing. */
function validSeries(): Series {
  return {
    id: 'test',
    title: 'Test Series',
    author: 'A. Author',
    books: [
      { id: 1, title: 'Book One', short: 'One' },
      { id: 2, title: 'Book Two', short: 'Two' },
    ],
    regions: [{ id: 'main', label: 'Main', y: 0, h: 100 }],
    affiliations: { good: { label: 'Good', color: '#fff' } },
    relationshipTypes: [
      { id: 'family', label: 'Family', color: '#f00', dash: null, symmetric: false },
      { id: 'romantic', label: 'Romantic', color: '#0f0', dash: null, symmetric: true },
    ],
    characters: [
      { id: 'alice', label: 'Alice', role: 'Hero', affil: 'good', region: 'main',
        book: 1, lastBook: 2, status: 'alive', size: 'main', x: 0 },
      { id: 'bob', label: 'Bob', role: 'Sidekick', affil: 'good', region: 'main',
        book: 1, lastBook: 2, status: 'alive', size: 'side', x: 100 },
    ],
    relationships: [
      { from: 'alice', to: 'bob', type: 'family', book: 1, label: 'brother' },
    ],
    events: [
      { book: 1, text: 'Alice meets Bob', involves: ['alice', 'bob'], kind: 'bond' },
    ],
  };
}

const rules = (s: Series) => checkIntegrity(s).map((i) => i.rule);
const errors = (s: Series) => checkIntegrity(s).filter((i) => i.severity === 'error');

describe('baseline', () => {
  it('accepts a well-formed series with no issues', () => {
    const s = validSeries();
    expect(SeriesSchema.safeParse(s).success).toBe(true);
    expect(checkIntegrity(s)).toEqual([]);
  });
});

describe('shape validation', () => {
  it('rejects an unknown status value', () => {
    const s = { ...validSeries() };
    s.characters[0]!.status = 'sacrificed' as never;
    expect(SeriesSchema.safeParse(s).success).toBe(false);
  });

  it('accepts the statuses that are genuinely not "dead"', () => {
    for (const status of ['missing', 'prisoner'] as const) {
      const s = validSeries();
      s.characters[0]!.status = status;
      expect(SeriesSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects a character with an empty id', () => {
    const s = validSeries();
    s.characters[0]!.id = '';
    expect(SeriesSchema.safeParse(s).success).toBe(false);
  });
});

describe('referential integrity', () => {
  it('catches a relationship pointing at a character that does not exist', () => {
    const s = validSeries();
    s.relationships.push({ from: 'alice', to: 'ghost', type: 'family', book: 1, label: 'x' });
    expect(rules(s)).toContain('dangling-relationship-endpoint');
  });

  it('catches an event involving a character that does not exist', () => {
    const s = validSeries();
    s.events.push({ book: 1, text: 'Something', involves: ['ghost'], kind: 'other' });
    expect(rules(s)).toContain('dangling-event-participant');
  });

  it('catches an unknown band', () => {
    const s = validSeries();
    s.characters[0]!.region = 'nowhere';
    expect(rules(s)).toContain('unknown-region');
  });

  it('catches an unknown affiliation', () => {
    const s = validSeries();
    s.characters[0]!.affil = 'nobody';
    expect(rules(s)).toContain('unknown-affiliation');
  });

  it('catches an unknown relationship type', () => {
    const s = validSeries();
    s.relationships[0]!.type = 'invented';
    expect(rules(s)).toContain('unknown-relationship-type');
  });

  it('catches duplicate character ids', () => {
    const s = validSeries();
    s.characters.push({ ...s.characters[0]! });
    expect(rules(s)).toContain('duplicate-character-id');
  });

  it('catches a self-referencing relationship', () => {
    const s = validSeries();
    s.relationships.push({ from: 'alice', to: 'alice', type: 'family', book: 1, label: 'self' });
    expect(rules(s)).toContain('self-relationship');
  });

  it('catches an exact duplicate relationship', () => {
    const s = validSeries();
    s.relationships.push({ ...s.relationships[0]! });
    expect(rules(s)).toContain('duplicate-relationship');
  });
});

describe('temporal integrity — the spoiler boundary depends on these', () => {
  it('catches book after lastBook', () => {
    const s = validSeries();
    s.characters[0]!.book = 2;
    s.characters[0]!.lastBook = 1;
    expect(rules(s)).toContain('book-after-lastbook');
  });

  it('catches a book number outside the series', () => {
    const s = validSeries();
    s.characters[0]!.book = 99;
    expect(rules(s)).toContain('book-out-of-range');
  });

  it('flags a relationship that predates one of its participants', () => {
    // This is the real Empyrean case: king_tauri -> halden is marked book 1,
    // but halden first appears in book 3, so the edge has nothing to attach to.
    const s = validSeries();
    s.characters[1]!.book = 2;
    s.relationships[0]!.book = 1;
    expect(rules(s)).toContain('relationship-before-participants');
  });

  it('flags an event referencing a character before they appear', () => {
    const s = validSeries();
    s.characters[1]!.book = 2;
    s.events[0]!.book = 1;
    expect(rules(s)).toContain('event-before-character-appears');
  });

  it('flags an event referencing a character after they leave', () => {
    // The real Lilith case: lastBook is 1, yet a book-2 event describes her
    // death, so the chart hides her in the book that discusses her.
    const s = validSeries();
    s.characters[0]!.lastBook = 1;
    s.events.push({ book: 2, text: 'Alice dies', involves: ['alice'], kind: 'death' });
    expect(rules(s)).toContain('event-after-character-leaves');
  });
});

describe('symmetric relationship handling', () => {
  it('flags a reversed duplicate of a symmetric type as redundant', () => {
    const s = validSeries();
    s.relationships = [
      { from: 'alice', to: 'bob', type: 'romantic', book: 1, label: 'together' },
      { from: 'bob', to: 'alice', type: 'romantic', book: 1, label: 'together' },
    ];
    expect(rules(s)).toContain('redundant-reversed-relationship');
  });

  it('allows both directions for a directed type', () => {
    // Two people can each betray the other; that is not a duplicate.
    const s = validSeries();
    s.relationships = [
      { from: 'alice', to: 'bob', type: 'family', book: 1, label: 'mother' },
      { from: 'bob', to: 'alice', type: 'family', book: 1, label: 'son' },
    ];
    expect(rules(s)).not.toContain('redundant-reversed-relationship');
    expect(errors(s)).toEqual([]);
  });
});
