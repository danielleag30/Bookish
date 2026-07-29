/**
 * Apply a series' corrections file to its existing data.
 *
 *   npx tsx scripts/apply-corrections.ts --slug fae-and-alchemy
 *   npx tsx scripts/apply-corrections.ts --slug fae-and-alchemy --write
 *
 * `add-series` applies the same corrections through the same module, but only
 * as the last step of a full extraction. That made adding one correction cost a
 * multi-minute non-deterministic model run — and risked the new run producing
 * different ids than the corrections name, so the fix and the data could drift
 * apart in the act of applying it.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema, checkIntegrity } from '../src/schema.ts';
import { applyCorrections, type Corrections } from '../pipeline/corrections.ts';

const root = resolve(import.meta.dirname, '..');
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const slug = arg('slug');
const write = process.argv.includes('--write');

if (!slug) {
  console.error('usage: npx tsx scripts/apply-corrections.ts --slug <series> [--write]');
  process.exit(1);
}

const dataPath = join(root, 'data', `${slug}.json`);
const fixPath = join(root, 'pipeline', 'input', `${slug}.corrections.json`);
for (const [what, p] of [['data', dataPath], ['corrections', fixPath]] as const) {
  if (!existsSync(p)) {
    console.error(`no ${what} at ${p.replace(root + '/', '')}`);
    process.exit(1);
  }
}

const series = SeriesSchema.parse(JSON.parse(readFileSync(dataPath, 'utf8')));
const fix = JSON.parse(readFileSync(fixPath, 'utf8')) as Corrections;

const { applied, skipped } = applyCorrections(series, fix);
console.log(`applied ${applied} correction(s)`);

// A correction that names an id the data no longer has is reported loudly. It
// looks like the judgement is still being honoured when it is not.
if (skipped.length) {
  console.warn(`\n${skipped.length} correction(s) did NOT apply — stale, or the id changed:`);
  for (const s of skipped) console.warn(`  ${s}`);
}

const parsed = SeriesSchema.safeParse(series);
if (!parsed.success) {
  console.error('\nThe corrected data does not match the schema:\n');
  for (const i of parsed.error.issues.slice(0, 12)) {
    console.error(`  ${i.path.join('.')}: ${i.message}`);
  }
  process.exit(1);
}
const errs = checkIntegrity(parsed.data).filter((i) => i.severity === 'error');
if (errs.length) {
  console.error('\nIntegrity errors after correcting:\n');
  for (const e of errs.slice(0, 12)) console.error(`  ${e.rule}: ${e.message}`);
  process.exit(1);
}

if (!write) {
  console.log('\nDry run. Re-run with --write to save.');
  process.exit(skipped.length ? 1 : 0);
}
writeFileSync(dataPath, JSON.stringify(parsed.data, null, 2) + '\n');
console.log(`\nwrote data/${slug}.json`);
