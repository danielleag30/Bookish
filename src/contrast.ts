/**
 * WCAG contrast, so a proposed palette cannot be illegible.
 *
 * A model asked for colours will happily return a combination nobody can read.
 * Validating contrast is what makes the theme agent safe to let loose: it can
 * propose whatever it likes, and anything unreadable is rejected before a human
 * ever has to notice.
 */

/** Parse #rgb, #rrggbb or rgba(...) into 0-255 channels. Null if unparseable. */
export function parseColor(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
    else h = h.slice(0, 6);
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  return null;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 to 21. Returns null if either colour is unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The floor a theme must clear.
 *
 * 4.5 is WCAG AA for body text, but the accent here is used for headings and
 * chart labels at larger sizes, where AA large text is 3.0. Requiring 4.5 for a
 * decorative accent would reject most of the palettes that actually suit these
 * books, so 3.5 is the compromise: comfortably above AA large, short of AA body.
 */
export const MIN_ACCENT_CONTRAST = 3.5;
