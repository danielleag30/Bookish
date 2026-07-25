/**
 * Validates every series data file in `data/` against the shared schema and
 * the referential-integrity rules.
 *
 *   npm run validate
 *
 * Exits non-zero when any file fails shape validation or reports an integrity
 * error, so CI fails loudly. Warnings are printed but do not fail the build:
 * they flag data worth a human look rather than something broken.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema, checkIntegrity, type Issue } from '../src/schema.ts';

const root = resolve(import.meta.dirname, '..');
const dataDir = join(root, 'data');

if (!existsSync(dataDir)) {
  console.log('No data/ directory — run `node scripts/extract-charts.mjs` first.');
  process.exit(1);
}

const files = readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.log('data/ holds no .json files — run `node scripts/extract-charts.mjs` first.');
  process.exit(1);
}

let totalErrors = 0;
let totalWarnings = 0;

for (const file of files) {
  console.log(`\n${file}`);
  const raw: unknown = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));

  const parsed = SeriesSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('  ✗ shape validation failed:');
    for (const issue of parsed.error.issues.slice(0, 25)) {
      console.error(`      ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    const hidden = parsed.error.issues.length - 25;
    if (hidden > 0) console.error(`      … and ${hidden} more`);
    totalErrors += parsed.error.issues.length;
    continue;
  }

  const series = parsed.data;
  console.log(
    `  shape ok — ${series.characters.length} characters, ` +
      `${series.relationships.length} relationships, ${series.events.length} events, ` +
      `${series.books.length} books`,
  );

  const issues = checkIntegrity(series);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  totalErrors += errors.length;
  totalWarnings += warnings.length;

  const report = (label: string, list: Issue[], mark: string) => {
    if (list.length === 0) return;
    console.log(`  ${mark} ${list.length} ${label}:`);
    const byRule = new Map<string, Issue[]>();
    for (const i of list) {
      if (!byRule.has(i.rule)) byRule.set(i.rule, []);
      byRule.get(i.rule)!.push(i);
    }
    for (const [rule, group] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`      ${rule} (${group.length})`);
      for (const i of group.slice(0, 6)) console.log(`        - ${i.where}: ${i.message}`);
      if (group.length > 6) console.log(`        … and ${group.length - 6} more`);
    }
  };

  report('integrity error(s)', errors, '✗');
  report('warning(s)', warnings, '!');
  if (issues.length === 0) console.log('  ✓ integrity ok');
}

console.log(
  `\n${files.length} file(s) checked — ${totalErrors} error(s), ${totalWarnings} warning(s).`,
);

// Both counts are at zero as of the Phase 1 canon corrections, so warnings now
// fail the build too. This is a ratchet: it keeps resolved contradictions from
// quietly reappearing. If a new series legitimately needs a warning tolerated,
// fix the data or argue the rule down — do not loosen this silently.
if (totalErrors > 0 || totalWarnings > 0) process.exit(1);
