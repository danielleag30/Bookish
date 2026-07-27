import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  RELATIONSHIP_TYPES,
  RELATIONSHIP_IDS,
  TYPE_ALIASES,
  isKinshipLabel,
  VOCAB_PENDING_REVIEW,
} from '../src/relationships.ts';
import { SeriesSchema, checkIntegrity } from '../src/schema.ts';

const dataDir = resolve(import.meta.dirname, '..', 'data');
const load = (name: string) =>
  SeriesSchema.parse(JSON.parse(readFileSync(join(dataDir, name), 'utf8')));
const files = readdirSync(dataDir).filter((f) => f.endsWith('.json'));

describe('the vocabulary is well-formed', () => {
  it('has no duplicate ids', () => {
    const ids = RELATIONSHIP_TYPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every type a definition and both inclusion and exclusion tests', () => {
    for (const t of RELATIONSHIP_TYPES) {
      expect(t.definition.length, `${t.id} definition`).toBeGreaterThan(20);
      expect(t.useWhen.length, `${t.id} useWhen`).toBeGreaterThan(0);
      expect(t.notWhen.length, `${t.id} notWhen`).toBeGreaterThan(0);
    }
  });

  it('states the from/to slots for every directed type, and for no symmetric one', () => {
    for (const t of RELATIONSHIP_TYPES) {
      if (t.symmetric) {
        expect(t.fromIs, `${t.id} is symmetric so fromIs must be empty`).toBe('');
        expect(t.toIs, `${t.id} is symmetric so toIs must be empty`).toBe('');
      } else {
        expect(t.fromIs.length, `${t.id} must say what \`from\` is`).toBeGreaterThan(0);
        expect(t.toIs.length, `${t.id} must say what \`to\` is`).toBeGreaterThan(0);
      }
    }
  });

  it('resolves every alias to a canonical type', () => {
    for (const [legacy, target] of Object.entries(TYPE_ALIASES)) {
      expect(RELATIONSHIP_IDS.has(target.type), `${legacy} -> ${target.type}`).toBe(true);
    }
  });

  it('covers all 38 legacy type strings from the three charts', () => {
    // Empyrean 11 + DCC 6 + Plated Prisoner 21, deduplicated.
    const legacy = [
      // Empyrean
      'bonded', 'mated', 'romantic', 'family', 'squad', 'ally', 'enemy',
      'mentor', 'betrayer', 'killed', 'complicated',
      // DCC (the rest overlap with Empyrean)
      'party',
      // Plated Prisoner
      'captor/captive', 'slow-burn romance', 'love interest',
      'fated mates (päyur)', 'married', 'trusted guard', 'commander',
      'wrath (squad)', 'hostile', 'political deal', 'sibling',
      'parent/child', 'ancestor', 'sacrifices for', 'rebellion',
      'mentor / loyalist', 'friend',
    ];
    for (const l of legacy) {
      expect(TYPE_ALIASES[l], `no alias for legacy type "${l}"`).toBeTruthy();
    }
  });

  it('maps the squad/party/Wrath collision onto one type', () => {
    expect(TYPE_ALIASES['party']?.type).toBe('squad');
    expect(TYPE_ALIASES['wrath (squad)']?.type).toBe('squad');
    expect(TYPE_ALIASES['squad']?.type).toBe('squad');
  });

  it('collapses the three Plated Prisoner romance types into one', () => {
    for (const legacy of ['slow-burn romance', 'love interest', 'married']) {
      expect(TYPE_ALIASES[legacy]?.type).toBe('romantic');
      // Nuance must survive as a label rather than being dropped.
      expect(TYPE_ALIASES[legacy]?.label).toBeTruthy();
    }
  });
});

describe('kinship label detection', () => {
  it('accepts real kinship terms', () => {
    for (const l of ['mother', 'father (executed)', 'sister', 'cousin', 'uncle', 'sibling']) {
      expect(isKinshipLabel(l), l).toBe(true);
    }
  });

  it('rejects the non-kinship labels that were filed under family', () => {
    for (const l of ['raised together', 'died saving him', 'calls her home', 'family']) {
      expect(isKinshipLabel(l), l).toBe(false);
    }
  });
});

describe('the real data conforms', () => {
  for (const file of files) {
    describe(file, () => {
      const s = load(file);

      it('uses only canonical relationship type ids', () => {
        for (const t of s.relationshipTypes) {
          expect(RELATIONSHIP_IDS.has(t.id), `${file}: "${t.id}"`).toBe(true);
        }
        for (const r of s.relationships) {
          expect(RELATIONSHIP_IDS.has(r.type), `${file}: edge type "${r.type}"`).toBe(true);
        }
      });

      it('produces no integrity errors or warnings', () => {
        const issues = checkIntegrity(s);
        expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
      });
    });
  }

  it("renamed DCC's party to squad", () => {
    const dcc = load('dcc.json');
    expect(dcc.relationshipTypes.some((t) => t.id === 'party')).toBe(false);
    expect(dcc.relationshipTypes.some((t) => t.id === 'squad')).toBe(true);
    expect(dcc.relationships.some((r) => r.type === 'party')).toBe(false);
    expect(dcc.relationships.some((r) => r.type === 'squad')).toBe(true);
  });

  it('retyped fen -> brennan from killed to enemy, because Brennan survived', () => {
    const s = load('empyrean.json');
    const brennan = s.characters.find((c) => c.id === 'brennan');
    expect(brennan?.status).toBe('alive');

    expect(s.relationships.some(
      (r) => r.from === 'fen' && r.to === 'brennan' && r.type === 'killed',
    )).toBe(false);

    const edge = s.relationships.find((r) => r.from === 'fen' && r.to === 'brennan');
    expect(edge?.type).toBe('enemy');
    expect(edge?.label).toContain('survived');
  });

  it('keeps every killed victim non-alive, outside documented exceptions', () => {
    for (const file of files) {
      const s = load(file);
      const byId = new Map(s.characters.map((c) => [c.id, c]));
      for (const r of s.relationships.filter((x) => x.type === 'killed')) {
        const key = `${s.id}:${r.from}>${r.to}:killed`;
        if (key === 'empyrean:violet>jack:killed') continue; // revived — documented
        expect(byId.get(r.to)?.status, key).not.toBe('alive');
      }
    }
  });
});

describe('pending-review register', () => {
  it('names a real edge for every entry, with a recommendation and a reason', () => {
    for (const [key, entry] of Object.entries(VOCAB_PENDING_REVIEW)) {
      // key shape: "<seriesId>:<from>><to>:<type>"
      const [seriesId, pair, type] = key.split(':');
      const s = load(`${seriesId}.json`);
      const [from, to] = pair!.split('>');
      expect(
        s.relationships.some((r) => r.from === from && r.to === to && r.type === type),
        `pending-review entry ${key} does not match a real edge`,
      ).toBe(true);
      expect(entry.recommend.length).toBeGreaterThan(0);
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });
});
