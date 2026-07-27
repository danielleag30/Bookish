/**
 * Spoiler audit — what would leak if a field were served below full reading
 * position.
 *
 *   npm run spoiler-audit
 *
 * Reports rather than fails. These are not data errors: the bios are correct,
 * they are simply written as whole-series text with no per-book gating. The fix
 * is segmenting them into `bioByBook`, which is a Phase 3 pipeline task.
 *
 * Until then the rule for Phase 1.5 and Phase 6 is: never serve `bio` unless
 * the reader is at the final book. Prefer `bioByBook` where present.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema, type Series, type Character } from '../src/schema.ts';

const dataDir = resolve(import.meta.dirname, '..', 'data');

/**
 * Name needles that identify exactly one character — the same uniqueness rule
 * the event linker uses, so "Sorrengail" never matches all five of them.
 */
function uniqueNeedles(characters: Character[]): { id: string; needle: string }[] {
  const owners = new Map<string, Set<string>>();
  const tokensFor = new Map<string, string[]>();

  for (const c of characters) {
    const toks = new Set<string>();
    for (const raw of c.label.split(/[\s·/,]+/)) {
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

function auditSeries(series: Series) {
  const byId = new Map(series.characters.map((c) => [c.id, c]));
  const needles = uniqueNeedles(series.characters);
  const maxBook = Math.max(...series.books.map((b) => b.id));

  interface Leak {
    character: Character;
    mentions: { id: string; label: string; book: number }[];
  }
  const leaks: Leak[] = [];

  for (const c of series.characters) {
    if (!c.bio) continue;
    const mentions = needles
      .filter((n) => n.id !== c.id)
      .filter((n) => new RegExp(`(?<!\\w)${n.needle}(?!\\w)`).test(c.bio!))
      .map((n) => byId.get(n.id)!)
      // A leak only matters if the mentioned character appears later than the
      // one whose bio it is: reading that bio then reveals someone unmet.
      .filter((m) => m.book > c.book);

    const unique = [...new Map(mentions.map((m) => [m.id, m])).values()];
    if (unique.length > 0) {
      leaks.push({
        character: c,
        mentions: unique.map((m) => ({ id: m.id, label: m.label, book: m.book })),
      });
    }
  }

  console.log(`\n${series.id} — ${series.title}`);
  console.log(`  books 1-${maxBook} · ${series.characters.length} characters`);

  const withBio = series.characters.filter((c) => c.bio).length;
  const segmented = series.characters.filter((c) => c.bioByBook?.length).length;
  console.log(`  bios: ${withBio} present, ${segmented} segmented into bioByBook`);

  if (leaks.length === 0) {
    console.log('  ✓ no bio names a later-appearing character');
  } else {
    console.log(
      `  ! ${leaks.length} of ${withBio} bios name a character who appears later:`,
    );
    for (const l of leaks.slice(0, 12)) {
      console.log(
        `      ${l.character.label} (bk${l.character.book}) → ` +
          l.mentions.map((m) => `${m.label} (bk${m.book})`).join(', '),
      );
    }
    if (leaks.length > 12) console.log(`      … and ${leaks.length - 12} more`);
  }

  const perceived = series.characters.filter((c) => c.perceived);
  if (perceived.length > 0) {
    console.log(`  perceived states recorded (${perceived.length}):`);
    for (const c of perceived) {
      const p = c.perceived!;
      const was = p.status ? `status "${p.status}"` : `identity "${p.identity}"`;
      console.log(`      ${c.label}: reader believes ${was} through book ${p.untilBook}`);
    }
  }

  return { leaks: leaks.length, withBio, segmented, perceived: perceived.length };
}

const files = readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort();
let totalLeaks = 0;
let totalSegmented = 0;

console.log('Spoiler audit — fields that would leak below full reading position');

for (const f of files) {
  const series = SeriesSchema.parse(JSON.parse(readFileSync(join(dataDir, f), 'utf8')));
  const r = auditSeries(series);
  totalLeaks += r.leaks;
  totalSegmented += r.segmented;
}

console.log(`\n${totalLeaks} leaking bio(s) across ${files.length} series.`);
if (totalLeaks > 0) {
  console.log(
    'Consequence: `bio` must not be served below the final book until segmented\n' +
      'into `bioByBook`. The character card, the Phase 1.5 ask box and the Phase 6\n' +
      'MCP server all need to honour that.',
  );
}
