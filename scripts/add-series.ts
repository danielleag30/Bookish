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
import { applyCorrections, type Corrections } from '../pipeline/corrections.ts';
import { SeriesSchema, checkIntegrity, type Series } from '../src/schema.ts';
import { RELATIONSHIP_TYPES } from '../src/relationships.ts';
import { extractSeries } from '../pipeline/extract.ts';
import { orchestrate, writeAudit } from '../pipeline/multiagent.ts';
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

// The shell handed to the extractor. Regions and affiliations are filled in
// afterwards from what it finds, so this only needs to be a valid starting point.
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

// Write the audit for a multi-agent run. Without this there is no record of what
// the verifier rejected, and reaching for "the most recent run file" picks up a
// different series' audit — which is worse than having none.
if ('audit' in result) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = writeAudit(result.audit, slug, stamp);
  console.log(`  audit ${file.replace(root + '/', '')}`);
}

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

// ── Regions and factions, from the extraction ──────────────────────────────
// These used to be a single "main" region and a single "Unsorted" affiliation,
// on the reasoning that a model must not invent geography. That was the wrong
// guardrail: the model reads Zilvaren and Yvelia straight off the notes, and
// with nowhere to put them it filed both as characters. Reading a place the
// notes name is extraction, not invention. Colour and coordinates stay
// placeholders, because those genuinely are authorial.
const FACTION_COLORS = [
  ['#8a7eaa', '#5a4a7a'], ['#7e9aaa', '#4a6a7a'], ['#aa8a7e', '#7a5a4a'],
  ['#7eaa8a', '#4a7a5a'], ['#aa7e9a', '#7a4a6a'], ['#a9aa7e', '#7a7a4a'],
];

const places = graph.places ?? [];
const factions = graph.factions ?? [];

// `main` and `unsorted` always survive as the home for anyone the notes do not
// place. A character must always have somewhere to sit, or the file will not
// validate.
const regions = [
  { id: 'main', label: 'Unplaced', x: 0, y: 0, w: 400, h: 300 },
  ...places.map((p, i) => ({
    id: p.id, label: p.label,
    x: ((i + 1) % 3) * 420, y: Math.floor((i + 1) / 3) * 320, w: 400, h: 300,
  })),
];
const regionIds = new Set(regions.map((r) => r.id));

const affiliations: Series['affiliations'] = {
  unsorted: { label: 'Unsorted', color: '#8a7eaa', border: '#5a4a7a' },
};
for (const [i, f] of factions.entries()) {
  affiliations[f.id] = {
    label: f.label,
    color: FACTION_COLORS[i % FACTION_COLORS.length]?.[0] ?? '#8a7eaa',
    border: FACTION_COLORS[i % FACTION_COLORS.length]?.[1] ?? '#5a4a7a',
  };
}

/**
 * Work out where a character sits from the notes themselves.
 *
 * The model fills `place` for only a handful of characters — allegiance is
 * rarely stated as a property, it is implied by the sentence someone appears in
 * ("Hayden Fane ... works as a store clerk in the seventh ward" sits in a line
 * that names Zilvaren). So: read every note line mentioning this character, and
 * if exactly one place is named across them, that is where they are. If two
 * places are named, the notes are genuinely ambiguous and they stay unplaced —
 * guessing between them would be inventing.
 */
function inferPlace(label: string): string | undefined {
  const first = label.split(/\s+/)[0];
  if (!first || first.length < 3) return undefined;
  const mentions = notes
    .split('\n')
    .filter((line) => new RegExp(`(?<!\\w)${first}(?!\\w)`, 'i').test(line));
  if (mentions.length === 0) return undefined;

  const hits = new Set<string>();
  for (const place of places) {
    const name = place.label.split(/\s+/)[0];
    if (!name) continue;
    if (mentions.some((line) => new RegExp(`(?<!\\w)${name}(?!\\w)`, 'i').test(line))) {
      hits.add(place.id);
    }
  }
  return hits.size === 1 ? [...hits][0] : undefined;
}

// Where each character ends up, resolved once so the layout below can use it.
const placeOf = new Map<string, string>();
for (const c of graph.characters) {
  const stated = c.place && regionIds.has(c.place) ? c.place : undefined;
  placeOf.set(c.id, stated ?? inferPlace(c.label) ?? 'main');
}

// Size each region to what it actually holds, then stack them without overlap.
// Fixed 400x300 boxes were arbitrary: "Unplaced" holds most of the cast and
// overflowed, while a realm with two people in it wasted a third of the canvas.
{
  const COLS = 3;
  const counts = new Map<string, number>();
  for (const id of placeOf.values()) counts.set(id, (counts.get(id) ?? 0) + 1);

  const GAP = 40;
  let x = 0;
  let rowY = 0;
  let rowH = 0;
  for (const r of regions) {
    const n = counts.get(r.id) ?? 0;
    r.h = Math.max(200, Math.ceil(n / COLS) * 62 + 110);
    r.w = 400;
    if (x > 0 && x + r.w > 900) { x = 0; rowY += rowH + GAP; rowH = 0; }
    r.x = x;
    r.y = rowY;
    x += r.w + GAP;
    rowH = Math.max(rowH, r.h);
  }
}

/**
 * Lay each character out inside their own region box.
 *
 * The previous scaffold placed nodes on a grid that knew nothing about regions,
 * so once regions became real, 29 of 30 characters were drawn outside the box
 * they belonged to — which reads as a rendering bug rather than a draft.
 */
const perRegion = new Map<string, number>();
function position(regionId: string): { x: number; y: number } {
  const r = regions.find((x) => x.id === regionId) ?? regions[0]!;
  const n = perRegion.get(regionId) ?? 0;
  perRegion.set(regionId, n + 1);
  const cols = 3;
  const padX = 70;
  const padY = 60;
  const stepX = ((r.w ?? 400) - padX * 2) / (cols - 1);
  const stepY = 62;
  return {
    x: (r.x ?? 0) + padX + (n % cols) * stepX,
    y: r.y + padY + Math.floor(n / cols) * stepY,
  };
}

// A character who dies is last seen in the book they die in. Blanket-assigning
// the final book kept Malcolm on the chart in book two, a book he is not in.
const diesIn = new Map<string, number>();
for (const [i, chunk] of chunks.entries()) {
  for (const c of graph.characters) {
    if (c.status !== 'dead' || diesIn.has(c.id)) continue;
    const first = c.label.split(/\s+/)[0];
    if (first && new RegExp(`(?<!\\w)${first}(?!\\w)`, 'i').test(chunk)) {
      diesIn.set(c.id, books[i]?.id ?? 1);
    }
  }
}

const draft: Series = {
  ...shell,
  regions,
  affiliations,
  // Cleared by hand once regions and factions are real. See SeriesSchema.
  draft: true,
  characters: graph.characters.map((c, i) => ({
    id: c.id, label: c.label, role: c.role,
    // Fall back rather than trust: a model naming a faction that is not in the
    // factions list would otherwise produce an unresolvable id and fail validation.
    affil: c.faction && affiliations[c.faction] ? c.faction : 'unsorted',
    region: placeOf.get(c.id) ?? 'main',
    book: firstSeen.get(c.id) ?? 1,
    lastBook: c.status === 'dead' ? (diesIn.get(c.id) ?? lastBook) : lastBook,
    status: c.status, size: i < 4 ? 'main' : 'side',
    ...position(placeOf.get(c.id) ?? 'main'),
  })),
  // A symmetric type says the same thing in both directions, so storing both is
  // a duplicate the validator rejects. Keep whichever direction arrived first.
  relationships: (() => {
    const symmetric = new Set(
      RELATIONSHIP_TYPES.filter((t) => t.symmetric).map((t) => t.id),
    );
    const seen = new Set<string>();
    return graph.relationships
      .filter((r) => {
        if (!symmetric.has(r.type)) return true;
        const key = [r.from, r.to].sort().join('|') + ':' + r.type;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((r) => ({
        from: r.from, to: r.to, type: r.type,
        book: Math.max(firstSeen.get(r.from) ?? 1, firstSeen.get(r.to) ?? 1),
        label: r.label,
      }));
  })(),
  events: chunks.flatMap((chunk, i) =>
    [...chunk.matchAll(/^-\s+(.+)$/gm)].map((m) => ({
      book: books[i]?.id ?? 1,
      text: m[1]!.trim(),
      // Only link a character the chart actually shows in this book. Book two
      // says Saeris rules "having killed Malcolm" — Malcolm is backstory there,
      // not a participant, and linking him points the event at someone the
      // timeline has already removed.
      involves: graph.characters
        .filter((c) => new RegExp(`(?<!\\w)${c.label.split(/\s+/)[0]}(?!\\w)`, 'i').test(m[1]!))
        .filter((c) => {
          const bookId = books[i]?.id ?? 1;
          const last = c.status === 'dead' ? (diesIn.get(c.id) ?? lastBook) : lastBook;
          return (firstSeen.get(c.id) ?? 1) <= bookId && last >= bookId;
        })
        .map((c) => c.id),
      kind: 'other' as const,
    })),
  ),
};

// ── Corrections ────────────────────────────────────────────────────────────
// Human judgements, re-applied after every extraction. Shared with
// scripts/apply-corrections.ts so a fresh run and a re-apply cannot diverge.
const correctionsPath = join(root, 'pipeline', 'input', `${slug}.corrections.json`);
if (existsSync(correctionsPath)) {
  const fix = JSON.parse(readFileSync(correctionsPath, 'utf8')) as Corrections;
  const { applied, skipped } = applyCorrections(draft, fix);
  console.log(`  applied ${applied} correction(s) from ${slug}.corrections.json`);
  if (skipped.length) {
    console.warn(`  ${skipped.length} correction(s) did NOT apply:`);
    for (const line of skipped) console.warn(`    ${line}`);
  }
}

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
