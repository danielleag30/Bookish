/**
 * Single entry point for a chart page.
 *
 * A chart page is now a thin shell: a title, a container, and one call. All
 * three series share this, replacing three separate implementations.
 */
import type { Series } from '../schema.ts';
import { mountChart, type ChartHandle } from './chart.ts';
import { CHART_CSS } from './chart.css.ts';
import { mountAskBox } from '../askbox.ts';
import { askReadingPosition, forgetPosition } from '../gate-prompt.ts';

export interface BootOptions {
  /** Series id — loads /data/<id>.json */
  series: string;
  /** Element to render into. Defaults to #chart. */
  container?: HTMLElement;
  /** Set false to skip the ask box. */
  askBox?: boolean;
}

export async function boot(opts: BootOptions): Promise<ChartHandle | null> {
  const container = opts.container ?? document.getElementById('chart');
  if (!container) {
    console.error('[chart] no container element');
    return null;
  }

  if (!document.getElementById('bkc-css')) {
    const style = document.createElement('style');
    style.id = 'bkc-css';
    style.textContent = CHART_CSS;
    document.head.appendChild(style);
  }

  let series: Series;
  try {
    const res = await fetch(`/data/${opts.series}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Validated by `npm run validate` in CI, so no Zod in the browser bundle.
    series = (await res.json()) as Series;
  } catch (err) {
    console.error('[chart] could not load series data:', err);
    container.textContent = 'Could not load chart data.';
    return null;
  }

  let askBox: Awaited<ReturnType<typeof mountAskBox>> = null;

  // A series theme, when present, wins over whatever the page's CSS set. This is
  // what makes a palette a reviewable data change rather than a CSS edit.
  if (series.theme) {
    const t = series.theme;
    // Set on :root as well as the chart container. The chart is not the only
    // themed surface — the page header and the ask box are chrome outside the
    // container, and while the vars lived only on the container those two
    // stayed gold no matter what the agent proposed, which made "the palette is
    // a data change" only two-thirds true.
    const set = (prop: string, v?: string) => {
      if (!v) return;
      container.style.setProperty(prop, v);
      document.documentElement.style.setProperty(prop, v);
    };
    set('--bkc-accent', t.accent);
    // Falls back to the built-in purple when a series has no counterpoint, so
    // the three original charts look exactly as they did.
    set('--bkc-accent2', t.accent2);
    set('--bkc-panel', t.panel);
    set('--bkc-line', t.line);
    if (t.ground) document.body.style.background = t.ground;
    if (t.display) container.style.setProperty('--bkc-display', t.display);
  }

  // Ask before drawing. The theme is applied above so the dialog wears the
  // series' own palette, and the chart mounts at the answered position rather
  // than rendering book one and correcting itself in front of the reader.
  const choice = await askReadingPosition({
    series: opts.series,
    title: series.title,
    books: series.books,
  });

  const handle = mountChart({
    container,
    series,
    // Moving the timeline invalidates any answer on screen immediately, rather
    // than waiting for the panel's own poll to notice.
    onBookChange: () => askBox?.reset(),
    // Selecting a character is the reader moving on, so an answer about someone
    // else should not stay open over the chart.
    onSelectionChange: () => askBox?.reset(),
    startAtBook: choice.book,
    onChangeReadThrough: () => {
      forgetPosition(opts.series);
      void askReadingPosition({
        series: opts.series,
        title: series.title,
        books: series.books,
        force: true,
      }).then((next) => handle.setBook(next.book));
    },
  });

  if (opts.askBox !== false) {
    // The ask box reads the chart's own reading position, so the panel and the
    // graph can never disagree about how far the reader has read.
    askBox = await mountAskBox({ series: opts.series, getBook: handle.getBook });
  }

  return handle;
}

declare global {
  interface Window { bookish?: { boot: typeof boot } }
}
window.bookish = { boot };

export { mountChart } from './chart.ts';
export type { ChartHandle } from './chart.ts';
