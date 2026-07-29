/**
 * Assemble the public site into dist/.
 *
 * WHY THIS EXISTS
 * `vercel.json` used to set `outputDirectory: "."`, which publishes the whole
 * repository. That put `sources/` online — the three original hand-built charts
 * with the full cast and every reveal inline and no spoiler gate at all. A
 * reader who found /sources/Empyrean-Chart.html got the ending of a series the
 * live chart is built to withhold.
 *
 * A `.vercelignore` cannot fix that. It withholds files from the deployment
 * entirely, including from the build, and the build needs `src/`, the vite
 * config and `package.json` — excluding them just breaks the deploy, which is
 * exactly what the first attempt did.
 *
 * So the site gets a real output directory, and this copies into it. The list
 * below is an allowlist: a new top-level directory is not published until
 * someone adds it here, which is the safe default for a project whose whole
 * point is not showing people things.
 */
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');

/** Everything the live site needs, and nothing else. */
const ALLOW = [
  'index.html',
  'images',
  'chart',       // built by build:chart, gitignored
  'data',        // fetched at runtime; safe because gate() withholds at read time
  'how-it-works',
];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const copied: string[] = [];
const missing: string[] = [];

for (const entry of ALLOW) {
  const from = join(root, entry);
  if (!existsSync(from)) {
    missing.push(entry);
    continue;
  }
  cpSync(from, join(dist, entry), { recursive: true });
  copied.push(entry);
}

// Chart pages are discovered rather than listed, so adding a series does not
// mean remembering to edit this file — the failure mode there is a live landing
// page linking to a 404.
for (const entry of readdirSync(root)) {
  if (!entry.endsWith('-Chart')) continue;
  if (!statSync(join(root, entry)).isDirectory()) continue;
  cpSync(join(root, entry), join(dist, entry), { recursive: true });
  copied.push(entry);
}

if (missing.length) {
  console.error(`missing, not copied: ${missing.join(', ')}`);
  // chart/ is built in the step before this one; anything else missing is a
  // broken deploy, not a warning.
  if (missing.some((m) => m !== 'chart')) process.exit(1);
}

console.log(`dist/ ← ${copied.join(' · ')}`);
