/**
 * Propose a series' palette from its cover.
 *
 *   npm run theme -- --slug dcc --image images/dcc.png
 *   npm run theme -- --slug dcc --image images/dcc.png --write
 *
 * WHY THE COVER
 * The cover is the series' existing visual identity — someone already decided
 * what it looks like, and a chart that clashes with it feels like a different
 * product. Reading the cover means the agent is matching a decision rather than
 * inventing one.
 *
 * WHY THIS IS SAFE TO LET RUN
 * A model asked for colours will happily return something nobody can read. Every
 * proposal is checked for WCAG contrast before it is shown, and a palette that
 * fails is rejected with the numbers rather than quietly shipped. The agent can
 * propose anything; only legible proposals survive.
 *
 * `mood` is required, and it is the point. A palette with no stated intent is
 * unreviewable — you cannot argue with #e87840, but you can argue with "warning
 * -label orange, a dungeon lit by emergency lighting".
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SeriesSchema, type Theme } from '../src/schema.ts';
import { contrastRatio, MIN_ACCENT_CONTRAST } from '../src/contrast.ts';
import { call, available, DEFAULT_MODEL } from '../pipeline/ollama.ts';

const root = resolve(import.meta.dirname, '..');
const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const has = (f: string) => process.argv.includes(`--${f}`);

const slug = arg('slug');
if (!slug) {
  console.error('usage: npm run theme -- --slug <series> [--image <path>] [--steer "<direction>"] [--write]');
  process.exit(1);
}
const model = arg('model', DEFAULT_MODEL)!;

const dataPath = join(root, 'data', `${slug}.json`);
const hasData = existsSync(dataPath);
const series = hasData
  ? SeriesSchema.parse(JSON.parse(readFileSync(dataPath, 'utf8')))
  : null;

// Find the cover: given, or guessed from the slug.
const guesses = [
  arg('image'),
  `images/${slug}.png`,
  `images/${slug.replace(/-/g, '_')}.png`,
  `images/${slug.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('')}.png`,
].filter(Boolean) as string[];
const imagePath = guesses.map((g) => join(root, g)).find((p) => existsSync(p));
if (!imagePath) {
  console.error(`No cover image found. Tried:\n${guesses.map((g) => `  ${g}`).join('\n')}`);
  process.exit(1);
}

if (!(await available())) {
  console.error('No local Ollama on :11434. Start it with `ollama serve`.');
  process.exit(1);
}

const title = series?.title ?? slug;
console.log(`${title}\ncover ${imagePath.replace(root + '/', '')}\nmodel ${model}\n`);

// A human steer. The agent still chooses the hexes and still has to clear the
// contrast floor — the steer only says what the palette is *about*. A reader who
// knows the series knows things the cover does not show.
const steer = arg('steer');

// Named, so the agent colours the real places rather than inventing a palette
// in the abstract. This is the difference between a theme and a decoration.
const regionList = (series?.regions ?? [])
  .map((r) => `  ${r.id} — ${r.label}`)
  .join('\n') || '  (none)';
const factionList = Object.entries(series?.affiliations ?? {})
  .map(([id, a]) => `  ${id} — ${a.label}`)
  .join('\n') || '  (none)';

const THEME_SCHEMA = {
  type: 'object',
  properties: {
    accent: { type: 'string', description: 'Hex like #d4af37. Headings and highlights. Must read clearly on the ground.' },
    ground: { type: 'string', description: 'Hex. Page background. Dark — these charts are dark.' },
    panel: { type: 'string', description: 'Hex. Slightly lighter than the ground, for side panels.' },
    line: { type: 'string', description: 'Hex. Borders. Close to the accent but much dimmer.' },
    accent2: { type: 'string', description: 'Hex. A counterpoint accent, only when the series is built on an opposition (ice vs fire). Must also read on the ground.' },
    mood: { type: 'string', description: 'One sentence on why these colours suit this series. Concrete, not marketing.' },
    regionColors: {
      type: 'array',
      description: 'One entry per region listed in the prompt, using the same ids.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          color: { type: 'string', description: 'Hex. A dark, desaturated wash for the region background.' },
          border: { type: 'string', description: 'Hex. Brighter than color, still muted.' },
        },
        required: ['id', 'color', 'border'],
      },
    },
    factionColors: {
      type: 'array',
      description: 'One entry per faction listed in the prompt, using the same ids.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          color: { type: 'string', description: 'Hex. Node fill. Must read against the ground.' },
          border: { type: 'string', description: 'Hex. Node stroke, brighter than color.' },
        },
        required: ['id', 'color', 'border'],
      },
    },
  },
  // Constrained decoding is the only reliable lever here: asked politely for a
  // counterpoint accent the model simply omitted it, because optional fields in
  // a JSON schema are genuinely optional. A steer means a human asked for
  // something specific, so accent2 becomes required and the decoder must fill it.
  required: [
    'accent', 'ground', 'panel', 'line', 'mood', 'regionColors', 'factionColors',
    ...(steer ? ['accent2'] : []),
  ],
};

const prompt = `This is the cover of "${title}", a fantasy series.

Choose a dark colour palette for an interactive character chart of this series,
drawn from the cover so the chart and the book feel like the same thing.

Requirements:
- ground must be very dark, near-black, but tinted toward the cover's own hues
- accent must be clearly readable against ground — aim for high contrast
- panel is a little lighter than ground
- line is close to accent but much dimmer
- mood: one concrete sentence about why this palette suits THIS series

This chart draws the places and the sides. Give each one its own colour, drawn
from the same palette, so the chart reads as a map of this world rather than a
grid of identical grey boxes. Where a place is described by an element — a
frozen realm, a desert city, a vampire court — let its colour say so.

Regions (use these exact ids):
${regionList}

Factions (use these exact ids):
${factionList}
${steer ? `
The person who has read this series asks for this specifically:
  "${steer}"
Follow it. Where it conflicts with the cover, the steer wins — they have read
the books and the cover only shows book one. If the steer describes an
opposition of two things, set accent to the first and accent2 to the second.
` : '- omit accent2 unless the series is genuinely built on an opposition'}
Return hex codes.`;

const image = readFileSync(imagePath).toString('base64');
const started = Date.now();
interface Swatch { id: string; color: string; border: string }
const res = await call<
  Theme & {
    accent: string; ground: string; panel: string; line: string; mood: string;
    regionColors?: Swatch[]; factionColors?: Swatch[];
  }
>(
  prompt, { model, format: THEME_SCHEMA, images: [image], timeoutMs: 420_000 },
);
const t = res.value;

// ── Check it before showing it ─────────────────────────────────────────────
const problems: string[] = [];
for (const [k, v] of Object.entries({ accent: t.accent, ground: t.ground, panel: t.panel, line: t.line })) {
  if (contrastRatio(v, '#ffffff') === null) problems.push(`${k} is not a colour: ${JSON.stringify(v)}`);
}
const accentOnGround = contrastRatio(t.accent, t.ground);
// accent2 is decoration only if it is legible; an unreadable counterpoint is
// worse than none, so it clears the same floor or it is dropped.
const accent2OnGround = t.accent2 ? contrastRatio(t.accent2, t.ground) : null;
if (t.accent2 && (accent2OnGround === null || accent2OnGround < MIN_ACCENT_CONTRAST)) {
  console.warn(
    `  accent2 ${t.accent2} is ${accent2OnGround?.toFixed(2) ?? '?'}:1 on the ground — below the ` +
      `${MIN_ACCENT_CONTRAST}:1 floor, dropping it.`,
  );
  delete (t as { accent2?: string }).accent2;
}

if (accentOnGround !== null && accentOnGround < MIN_ACCENT_CONTRAST) {
  problems.push(
    `accent on ground is ${accentOnGround.toFixed(2)}:1, below the ${MIN_ACCENT_CONTRAST}:1 floor — unreadable`,
  );
}
if ((t.mood ?? '').trim().length < 30) {
  problems.push('mood is too short to be a reason');
}

console.log(`  accent  ${t.accent}`);
if (t.accent2) console.log(`  accent2 ${t.accent2}`);
console.log(`  ground  ${t.ground}`);
console.log(`  panel   ${t.panel}`);
console.log(`  line    ${t.line}`);
console.log(`  mood    ${t.mood}`);
console.log(`\n  contrast accent-on-ground: ${accentOnGround?.toFixed(2) ?? '?'}:1  (floor ${MIN_ACCENT_CONTRAST}:1)`);
if (t.accent2) console.log(`  contrast accent2-on-ground: ${accent2OnGround?.toFixed(2) ?? '?'}:1`);
console.log(`  ${((Date.now() - started) / 1000).toFixed(0)}s · $0`);

if (problems.length) {
  console.error(`\nRejected:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`\nNothing written. Re-run to get another proposal.`);
  process.exit(1);
}

if (!has('write')) {
  console.log(`\nProposal only. Re-run with --write to put it in data/${slug}.json.`);
  process.exit(0);
}
if (!series) {
  console.error(`\nNo data/${slug}.json yet — build the series first, then --write.`);
  process.exit(1);
}

// The per-region and per-faction palettes belong on the regions and
// affiliations themselves, not in `theme` — that is where the chart engine
// already looks, so no rendering code has to learn about a second source.
const regionPalette = new Map((t.regionColors ?? []).map((r) => [r.id, r]));
const factionPalette = new Map((t.factionColors ?? []).map((f) => [f.id, f]));
let painted = 0;

const regions = series.regions.map((r) => {
  const c = regionPalette.get(r.id);
  if (!c || contrastRatio(c.color, t.ground) === null) return r;
  painted++;
  return { ...r, color: c.color, border: c.border };
});

const affiliations = Object.fromEntries(
  Object.entries(series.affiliations).map(([id, a]) => {
    const c = factionPalette.get(id);
    // A node fill has to be distinguishable from the background it sits on, or
    // the character disappears. 1.6:1 is low, but these are large filled discs
    // with a brighter stroke, not text.
    const ratio = c ? contrastRatio(c.color, t.ground) : null;
    if (!c || ratio === null || ratio < 1.6) return [id, a];
    painted++;
    return [id, { ...a, color: c.color, border: c.border }];
  }),
);

// Strip the proposal arrays back out; they were the transport, not the data.
const { regionColors: _rc, factionColors: _fc, ...themeOnly } = t;

const updated = {
  ...series,
  regions,
  affiliations,
  theme: { ...themeOnly, display: series.theme?.display ?? "'Cinzel', serif" },
};
console.log(`  painted ${painted} region(s) and faction(s)`);
SeriesSchema.parse(updated);
writeFileSync(dataPath, JSON.stringify(updated, null, 2) + '\n');
console.log(`\nwrote the theme into data/${slug}.json`);
