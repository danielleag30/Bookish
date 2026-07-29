/**
 * What is on the chart, and what is missing, per character.
 *
 *   npx tsx scripts/gaps.ts --slug fae-and-alchemy
 *   npx tsx scripts/gaps.ts --slug fae-and-alchemy --md > GAPS.md
 *
 * WHY
 * "15 of 29 characters have no relationships" is a number, not a task list. It
 * does not say which fifteen, what is already known about them, or what a human
 * would have to supply to close it. This prints the row for every character so
 * the gap is a thing you can read down and answer.
 */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema, type Series } from '../src/schema.ts';

const root = resolve(import.meta.dirname, '..');
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const md = process.argv.includes('--md');
const slug = arg('slug');
if (!slug) {
  console.error('usage: npx tsx scripts/gaps.ts --slug <series> [--md]');
  process.exit(1);
}

const series: Series = SeriesSchema.parse(
  JSON.parse(readFileSync(join(root, 'data', `${slug}.json`), 'utf8')),
);

const label = new Map(series.characters.map((c) => [c.id, c.label]));
const edges = new Map<string, string[]>();
for (const r of series.relationships) {
  const a = `${r.type} → ${label.get(r.to) ?? r.to}`;
  const b = `${r.type} ← ${label.get(r.from) ?? r.from}`;
  edges.set(r.from, [...(edges.get(r.from) ?? []), a]);
  edges.set(r.to, [...(edges.get(r.to) ?? []), b]);
}

const regionLabel = new Map(series.regions.map((r) => [r.id, r.label]));
const affilLabel = new Map(Object.entries(series.affiliations).map(([k, v]) => [k, v.label]));

const rows = series.characters.map((c) => {
  const rels = edges.get(c.id) ?? [];
  const missing: string[] = [];
  if (rels.length === 0) missing.push('**relationships**');
  if (c.region === 'main') missing.push('region');
  if (c.affil === 'unsorted') missing.push('faction');
  if (!c.type) missing.push('type');
  if (!c.role) missing.push('role');
  if (!c.magic && !c.attrs?.magic) missing.push('power');
  return {
    id: c.id,
    label: c.label,
    books: c.book === c.lastBook ? `${c.book}` : `${c.book}–${c.lastBook}`,
    region: regionLabel.get(c.region) ?? c.region,
    affil: affilLabel.get(c.affil) ?? c.affil,
    type: c.type ?? '—',
    status: c.status,
    role: c.role || '—',
    rels,
    missing,
  };
});

if (md) {
  console.log(`# ${series.title} — what the chart has, and what it is missing\n`);
  console.log(
    `${series.characters.length} characters · ${series.relationships.length} relationships · ` +
      `${series.books.length} books\n`,
  );
  console.log('| Character | Bk | Region | Faction | Kind | Role | Connections | Missing |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(
      `| **${r.label}** | ${r.books} | ${r.region} | ${r.affil} | ${r.type} | ${r.role} | ` +
        `${r.rels.length ? r.rels.join('<br/>') : '— **none**'} | ${r.missing.join(', ') || '—'} |`,
    );
  }
} else {
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
  console.log(
    `\n${series.title} — ${series.characters.length} characters, ` +
      `${series.relationships.length} relationships\n`,
  );
  console.log(
    pad('CHARACTER', 20) + pad('BK', 5) + pad('REGION', 12) + pad('FACTION', 15) +
      pad('KIND', 9) + 'CONNECTIONS',
  );
  console.log('─'.repeat(100));
  for (const r of rows) {
    console.log(
      pad(r.label, 20) + pad(r.books, 5) + pad(r.region, 12) + pad(r.affil, 15) +
        pad(r.type, 9) + (r.rels.length ? r.rels.join(', ') : '‼ NONE'),
    );
  }
  const noRels = rows.filter((r) => r.rels.length === 0);
  console.log(`\n${noRels.length} of ${rows.length} have no connections:`);
  console.log('  ' + noRels.map((r) => r.label).join(', '));
}
