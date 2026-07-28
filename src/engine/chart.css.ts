/**
 * Chart styles, shipped as a string so the bundle stays a single self-contained
 * module the static chart pages can load with one script tag.
 *
 * Colours come from CSS custom properties, which each chart page sets to keep
 * its own identity — Empyrean purple-gold, DCC red-on-black, Plated Prisoner
 * gilded rose.
 */
export const CHART_CSS = `
.bkc{--bkc-fg:#e8e6f0;--bkc-dim:#a49bba;--bkc-accent:#d4af37;--bkc-accent2:#9b59d0;--bkc-panel:rgba(16,12,28,.92);
  --bkc-line:rgba(212,175,55,.25);--bkc-display:'Cinzel',serif;
  display:grid;grid-template-columns:1fr 300px;grid-template-rows:auto 1fr;
  gap:10px;height:100%;min-height:620px;color:var(--bkc-fg);
  font-family:'DM Sans',system-ui,sans-serif}
.bkc-controls{grid-column:1/-1;display:flex;flex-direction:column;gap:6px}
.bkc-books,.bkc-layers,.bkc-rels{display:flex;flex-wrap:wrap;gap:5px}
.bkc-book{background:rgba(0,0,0,.3);color:var(--bkc-dim);border:1px solid var(--bkc-line);
  border-radius:8px;padding:7px 13px;font:inherit;font-size:.8rem;cursor:pointer}
.bkc-book:hover{color:var(--bkc-fg)}
.bkc-book.on{background:linear-gradient(135deg,
    color-mix(in srgb,var(--bkc-accent) 28%,transparent),
    color-mix(in srgb,var(--bkc-accent2) 24%,transparent));
  color:var(--bkc-fg);border-color:var(--bkc-accent)}
.bkc-book.future{opacity:.5;font-style:italic}
.bkc-chip{background:rgba(0,0,0,.25);color:var(--bkc-dim);border:1px solid rgba(255,255,255,.13);
  border-radius:16px;padding:3px 10px;font:inherit;font-size:.68rem;cursor:pointer}
.bkc-chip:hover{color:var(--bkc-fg)}
.bkc-chip.on{background:color-mix(in srgb,var(--bkc-accent) 16%,transparent);color:var(--bkc-fg)}
.bkc-stage{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.07);
  border-radius:12px;background:rgba(0,0,0,.22);cursor:grab}
.bkc-stage:active{cursor:grabbing}
.bkc-svg{width:100%;height:100%;display:block;user-select:none}
.bkc-region-label{fill:var(--bkc-dim);font-size:12px;letter-spacing:.08em;
  text-transform:uppercase;opacity:.75}
.bkc-edge-label{fill:var(--bkc-dim);font-size:9px;text-anchor:middle;opacity:.85;
  paint-order:stroke;stroke:rgba(0,0,0,.65);stroke-width:2.5px}
.bkc-node{cursor:pointer}
.bkc-node:hover .bkc-initials{fill:#fff}
.bkc-initials{fill:rgba(255,255,255,.92);text-anchor:middle;dominant-baseline:central;
  font-weight:600;pointer-events:none}
.bkc-node-label{fill:var(--bkc-fg);font-size:11px;text-anchor:middle;pointer-events:none;
  paint-order:stroke;stroke:rgba(0,0,0,.7);stroke-width:3px}
.bkc-node-status{fill:var(--bkc-dim);font-size:9px;text-anchor:middle;pointer-events:none;
  font-style:italic}
.bkc-glyph{fill:var(--bkc-accent);font-size:13px;text-anchor:middle;pointer-events:none}
.bkc-sidebar{overflow-y:auto;padding:14px;border:1px solid var(--bkc-line);border-radius:12px;
  background:var(--bkc-panel)}
.bkc-sb-title{margin:0 0 4px;font-size:1rem;color:var(--bkc-accent);
  font-family:var(--bkc-display)}
.bkc-sb-role{margin:0 0 8px;font-size:.78rem;color:var(--bkc-fg);opacity:.9}
.bkc-sb-meta{margin:0 0 10px;font-size:.72rem;color:var(--bkc-dim);line-height:1.5}
.bkc-sidebar h4{margin:12px 0 5px;font-size:.7rem;letter-spacing:.09em;
  text-transform:uppercase;color:var(--bkc-accent);opacity:.85}
.bkc-sb-list{margin:0;padding-left:16px;font-size:.73rem;color:var(--bkc-fg);line-height:1.6}
.bkc-sb-list li{margin-bottom:3px;opacity:.9}
.bkc-sb-bio{margin:10px 0 0;font-size:.73rem;line-height:1.6;color:var(--bkc-dim)}
.bkc-sb-hidden{margin:10px 0 0;font-size:.72rem;font-style:italic;color:var(--bkc-dim);
  padding:6px 8px;border-left:2px solid var(--bkc-line);background:rgba(212,175,55,.06)}
.bkc-legend{grid-column:1/-1;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;
  padding:8px 12px;border:1px solid rgba(255,255,255,.07);border-radius:10px;
  background:rgba(0,0,0,.2)}
.bkc-legend h4{margin:0;font-size:.66rem;letter-spacing:.09em;text-transform:uppercase;
  color:var(--bkc-dim)}
.bkc-legend-items{display:flex;flex-wrap:wrap;gap:10px;font-size:.68rem;color:var(--bkc-dim)}
.bkc-legend-item{display:inline-flex;align-items:center;gap:5px}
.bkc-legend-item i{width:16px;height:3px;border-radius:2px;display:inline-block}
@media (max-width:900px){
  .bkc{grid-template-columns:1fr}
  .bkc-sidebar{max-height:280px}
}
`;
