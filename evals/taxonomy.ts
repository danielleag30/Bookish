/**
 * Sorting failures into causes.
 *
 * GH-600 Domain 4 asks for root causes classified as reasoning errors, tool
 * misuse, or context and environment issues. Those three are the buckets below,
 * mapped onto what this pipeline can actually get wrong. The value is not the
 * label — it is that a run tells you which bucket grew, so the next change has a
 * target instead of being a guess.
 */
import type { EvalReport } from './compare.ts';
import type { RunResult } from '../pipeline/extract.ts';

export type FailureClass =
  /** The model read the passage and drew the wrong conclusion. */
  | 'reasoning: wrong type'
  | 'reasoning: reversed direction'
  | 'reasoning: invented edge'
  /** It broke the contract it was given. */
  | 'tool misuse: dangling id'
  | 'tool misuse: unusable id'
  /** Nothing was wrong with the model; the corpus could not support the answer. */
  | 'context: not in corpus'
  | 'context: chunk failed'
  /** The failure this project exists to prevent. */
  | 'guardrail: temporal leak';

export interface FailureCount {
  cls: FailureClass;
  count: number;
  note: string;
}

export function classify(
  report: EvalReport,
  run: RunResult,
  temporalLeakCount: number,
): FailureCount[] {
  const danglingIssues = run.chunks.reduce(
    (n, c) => n + c.issues.filter((i) => i.kind === 'dangling-endpoint').length, 0,
  );
  const failedChunks = run.chunks.filter((c) => c.error || c.planRejected).length;

  const out: FailureCount[] = [
    { cls: 'reasoning: wrong type', count: report.wrongType.length,
      note: 'right pair, wrong relationship type' },
    { cls: 'reasoning: reversed direction', count: report.reversed.length,
      note: 'right pair and type, backwards on a directed type' },
    { cls: 'reasoning: invented edge', count: report.spuriousEdges.length,
      note: 'no such relationship in the truth graph' },
    { cls: 'tool misuse: dangling id', count: danglingIssues,
      note: 'relationship referenced an id absent from its own characters list' },
    { cls: 'tool misuse: unusable id', count: report.unresolved.length,
      note: 'predicted a character that resolves to nobody' },
    { cls: 'context: not in corpus', count: report.missedCharacters.length,
      note: 'truth character the corpus never mentions — a corpus limit, not a model error' },
    { cls: 'context: chunk failed', count: failedChunks,
      note: 'chunk errored or its plan was rejected' },
    { cls: 'guardrail: temporal leak', count: temporalLeakCount,
      note: 'named an entity the reader could not know yet — the failure this project exists to prevent' },
  ];
  return out.filter((f) => f.count > 0 || f.cls.startsWith('guardrail'));
}
