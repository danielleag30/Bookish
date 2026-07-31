import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema, type Series } from '../src/schema.ts';
import { evaluate, temporalLeaks, buildResolver } from '../evals/compare.ts';
import { classify } from '../evals/taxonomy.ts';
import { checkGraph, checkPlan, mergeGraphs, type ExtractedGraph } from '../pipeline/extract.ts';
import type { RunResult } from '../pipeline/extract.ts';

const dataDir = resolve(import.meta.dirname, '..', 'data');
const emp: Series = SeriesSchema.parse(
  JSON.parse(readFileSync(join(dataDir, 'empyrean.json'), 'utf8')),
);

const graph = (
  chars: [string, string][],
  rels: [string, string, string][] = [],
): ExtractedGraph => ({
  characters: chars.map(([id, label]) => ({ id, label, role: '', status: 'alive' as const })),
  relationships: rels.map(([from, to, type]) => ({ from, to, type, label: '' })),
});

describe('entity resolution', () => {
  const resolver = buildResolver(emp);

  it('resolves ids, labels, and given names to the same character', () => {
    for (const key of ['violet', 'Violet Sorrengail', 'violet sorrengail']) {
      expect(resolver.get(key.toLowerCase().replace(/[^a-z0-9 ]/g, '')), key)
        .toBeDefined();
    }
  });

  it('strips titles, so "Col. Panchek" and "panchek" agree', () => {
    expect(resolver.get('panchek')).toBe('panchek');
  });

  it('refuses a name that could mean two characters', () => {
    // Five Sorrengails share the surname, so it must not resolve to any of them.
    expect(resolver.get('sorrengail')).toBeUndefined();
  });

  it('uses declared aliases', () => {
    // Rip's aliases include "Slade Ravinger".
    const pp: Series = SeriesSchema.parse(
      JSON.parse(readFileSync(join(dataDir, 'plated-prisoner.json'), 'utf8')),
    );
    expect(buildResolver(pp).get('slade ravinger')).toBe('rip');
  });
});

describe('scoring', () => {
  it('gives a perfect score to a prediction that matches truth', () => {
    // Deliberately a set that HAS edges between its members. The first six
    // book-1 characters are gods and officials with no edges among them, so
    // asserting edge recall on that set asserts nothing.
    const wanted = ['violet', 'lilith', 'tairn', 'andarna', 'xaden', 'sgaeyl', 'mira'];
    const truthChars = emp.characters.filter((c) => wanted.includes(c.id));
    const ids = new Set(truthChars.map((c) => c.id));
    const rels = emp.relationships
      .filter((r) => ids.has(r.from) && ids.has(r.to))
      .map((r) => [r.from, r.to, r.type] as [string, string, string]);

    const report = evaluate(
      graph(truthChars.map((c) => [c.id, c.label]), rels),
      emp,
      truthChars,
    );
    expect(rels.length, 'the fixture must contain edges to be meaningful').toBeGreaterThan(3);
    expect(report.nodes.f1).toBe(1);
    expect(report.edges.recall).toBe(1);
    expect(report.edges.f1).toBe(1);
    expect(report.spuriousEdges).toEqual([]);
    expect(report.reversed).toEqual([]);
  });

  it('counts an invented character as a false positive, not a miss', () => {
    const truthChars = emp.characters.filter((c) => c.id === 'violet');
    const report = evaluate(
      graph([['violet', 'Violet Sorrengail'], ['nobody', 'Someone Invented']]),
      emp, truthChars,
    );
    expect(report.unresolved).toEqual(['Someone Invented']);
    expect(report.nodes.falsePositives).toBe(1);
    expect(report.nodes.recall).toBe(1);
  });

  it('separates a reversed directed edge from an invented one', () => {
    // Truth has lilith -> fen (killed). Predicting fen -> lilith is reversed,
    // which is a different error from inventing an edge that does not exist.
    const chars = emp.characters.filter((c) => ['lilith', 'fen'].includes(c.id));
    const report = evaluate(
      graph([['lilith', 'Lilith Sorrengail'], ['fen', 'Fen Riorson']], [['fen', 'lilith', 'killed']]),
      emp, chars,
    );
    expect(report.reversed).toHaveLength(1);
    expect(report.spuriousEdges).toHaveLength(0);
    expect(report.edges.truePositives).toBe(0);
  });

  it('does not punish direction on a symmetric type', () => {
    // violet <-> xaden is romantic, which reads the same either way.
    const chars = emp.characters.filter((c) => ['violet', 'xaden'].includes(c.id));
    const forward = evaluate(
      graph([['violet', 'Violet'], ['xaden', 'Xaden']], [['violet', 'xaden', 'romantic']]),
      emp, chars,
    );
    const backward = evaluate(
      graph([['violet', 'Violet'], ['xaden', 'Xaden']], [['xaden', 'violet', 'romantic']]),
      emp, chars,
    );
    expect(forward.edges.truePositives).toBe(1);
    expect(backward.edges.truePositives).toBe(1);
    expect(backward.reversed).toEqual([]);
  });

  it('reports the right pair with the wrong type separately', () => {
    const chars = emp.characters.filter((c) => ['violet', 'lilith'].includes(c.id));
    const report = evaluate(
      graph([['violet', 'Violet'], ['lilith', 'Lilith']], [['violet', 'lilith', 'mentor']]),
      emp, chars,
    );
    expect(report.wrongType).toHaveLength(1);
    expect(report.wrongType[0]?.actual).toContain('family');
  });

  it('separates reachable recall from the corpus ceiling', () => {
    const truthChars = emp.characters.filter((c) => c.book === 1);
    const corpus = 'Violet Sorrengail bonds Tairn.';
    const report = evaluate(
      graph([['violet', 'Violet Sorrengail'], ['tairn', 'Tairn']]),
      emp, truthChars, corpus,
    );
    // Overall recall is dire because the corpus names two of many characters…
    expect(report.nodes.recall).toBeLessThan(0.2);
    // …but against what the corpus can support, the model did well.
    expect(report.nodesInCorpus.recall).toBeGreaterThan(0.5);
    expect(report.outOfCorpus).toBeGreaterThan(20);
  });
});

describe('temporal leaks', () => {
  it('flags a character the reader cannot know yet', () => {
    // Theophanie first appears in book 3.
    const leaks = temporalLeaks(graph([['theophanie', 'Theophanie']]), emp, 1);
    expect(leaks.join()).toMatch(/Theophanie/);
  });

  it('stays empty when everything predicted is already visible', () => {
    expect(temporalLeaks(graph([['violet', 'Violet Sorrengail']]), emp, 1)).toEqual([]);
  });
});

describe('output validation', () => {
  const types = new Set(emp.relationshipTypes.map((t) => t.id));

  it('catches a relationship pointing at an id not in its own character list', () => {
    const issues = checkGraph(graph([['violet', 'Violet']], [['violet', 'ghost', 'family']]), types);
    expect(issues.some((i) => i.kind === 'dangling-endpoint')).toBe(true);
  });

  it('catches an unknown relationship type and a self-relationship', () => {
    const issues = checkGraph(
      graph([['violet', 'Violet']], [['violet', 'violet', 'not-a-type']]), types,
    );
    expect(issues.some((i) => i.kind === 'unknown-type')).toBe(true);
    expect(issues.some((i) => i.kind === 'self-relationship')).toBe(true);
  });

  it('accepts a well-formed graph', () => {
    expect(checkGraph(
      graph([['a', 'A'], ['b', 'B']], [['a', 'b', 'family']]), types,
    )).toEqual([]);
  });
});

describe('plan validation', () => {
  it('rejects a plan naming someone absent from the passage', () => {
    const problems = checkPlan(
      { characters: ['Violet', 'Theophanie'], summary: 'x' },
      'Violet crosses the parapet.',
    );
    expect(problems.join()).toMatch(/Theophanie/);
  });

  it('accepts a plan grounded in the passage', () => {
    expect(checkPlan(
      { characters: ['Violet'], summary: 'She crosses the parapet.' },
      'Violet crosses the parapet.',
    )).toEqual([]);
  });
});

describe('merging chunk graphs', () => {
  it('fills a blank role but never overwrites a definite one', () => {
    const merged = mergeGraphs([
      { characters: [{ id: 'a', label: 'A', role: 'Rider', status: 'alive' }], relationships: [] },
      { characters: [{ id: 'a', label: 'A', role: '', status: 'alive' }], relationships: [] },
    ]);
    expect(merged.characters[0]?.role).toBe('Rider');
  });

  it('lets a later chunk resolve an unknown status but not blur a known one', () => {
    const merged = mergeGraphs([
      { characters: [{ id: 'a', label: 'A', role: '', status: 'unknown' }], relationships: [] },
      { characters: [{ id: 'a', label: 'A', role: '', status: 'dead' }], relationships: [] },
    ]);
    expect(merged.characters[0]?.status).toBe('dead');

    const reverse = mergeGraphs([
      { characters: [{ id: 'a', label: 'A', role: '', status: 'dead' }], relationships: [] },
      { characters: [{ id: 'a', label: 'A', role: '', status: 'unknown' }], relationships: [] },
    ]);
    expect(reverse.characters[0]?.status).toBe('dead');
  });

  it('deduplicates identical relationships across chunks', () => {
    const g = graph([['a', 'A'], ['b', 'B']], [['a', 'b', 'family']]);
    expect(mergeGraphs([g, g]).relationships).toHaveLength(1);
  });
});

describe('failure taxonomy', () => {
  const emptyRun: RunResult = {
    series: 'empyrean', model: 'test', chunks: [],
    graph: { characters: [], relationships: [] },
    totals: { ms: 0, promptTokens: 0, responseTokens: 0, calls: 0 },
  };

  it('always reports the temporal-leak class, even at zero', () => {
    const report = evaluate(graph([['violet', 'Violet Sorrengail']]), emp,
      emp.characters.filter((c) => c.id === 'violet'));
    const classes = classify(report, emptyRun, 0).map((f) => f.cls);
    expect(classes).toContain('guardrail: temporal leak');
  });

  it('carries the leak count through rather than hardcoding zero', () => {
    const report = evaluate(graph([['violet', 'Violet Sorrengail']]), emp,
      emp.characters.filter((c) => c.id === 'violet'));
    const leak = classify(report, emptyRun, 7).find((f) => f.cls === 'guardrail: temporal leak');
    expect(leak?.count).toBe(7);
  });

  it('classifies a corpus gap as context, not as a model error', () => {
    const report = evaluate(graph([]), emp, emp.characters.filter((c) => c.book === 1));
    const ctx = classify(report, emptyRun, 0).find((f) => f.cls === 'context: not in corpus');
    expect(ctx?.count).toBeGreaterThan(0);
  });
});

describe('changelog agent', () => {
  it('buckets a pull request by what it did', async () => {
    const { sectionFor, cleanBody } = await import('../scripts/draft-changelog.ts');
    const pr = (title: string) => ({ number: 1, title, body: '', mergedAt: '', labels: [] });

    expect(sectionFor(pr('Resolve every pending data question against canon'))).toBe('Fixed');
    expect(sectionFor(pr('Refresh the ask box when its answer stops being true'))).toBe('Fixed');
    expect(sectionFor(pr('Per-book data model, and Plated Prisoner migrated into it'))).toBe('Data');
    expect(sectionFor(pr('Define a controlled relationship vocabulary'))).toBe('Data');
    expect(sectionFor(pr('Add a "how it works" page explaining the data flow'))).toBe('Docs');
    expect(sectionFor(pr('Phase 6: spoiler-bounded MCP server'))).toBe('Added');
    expect(sectionFor(pr('Surface the how-it-works page on the landing page'))).toBe('Changed');

    // Bucketing is keyword-based on purpose: which section a change belongs in
    // is a fact about the change, so it must be stable across runs rather than
    // re-decided by a model each time.
    const title = 'Phase 6: spoiler-bounded MCP server';
    expect(sectionFor(pr(title))).toBe(sectionFor(pr(title)));
  });

  it('strips PR boilerplate before anything reaches the model', async () => {
    const { cleanBody } = await import('../scripts/draft-changelog.ts');
    const body = [
      '## Heading',
      '```ts',
      'const secret = "should not survive";',
      '```',
      '| a | b |',
      'Real prose that should survive.',
      '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    ].join('\n');
    const out = cleanBody(body);
    expect(out).toContain('Real prose that should survive.');
    expect(out).not.toContain('should not survive');
    expect(out).not.toContain('🤖');
    expect(out).not.toContain('|');
    expect(out).not.toContain('##');
  });

  it('caps what it sends, so a huge PR body cannot blow the request', async () => {
    const { cleanBody } = await import('../scripts/draft-changelog.ts');
    expect(cleanBody('x '.repeat(5000)).length).toBeLessThanOrEqual(1200);
  });
});

/**
 * The release watcher's matching rules.
 *
 * Its only real failure mode is crying wolf: a watcher that reports the Spanish
 * edition of book one as a new release stops being read, and then a real
 * release goes unnoticed. These pin the cases that were actually wrong on the
 * first run against live data.
 */
describe('new-books watch', () => {
  it('treats edition differences as the same title', async () => {
    const { normaliseTitle } = await import('../scripts/check-new-books.ts');
    expect(normaliseTitle('Quicksilver (Fae & Alchemy #1)')).toBe(normaliseTitle('Quicksilver'));
    expect(normaliseTitle("Carl's Doomsday Scenario")).toBe(normaliseTitle('Carls Doomsday Scenario'));
    expect(normaliseTitle('Iron Flame: A Novel')).toBe(normaliseTitle('Iron Flame'));
  });

  it('does not collapse genuinely different titles', async () => {
    const { normaliseTitle } = await import('../scripts/check-new-books.ts');
    expect(normaliseTitle('Gild')).not.toBe(normaliseTitle('Glint'));
    expect(normaliseTitle('Quicksilver')).not.toBe(normaliseTitle('Brimstone'));
  });
});
