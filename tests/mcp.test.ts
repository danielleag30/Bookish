import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSeries, newState, positionFor, listSeries, setReadingPosition,
  searchCharacters, getCharacter, getRelationships, getEvents, findConnection,
  type ServerState,
} from '../mcp/tools.ts';

const all = loadSeries();
const emp = all.get('empyrean')!;
let state: ServerState;
beforeEach(() => { state = newState(); });

/** Everything a reader at book 1 must never be told about. */
const LATER = emp.characters.filter((c) => c.book > 1);
const leaks = (text: string) =>
  LATER.filter((c) => c.label.length >= 5 && text.includes(c.label)).map((c) => c.label);

describe('reading position is server state', () => {
  it('defaults to the first book, not the last', () => {
    // Defaulting to the end would spoil a reader who never set a position.
    expect(positionFor(state, emp)).toBe(1);
    expect(listSeries(all, state)).toMatch(/you are at book 1/);
  });

  it('rejects a book the series does not have', () => {
    expect(() => setReadingPosition(all, state, 'empyrean', 99)).toThrow(/books 1–4/);
    expect(() => setReadingPosition(all, state, 'empyrean', 0)).toThrow();
    expect(positionFor(state, emp)).toBe(1);
  });

  it('rejects an unknown series rather than guessing', () => {
    expect(() => setReadingPosition(all, state, 'nope', 1)).toThrow(/unknown series/);
  });

  it('keeps positions independent per series', () => {
    setReadingPosition(all, state, 'empyrean', 3);
    expect(positionFor(state, emp)).toBe(3);
    expect(positionFor(state, all.get('dcc')!)).toBe(1);
  });
});

describe('adversarial — five routes to a hidden character, at book 1', () => {
  // Theophanie and Halden first appear in book 3.
  it('1. direct lookup by id returns nothing and does not confirm existence', () => {
    const out = getCharacter(all, state, 'empyrean', 'theophanie');
    expect(out).toMatch(/No such character/);
    expect(out).not.toMatch(/book 3|later|appears in/i);
  });

  it('2. fuzzy search finds nothing, and says so without hinting', () => {
    for (const q of ['theo', 'Theophanie', 'venin', 'prince', 'halden']) {
      const out = searchCharacters(all, state, 'empyrean', q);
      expect(leaks(out), `search "${q}"`).toEqual([]);
    }
    // The response must not echo the query either, so a probe gets nothing back
    // that could be read as confirmation.
    const probe = searchCharacters(all, state, 'empyrean', 'theophanie');
    expect(probe).not.toMatch(/later|book 3|not yet/i);
    expect(probe).not.toMatch(/theophanie/i);
  });

  it('3. relationship traversal cannot reach them', () => {
    for (const c of ['violet', 'xaden', 'dain', 'lilith']) {
      expect(leaks(getRelationships(all, state, 'empyrean', c)), c).toEqual([]);
    }
  });

  it('4. the event log never names them', () => {
    expect(leaks(getEvents(all, state, 'empyrean'))).toEqual([]);
    expect(leaks(getEvents(all, state, 'empyrean', 'violet'))).toEqual([]);
  });

  it('5. path finding refuses rather than routing through them', () => {
    expect(findConnection(all, state, 'empyrean', 'violet', 'theophanie'))
      .toMatch(/not on the chart/);
    expect(leaks(findConnection(all, state, 'empyrean', 'violet', 'xaden'))).toEqual([]);
  });

  it('no tool output at book 1 names any later character', () => {
    const outputs = [
      listSeries(all, state),
      searchCharacters(all, state, 'empyrean', 'a'),
      getCharacter(all, state, 'empyrean', 'violet'),
      getRelationships(all, state, 'empyrean', 'violet'),
      getEvents(all, state, 'empyrean'),
      findConnection(all, state, 'empyrean', 'violet', 'liam'),
    ];
    for (const o of outputs) expect(leaks(o)).toEqual([]);
  });
});

describe('what the reader believes', () => {
  it('reports Brennan as dead at book 1 and flags it as belief', () => {
    const out = getCharacter(all, state, 'empyrean', 'brennan');
    expect(out).toMatch(/dead/);
    expect(out).toMatch(/as far as you know/);
  });

  it('reports him alive from book 2', () => {
    setReadingPosition(all, state, 'empyrean', 2);
    const out = getCharacter(all, state, 'empyrean', 'brennan');
    expect(out).toMatch(/Status: alive/);
    expect(out).not.toMatch(/as far as you know/);
  });

  it('hides Panchek being venin until the reveal', () => {
    expect(getCharacter(all, state, 'empyrean', 'panchek')).not.toMatch(/venin/i);
    setReadingPosition(all, state, 'empyrean', 3);
    expect(getCharacter(all, state, 'empyrean', 'panchek')).toMatch(/venin/i);
  });
});

describe('biographies', () => {
  it('withholds them below the final book', () => {
    for (const book of [1, 2, 3]) {
      setReadingPosition(all, state, 'empyrean', book);
      const out = getCharacter(all, state, 'empyrean', 'brennan');
      expect(out, `book ${book}`).toMatch(/withheld/);
      expect(out).not.toMatch(/Onyx Storm/);
    }
  });

  it('releases them at the final book', () => {
    setReadingPosition(all, state, 'empyrean', 4);
    expect(getCharacter(all, state, 'empyrean', 'brennan')).not.toMatch(/withheld/);
  });
});

describe('the tools do their job', () => {
  it('finds who Violet is bonded to', () => {
    const out = getRelationships(all, state, 'empyrean', 'violet', 'bonded');
    expect(out).toMatch(/Tairn/);
    expect(out).toMatch(/Andarna/);
  });

  it('answers what happened to a character', () => {
    expect(getEvents(all, state, 'empyrean', 'liam')).toMatch(/Book 1/);
  });

  it('walks a path between two visible characters', () => {
    const out = findConnection(all, state, 'empyrean', 'violet', 'tairn');
    expect(out).toMatch(/—\[bonded/);
  });

  it('works across all three series', () => {
    for (const id of [...all.keys()]) {
      expect(() => listSeries(all, state)).not.toThrow();
      expect(searchCharacters(all, state, id, 'a').length).toBeGreaterThan(0);
    }
  });
});
