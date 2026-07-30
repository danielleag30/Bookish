/**
 * The gate — asks how far you have read, before the chart draws anything.
 *
 * WHY IT BLOCKS
 * Every other spoiler control in this project is a filter you apply to
 * something already on screen. This one runs first, because the honest default
 * for "how far has this reader got" does not exist: showing book one to someone
 * who has finished the series is useless, and showing the finale to someone on
 * book one is the exact harm the whole project is built to prevent. Asking is
 * the only answer that is right for both.
 *
 * WHAT IT ASKS
 * "Which book have you finished?" — not "which are you reading". A reader
 * halfway through book three has finished book two, and book two is what is
 * safe to show them. Phrasing it as *completed* is what makes the answer usable
 * without further interpretation.
 *
 * WHAT IT REMEMBERS
 * The answer, per series, in localStorage. Being asked the same question on
 * every visit is a toll, not a feature — so it asks once and then trusts you.
 * Changing position afterwards is the book bar, which is manual and always
 * visible, and the panel header states the current position at all times.
 *
 * IF IT IS DISMISSED
 * Book one. Not "everything": a reader who closes a dialog has told you nothing
 * about what they have read, and the safe reading of nothing is the beginning.
 */

export interface GateChoice {
  /** The book they have finished — this becomes the reading position. */
  book: number;
  /** True when it came from a previous visit rather than being asked now. */
  remembered: boolean;
}

export interface GateBook {
  id: number;
  title: string;
  short: string;
  /** Announced but unreleased — cannot be a reading position. */
  future?: boolean;
}

const KEY = (series: string) => `bookish:read-through:${series}`;

const CSS = `
.bkg-veil{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;
  justify-content:center;padding:20px;background:rgba(6,4,12,.82);
  backdrop-filter:blur(6px);font-family:'DM Sans',system-ui,sans-serif}
.bkg{max-width:440px;width:100%;background:rgba(18,14,30,.97);color:#e8e6f0;
  border:1px solid color-mix(in srgb,var(--bkc-accent,#d4af37) 35%,transparent);
  border-radius:16px;padding:24px 22px 20px;
  box-shadow:0 24px 70px rgba(0,0,0,.6);max-height:88vh;overflow-y:auto}
.bkg h2{margin:0 0 6px;font-family:var(--bkc-display,'Cinzel',serif);
  font-size:1.15rem;font-weight:600;color:var(--bkc-accent,#f0d98a)}
.bkg p{margin:0 0 16px;font-size:.82rem;line-height:1.55;color:#a49bba}
.bkg-list{display:flex;flex-direction:column;gap:7px}
.bkg-list button{display:flex;align-items:baseline;gap:9px;width:100%;
  text-align:left;background:rgba(0,0,0,.3);color:#e8e6f0;font:inherit;
  font-size:.85rem;padding:11px 13px;border-radius:10px;cursor:pointer;
  border:1px solid color-mix(in srgb,var(--bkc-accent,#d4af37) 22%,transparent)}
.bkg-list button:hover,.bkg-list button:focus-visible{
  border-color:color-mix(in srgb,var(--bkc-accent,#d4af37) 65%,transparent);
  background:color-mix(in srgb,var(--bkc-accent,#d4af37) 12%,transparent);outline:none}
.bkg-n{font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;
  color:#8b839c;min-width:44px}
.bkg-skip{margin-top:14px;width:100%;background:none;border:none;
  color:#8b839c;font:inherit;font-size:.72rem;cursor:pointer;padding:6px;
  text-decoration:underline;text-underline-offset:3px}
.bkg-skip:hover{color:#e8e6f0}
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** What was stored for this series, if anything and if it is still valid. */
export function rememberedPosition(series: string, books: GateBook[]): number | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY(series));
  } catch {
    return null; // private browsing, storage disabled — just ask.
  }
  if (raw === null) return null;
  const n = Number(raw);
  // A stored value that is no longer a real book — because a book was added,
  // removed or unpublished since — is not trusted. Asking again is cheap.
  return books.some((b) => b.id === n && !b.future) ? n : null;
}

export function rememberPosition(series: string, book: number): void {
  try {
    localStorage.setItem(KEY(series), String(book));
  } catch {
    /* nothing to do; the session still works, it just will not persist */
  }
}

export function forgetPosition(series: string): void {
  try {
    localStorage.removeItem(KEY(series));
  } catch { /* as above */ }
}

/**
 * Resolve a reading position, asking only if there is nothing remembered.
 *
 * Resolves after the reader answers, so the caller can await it and draw the
 * chart at the right position rather than drawing book one and correcting.
 */
export function askReadingPosition(opts: {
  series: string;
  title: string;
  books: GateBook[];
  /** Force the dialog even if an answer is stored. */
  force?: boolean;
}): Promise<GateChoice> {
  const published = opts.books.filter((b) => !b.future);
  const first = Math.min(...published.map((b) => b.id));

  if (!opts.force) {
    const known = rememberedPosition(opts.series, opts.books);
    if (known !== null) return Promise.resolve({ book: known, remembered: true });
  }
  if (published.length <= 1) {
    return Promise.resolve({ book: first, remembered: false });
  }

  return new Promise<GateChoice>((resolve) => {
    if (!document.getElementById('bkg-css')) {
      const style = el('style');
      style.id = 'bkg-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const veil = el('div', 'bkg-veil');
    const box = el('div', 'bkg');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'bkg-title');

    const h = el('h2', undefined, `Where are you in ${opts.title}?`);
    h.id = 'bkg-title';
    box.appendChild(h);
    box.appendChild(
      el('p', undefined,
        'Pick the last book you finished. The chart will show only what you have ' +
        'read — characters, relationships and events after that point stay hidden ' +
        'until you move the timeline yourself.'),
    );

    const done = (book: number, remembered: boolean) => {
      document.removeEventListener('keydown', onKey);
      veil.remove();
      resolve({ book, remembered });
    };

    const list = el('div', 'bkg-list');
    for (const b of published) {
      const btn = el('button');
      btn.type = 'button';
      btn.append(
        el('span', 'bkg-n', `Book ${b.id}`),
        el('span', undefined, b.title),
      );
      btn.onclick = () => {
        rememberPosition(opts.series, b.id);
        done(b.id, false);
      };
      list.appendChild(btn);
    }
    box.appendChild(list);

    // Dismissing is not "show me everything" — see the module comment.
    const skip = el('button', 'bkg-skip', 'I have not started — show me book one only');
    skip.type = 'button';
    skip.onclick = () => done(first, false);
    box.appendChild(skip);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(first, false);
    };
    document.addEventListener('keydown', onKey);
    veil.onclick = (e) => { if (e.target === veil) done(first, false); };

    veil.appendChild(box);
    document.body.appendChild(veil);
    (list.firstElementChild as HTMLButtonElement | null)?.focus();
  });
}
