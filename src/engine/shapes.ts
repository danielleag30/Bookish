/**
 * Pure geometry for the chart: node outlines and edge paths.
 *
 * No DOM and no state, so every shape is unit-testable. Extracted from the
 * Empyrean chart, which was the most complete of the three implementations.
 */

export type ShapeName =
  | 'circle' | 'diamond' | 'triangle' | 'hexagon'
  | 'star6' | 'star8' | 'chevron' | 'square';

/** SVG element name and attributes for a node outline. */
export interface ShapeSpec {
  tag: 'circle' | 'polygon' | 'rect';
  attrs: Record<string, string | number>;
}

function polygon(points: [number, number][]): ShapeSpec {
  return { tag: 'polygon', attrs: { points: points.map(([x, y]) => `${x},${y}`).join(' ') } };
}

function star(cx: number, cy: number, r: number, points: number, inner: number): ShapeSpec {
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return polygon(pts);
}

/**
 * Outline for a character node.
 * `shape` comes from the series' characterTypes; unknown names fall back to a
 * circle so a new series cannot crash the renderer.
 */
export function nodeShape(shape: string, cx: number, cy: number, r: number): ShapeSpec {
  switch (shape) {
    case 'diamond':
      return polygon([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]]);
    case 'triangle':
      return polygon([[cx, cy - r], [cx + r * 0.87, cy + r * 0.5], [cx - r * 0.87, cy + r * 0.5]]);
    case 'hexagon': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      return polygon(pts);
    }
    case 'star6': return star(cx, cy, r, 6, 0.55);
    case 'star8': return star(cx, cy, r, 8, 0.62);
    case 'chevron':
      return polygon([
        [cx, cy - r], [cx + r, cy + r * 0.6], [cx, cy + r * 0.15], [cx - r, cy + r * 0.6],
      ]);
    case 'square':
      return { tag: 'rect', attrs: { x: cx - r * 0.8, y: cy - r * 0.8, width: r * 1.6, height: r * 1.6, rx: r * 0.15 } };
    case 'circle':
    default:
      return { tag: 'circle', attrs: { cx, cy, r } };
  }
}

/**
 * Curved path between two nodes.
 *
 * The arc is offset perpendicular to the line so multiple edges between nearby
 * nodes stay distinguishable, and so an edge does not pass straight through the
 * label of whatever sits between its endpoints.
 */
export function edgePath(x1: number, y1: number, x2: number, y2: number, bow = 0.16): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // Perpendicular offset, scaled by length so short edges stay nearly straight.
  const off = Math.min(dist * bow, 90);
  const cx = mx + (-dy / dist) * off;
  const cy = my + (dx / dist) * off;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

/** Point at parameter t along the quadratic used by edgePath, for label placement. */
export function edgeMidpoint(
  x1: number, y1: number, x2: number, y2: number, bow = 0.16,
): { x: number; y: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const off = Math.min(dist * bow, 90);
  const cx = (x1 + x2) / 2 + (-dy / dist) * off;
  const cy = (y1 + y2) / 2 + (dx / dist) * off;
  // Quadratic at t = 0.5
  return { x: 0.25 * x1 + 0.5 * cx + 0.25 * x2, y: 0.25 * y1 + 0.5 * cy + 0.25 * y2 };
}

/** Shrink an endpoint back to the node's rim so the line does not overlap it. */
export function trimToRim(
  x1: number, y1: number, x2: number, y2: number, r1: number, r2: number,
): [number, number, number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  return [x1 + ux * r1, y1 + uy * r1, x2 - ux * r2, y2 - uy * r2];
}

/** Node radius for a size keyword. */
export function nodeRadius(size: string): number {
  return size === 'main' ? 26 : 17;
}
