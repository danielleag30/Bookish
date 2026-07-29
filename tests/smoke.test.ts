import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Phase 0 smoke tests.
 *
 * These exist to prove the test loop actually runs in CI. They assert real
 * facts about the repo rather than `expect(true).toBe(true)`, so a broken
 * toolchain and a broken repo both surface here.
 *
 * Phase 1 replaces the interesting assertions with schema validation.
 */

const root = resolve(import.meta.dirname, '..');

describe('toolchain', () => {
  it('runs TypeScript with strict null checks in scope', () => {
    // If `strict` were off, `maybe` would be typed `string` and the
    // narrowing below would be dead code that tsc flags.
    const maybe: string | undefined = ['a'][1];
    expect(maybe).toBeUndefined();
  });
});

describe('repo layout', () => {
  // Derived from data/, not hardcoded: the invariant is "no series without a
  // page to render it on", which is what the test name has always claimed.
  // Case-insensitive because DCC-Chart is an acronym, not title case.
  it('has a chart directory for every series', () => {
    const charted = new Set(
      readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.endsWith('-Chart'))
        .map((e) => e.name.replace(/-Chart$/, '').toLowerCase()),
    );

    const slugs = readdirSync(join(root, 'data'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));

    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(charted, `data/${slug}.json has no chart directory`).toContain(slug);
    }
  });

  it('every chart directory has an index.html entry point', () => {
    const chartDirs = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.endsWith('-Chart'))
      .map((e) => e.name);

    for (const dir of chartDirs) {
      expect(
        existsSync(resolve(root, dir, 'index.html')),
        `${dir} is missing index.html`,
      ).toBe(true);
    }
  });

  it('is licensed', () => {
    expect(existsSync(resolve(root, 'LICENSE'))).toBe(true);
  });
});

/**
 * Deploy hygiene.
 *
 * `vercel.json` used to publish the repository root, so anything not excluded
 * shipped. `sources/` holds the three original charts with every reveal inline
 * and no spoiler gate — they were live at /sources/Empyrean-Chart.html while the
 * whole project existed to withhold exactly that.
 *
 * The first attempt at a fix was a `.vercelignore`, which broke the deploy
 * outright: it withholds files from the build too, and the build needs `src/`,
 * the vite config and `package.json`. Hence a real output directory, with an
 * allowlist — the default is that nothing is published.
 */
describe('what gets deployed', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
    outputDirectory?: string;
    buildCommand?: string;
  };

  it('publishes a build directory, not the repository root', () => {
    expect(cfg.outputDirectory, 'publishing "." serves sources/, src/, tests/ …').toBeTruthy();
    expect(cfg.outputDirectory).not.toBe('.');
  });

  it('the site builder allowlists what ships, rather than excluding what does not', () => {
    const builder = readFileSync(join(root, 'scripts', 'build-site.ts'), 'utf8');
    const allow = /const ALLOW = \[([\s\S]*?)\]/.exec(builder)?.[1] ?? '';
    const entries = [...allow.matchAll(/'([^']+)'/g)].map((m) => m[1]);

    // The site cannot work without these.
    for (const needed of ['index.html', 'images', 'chart', 'data']) {
      expect(entries, `${needed} is required by the site`).toContain(needed);
    }
    // And these must never be in the list.
    for (const secret of ['sources', 'src', 'tests', 'scripts', 'pipeline', 'evals', 'mcp']) {
      expect(entries, `${secret} would be published`).not.toContain(secret);
    }
  });

  it('builds every chart directory rather than a hardcoded list', () => {
    // A series added without editing the builder would leave the landing page
    // linking at a 404.
    const builder = readFileSync(join(root, 'scripts', 'build-site.ts'), 'utf8');
    expect(builder).toMatch(/endsWith\('-Chart'\)/);
  });
});

/**
 * The architecture page has to describe the code that exists.
 *
 * Several structural changes shipped without it being touched — perceived-state
 * resolution moving into `gate()`, the corrections file, the dist/ build step —
 * so it described a pipeline the code no longer had. A confidently wrong
 * architecture page is worse than no page.
 *
 * These are shallow checks by design: they cannot verify the prose is *right*,
 * only that every load-bearing piece of the flow is named. If you add a stage
 * and CI fails here, the page needs a paragraph, not a workaround.
 */
describe('how-it-works tracks the code', () => {
  const page = readFileSync(join(root, 'how-it-works', 'index.html'), 'utf8');

  it('has a mermaid diagram of the data flow', () => {
    expect(page).toMatch(/class="mermaid"/);
    expect(page).toMatch(/flowchart/);
  });

  it('names every stage the data actually passes through', () => {
    for (const stage of [
      'extractor',       // pipeline/multiagent.ts
      'verifier',
      'resolver',
      'corrections',     // pipeline/input/*.corrections.json
      'theme agent',     // scripts/propose-theme.ts
      'checkIntegrity',  // src/schema.ts
      'gate(',           // src/spoiler.ts — the one rule
      'build-site',      // scripts/build-site.ts
    ]) {
      expect(page, `the flow diagram does not mention ${stage}`).toContain(stage);
    }
  });

  it('names each surface that reads through the gate', () => {
    for (const surface of ['chart renderer', 'ask box', 'MCP server', 'eval runner']) {
      expect(page, `${surface} reads through gate() but is not on the page`).toContain(surface);
    }
  });
});
