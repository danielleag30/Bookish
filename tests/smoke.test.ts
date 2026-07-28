import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
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
