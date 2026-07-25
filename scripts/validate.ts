/**
 * Validates every series data file in `data/`.
 *
 * Phase 0: checks the files exist and parse as JSON.
 * Phase 1: will parse each file through the Zod series schema and run
 *          referential-integrity checks (dangling relationship endpoints,
 *          unknown bands/affiliations, book <= lastBook, duplicate ids).
 *
 * Exits non-zero on any failure so CI fails loudly.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dataDir = join(root, 'data');

const errors: string[] = [];

if (!existsSync(dataDir)) {
  console.log('No data/ directory yet — nothing to validate.');
  console.log('Phase 1 extracts the inline chart data into data/*.json.');
  process.exit(0);
}

const files = readdirSync(dataDir).filter((f) => f.endsWith('.json'));

if (files.length === 0) {
  console.log('data/ exists but holds no .json files yet — nothing to validate.');
  console.log('Phase 1 extracts the inline chart data into data/*.json.');
  process.exit(0);
}

for (const file of files) {
  const path = join(dataDir, file);
  try {
    JSON.parse(readFileSync(path, 'utf8'));
    console.log(`  ✓ ${file} — parses as JSON`);
  } catch (err) {
    errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (errors.length > 0) {
  console.error(`\n${errors.length} file(s) failed validation:\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log(`\n${files.length} data file(s) validated.`);
