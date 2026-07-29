/**
 * Split whole-series bios into per-book segments.
 *
 *   npx tsx scripts/segment-bios.ts            # report only
 *   npx tsx scripts/segment-bios.ts --write
 *
 * WHY
 * `bio` is whole-series prose, and `scripts/spoiler-audit.ts` found 37 of them
 * naming a character who has not appeared yet — Auren's book-1 bio mentions
 * Saira, who arrives in book 5. So `present()` withholds every unsegmented bio
 * below the final book. That is safe and useless: a reader on book 2 gets
 * nothing at all.
 *
 * HOW, AND WHY IT IS NOT INVENTION
 * This does not rewrite a single word. It splits the existing prose into
 * sentences and works out the earliest book at which each sentence is safe to
 * show — the latest first-appearance among the characters it names, and never
 * earlier than the subject's own first book. A sentence naming Saira lands in
 * book 5 because that is when Saira exists, not because anyone decided it
 * should. Sentences that name nobody stay with the subject's first book.
 *
 * The result is strictly more information than before at every position, and by
 * construction it cannot name someone the reader has not met.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema, type Series, type Character } from '../src/schema.ts';
import { mentions } from '../src/regex.ts';

const root = resolve(import.meta.dirname, '..');
const dataDir = join(root, 'data');
const write = process.argv.includes('--write');

/** Name needles that identify exactly one character. Mirrors spoiler-audit. */
function uniqueNeedles(characters: Character[]): { id: string; needle: string }[] {
  const owners = new Map<string, Set<string>>();
  const tokensFor = new Map<string, string[]>();

  for (const c of characters) {
    const toks = new Set<string>();
    for (const raw of [c.label, ...(c.aliases ?? [])].join(' ').split(/[\s·/,]+/)) {
      const t = raw.replace(/['"“”‘’]/g, '').trim();
      if (t.length >= 4) toks.add(t);
    }
    tokensFor.set(c.id, [...toks]);
    for (const t of toks) {
      if (!owners.has(t)) owners.set(t, new Set());
      owners.get(t)!.add(c.id);
    }
  }

  const out: { id: string; needle: string }[] = [];
  for (const c of characters) {
    for (const t of tokensFor.get(c.id) ?? []) {
      if (owners.get(t)!.size === 1) out.push({ id: c.id, needle: t });
    }
  }
  return out;
}

/**
 * Split on sentence ends, keeping the terminator.
 *
 * Deliberately conservative: a bio that is one long sentence stays one segment
 * rather than being chopped mid-clause. Better a whole sentence held back than
 * half a sentence shown.
 */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z“"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

let totalChanged = 0;
let totalSegments = 0;

for (const file of readdirSync(dataDir).filter((f) => f.endsWith('.json'))) {
  const path = join(dataDir, file);
  const series: Series = SeriesSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const finalBook = Math.max(...series.books.map((b) => b.id));
  const needles = uniqueNeedles(series.characters);
  const bookOf = new Map(series.characters.map((c) => [c.id, c.book]));

  // Book titles are spoilers too. Brennan's bio says what happens to him "in
  // Onyx Storm" — no later character is named, so a name-only rule served that
  // sentence from book one and told the reader there is a book three and what
  // is in it.
  const titles = series.books.flatMap((b) =>
    [b.title, b.short]
      .filter((t): t is string => Boolean(t) && t.length >= 4)
      .map((t) => ({ book: b.id, needle: t })),
  );

  let changed = 0;
  for (const c of series.characters) {
    if (!c.bio || c.bioByBook?.length) continue;

    // A bio describes the true person. If the reader is meant to believe
    // something else about them until book N, then NOTHING from the bio is safe
    // before N — not just the sentences that name a later character. Panchek's
    // bio says he is venin without naming anyone new, and a name-based rule
    // served it from book one, two books before he is exposed.
    const floor = c.perceived ? Math.max(c.book, c.perceived.untilBook + 1) : c.book;

    const byBook = new Map<number, string[]>();
    for (const sentence of sentences(c.bio)) {
      let earliest = floor;
      for (const n of needles) {
        if (n.id === c.id) continue;
        if (!mentions(sentence, n.needle)) continue;
        earliest = Math.max(earliest, bookOf.get(n.id) ?? c.book);
      }
      for (const t of titles) {
        if (mentions(sentence, t.needle)) {
          earliest = Math.max(earliest, t.book);
        }
      }
      // Clamp to the final book: a segment can never be later than the series.
      const slot = Math.min(Math.max(earliest, floor), finalBook);
      byBook.set(slot, [...(byBook.get(slot) ?? []), sentence]);
    }
    if (byBook.size === 0) continue;

    c.bioByBook = [...byBook.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([book, parts]) => ({ book, text: parts.join(' ') }));
    changed++;
    totalSegments += c.bioByBook.length;
  }

  if (changed) {
    SeriesSchema.parse(series);
    if (write) writeFileSync(path, JSON.stringify(series, null, 2) + '\n');
    console.log(`${file}: segmented ${changed} bio(s)`);
    totalChanged += changed;
  }
}

console.log(
  `\n${totalChanged} bio(s) split into ${totalSegments} segment(s)` +
    (write ? '' : '\n\nReport only. Re-run with --write to apply.'),
);
