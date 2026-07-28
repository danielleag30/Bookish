/**
 * Build a draft series file from source notes, locally.
 *
 *   npm run add-series -- --slug fae-and-alchemy
 *   npm run add-series -- --slug fae-and-alchemy --model qwen3:8b --single
 *
 * WHY THIS RUNS ON YOUR MACHINE AND NOT IN CI
 * A GitHub runner has no local model, so extraction there needs a hosted one —
 * and GitHub Models is retired on 2026-07-30. Running it locally on Ollama costs
 * nothing, has no rate limit, and can be re-run as many times as it takes to get
 * a draft worth proposing.
 *
 * The division of labour is deliberate:
 *   the issue      is the request, and the record of who asked for what
 *   this command   does the expensive, model-driven part, on your hardware
 *   CI             validates whatever comes back
 *   a human        decides whether it becomes a chart
 *
 * WHAT IT PRODUCES
 * A draft, not a finished chart. Characters and relationships are extracted;
 * books, regions and affiliations are scaffolded from what the notes state and
 * will need a human pass. The file is written to data/ only if it validates.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema, checkIntegrity, type Series } from '../src/schema.ts';
import { RELATIONSHIP_TYPES } from '../src/relationships.ts';
import { extractSeries } from '../pipeline/extract.ts';
import { orchestrate } from '../pipeline/multiagent.ts';
import { available, DEFAULT_MODEL } from '../pipeline/ollama.ts';

const root = resolve(import.meta.dirname, '..');

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const has = (f: string) => process.argv.includes(`--${f}`);

const slug = arg('slug');
if (!slug) {
  console.error('usage: npm run add-series -- --slug <series-slug> [--model <m>] [--single]');
  process.exit(1);
}
const model = arg('model', DEFAULT_MODEL)!;

const notesPath = join(root, 'pipeline', 'input', `${slug}.md`);
if (!existsSync(notesPath)) {
  console.error(
    `No notes at pipeline/input/${slug}.md\n` +
    `The add-series agent writes that file from a labelled issue — see ` +
    `.github/workflows/add-series-agent.yml.`,
  );
  process.exit(1);
}

if (!(await available())) {
  console.error('No local Ollama on :11434. Start it with `ollama serve`.');
  process.exit(1);
}

const notes = readFileSync(notesPath, 'utf8');

// ── Scaffold the parts a model should not be guessing ──────────────────────
// Book titles, region geometry and palette are authorial decisions. The notes
// state the books; everything else gets a placeholder a human will replace.
const title = /\*\*Series:\*\*\s*(.+)/.exec(notes)?.[1]?.split(' by ')[0]?.trim() ?? slug;
const author = /\*\*Series:\*\*.*\bby\s+(.+)/.exec(notes)?.[1]?.trim() ?? 'Unknown';

const bookHeadings = [...notes.matchAll(/^##\s*Book\s*(\d+)\s*:\s*(.+)$/gim)];
const books = bookHeadings.length
  ? bookHeadings.map((m) => ({
      id: Number(m[1]), title: m[2]!.trim(), short: m[2]!.trim(),
    }))
  : [{ id: 1, title: `${title} book 1`, short: 'Book 1' }];

// Chunk by book, so a chunk never contains a later book's events.
const chunks = bookHeadings.length
  ? bookHeadings.map((m, i) => {
      const start = m.index!;
      const end = bookHeadings[i + 1]?.index ?? notes.length;
      return notes.slice(start, end).trim();
    })
  : [notes];

console.log(`${title} by ${author} · ${books.length} book(s) · ${chunks.length} chunk(s)`);
console.log(`model ${model} · ${has('single') ? 'single agent' : 'extractor + verifier + resolver'}\n`);

// A minimal shell the extraction fills in. One region and one affiliation, so
// the result validates; a human splits them properly.
const shell: Series = {
  id: slug, title, author, books,
  regions: [{ id: 'main', label: title, y: 0, h: 600 }],
  affiliations: { unsorted: { label: 'Unsorted', color: '#8a7eaa', border: '#5a4a7a' } },
  relationshipTypes: RELATIONSHIP_TYPES.map((t) => ({
    id: t.id, label: t.label, color: '#7a7a8a', dash: null, symmetric: t.symmetric,
  })),
  characters: [], relationships: [], events: [],
};

// ── Extract ────────────────────────────────────────────────────────────────
const started = Date.now();
const result = has('single')
  ? await extractSeries(shell, chunks, { model, onProgress: (m) => process.stdout.write(`  ${m}\r`) })
  : await orchestrate(shell, chunks, { model, onProgress: (m) => process.stdout.write(`  ${m}\r`) });
const graph = result.graph;

// ── Assemble ───────────────────────────────────────────────────────────────
// Everything lands in book 1 unless a later chunk introduced it, which is the
// most conservative reading: a character shown earlier than they appear is a
// spoiler, one shown later is merely wrong.
const firstSeen = new Map<string, number>();
if (!has('single') || true) {
  for (const [i, chunk] of chunks.entries()) {
    for (const c of graph.characters) {
      if (firstSeen.has(c.id)) continue;
      if (chunk.toLowerCase().includes(c.label.toLowerCase())) firstSeen.set(c.id, books[i]?.id ?? 1);
    }
  }
}
const lastBook = Math.max(...books.map((b) => b.id));

const draft: Series = {
  ...shell,
  characters: graph.characters.map((c, i) => ({
    id: c.id, label: c.label, role: c.role,
    affil: 'unsorted', region: 'main',
    book: firstSeen.get(c.id) ?? 1,
    lastBook,
    status: c.status, size: i < 4 ? 'main' : 'side',
    x: 120 + (i % 6) * 150,
    y: 90 + Math.floor(i / 6) * 130,
  })),
  relationships: graph.relationships.map((r) => ({
    from: r.from, to: r.to, type: r.type,
    book: Math.max(firstSeen.get(r.from) ?? 1, firstSeen.get(r.to) ?? 1),
    label: r.label,
  })),
  events: chunks.flatMap((chunk, i) =>
    [...chunk.matchAll(/^-\s+(.+)$/gm)].map((m) => ({
      book: books[i]?.id ?? 1,
      text: m[1]!.trim(),
      involves: graph.characters
        .filter((c) => new RegExp(`(?<!\\w)${c.label.split(/\s+/)[0]}(?!\\w)`, 'i').test(m[1]!))
        .map((c) => c.id),
      kind: 'other' as const,
    })),
  ),
};

// ── Validate before writing ────────────────────────────────────────────────
const parsed = SeriesSchema.safeParse(draft);
if (!parsed.success) {
  console.error('\nThe draft does not match the schema:\n');
  for (const i of parsed.error.issues.slice(0, 12)) {
    console.error(`  ${i.path.join('.')}: ${i.message}`);
  }
  console.error('\nNothing written. Fix the notes or the pipeline and re-run.');
  process.exit(1);
}
const issues = checkIntegrity(parsed.data);
const errors = issues.filter((i) => i.severity === 'error');

const secs = ((Date.now() - started) / 1000).toFixed(0);
console.log(`\n${draft.characters.length} characters · ${draft.relationships.length} relationships · ` +
            `${draft.events.length} events · ${secs}s · $0`);

if (errors.length) {
  console.error(`\n${errors.length} integrity error(s) — nothing written:`);
  for (const e of errors.slice(0, 10)) console.error(`  ${e.rule}: ${e.where} — ${e.message}`);
  process.exit(1);
}

mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(join(root, 'data', `${slug}.json`), JSON.stringify(draft, null, 2) + '\n');
console.log(`\nwrote data/${slug}.json`);
console.log(`
This is a draft, not a chart. Still to do by hand:
  - split the single "Unsorted" affiliation into real factions
  - split the single region into places, with coordinates
  - set each character's first and last book properly
  - add a theme with a mood line
  - check every relationship against RELATIONSHIPS.md

Then: npm run validate && npm run dev`);
