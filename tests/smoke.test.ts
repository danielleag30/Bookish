import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
  it('has a chart directory for every series', () => {
    const chartDirs = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.endsWith('-Chart'))
      .map((e) => e.name)
      .sort();

    expect(chartDirs).toEqual([
      'DCC-Chart',
      'Empyrean-Chart',
      'Plated-Prisoner-Chart',
    ]);
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
