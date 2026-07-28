import { describe, it, expect } from 'vitest';
import { parseColor, contrastRatio, relativeLuminance } from '../src/contrast.ts';

describe('colour parsing', () => {
  it('handles the notations the data actually uses', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#d4af37')).toEqual([212, 175, 55]);
    expect(parseColor('#D4AF37')).toEqual([212, 175, 55]);
    expect(parseColor('rgba(16,12,28,.92)')).toEqual([16, 12, 28]);
    expect(parseColor('rgb(10, 10, 20)')).toEqual([10, 10, 20]);
    // 8-digit hex carries alpha, which contrast ignores.
    expect(parseColor('#d4af3722')).toEqual([212, 175, 55]);
  });

  it('returns null rather than guessing at prose', () => {
    for (const junk of ['burnt orange', '', 'gold-ish', '#gggggg', '#12']) {
      expect(parseColor(junk), junk).toBeNull();
    }
  });
});

describe('contrast ratio', () => {
  it('matches the WCAG anchors', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is symmetric — order of arguments cannot change the verdict', () => {
    expect(contrastRatio('#d4af37', '#0a0a14'))
      .toBeCloseTo(contrastRatio('#0a0a14', '#d4af37')!, 10);
  });

  it('is null when either side is unparseable', () => {
    expect(contrastRatio('nonsense', '#000')).toBeNull();
    expect(contrastRatio('#000', 'nonsense')).toBeNull();
  });

  it('rates black on near-black as unusable', () => {
    expect(contrastRatio('#333333', '#0a0a14')!).toBeLessThan(2);
  });
});

describe('relative luminance', () => {
  it('runs 0 to 1 across the range', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
  });

  it('weights green above red above blue, as the spec does', () => {
    const g = relativeLuminance([0, 255, 0]);
    const r = relativeLuminance([255, 0, 0]);
    const b = relativeLuminance([0, 0, 255]);
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
  });
});
