import { describe, it, expect } from 'vitest';
import { runResolver, pooled, emptyAudit } from '../pipeline/multiagent.ts';
import type { ExtractedGraph } from '../pipeline/extract.ts';

const g = (
  chars: [string, string, string, string][],
  rels: [string, string, string][] = [],
): ExtractedGraph => ({
  characters: chars.map(([id, label, role, status]) => ({
    id, label, role, status: status as never,
  })),
  relationships: rels.map(([from, to, type]) => ({ from, to, type, label: '' })),
});

describe('resolver conflict handling', () => {
  it('keeps a definite status over unknown, whichever chunk it came from', () => {
    const audit = emptyAudit();
    const out = runResolver([
      { chunk: 0, graph: g([['a', 'A', '', 'dead']]) },
      { chunk: 1, graph: g([['a', 'A', '', 'unknown']]) },
    ], audit);
    expect(out.characters[0]?.status).toBe('dead');
    expect(audit.conflicts[0]?.why).toMatch(/definite/);

    const audit2 = emptyAudit();
    const out2 = runResolver([
      { chunk: 0, graph: g([['a', 'A', '', 'unknown']]) },
      { chunk: 1, graph: g([['a', 'A', '', 'dead']]) },
    ], audit2);
    expect(out2.characters[0]?.status).toBe('dead');
  });

  it('takes the later chunk when two definite statuses disagree', () => {
    // Later in the file is later in the story, so it describes a newer state.
    const audit = emptyAudit();
    const out = runResolver([
      { chunk: 0, graph: g([['a', 'A', '', 'alive']]) },
      { chunk: 2, graph: g([['a', 'A', '', 'dead']]) },
    ], audit);
    expect(out.characters[0]?.status).toBe('dead');
    expect(audit.conflicts[0]?.why).toMatch(/later point in the story/);
  });

  it('logs every conflict with both values and their source', () => {
    const audit = emptyAudit();
    runResolver([
      { chunk: 0, graph: g([['a', 'A', 'Rider', 'alive']]) },
      { chunk: 1, graph: g([['a', 'A', 'Wingleader', 'dead']]) },
    ], audit);
    expect(audit.conflicts).toHaveLength(2); // status and role
    for (const c of audit.conflicts) {
      expect(c.values).toHaveLength(2);
      expect(c.values.every((v) => v.from.startsWith('chunk'))).toBe(true);
      expect(c.why.length).toBeGreaterThan(10);
      expect(c.resolution).toBeTruthy();
    }
  });

  it('fills a blank role without recording a conflict', () => {
    const audit = emptyAudit();
    const out = runResolver([
      { chunk: 0, graph: g([['a', 'A', '', 'alive']]) },
      { chunk: 1, graph: g([['a', 'A', 'Rider', 'alive']]) },
    ], audit);
    expect(out.characters[0]?.role).toBe('Rider');
    expect(audit.conflicts).toEqual([]);
  });

  it('collapses duplicate edges across chunks and reports the count', () => {
    const audit = emptyAudit();
    const one = g([['a', 'A', '', 'alive'], ['b', 'B', '', 'alive']], [['a', 'b', 'family']]);
    const out = runResolver([{ chunk: 0, graph: one }, { chunk: 1, graph: one }], audit);
    expect(out.relationships).toHaveLength(1);
    expect(audit.agents[0]?.note).toMatch(/1 duplicate edge/);
  });

  it('records itself as an agent so the audit covers every stage', () => {
    const audit = emptyAudit();
    runResolver([{ chunk: 0, graph: g([['a', 'A', '', 'alive']]) }], audit);
    expect(audit.agents.map((a) => a.role)).toContain('resolver');
  });
});

describe('bounded concurrency', () => {
  it('never exceeds the limit and preserves input order', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await pooled([1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 10;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it('handles fewer items than the limit', async () => {
    expect(await pooled([1], 4, async (n) => n + 1)).toEqual([2]);
    expect(await pooled([], 4, async (n: number) => n)).toEqual([]);
  });
});
