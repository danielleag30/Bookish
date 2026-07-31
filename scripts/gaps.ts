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

// Whatever this world calls an ability — "Signet" in the Empyrean. A column
// headed "Power" on an Empyrean table is the same mistake the chart used to
// make, and this file exists to be filled in by someone who read the books.
const abilityTerm = series.terms?.magic ?? 'Power';

// Only the attribute columns this series actually uses, so a table for one
// series is not padded with another's fields.
const attrKeys = [...new Set(series.characters.flatMap((c) => Object.keys(c.attrs ?? {})))].sort();

/**
 * Can a character of this kind have this field at all?
 *
 * Asking a dragon for a signet, or a god for a wing, is noise, and a report
 * full of noise does not get filled in. The test is whether ANY member of the
 * kind has one — that proves the field applies to them, so a blank is a gap.
 *
 * Not "most of them have it", which was the first attempt and inverted itself:
 * the whole point of this report is that 37 of 41 riders are missing a signet,
 * and a majority rule concludes from that very fact that riders do not have
 * signets. A rule that goes quiet precisely when the gap is worst is worse than
 * no rule.
 */
const kindOf = (c: { type?: string }) => c.type ?? '(none)';
const byKind = new Map<string, typeof series.characters>();
for (const c of series.characters) {
  byKind.set(kindOf(c), [...(byKind.get(kindOf(c)) ?? []), c]);
}
const kindHas = (kind: string, has: (c: (typeof series.characters)[number]) => boolean) =>
  (byKind.get(kind) ?? []).some(has);
const expectsAbility = (c: { type?: string }) => kindHas(kindOf(c), (x) => Boolean(x.magic));
const expectsAttr = (c: { type?: string }, k: string) =>
  kindHas(kindOf(c), (x) => x.attrs?.[k] !== undefined);

const rows = series.characters.map((c) => {
  const rels = edges.get(c.id) ?? [];
  const missing: string[] = [];
  if (rels.length === 0) missing.push('**relationships**');
  if (c.region === 'main') missing.push('region');
  if (c.affil === 'unsorted') missing.push('faction');
  if (!c.type) missing.push('type');
  if (!c.role) missing.push('role');
  if (!c.magic && expectsAbility(c)) missing.push(`**${abilityTerm.toLowerCase()}**`);
  // Attributes are deliberately NOT flagged as missing.
  //
  // `signet` and `king` look identical to code — a field some characters have
  // and others do not — but a rider without a recorded signet is a gap, while a
  // character without `king` is simply not a king. Coverage cannot tell those
  // apart, and guessing produced "missing king: 30 of 39". They are reported as
  // coverage below instead, which is information rather than an accusation.
  return {
    id: c.id,
    label: c.label,
    books: c.book === c.lastBook ? `${c.book}` : `${c.book}–${c.lastBook}`,
    region: regionLabel.get(c.region) ?? c.region,
    affil: affilLabel.get(c.affil) ?? c.affil,
    type: c.type ?? '—',
    status: c.status,
    role: c.role || '—',
    kindLabel: series.characterTypes?.[c.type ?? '']?.label ?? c.type ?? '—',
    ability: c.magic ?? '',
    attrs: Object.fromEntries(attrKeys.map((k) => [k, String(c.attrs?.[k] ?? '')])),
    rels,
    missing,
  };
});

if (md) {
  console.log(`# ${series.title} — what the chart has, and what it is missing\n`);
  console.log(
    `${series.characters.length} characters · ${series.relationships.length} relationships · ` +
      `${series.books.filter((b) => !b.future).length} published books` +
      `${series.books.some((b) => b.future) ? ' (+1 announced)' : ''}\n`,
  );
  console.log(`Abilities are called **${abilityTerm}** in this series.\n`);

  const gapCount = (k: string) => rows.filter((r) => r.missing.some((m) => m.includes(k))).length;
  console.log('### Gaps\n');
  console.log('| Missing | Count |');
  console.log('|---|---|');
  let anyGap = false;
  for (const k of [abilityTerm.toLowerCase(), 'role', 'region', 'faction', 'relationships']) {
    const n = gapCount(k);
    if (n) { anyGap = true; console.log(`| ${k} | ${n} of ${rows.length} |`); }
  }
  if (!anyGap) console.log('| — | nothing |');
  console.log('');

  if (attrKeys.length) {
    console.log('### Attribute coverage\n');
    console.log('Not gaps — some of these only apply to some characters.\n');
    console.log('| Attribute | Recorded on |');
    console.log('|---|---|');
    for (const k of attrKeys) {
      const n = series.characters.filter((c) => c.attrs?.[k] !== undefined).length;
      console.log(`| ${k} | ${n} of ${rows.length} |`);
    }
    console.log('');
  }

  // Grouped by kind: a signet is a thing riders have, and asking for one on a
  // dragon's row wastes the reader's attention.
  const head = ['Character', 'Bk', 'Region', 'Faction', 'Role', abilityTerm, ...attrKeys, 'Connections', 'Missing'];
  const kinds = [...new Set(rows.map((r) => r.kindLabel))];
  const grouped = kinds.length > 1;
  for (const kind of kinds) {
    const group = rows.filter((r) => r.kindLabel === kind);
    if (grouped) console.log(`## ${kind} (${group.length})\n`);
    else console.log(`## All characters (${group.length})\n`);
    console.log(`| ${head.join(' | ')} |`);
    console.log(`|${head.map(() => '---').join('|')}|`);
    for (const r of group) {
      console.log(
        `| **${r.label}** | ${r.books} | ${r.region} | ${r.affil} | ${r.role} | ` +
        `${r.ability || ''} | ${attrKeys.map((k) => r.attrs[k] ?? '').join(' | ')}` +
        `${attrKeys.length ? ' | ' : ''}` +
        `${r.rels.length ? r.rels.join('<br/>') : '— **none**'} | ${r.missing.join(', ') || '—'} |`,
      );
    }
    console.log('');
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
