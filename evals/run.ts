/**
 * Run the pipeline against a series and score it.
 *
 *   npm run eval                     # empyrean, all books
 *   npm run eval -- --series dcc --book 3
 *
 * Appends a row to evals/results.md so score history is visible in git rather
 * than living in a terminal scrollback.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema } from '../src/schema.ts';
import { gate } from '../src/spoiler.ts';
import { extractSeries, writeTrace } from '../pipeline/extract.ts';
import { available, DEFAULT_MODEL } from '../pipeline/ollama.ts';
import { evaluate, temporalLeaks } from './compare.ts';
import { classify } from './taxonomy.ts';

const root = resolve(import.meta.dirname, '..');
const RESULTS = join(import.meta.dirname, 'results.md');

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const seriesId = arg('series', 'empyrean')!;
const model = arg('model', DEFAULT_MODEL)!;
const note = arg('note', '') ?? '';

const series = SeriesSchema.parse(
  JSON.parse(readFileSync(join(root, 'data', `${seriesId}.json`), 'utf8')),
);
const position = Number(arg('book', String(Math.max(...series.books.map((b) => b.id)))));

if (!(await available())) {
  console.error(
    'No local Ollama on :11434. Start it with `ollama serve`.\n' +
    'The pipeline is deliberately local-only — see pipeline/ollama.ts.',
  );
  process.exit(1);
}

// ── Corpus ─────────────────────────────────────────────────────────────────
// One chunk per book, built from that book's event lines. See evals/README.md
// for why this is the corpus and what it does and does not contain.
const g = gate(series, position);
const chunks: string[] = [];
for (const b of series.books.filter((b) => b.id <= position)) {
  const evs = g.events.filter((e) => e.book === b.id).map((e) => `- ${e.text}`);
  if (evs.length === 0) continue;
  chunks.push(`Book ${b.id}: ${b.short}\n${evs.join('\n')}`);
}

console.log(`${seriesId} · through book ${position} · ${chunks.length} chunks · model ${model}`);

const run = await extractSeries(series, chunks, {
  model,
  onProgress: (m) => process.stdout.write(`  ${m}\r`),
});

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const traceFile = writeTrace(run, stamp);

const corpus = chunks.join('\n');
const report = evaluate(run.graph, series, g.characters, corpus);
const leaks = temporalLeaks(run.graph, series, position);
const failures = classify(report, run, leaks.length);

// ── Report ─────────────────────────────────────────────────────────────────
const pct = (n: number) => (n * 100).toFixed(1);
console.log(`\n\nnodes            P ${pct(report.nodes.precision)}  R ${pct(report.nodes.recall)}  F1 ${pct(report.nodes.f1)}`);
console.log(`nodes in corpus  P ${pct(report.nodesInCorpus.precision)}  R ${pct(report.nodesInCorpus.recall)}  F1 ${pct(report.nodesInCorpus.f1)}   <- the model's actual score`);
console.log(`                 ${report.outOfCorpus} truth characters the corpus never names`);
console.log(`edges            P ${pct(report.edges.precision)}  R ${pct(report.edges.recall)}  F1 ${pct(report.edges.f1)}`);
console.log(`\nper type:`);
for (const [type, m] of Object.entries(report.edgesByType).sort((a, b) => b[1].f1 - a[1].f1)) {
  console.log(`  ${type.padEnd(13)} P ${pct(m.precision).padStart(5)}  R ${pct(m.recall).padStart(5)}  F1 ${pct(m.f1).padStart(5)}  (tp ${m.truePositives}, fp ${m.falsePositives}, fn ${m.falseNegatives})`);
}
console.log(`\ntemporal leaks: ${leaks.length}${leaks.length ? ` — ${leaks.join(', ')}` : ''}`);
console.log(`reversed: ${report.reversed.length} · wrong type: ${report.wrongType.length} · spurious: ${report.spuriousEdges.length}`);
console.log(`\nfailure classes:`);
for (const f of failures) console.log(`  ${f.cls.padEnd(24)} ${f.count.toString().padStart(3)}  ${f.note}`);
console.log(`\n${(run.totals.ms / 1000).toFixed(0)}s · ${run.totals.calls} calls · ${run.totals.responseTokens} response tokens · $0`);
console.log(`trace: ${traceFile.replace(root + '/', '')}`);

// ── Append to the score history ────────────────────────────────────────────
if (!existsSync(RESULTS)) {
  writeFileSync(RESULTS, `# Eval results

Appended by \`npm run eval\`. Committed on purpose: a score moving over time is
the evidence that tuning worked, and it is not visible from a single number.

Scoring rules, entity resolution and the corpus are described in
[README.md](README.md). Cost is always \$0 — the model runs locally.

| when | series | book | model | node F1 | in-corpus F1 | edge F1 | leaks | rev | wrong type | spurious | s | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
`);
}
appendFileSync(
  RESULTS,
  `| ${stamp.slice(0, 16)} | ${seriesId} | ${position} | ${model} | ${pct(report.nodes.f1)} | ${pct(report.nodesInCorpus.f1)} | ` +
  `${pct(report.edges.f1)} | ${leaks.length} | ${report.reversed.length} | ` +
  `${report.wrongType.length} | ${report.spuriousEdges.length} | ` +
  `${(run.totals.ms / 1000).toFixed(0)} | ${note} |\n`,
);
console.log(`appended to evals/results.md`);
