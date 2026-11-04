/** Snapping of moving/resizing boxes to sibling and parent edges/centres. */
import type { Rect } from "../../core/layout";

export interface Guide {
  axis: "x" | "y";
  pos: number;
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

const edges = (r: Rect) => ({ x: [r.x, r.x + r.w / 2, r.x + r.w], y: [r.y, r.y + r.h / 2, r.y + r.h] });

/**
 * Find the smallest correction (dx, dy) that aligns one of `moving`'s edges or
 * centre with a target line, within `threshold` world px.
 * `which` limits the snapped edges (for resize): e.g. { x: [2] } = right edge only.
 */
export function snapRect(moving: Rect, targets: Rect[], threshold: number, which?: { x?: number[]; y?: number[] }): SnapResult {
  const m = edges(moving);
  let best = { x: { d: Infinity, line: 0 }, y: { d: Infinity, line: 0 } };
  for (const t of targets) {
    const e = edges(t);
    for (const axis of ["x", "y"] as const) {
      const allowed = which?.[axis];
      if (which && !allowed) continue;
      m[axis].forEach((mv, mi) => {
        if (allowed && !allowed.includes(mi)) return;
        for (const tv of e[axis]) {
          const d = tv - mv;
          if (Math.abs(d) <= threshold && Math.abs(d) < Math.abs(best[axis].d)) best = { ...best, [axis]: { d, line: tv } };
        }
      });
    }
  }
  const dx = Number.isFinite(best.x.d) ? best.x.d : 0;
  const dy = Number.isFinite(best.y.d) ? best.y.d : 0;
  const moved = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: Guide[] = [];
  for (const axis of ["x", "y"] as const) {
    if (!Number.isFinite(best[axis].d)) continue;
    const line = best[axis].line;
    // Extent of the guide: span all targets touching the line + the moving rect.
    let from = axis === "x" ? moved.y : moved.x;
    let to = axis === "x" ? moved.y + moved.h : moved.x + moved.w;
    for (const t of targets) {
      const e = edges(t)[axis];
      if (e.some((v) => Math.abs(v - line) < 0.5)) {
        from = Math.min(from, axis === "x" ? t.y : t.x);
        to = Math.max(to, axis === "x" ? t.y + t.h : t.x + t.w);
      }
    }
    guides.push({ axis, pos: line, from, to });
  }
  return { dx, dy, guides };
}

export interface Measure {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
}

/** Distances from `r` to the edges of `container` (spacing indicators). */
export function measureToContainer(r: Rect, c: Rect): Measure[] {
  const cy = r.y + r.h / 2;
  const cx = r.x + r.w / 2;
  const out: Measure[] = [];
  const push = (x1: number, y1: number, x2: number, y2: number, d: number) => {
    if (Math.abs(d) >= 1) out.push({ x1, y1, x2, y2, label: String(Math.round(d)) });
  };
  push(c.x, cy, r.x, cy, r.x - c.x);
  push(r.x + r.w, cy, c.x + c.w, cy, c.x + c.w - r.x - r.w);
  push(cx, c.y, cx, r.y, r.y - c.y);
  push(cx, r.y + r.h, cx, c.y + c.h, c.y + c.h - r.y - r.h);
  return out;
}

/** Distances between two rects (Alt-hover measurement). */
export function measureBetween(a: Rect, b: Rect): Measure[] {
  const out: Measure[] = [];
  const midY = Math.max(a.y, b.y) + (Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) / 2;
  const midX = Math.max(a.x, b.x) + (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) / 2;
  const yRef = Number.isFinite(midY) && midY > Math.max(a.y, b.y) - 0.1 ? midY : a.y + a.h / 2;
  const xRef = Number.isFinite(midX) && midX > Math.max(a.x, b.x) - 0.1 ? midX : a.x + a.w / 2;
  if (a.x + a.w <= b.x) out.push({ x1: a.x + a.w, y1: yRef, x2: b.x, y2: yRef, label: String(Math.round(b.x - a.x - a.w)) });
  else if (b.x + b.w <= a.x) out.push({ x1: b.x + b.w, y1: yRef, x2: a.x, y2: yRef, label: String(Math.round(a.x - b.x - b.w)) });
  if (a.y + a.h <= b.y) out.push({ x1: xRef, y1: a.y + a.h, x2: xRef, y2: b.y, label: String(Math.round(b.y - a.y - a.h)) });
  else if (b.y + b.h <= a.y) out.push({ x1: xRef, y1: b.y + b.h, x2: xRef, y2: a.y, label: String(Math.round(a.y - b.y - b.h)) });
  // b contains a: distances to b's edges
  if (!out.length && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h) return measureToContainer(a, b);
  return out;
}
