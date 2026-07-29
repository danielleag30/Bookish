/**
 * The chart renderer.
 *
 * One implementation for every series, replacing three hand-written ones.
 * Empyrean and DCC shared twelve identically-named functions by copy-paste
 * (mk, getRC, getRD, curvePath, renderCtrl, bookBtn, renderRelBar, renderSVG,
 * renderLegend, applySidebar, renderSidebar, render) and Plated Prisoner was a
 * separate React implementation of the same idea.
 *
 * Rendering is a full rebuild from state on every change — no diffing. At a few
 * dozen nodes that is fast, and it keeps the drawing code readable: what you see
 * is a direct function of the state object.
 */
import type { Series, Character } from '../schema.ts';
import { present } from '../spoiler.ts';
import { nodeShape, edgePath, edgeMidpoint, trimToRim } from './shapes.ts';
import { buildView, initialState, toggle, type ChartState, type ChartView } from './view.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export interface ChartHandle {
  /** Current reading position — the ask box binds to this. */
  getBook: () => number;
  setBook: (book: number) => void;
  destroy: () => void;
}

export interface MountOptions {
  container: HTMLElement;
  series: Series;
  /** Called whenever the reading position changes. */
  onBookChange?: (book: number) => void;
  /**
   * Called whenever the selection changes, including when it is cleared.
   * Node clicks stopPropagation so the canvas handler does not immediately
   * deselect, which means they never reach a document-level listener — so
   * anything that needs to know is told directly.
   */
  onSelectionChange?: (id: string | null) => void;
}

export function mountChart(opts: MountOptions): ChartHandle {
  const { container, series } = opts;
  let state: ChartState = initialState(series);

  container.classList.add('bkc');
  container.replaceChildren();

  // ── Chrome ───────────────────────────────────────────────────────────────
  const controls = el('div', 'bkc-controls');
  const bookRow = el('div', 'bkc-books');
  const layerRow = el('div', 'bkc-layers');
  const relRow = el('div', 'bkc-rels');
  controls.append(bookRow, layerRow, relRow);

  const stage = el('div', 'bkc-stage');
  const svgEl = svg('svg', { class: 'bkc-svg' });
  stage.appendChild(svgEl);

  const sidebar = el('aside', 'bkc-sidebar');
  const legend = el('div', 'bkc-legend');

  container.append(controls, stage, sidebar, legend);

  const relColor = (type: string) =>
    series.relationshipTypes.find((t) => t.id === type)?.color ?? '#7a7a8a';
  const relDash = (type: string) =>
    series.relationshipTypes.find((t) => t.id === type)?.dash ?? null;
  const affilOf = (c: Character) => series.affiliations[c.affil];
  const shapeOf = (c: Character) =>
    (c.type ? series.characterTypes?.[c.type]?.shape : undefined) ?? 'circle';

  // ── Render ───────────────────────────────────────────────────────────────
  function renderBooks() {
    bookRow.replaceChildren();
    for (const b of series.books) {
      const btn = el('button', 'bkc-book', `Book ${b.id} · ${b.short}`);
      if (b.id === state.book) btn.classList.add('on');
      if (b.future) btn.classList.add('future');
      btn.title = [b.era, b.dominant, b.year].filter(Boolean).join(' · ');
      btn.onclick = () => setBook(b.id);
      bookRow.appendChild(btn);
    }
  }

  function chip(label: string, on: boolean, onClick: () => void, color?: string) {
    const b = el('button', 'bkc-chip', label);
    if (on) b.classList.add('on');
    if (color) b.style.borderColor = color;
    b.onclick = onClick;
    return b;
  }

  function renderLayers() {
    layerRow.replaceChildren();
    const types = Object.entries(series.characterTypes ?? {});
    for (const [id, t] of types) {
      layerRow.appendChild(chip(t.label, state.filters.charTypes.has(id), () => {
        state.filters.charTypes = toggle(state.filters.charTypes, id);
        render();
      }));
    }
    for (const [id, a] of Object.entries(series.affiliations)) {
      layerRow.appendChild(chip(
        `${a.emoji ?? ''} ${a.label}`.trim(),
        state.filters.affils.has(id),
        () => { state.filters.affils = toggle(state.filters.affils, id); render(); },
        a.border ?? a.color,
      ));
    }
    layerRow.appendChild(chip('Regions', state.showRegions, () => {
      state.showRegions = !state.showRegions; render();
    }));
    layerRow.appendChild(chip('Names', state.showLabels, () => {
      state.showLabels = !state.showLabels; render();
    }));
    layerRow.appendChild(chip('Edge labels', state.showEdgeLabels, () => {
      state.showEdgeLabels = !state.showEdgeLabels; render();
    }));
  }

  function renderRelBar() {
    relRow.replaceChildren();
    const all = series.relationshipTypes;
    relRow.appendChild(chip('All', state.filters.relTypes.size === all.length, () => {
      state.filters.relTypes = new Set(all.map((t) => t.id)); render();
    }));
    relRow.appendChild(chip('None', state.filters.relTypes.size === 0, () => {
      state.filters.relTypes = new Set(); render();
    }));
    for (const t of all) {
      relRow.appendChild(chip(t.label, state.filters.relTypes.has(t.id), () => {
        state.filters.relTypes = toggle(state.filters.relTypes, t.id); render();
      }, t.color));
    }
  }

  function renderSvg(view: ChartView) {
    svgEl.replaceChildren();
    const { w, h } = view.extent;
    svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMin meet');

    const root = svg('g', {
      transform: `translate(${state.pan.x} ${state.pan.y}) scale(${state.scale})`,
    });
    svgEl.appendChild(root);

    // Regions first, so everything draws over them.
    if (state.showRegions) {
      for (const r of view.regions) {
        const g = svg('g', { class: 'bkc-region' });
        // A region is a backdrop, not a block of colour. Painted at full
        // opacity, a saturated region colour swamps the nodes sitting on it —
        // Zilvaren rendered as a solid orange slab. The fill is a wash and the
        // border carries the identity, which is how a map reads.
        g.appendChild(svg('rect', {
          x: r.x ?? 0, y: r.y, width: r.w ?? w, height: r.h, rx: 10,
          fill: r.color ?? '#ffffff',
          'fill-opacity': r.color ? 0.14 : 0.03,
          stroke: r.border ?? '#ffffff',
          'stroke-opacity': r.border ? 0.45 : 0.08,
          'stroke-width': 1.5,
        }));
        const t = svg('text', {
          x: (r.x ?? 0) + 12, y: r.y + 20, class: 'bkc-region-label',
        });
        // Fit the label to the box. Plated Prisoner has five narrow kingdoms in
        // a row, and appending `power` to each made their labels bleed across
        // one another. Roughly 7px per character at this size and spacing.
        const boxW = (r.w ?? w) - 24;
        const fits = Math.max(6, Math.floor(boxW / 7));
        const full = r.power ? `${r.label} — ${r.power}` : r.label;
        t.textContent = full.length <= fits
          ? full
          : r.label.length <= fits
            ? r.label
            : `${r.label.slice(0, Math.max(1, fits - 1))}…`;
        if (full.length > fits) {
          const tip = svg('title');
          tip.textContent = full;
          t.appendChild(tip);
        }
        g.appendChild(t);
        root.appendChild(g);
      }
    }

    // Edges.
    const edgeLayer = svg('g', { class: 'bkc-edges' });
    let labelSlot = 0;
    for (const e of view.edges) {
      const [x1, y1, x2, y2] = trimToRim(
        e.from.x, e.from.y, e.to.x, e.to.y, e.from.r + 3, e.to.r + 3,
      );
      const path = svg('path', {
        d: edgePath(x1, y1, x2, y2),
        fill: 'none',
        stroke: relColor(e.relationship.type),
        'stroke-width': 2,
        opacity: 0.75,
      });
      const dash = relDash(e.relationship.type);
      if (dash) path.setAttribute('stroke-dasharray', dash);
      edgeLayer.appendChild(path);

      if (state.showEdgeLabels && e.relationship.label) {
        // Every label used to sit at the exact midpoint, so edges sharing a
        // node stacked their text in the same place and became unreadable.
        // Sliding alternate labels off-centre separates them for the common
        // case of a hub character with several edges.
        const slide = [0.5, 0.35, 0.65, 0.42, 0.58][labelSlot % 5] ?? 0.5;
        labelSlot++;
        const m = {
          x: x1 + (x2 - x1) * slide,
          y: y1 + (y2 - y1) * slide,
        };
        const t = svg('text', { x: m.x, y: m.y, class: 'bkc-edge-label' });
        // Extracted labels are whole sentences. Truncate to keep the chart
        // legible and hang the full text off a tooltip rather than losing it.
        const full = e.relationship.label;
        t.textContent = full.length > 38 ? `${full.slice(0, 36).trimEnd()}…` : full;
        if (full.length > 38) {
          const title = svg('title');
          title.textContent = full;
          t.appendChild(title);
        }
        edgeLayer.appendChild(t);
      }
    }
    root.appendChild(edgeLayer);

    // Work out which labels would collide, and push them onto lower tiers.
    // Two labels clash when their nodes sit at nearly the same height and their
    // estimated text widths overlap.
    const labelTier = new Map<string, number>();
    if (state.showLabels) {
      const sorted = [...view.nodes].sort((a, b) => a.y - b.y || a.x - b.x);
      const placed: { x: number; y: number; halfW: number; tier: number }[] = [];
      for (const n of sorted) {
        const halfW = Math.max(24, present(n.character, view.gated).label.length * 3.1);
        let tier = 0;
        // Try successively lower tiers until nothing already there overlaps.
        while (tier < 3 && placed.some(
          (p) => p.tier === tier
            && Math.abs(p.y - n.y) < 26
            && Math.abs(p.x - n.x) < p.halfW + halfW,
        )) tier++;
        labelTier.set(n.character.id, tier);
        placed.push({ x: n.x, y: n.y, halfW, tier });
      }
    }

    // Nodes.
    const nodeLayer = svg('g', { class: 'bkc-nodes' });
    for (const n of view.nodes) {
      const c = n.character;
      const shown = present(c, view.gated);
      const aff = affilOf(c);
      const g = svg('g', { class: 'bkc-node', 'data-id': c.id });

      // "New this book" ring.
      if (n.isNew) {
        g.appendChild(svg('circle', {
          cx: n.x, cy: n.y, r: n.r + 7, fill: 'none',
          stroke: aff?.border ?? aff?.color ?? '#fff',
          'stroke-width': 2, 'stroke-dasharray': '4 3', opacity: 0.85,
        }));
      }

      const spec = nodeShape(shapeOf(c), n.x, n.y, n.r);
      const body = svg(spec.tag, {
        ...spec.attrs,
        fill: aff?.color ?? '#5a5a7a',
        stroke: aff?.border ?? 'rgba(255,255,255,.5)',
        'stroke-width': c.size === 'main' ? 3 : 2,
      });
      if (shown.status !== 'alive') body.setAttribute('opacity', '0.55');
      g.appendChild(body);

      // Initials inside the node.
      const initials = c.label.split(/[\s·/]+/).filter(Boolean).slice(0, 2)
        .map((p) => p[0]).join('');
      const ini = svg('text', {
        x: n.x, y: n.y, class: 'bkc-initials',
        'font-size': c.size === 'main' ? 15 : 11,
      });
      ini.textContent = initials;
      g.appendChild(ini);

      if (state.showLabels) {
        // Stagger labels for horizontally-crowded nodes. Empyrean's riders row
        // packs a dozen characters at similar y, and their names ran into one
        // another — "Xaden RiorsGarrick Tavisnogen Cardulo".
        const t = svg('text', {
          x: n.x, y: n.y + n.r + 15 + (labelTier.get(c.id) ?? 0) * 13,
          class: 'bkc-node-label',
        });
        // The presented label, so an alias is shown before its reveal.
        t.textContent = shown.label;
        g.appendChild(t);

        if (shown.status !== 'alive') {
          const s = svg('text', {
            x: n.x, y: n.y + n.r + 28 + (labelTier.get(c.id) ?? 0) * 13,
            class: 'bkc-node-status',
          });
          s.textContent = shown.statusIsBelief
            ? `(${shown.status}?)`
            : `(${c.statusDetail ?? shown.status})`;
          g.appendChild(s);
        }
      }

      if (c.magic) {
        const m = svg('text', { x: n.x + n.r - 2, y: n.y - n.r + 6, class: 'bkc-glyph' });
        m.textContent = '✦';
        m.appendChild(svg('title')).textContent = c.magic;
        g.appendChild(m);
      }

      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.selected = c.id;
        opts.onSelectionChange?.(c.id);
        render();
      });
      nodeLayer.appendChild(g);
    }
    root.appendChild(nodeLayer);
  }

  function renderSidebar(view: ChartView) {
    sidebar.replaceChildren();
    const book = series.books.find((b) => b.id === state.book);

    if (state.selected) {
      const node = view.byId.get(state.selected);
      if (node) {
        const shown = present(node.character, view.gated);
        sidebar.appendChild(el('h3', 'bkc-sb-title', shown.label));
        if (shown.role) sidebar.appendChild(el('p', 'bkc-sb-role', shown.role));

        const meta = el('p', 'bkc-sb-meta');
        meta.textContent = [
          `Status: ${shown.status}${shown.statusIsBelief ? ' — as far as you know' : ''}`,
          series.affiliations[node.character.affil]?.label,
          node.character.magic,
        ].filter(Boolean).join(' · ');
        sidebar.appendChild(meta);

        const conns = view.edges.filter(
          (e) => e.relationship.from === state.selected || e.relationship.to === state.selected,
        );
        sidebar.appendChild(el('h4', undefined, `Connections (${conns.length})`));
        const ul = el('ul', 'bkc-sb-list');
        for (const e of conns) {
          const otherId = e.relationship.from === state.selected
            ? e.relationship.to : e.relationship.from;
          const other = view.byId.get(otherId);
          if (!other) continue;
          const li = el('li');
          li.textContent = `${e.relationship.type} — ${present(other.character, view.gated).label}`
            + (e.relationship.label ? ` (${e.relationship.label})` : '');
          ul.appendChild(li);
        }
        sidebar.appendChild(ul);

        if (shown.bio) sidebar.appendChild(el('p', 'bkc-sb-bio', shown.bio));
        else if (shown.bioWithheld) {
          sidebar.appendChild(el('p', 'bkc-sb-hidden',
            'Biography hidden — it describes later books.'));
        }

        const back = el('button', 'bkc-chip', '← Book overview');
        back.onclick = () => { state.selected = null; render(); };
        sidebar.appendChild(back);
        return;
      }
    }

    sidebar.appendChild(el('h3', 'bkc-sb-title', book ? `Book ${book.id} · ${book.short}` : ''));
    if (book?.era) sidebar.appendChild(el('p', 'bkc-sb-role', book.era));
    if (book?.dominant) {
      sidebar.appendChild(el('p', 'bkc-sb-meta', `Ascendant: ${book.dominant}`));
    }
    sidebar.appendChild(el('p', 'bkc-sb-meta',
      `${view.nodes.length} characters · ${view.edges.length} relationships shown`));

    const evs = view.gated.events.filter((e) => e.book === state.book);
    if (evs.length) {
      sidebar.appendChild(el('h4', undefined, 'Key events'));
      const ul = el('ul', 'bkc-sb-list');
      for (const e of evs) ul.appendChild(el('li', undefined, e.text));
      sidebar.appendChild(ul);
    }
  }

  function renderLegend() {
    legend.replaceChildren();
    legend.appendChild(el('h4', undefined, 'Relationships'));
    const wrap = el('div', 'bkc-legend-items');
    for (const t of series.relationshipTypes) {
      if (!state.filters.relTypes.has(t.id)) continue;
      const row = el('span', 'bkc-legend-item');
      const sw = el('i');
      sw.style.background = t.color;
      if (t.dash) sw.style.opacity = '0.7';
      row.append(sw, el('span', undefined, t.label));
      wrap.appendChild(row);
    }
    legend.appendChild(wrap);
  }

  function render() {
    const view = buildView(series, state);
    renderBooks();
    renderLayers();
    renderRelBar();
    renderSvg(view);
    renderSidebar(view);
    renderLegend();
  }

  // ── Interactions ─────────────────────────────────────────────────────────

  /**
   * Client pixels -> SVG user units.
   *
   * The chart is drawn in its own coordinate space and scaled to fit by the
   * viewBox, so a 10px mouse move is not a 10px move in the drawing. Panning
   * used to add client deltas straight to `pan`, which made the content drift
   * away from the cursor at any size but the one where they happened to match.
   * getScreenCTM knows the real mapping, including preserveAspectRatio.
   */
  function toUserSpace(clientX: number, clientY: number): { x: number; y: number } {
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  /** How many SVG units one client pixel covers right now. */
  function unitsPerPixel(): number {
    const ctm = svgEl.getScreenCTM();
    return ctm && ctm.a !== 0 ? 1 / ctm.a : 1;
  }

  let dragging: { id: string | null; sx: number; sy: number; ox: number; oy: number } | null = null;
  let moved = false;

  svgEl.addEventListener('mousedown', (e) => {
    const target = (e.target as Element).closest('.bkc-node');
    const id = target?.getAttribute('data-id') ?? null;
    moved = false;
    if (id) {
      const view = buildView(series, state);
      const n = view.byId.get(id);
      dragging = { id, sx: e.clientX, sy: e.clientY, ox: n?.x ?? 0, oy: n?.y ?? 0 };
    } else {
      dragging = { id: null, sx: e.clientX, sy: e.clientY, ox: state.pan.x, oy: state.pan.y };
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rawX = e.clientX - dragging.sx;
    const rawY = e.clientY - dragging.sy;
    if (Math.abs(rawX) + Math.abs(rawY) > 3) moved = true;
    const k = unitsPerPixel();
    const dx = rawX * k;
    const dy = rawY * k;
    if (dragging.id) {
      state.moved[dragging.id] = {
        x: dragging.ox + dx / state.scale,
        y: dragging.oy + dy / state.scale,
      };
    } else {
      state.pan = { x: dragging.ox + dx, y: dragging.oy + dy };
    }
    render();
  });

  window.addEventListener('mouseup', () => { dragging = null; });

  svgEl.addEventListener('click', (e) => {
    // Clicking empty canvas clears the selection, but not at the end of a drag.
    if (moved) return;
    if (!(e.target as Element).closest('.bkc-node')) {
      state.selected = null;
      opts.onSelectionChange?.(null);
      render();
    }
  });

  /**
   * Zoom about a point, so what is under the cursor stays under the cursor.
   *
   * The transform is `translate(pan) scale(s)`, so a point p in chart space is
   * drawn at `pan + p*s`. Holding the drawn position fixed while s changes
   * means solving for the new pan, which is what this does. Without it, zoom
   * pivoted on the top-left corner and the chart lunged off-screen.
   */
  function zoomAbout(clientX: number, clientY: number, factor: number) {
    const next = Math.min(3, Math.max(0.18, state.scale * factor));
    if (next === state.scale) return;
    const at = toUserSpace(clientX, clientY);
    const world = { x: (at.x - state.pan.x) / state.scale, y: (at.y - state.pan.y) / state.scale };
    state.pan = { x: at.x - world.x * next, y: at.y - world.y * next };
    state.scale = next;
    render();
  }

  stage.addEventListener('wheel', (e) => {
    // A trackpad pinch arrives as a wheel event with ctrlKey set. Everything
    // else is a scroll, and a scroll over a canvas should move the canvas —
    // zooming on every wheel event is why this felt wrong.
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      // 0.01 moved a full mouse notch (~120) through 3.3x in one step, which
      // overshoots the whole zoom range in two clicks. This is ~1.2x a notch.
      zoomAbout(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
      return;
    }
    e.preventDefault();
    const k = unitsPerPixel();
    state.pan = { x: state.pan.x - e.deltaX * k, y: state.pan.y - e.deltaY * k };
    render();
  }, { passive: false });

  // Double-click on empty canvas resets the view. Once you can zoom freely you
  // need a way back, and hunting for the chart by dragging is miserable.
  stage.addEventListener('dblclick', (e) => {
    if ((e.target as Element).closest('.bkc-node')) return;
    state.scale = 1;
    state.pan = { x: 0, y: 0 };
    render();
  });

  function setBook(book: number) {
    state.book = book;
    // A selected character may not exist at the new position.
    if (state.selected) {
      const view = buildView(series, state);
      if (!view.byId.has(state.selected)) state.selected = null;
    }
    render();
    opts.onBookChange?.(book);
  }

  render();

  return {
    getBook: () => state.book,
    setBook,
    destroy: () => container.replaceChildren(),
  };
}
