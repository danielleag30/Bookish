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

  const handle = mountChart({
    container,
    series,
    // Moving the timeline invalidates any answer on screen immediately, rather
    // than waiting for the panel's own poll to notice.
    onBookChange: () => askBox?.reset(),
    // Selecting a character is the reader moving on, so an answer about someone
    // else should not stay open over the chart.
    onSelectionChange: () => askBox?.reset(),
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
