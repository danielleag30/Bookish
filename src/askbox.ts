/**
 * The ask box — a spoiler-bounded sidebar panel for a chart page.
 *
 * All filtering happens in src/spoiler.ts. This file only renders; it never
 * reaches into the raw series data, so there is no second place for the gate to
 * be got wrong.
 *
 * Mounted by each chart page:
 *   mountAskBox({ series: 'empyrean', getBook: () => S.book })
 *
 * `getBook` binds the reading position to the chart's own book selector, so the
 * panel and the graph can never disagree about how far the reader has read.
 */
// Type-only import: the data is validated by `npm run validate` in CI, so
// re-running Zod in every visitor's browser would ship ~90 kB for nothing.
import type { Series } from './schema.ts';
import { ask, gate, mostConnected, findCharacters, type Answer } from './spoiler.ts';

export interface AskBoxHandle {
  /** Discard the current answer and collapse. */
  reset: () => void;
}

export interface AskBoxOptions {
  /** Series id — loads /data/<id>.json */
  series: string;
  /** Current reading position, read fresh on every query. */
  getBook: () => number;
  /** Where to mount. Defaults to document.body. */
  container?: HTMLElement;
}

const CSS = `
.bk-ask{position:fixed;right:14px;bottom:14px;width:340px;max-height:min(70vh,620px);
  display:flex;flex-direction:column;z-index:9000;font-family:'DM Sans',system-ui,sans-serif;
  background:rgba(16,12,28,.96);border:1px solid rgba(212,175,55,.35);border-radius:14px;
  box-shadow:0 18px 50px rgba(0,0,0,.55);color:#e8e6f0;overflow:hidden;
  backdrop-filter:blur(8px)}
.bk-ask.bk-collapsed{max-height:44px}
.bk-ask-hdr{display:flex;align-items:center;gap:8px;padding:11px 13px;cursor:pointer;
  background:linear-gradient(135deg,rgba(212,175,55,.16),rgba(155,89,208,.14));
  border-bottom:1px solid rgba(212,175,55,.22);flex:0 0 auto}
.bk-ask-hdr h3{margin:0;font-size:.83rem;font-weight:600;letter-spacing:.02em;flex:1;
  font-family:'Cinzel',serif;color:#f0d98a}
.bk-ask-pos{font-size:.66rem;color:#a49bba;white-space:nowrap}
.bk-ask-tog{font-size:.85rem;color:#a49bba;line-height:1}
.bk-ask-body{padding:11px 13px 13px;overflow-y:auto;flex:1 1 auto}
.bk-ask-form{display:flex;gap:6px}
.bk-ask-form input{flex:1;min-width:0;background:rgba(0,0,0,.35);color:#e8e6f0;
  border:1px solid rgba(212,175,55,.25);border-radius:8px;padding:7px 9px;font-size:.78rem;
  font-family:inherit}
.bk-ask-form input:focus{outline:none;border-color:rgba(212,175,55,.6)}
.bk-ask-form button{background:rgba(212,175,55,.2);color:#f0d98a;border:1px solid rgba(212,175,55,.4);
  border-radius:8px;padding:7px 11px;font-size:.78rem;cursor:pointer;font-family:inherit}
.bk-ask-form button:hover{background:rgba(212,175,55,.32)}
.bk-ask-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px}
.bk-ask-chips button{background:rgba(155,89,208,.14);border:1px solid rgba(155,89,208,.3);
  color:#c9bce0;border-radius:20px;padding:4px 10px;font-size:.68rem;cursor:pointer;
  font-family:inherit}
.bk-ask-chips button:hover{background:rgba(155,89,208,.26)}
.bk-ask-out{margin-top:12px;font-size:.76rem;line-height:1.55}
.bk-ask-head{font-weight:600;color:#f0d98a;margin-bottom:6px}
.bk-ask-line{padding:2px 0;color:#d5d0e0;white-space:pre-wrap;word-break:break-word}
.bk-ask-note{margin-top:9px;padding:6px 8px;font-size:.68rem;color:#a49bba;
  background:rgba(212,175,55,.07);border-left:2px solid rgba(212,175,55,.4);border-radius:4px}
.bk-ask-belief{color:#f0b86a}
.bk-ask-empty{color:#8b839c;font-style:italic}
`;

/** Turn a relationship type id into something that reads as a question. */
function phrase(type: string): string {
  switch (type) {
    case 'bonded': return 'bonded to';
    case 'family': return 'related to';
    case 'romantic': return 'involved with';
    case 'squad': return 'in a squad with';
    case 'friend': return 'friends with';
    case 'ally': return 'allied with';
    case 'enemy': return 'enemies with';
    case 'mentor': return 'mentoring';
    case 'killed': return 'killed by';
    case 'mated': return 'mated to';
    case 'captor': return 'the captor of';  // "captive" collides with the status word
    case 'commands': return 'commanding';
    case 'betrayer': return 'betrayed by';
    default: return `${type} with`;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const GENERIC_SUGGESTIONS = ['who is alive', 'who died'];

/** Titles are not names: "King Fulke" and "King Midas" both start with "King". */
const TITLE_WORDS = new Set([
  'king', 'queen', 'prince', 'princess', 'lord', 'lady', 'major', 'colonel',
  'general', 'gen', 'professor', 'prof', 'captain', 'capt', 'commandant',
  'commander', 'vice', 'sir', 'dame', 'the',
]);

/**
 * Shortest form of a name that still resolves back to this character.
 *
 * A chip has to round-trip: the question it writes must be parsed back to the
 * character it was written about. Taking the first word gave "who is King the
 * captor of", which is both a title and ambiguous between two kings, so the
 * answer came back about the wrong person.
 */
function shortName(
  label: string,
  id: string,
  resolve: (q: string) => { id: string }[],
): string {
  const parts = label.split(/[\s·/,]+/).filter(Boolean);
  for (const p of parts) {
    if (TITLE_WORDS.has(p.toLowerCase())) continue;
    const hits = resolve(p);
    if (hits.length > 0 && hits[0]?.id === id) return p;
  }
  return label;
}

export async function mountAskBox(opts: AskBoxOptions): Promise<AskBoxHandle | null> {
  let series: Series;
  try {
    const res = await fetch(`/data/${opts.series}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    series = (await res.json()) as Series;
  } catch (err) {
    // A broken panel must not take the chart down with it.
    console.error('[askbox] could not load series data:', err);
    return null;
  }

  if (!document.getElementById('bk-ask-css')) {
    const style = el('style');
    style.id = 'bk-ask-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const root = el('div', 'bk-ask bk-collapsed');
  const hdr = el('div', 'bk-ask-hdr');
  const title = el('h3', undefined, 'Ask about this chart');
  const pos = el('span', 'bk-ask-pos');
  const tog = el('span', 'bk-ask-tog', '▸');
  hdr.append(title, pos, tog);

  const body = el('div', 'bk-ask-body');
  const form = el('form', 'bk-ask-form');
  const input = el('input');
  input.type = 'text';
  input.placeholder = 'e.g. who is Violet bonded to';
  input.autocomplete = 'off';
  const go = el('button', undefined, 'Ask');
  go.type = 'submit';
  form.append(input, go);

  const chips = el('div', 'bk-ask-chips');
  const out = el('div', 'bk-ask-out');
  body.append(form, chips, out);
  root.append(hdr, body);
  (opts.container ?? document.body).appendChild(root);

  const bookLabel = (n: number) => {
    const b = series.books.find((x) => x.id === n);
    return b ? `Book ${b.id} · ${b.short}` : `Book ${n}`;
  };

  const refreshPos = () => {
    const g = gate(series, opts.getBook());
    pos.textContent = `as of ${bookLabel(g.position)}`;
  };

  const render = (a: Answer) => {
    out.replaceChildren();
    out.appendChild(el('div', 'bk-ask-head', a.headline));
    if (a.lines.length === 0) {
      out.appendChild(el('div', 'bk-ask-empty', 'Nothing to show.'));
    }
    for (const line of a.lines) {
      const d = el('div', 'bk-ask-line', line);
      if (line.includes('as far as you know')) d.classList.add('bk-ask-belief');
      out.appendChild(d);
    }
    if (a.gatedNote) out.appendChild(el('div', 'bk-ask-note', `🔒 ${a.gatedNote}`));
  };

  /**
   * Discard the answer.
   *
   * An answer is only true at the position it was computed for, so leaving one
   * on screen after the reader moves the timeline — or after they click a
   * character — is actively misleading. Clearing is safer than silently
   * recomputing, because the reader asked the question in a context that no
   * longer holds.
   */
  const reset = () => {
    out.replaceChildren();
    input.value = '';
    root.classList.add('bk-collapsed');
    tog.textContent = '▸';
  };

  const run = (q: string) => {
    if (!q.trim()) return;
    refreshPos();
    render(ask(series, opts.getBook(), q));
  };

  // Suggestion chips: two generic, plus the current book's headline character.
  const buildChips = () => {
    chips.replaceChildren();
    const g = gate(series, opts.getBook());
    // Most-connected rather than first-in-file: data order gave Lilith.
    const lead = mostConnected(g);
    const qs: string[] = [];

    if (lead) {
      const firstName = shortName(lead.label, lead.id, (q) => findCharacters(g, q));
      // Suggest the type this character actually has the most of. A hardcoded
      // "bonded" chip returned an empty answer on the DCC chart, which has no
      // `bonded` type at all.
      const counts = new Map<string, number>();
      for (const r of g.relationships) {
        if (r.from === lead.id || r.to === lead.id) {
          counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
        }
      }
      const topType = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (topType) qs.push(`who is ${firstName} ${phrase(topType)}`);
      qs.push(`what happened to ${firstName}`);
    }
    qs.push(...GENERIC_SUGGESTIONS);

    for (const q of qs.slice(0, 4)) {
      const b = el('button', undefined, q);
      b.type = 'button';
      b.onclick = () => { input.value = q; run(q); };
      chips.appendChild(b);
    }
  };

  form.onsubmit = (e) => { e.preventDefault(); run(input.value); };

  hdr.onclick = () => {
    const collapsed = root.classList.toggle('bk-collapsed');
    tog.textContent = collapsed ? '▸' : '▾';
    if (!collapsed) { refreshPos(); buildChips(); input.focus(); }
  };

  /**
   * Sit clear of the chart's own right-hand sidebar instead of covering it.
   * The sidebar is toggled by the chart, so its width is re-measured rather
   * than assumed. Falls back to the plain corner position when absent.
   */
  const avoidSidebar = () => {
    const sb = document.getElementById('sidebar');
    let offset = 14;
    if (sb) {
      const r = sb.getBoundingClientRect();
      const onScreen = r.width > 40 && r.right > window.innerWidth - r.width - 40;
      if (onScreen) offset = Math.round(r.width) + 22;
    }
    // Never push the panel off-screen on a narrow viewport.
    const max = Math.max(14, window.innerWidth - 360);
    root.style.right = `${Math.min(offset, max)}px`;
  };

  refreshPos();
  buildChips();
  avoidSidebar();

  // Keep the header honest as the chart changes around us, and drop any answer
  // that was computed for a different reading position.
  let last = opts.getBook();
  setInterval(() => {
    const now = opts.getBook();
    if (now !== last) {
      last = now;
      refreshPos();
      buildChips();
      out.replaceChildren();
    }
    avoidSidebar();
  }, 250);
  window.addEventListener('resize', avoidSidebar);

  // Any click outside the panel means the reader has moved on — a book button, a
  // filter chip, a character node. Fold the panel away rather than leaving a
  // stale answer open over the chart.
  document.addEventListener('click', (e) => {
    if (root.classList.contains('bk-collapsed')) return;
    if (root.contains(e.target as Node)) return;
    reset();
  });

  return { reset };
}

declare global {
  interface Window { mountAskBox?: typeof mountAskBox }
}
window.mountAskBox = mountAskBox;
