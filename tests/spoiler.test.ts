import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema, type Series } from '../src/schema.ts';
import { gate, present, ask, findCharacters, connectionsOf, pathBetween, eventsOf, mostConnected } from '../src/spoiler.ts';

const dataDir = resolve(import.meta.dirname, '..', 'data');
const load = (n: string): Series =>
  SeriesSchema.parse(JSON.parse(readFileSync(join(dataDir, n), 'utf8')));
const emp = load('empyrean.json');
const dcc = load('dcc.json');
const pp = load('plated-prisoner.json');

describe('the gate', () => {
  it('hides characters who have not appeared yet', () => {
    const g = gate(emp, 1);
    expect(g.byId.has('violet')).toBe(true);
    expect(g.byId.has('halden')).toBe(false);      // book 3
    expect(g.byId.has('theophanie')).toBe(false);  // book 3
  });

  it('reveals them at their own book and not before', () => {
    expect(gate(emp, 2).byId.has('berwyn')).toBe(true);   // corrected to book 2
    expect(gate(emp, 1).byId.has('berwyn')).toBe(false);
  });

  it('hides an edge when either endpoint is hidden', () => {
    for (const pos of [1, 2, 3, 4]) {
      const g = gate(emp, pos);
      for (const r of g.relationships) {
        expect(g.byId.has(r.from), `pos ${pos}: ${r.from}`).toBe(true);
        expect(g.byId.has(r.to), `pos ${pos}: ${r.to}`).toBe(true);
        expect(r.book).toBeLessThanOrEqual(pos);
      }
    }
  });

  it('hides later events', () => {
    for (const pos of [1, 2, 3]) {
      for (const e of gate(emp, pos).events) expect(e.book).toBeLessThanOrEqual(pos);
    }
  });

  it('clamps an out-of-range position instead of leaking', () => {
    expect(gate(emp, 99).position).toBe(4);
    expect(gate(emp, -5).position).toBe(1);
    expect(gate(emp, 0).position).toBe(1);
  });
});

describe('perceived state — the Brennan case', () => {
  it('reports Brennan as dead at book 1, because that is what the reader believes', () => {
    const p = present(emp.characters.find((c) => c.id === 'brennan')!, gate(emp, 1));
    expect(p.status).toBe('dead');
    expect(p.statusIsBelief).toBe(true);
  });

  it('reports him alive from book 2 onward', () => {
    for (const pos of [2, 3, 4]) {
      const p = present(emp.characters.find((c) => c.id === 'brennan')!, gate(emp, pos));
      expect(p.status).toBe('alive');
      expect(p.statusIsBelief).toBe(false);
    }
  });

  it("shows Aaric under his alias until the reveal", () => {
    const c = emp.characters.find((x) => x.id === 'aaric')!;
    expect(present(c, gate(emp, 2)).label).toBe('Aaric Graycastle');
    expect(present(c, gate(emp, 3)).label).toBe(c.label);
  });
});

describe('bio containment', () => {
  it('withholds unsegmented bios below the final book', () => {
    for (const pos of [1, 2, 3]) {
      const g = gate(emp, pos);
      for (const c of g.characters) {
        const p = present(c, g);
        expect(p.bio, `${c.id} at pos ${pos}`).toBeUndefined();
        if (c.bio) expect(p.bioWithheld).toBe(true);
      }
    }
  });

  it('releases them at the final book', () => {
    const g = gate(emp, 4);
    const p = present(emp.characters.find((c) => c.id === 'brennan')!, g);
    expect(p.bio).toBeTruthy();
    expect(p.bioWithheld).toBe(false);
  });

  it("never leaks Brennan's Onyx Storm spoiler early", () => {
    for (const pos of [1, 2, 3]) {
      const g = gate(emp, pos);
      const p = present(emp.characters.find((c) => c.id === 'brennan')!, g);
      expect(JSON.stringify(p)).not.toMatch(/Onyx Storm|Theophanie/);
    }
  });
});

describe('adversarial — five routes to a hidden character', () => {
  const g = gate(emp, 1); // Theophanie and Halden are book 3

  it('1. exact id lookup finds nothing', () => {
    expect(g.byId.get('theophanie')).toBeUndefined();
    expect(findCharacters(g, 'theophanie')).toEqual([]);
  });

  it('2. fuzzy and partial name search finds nothing', () => {
    for (const q of ['theo', 'Theophanie', 'THEOPH', 'halden', 'prince']) {
      for (const hit of findCharacters(g, q)) {
        expect(hit.id).not.toBe('theophanie');
        expect(hit.id).not.toBe('halden');
      }
    }
  });

  it('3. relationship traversal from a visible character cannot reach them', () => {
    for (const c of g.characters) {
      for (const conn of connectionsOf(g, c.id)) {
        expect(conn.other.book).toBeLessThanOrEqual(1);
      }
    }
  });

  it('4. the event log never names them', () => {
    for (const e of g.events) {
      for (const id of e.involves) expect(g.byId.has(id)).toBe(true);
    }
    expect(eventsOf(g, 'theophanie')).toEqual([]);
  });

  it('5. path finding refuses rather than routing through them', () => {
    expect(pathBetween(g, 'violet', 'theophanie')).toBeNull();
    const path = pathBetween(g, 'violet', 'xaden');
    for (const step of path ?? []) {
      expect(step.from.book).toBeLessThanOrEqual(1);
      expect(step.to.book).toBeLessThanOrEqual(1);
    }
  });

  it('no answer at position 1 mentions any book 2+ character by name', () => {
    const later = emp.characters.filter((c) => c.book > 1);
    const questions = [
      'who is Violet bonded to', 'who is alive', 'who died',
      'what happened to Violet', 'tell me about Brennan',
      'how are Violet and Xaden connected', 'Theophanie', 'Prince Halden',
      'riders', 'venin', 'who is Xaden married to',
    ];
    for (const q of questions) {
      const a = ask(emp, 1, q);
      const text = [a.headline, ...a.lines, JSON.stringify(a.subject ?? {})].join(' ');
      for (const c of later) {
        // Skip labels that are substrings of visible names.
        if (c.label.length < 5) continue;
        expect(text, `"${q}" leaked ${c.label}`).not.toContain(c.label);
      }
    }
  });
});

describe('answers', () => {
  it('answers a bonded question', () => {
    const a = ask(emp, 1, 'who is Violet bonded to');
    expect(a.kind).toBe('connections');
    expect(a.lines.join(' ')).toMatch(/Tairn/);
    expect(a.lines.join(' ')).toMatch(/Andarna/);
  });

  it('answers a status list and marks beliefs', () => {
    const a = ask(emp, 1, 'who is dead');
    expect(a.kind).toBe('status-list');
    expect(a.lines.join('\n')).toMatch(/Brennan[\s\S]*as far as you know/);
  });

  it('answers a path question', () => {
    const a = ask(emp, 3, 'how are Violet and Dain connected');
    expect(a.kind).toBe('path');
    expect(a.lines.length).toBeGreaterThan(0);
  });

  it('answers what happened to a character', () => {
    const a = ask(emp, 1, 'what happened to Liam');
    expect(a.kind).toBe('events');
    expect(a.lines.join(' ')).toMatch(/Book 1/);
  });

  it('notes when the answer was gated', () => {
    expect(ask(emp, 1, 'who is alive').gatedNote).toMatch(/hidden/);
    expect(ask(emp, 4, 'who is alive').gatedNote).toBeUndefined();
  });

  it('fails helpfully on an unmatched question', () => {
    const a = ask(emp, 1, 'what is the airspeed of a laden swallow');
    expect(a.kind).toBe('unknown');
    expect(a.lines.join(' ')).toMatch(/who is/);
  });

  it('works on DCC too, not just Empyrean', () => {
    const a = ask(dcc, 1, 'who is Carl allied with');
    expect(a.subject?.label).toBe('Carl');
    expect(gate(dcc, 1).byId.has('nekhebit')).toBe(false); // book 6
  });
});

describe('generated suggestions round-trip through the parser', () => {
  // The chip generator builds questions with phrase(); the parser reads them
  // with REL_WORDS. If the two drift, a chip returns the wrong answer kind —
  // which is exactly what happened with "allied with" on the DCC chart.
  const PHRASES: Record<string, string> = {
    bonded: 'bonded to', family: 'related to', romantic: 'involved with',
    squad: 'in a squad with', friend: 'friends with', ally: 'allied with',
    enemy: 'enemies with', mentor: 'mentoring', killed: 'killed by',
    mated: 'mated to', captor: 'the captor of', commands: 'commanding',
    betrayer: 'betrayed by',
  };

  for (const [type, phrase] of Object.entries(PHRASES)) {
    it(`"${phrase}" resolves to the ${type} type`, () => {
      const a = ask(emp, 4, `who is Violet ${phrase}`);
      expect(a.kind, `"${phrase}" fell through to ${a.kind}`).toBe('connections');
      expect(a.headline.toLowerCase()).toContain(type);
    });
  }
});

describe('temporal state — the Jack Barlowe class of leak', () => {
  const jackRaw = emp.characters.find((c) => c.id === 'jack')!;

  it('reports Jack as a living rider in book 1, not a venin prisoner', () => {
    // The original record held his END state, so book 1 leaked two reveals:
    // venin (book 2) and prisoner (book 3).
    const p = present(jackRaw, gate(emp, 1));
    expect(p.affil).toBe('riders_other');
    expect(p.status).toBe('alive');
    expect(p.role.toLowerCase()).not.toContain('venin');
  });

  it('turns him venin in book 2 and imprisons him in book 3', () => {
    const b2 = present(jackRaw, gate(emp, 2));
    expect(b2.affil).toBe('venin');
    expect(b2.status).toBe('alive');

    const b3 = present(jackRaw, gate(emp, 3));
    expect(b3.affil).toBe('venin');
    expect(b3.status).toBe('prisoner');
  });

  it('resolves even when handed a raw unresolved record', () => {
    // present() must not depend on the caller having gone through gate(),
    // or a stray series.characters lookup silently leaks the end state.
    for (const pos of [1, 2, 3, 4]) {
      const viaRaw = present(jackRaw, gate(emp, pos));
      const g = gate(emp, pos);
      const viaGate = present(g.byId.get('jack')!, g);
      expect(viaRaw).toEqual(viaGate);
    }
  });

  it('changes a relationship type at the right book instead of using `complicated`', () => {
    const at = (pos: number) =>
      gate(emp, pos).relationships.find((r) => r.from === 'violet' && r.to === 'imogen');
    expect(at(1)?.type).toBe('enemy');
    expect(at(2)?.type).toBe('ally');
    expect(at(3)?.type).toBe('ally');
  });

  it('honours untilBook so an ended relationship stops being visible', () => {
    for (const pos of [1, 2, 3, 4]) {
      for (const r of gate(emp, pos).relationships) {
        if (r.untilBook !== undefined) expect(r.untilBook).toBeGreaterThanOrEqual(pos);
      }
    }
  });

  /**
   * The general form of the Jack bug: at position k, no visible character may
   * report an attribute that a later change introduces. This is the test whose
   * absence let the leak survive 129 other tests — they checked WHO was
   * visible, never WHAT they claimed to be.
   */
  it('never reports an attribute introduced by a later book', () => {
    for (const series of [emp, dcc]) {
      const books = series.books.map((b) => b.id);
      for (const pos of books) {
        const g = gate(series, pos);
        for (const c of series.characters.filter((x) => x.book <= pos)) {
          const shown = present(c, g);
          for (const ch of c.changes ?? []) {
            if (ch.book <= pos) continue;
            for (const [field, laterValue] of Object.entries(ch.set)) {
              expect(
                (shown as unknown as Record<string, unknown>)[field],
                `${series.id} book ${pos}: ${c.id}.${field} leaked the book-${ch.book} value`,
              ).not.toBe(laterValue);
            }
          }
        }
      }
    }
  });
});

describe('answers name the reading position once, not three times', () => {
  // The panel header already states the position. Repeating it in the headline
  // AND the note meant every answer mentioned the same book three times.
  const POSITION_RE = /as of Book|Book \d+ ·/;

  it('keeps the book out of every headline', () => {
    const questions = [
      'who is alive', 'who died', 'who is Violet bonded to',
      'what happened to Liam', 'how are Violet and Dain connected',
      'tell me about Xaden', 'riders',
    ];
    for (const q of questions) {
      for (const pos of [1, 2, 3, 4]) {
        const a = ask(emp, pos, q);
        expect(a.headline, `"${q}" @ ${pos}`).not.toMatch(POSITION_RE);
      }
    }
  });

  it('keeps the book out of the gated note as well', () => {
    const a = ask(emp, 1, 'who is alive');
    expect(a.gatedNote).toBe('Later books are hidden.');
  });

  it('drops the note entirely at the final book, since nothing is withheld', () => {
    expect(ask(emp, 4, 'who is alive').gatedNote).toBeUndefined();
  });

  it('still reports the right counts per position', () => {
    // Dropping the label must not change what is actually answered.
    const b1 = ask(emp, 1, 'who died');
    const b2 = ask(emp, 2, 'who died');
    expect(b1.lines.length).toBeLessThan(b2.lines.length);
    expect(b1.headline).toMatch(/^\d+ characters dead$/);
  });
});

describe('suggested questions resolve to the character they name', () => {
  /**
   * A chip has to round-trip: whatever short name it writes must parse back to
   * the character it was written about. Taking the first word of the label gave
   * "who is King the captor of" on Plated Prisoner — a title, ambiguous between
   * King Fulke and King Midas, so the answer came back about the wrong person.
   */
  const TITLES = new Set(['king', 'queen', 'prince', 'princess', 'lord', 'lady',
    'major', 'colonel', 'general', 'professor', 'captain', 'commander', 'the']);

  for (const [name, series] of [['empyrean', emp], ['dcc', dcc], ['plated-prisoner', pp]] as const) {
    it(`${name}: the most-connected character has an unambiguous short name`, () => {
      for (const book of series.books.map((b) => b.id)) {
        const g = gate(series, book);
        const lead = mostConnected(g);
        if (!lead) continue;

        const parts = lead.label.split(/[\s·/,]+/).filter(Boolean);
        const short = parts.find(
          (p) => !TITLES.has(p.toLowerCase()) && findCharacters(g, p)[0]?.id === lead.id,
        ) ?? lead.label;

        expect(TITLES.has(short.toLowerCase()), `${name} bk${book}: "${short}" is a title`).toBe(false);
        expect(findCharacters(g, short)[0]?.id, `${name} bk${book}: "${short}"`).toBe(lead.id);
      }
    });

    it(`${name}: a question about the lead's commonest relationship returns results`, () => {
      for (const book of series.books.map((b) => b.id)) {
        const g = gate(series, book);
        const lead = mostConnected(g);
        if (!lead) continue;
        const conns = connectionsOf(g, lead.id);
        if (conns.length === 0) continue;

        const counts = new Map<string, number>();
        for (const c of conns) counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
        const topType = [...counts].sort((a, b) => b[1] - a[1])[0]![0];

        // Asking about that type must find the same edges, not an empty answer.
        expect(connectionsOf(g, lead.id, topType).length,
          `${name} bk${book}: ${lead.id} / ${topType}`).toBeGreaterThan(0);
      }
    });
  }
});
