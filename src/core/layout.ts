/**
 * Roblox layout engine.
 *
 * Computes the absolute rectangle of every node in a resolved tree using
 * Roblox's rules: UDim2 Size/Position relative to the parent's content box,
 * AnchorPoint, UIPadding, UIScale, UIAspectRatioConstraint,
 * UISizeConstraint, UIListLayout, UIGridLayout, UIPageLayout, ScrollingFrame
 * canvases, AutomaticSize, TextScaled and the ScreenGui top-bar inset.
 *
 * The engine is pure (no DOM). Text measurement is injected so the browser
 * can use real font metrics while tests/the server use an approximation.
 */
import { CLASSES, HUGE } from "./classes";
import { propOf, type ResolvedNode } from "./document";
import type { FontFace, UDim, UDim2, Vector2 } from "./types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutBox extends Rect {
  id: string;
  parentId: string | null;
  className: string;
  /** Own rotation in degrees (Roblox rotates around the centre; descendants inherit). */
  rotation: number;
  /** Cumulative UIScale factor applied to offsets/text in this subtree. */
  scale: number;
  /** Effective text size in pixels (after TextScaled / UIScale). */
  textSize?: number;
  /** For ScrollingFrames: the absolute canvas rect children are laid out in. */
  canvas?: Rect;
  /** Visible after considering ancestors. */
  visible: boolean;
  clips: boolean;
  /** True if position was dictated by a parent layout (list/grid/page). */
  laidOut: boolean;
  /** Content rect children are laid out in (after padding). */
  content: Rect;
}

export interface TextMeasurer {
  /** Measure text. `wrapWidth` null = single line. Returns pixel bounds. */
  measure(text: string, font: FontFace, size: number, wrapWidth: number | null, lineHeight: number): { w: number; h: number };
}

export interface SafeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface LayoutOptions {
  measurer?: TextMeasurer;
  /** Device safe-area insets (notches), used by ScreenInsets. */
  safeInsets?: SafeInsets;
  /** Height of the Roblox top bar inset (IgnoreGuiInset = false). */
  topbarInset?: number;
}

/** Height of the Roblox top bar since the 2024 UI refresh. */
export const ROBLOX_TOPBAR_INSET = 58;

export type LayoutMap = Map<string, LayoutBox>;

/** Approximate measurer (≈ average glyph width). Used on the server and in tests. */
export const approxMeasurer: TextMeasurer = {
  measure(text, font, size, wrapWidth, lineHeight) {
    const plain = text.replace(/<[^>]+>/g, "");
    const factor = font.family === "PressStart2P" ? 1.0 : font.family === "RobotoMono" ? 0.6 : 0.53;
    const bold = ["Bold", "ExtraBold", "Heavy"].includes(font.weight) ? 1.06 : 1;
    const cw = size * factor * bold;
    const lines = plain.split("\n");
    let maxW = 0;
    let count = 0;
    for (const line of lines) {
      const lw = line.length * cw;
      if (wrapWidth !== null && wrapWidth > 0 && lw > wrapWidth) {
        // greedy word wrap
        let cur = 0;
        let n = 1;
        for (const word of line.split(/(\s+)/)) {
          const ww = word.length * cw;
          if (cur + ww > wrapWidth && cur > 0) {
            n++;
            maxW = Math.max(maxW, cur);
            cur = word.trim() ? ww : 0;
          } else cur += ww;
        }
        maxW = Math.max(maxW, cur);
        count += n;
      } else {
        maxW = Math.max(maxW, lw);
        count++;
      }
    }
    return { w: maxW, h: count * size * lineHeight };
  },
};

const LAYOUT_CLASSES = new Set(["UIListLayout", "UIGridLayout", "UIPageLayout"]);

interface Modifiers {
  padding?: ResolvedNode;
  scale?: ResolvedNode;
  aspect?: ResolvedNode;
  sizeC?: ResolvedNode;
  textC?: ResolvedNode;
  layout?: ResolvedNode;
}

function modifiersOf(n: ResolvedNode): Modifiers {
  const m: Modifiers = {};
  for (const c of n.children) {
    switch (c.className) {
      case "UIPadding": m.padding ??= c; break;
      case "UIScale": m.scale ??= c; break;
      case "UIAspectRatioConstraint": m.aspect ??= c; break;
      case "UISizeConstraint": m.sizeC ??= c; break;
      case "UITextSizeConstraint": m.textC ??= c; break;
      default: if (LAYOUT_CLASSES.has(c.className)) m.layout ??= c;
    }
  }
  return m;
}

const isGui = (n: ResolvedNode) => CLASSES[n.className]?.kind === "gui";
const ud = (u: UDim, len: number, k: number) => len * u.s + u.o * k;

/**
 * Lay out a tree. `rootRect` is the rectangle of the root node: for a
 * ScreenGui the screen (device) size, for a loose GuiObject its own canvas rect.
 */
export function computeLayout(root: ResolvedNode, rootRect: Rect, opts: LayoutOptions = {}): LayoutMap {
  const out: LayoutMap = new Map();
  const ctx: Ctx = {
    out,
    measurer: opts.measurer ?? approxMeasurer,
    safe: opts.safeInsets ?? { top: 0, bottom: 0, left: 0, right: 0 },
    topbar: opts.topbarInset ?? ROBLOX_TOPBAR_INSET,
  };
  if (root.className === "ScreenGui") {
    const ignoreInset = propOf<boolean>(root, "IgnoreGuiInset");
    const insets = propOf<string>(root, "ScreenInsets");
    const s = insets === "None" ? { top: 0, bottom: 0, left: 0, right: 0 } : ctx.safe;
    const top = Math.max(s.top, ignoreInset ? 0 : ctx.topbar);
    const content: Rect = {
      x: rootRect.x + s.left,
      y: rootRect.y + top,
      w: Math.max(0, rootRect.w - s.left - s.right),
      h: Math.max(0, rootRect.h - top - s.bottom),
    };
    out.set(root.id, {
      ...rootRect, id: root.id, parentId: null, className: root.className, rotation: 0, scale: 1,
      visible: propOf<boolean>(root, "Enabled") !== false, clips: false, laidOut: false, content,
    });
    layoutChildren(ctx, root, content, 1, true, root.id);
  } else {
    // Loose top-level GuiObject: its own offset size defines it.
    placeNode(ctx, root, null, { ...rootRect, w: 0, h: 0 }, 1, true, { forced: { x: rootRect.x, y: rootRect.y, w: rootRect.w, h: rootRect.h } });
  }
  return out;
}

interface Ctx {
  out: LayoutMap;
  measurer: TextMeasurer;
  safe: SafeInsets;
  topbar: number;
}

interface Placement {
  /** Exact rect dictated by a parent layout (top-left + size). */
  forced?: Rect;
  /** Size only (grid cells) — position comes later from the layout. */
  forcedSize?: { w: number; h: number };
}

/** Compute the base size of a GuiObject in its parent content box (before automatic sizing). */
function baseSize(n: ResolvedNode, parent: Rect, k: number, m: Modifiers): { w: number; h: number; own: number } {
  const size = propOf<UDim2>(n, "Size");
  let w = parent.w * size.xs + size.xo * k;
  let h = parent.h * size.ys + size.yo * k;
  if (m.aspect) {
    const ratio = Math.max(0.0001, propOf<number>(m.aspect, "AspectRatio"));
    const type = propOf<string>(m.aspect, "AspectType");
    const axis = propOf<string>(m.aspect, "DominantAxis");
    if (type === "FitWithinMaxSize") {
      if (w / h > ratio) w = h * ratio;
      else h = w / ratio;
    } else if (axis === "Width") h = w / ratio;
    else w = h * ratio;
  }
  if (m.sizeC) {
    const mn = propOf<Vector2>(m.sizeC, "MinSize");
    const mx = propOf<Vector2>(m.sizeC, "MaxSize");
    w = Math.min(mx.x >= HUGE ? Infinity : mx.x, Math.max(mn.x, w));
    h = Math.min(mx.y >= HUGE ? Infinity : mx.y, Math.max(mn.y, h));
  }
  const own = m.scale ? Math.max(0, propOf<number>(m.scale, "Scale")) : 1;
  return { w: Math.max(0, w * own), h: Math.max(0, h * own), own };
}

function textSizeFor(ctx: Ctx, n: ResolvedNode, w: number, h: number, k: number, m: Modifiers): number {
  const size = propOf<number>(n, "TextSize");
  if (!propOf<boolean>(n, "TextScaled")) return size * k;
  const font = propOf<FontFace>(n, "FontFace");
  const text = propOf<string>(n, "Text") || " ";
  const lh = propOf<number>(n, "LineHeight");
  const wrapped = propOf<boolean>(n, "TextWrapped");
  let lo = m.textC ? propOf<number>(m.textC, "MinTextSize") : 1;
  let hi = Math.min(100, m.textC ? propOf<number>(m.textC, "MaxTextSize") : 100);
  if (hi < lo) hi = lo;
  let best = lo;
  // Binary search on integer sizes for the largest that fits.
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = ctx.measurer.measure(text, font, mid, wrapped ? w : null, lh);
    if (b.w <= w + 0.5 && b.h <= h + 0.5) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/**
 * Place a GuiObject. Computes its rect, recurses into children and returns the box.
 * `parentContent` is the parent's content rect (after padding / canvas).
 */
function placeNode(
  ctx: Ctx,
  n: ResolvedNode,
  parentId: string | null,
  parentContent: Rect,
  k: number,
  parentVisible: boolean,
  placement: Placement = {},
): LayoutBox {
  const m = modifiersOf(n);
  let w: number, h: number, own: number;
  if (placement.forced) ({ w, h } = placement.forced), (own = m.scale ? propOf<number>(m.scale, "Scale") : 1);
  else if (placement.forcedSize) ({ w, h } = placement.forcedSize), (own = m.scale ? propOf<number>(m.scale, "Scale") : 1);
  else ({ w, h, own } = baseSize(n, parentContent, k, m));
  const childK = k * own;

  const anchor = propOf<Vector2>(n, "AnchorPoint");
  const pos = propOf<UDim2>(n, "Position");
  // Anchor point position in absolute coordinates.
  const ax = placement.forced ? placement.forced.x + anchor.x * w : parentContent.x + parentContent.w * pos.xs + pos.xo * k;
  const ay = placement.forced ? placement.forced.y + anchor.y * h : parentContent.y + parentContent.h * pos.ys + pos.yo * k;

  const visible = parentVisible && propOf<boolean>(n, "Visible") !== false;
  const box: LayoutBox = {
    id: n.id, parentId, className: n.className,
    x: ax - anchor.x * w, y: ay - anchor.y * h, w, h,
    rotation: propOf<number>(n, "Rotation") || 0,
    scale: childK,
    visible,
    clips: !!propOf<boolean>(n, "ClipsDescendants"),
    laidOut: !!placement.forced || !!placement.forcedSize,
    content: { x: 0, y: 0, w: 0, h: 0 },
  };
  ctx.out.set(n.id, box);

  const autoSize = propOf<string>(n, "AutomaticSize");
  const isText = CLASSES[n.className]?.isText;

  const layoutInside = () => {
    const padded = paddedRect(box, m.padding, childK);
    box.content = padded;
    let childArea = padded;
    if (CLASSES[n.className]?.isScrolling) {
      const cs = propOf<UDim2>(n, "CanvasSize");
      const cp = propOf<Vector2>(n, "CanvasPosition");
      // Roblox: AbsoluteCanvasSize is never smaller than the visible window.
      const canvas: Rect = {
        x: box.x - cp.x,
        y: box.y - cp.y,
        w: Math.max(box.w, box.w * cs.xs + cs.xo * childK),
        h: Math.max(box.h, box.h * cs.ys + cs.yo * childK),
      };
      box.canvas = canvas;
      childArea = paddedRect(canvas, m.padding, childK);
      box.content = childArea;
    }
    return layoutChildren(ctx, n, childArea, childK, visible, n.id);
  };

  let extent = layoutInside();

  if (isText) box.textSize = textSizeFor(ctx, n, w, h, k, m);

  // AutomaticSize: grow to fit content (children extent or text bounds).
  if (autoSize !== "None" && !placement.forcedSize) {
    let needW = 0;
    let needH = 0;
    const pad = padAmounts(box, m.padding, childK);
    if (isText) {
      const font = propOf<FontFace>(n, "FontFace");
      const wrap = propOf<boolean>(n, "TextWrapped") && autoSize === "Y" ? w - pad.l - pad.r : null;
      const tb = ctx.measurer.measure(propOf<string>(n, "Text"), font, box.textSize ?? 14, wrap, propOf<number>(n, "LineHeight"));
      needW = tb.w + pad.l + pad.r;
      needH = tb.h + pad.t + pad.b;
    }
    if (extent) {
      needW = Math.max(needW, extent.w + pad.l + pad.r);
      needH = Math.max(needH, extent.h + pad.t + pad.b);
    }
    const nw = autoSize === "X" || autoSize === "XY" ? Math.max(w, needW) : w;
    const nh = autoSize === "Y" || autoSize === "XY" ? Math.max(h, needH) : h;
    if (nw !== w || nh !== h) {
      box.w = nw;
      box.h = nh;
      if (!placement.forced) {
        box.x = ax - anchor.x * nw;
        box.y = ay - anchor.y * nh;
      }
      extent = layoutInside();
    }
  }

  // AutomaticCanvasSize for scrolling frames.
  if (box.canvas && extent) {
    const acs = propOf<string>(n, "AutomaticCanvasSize");
    const pad = padAmounts(box.canvas, m.padding, childK);
    let changed = false;
    if ((acs === "X" || acs === "XY") && extent.w + pad.l + pad.r > box.canvas.w) {
      box.canvas.w = extent.w + pad.l + pad.r;
      changed = true;
    }
    if ((acs === "Y" || acs === "XY") && extent.h + pad.t + pad.b > box.canvas.h) {
      box.canvas.h = extent.h + pad.t + pad.b;
      changed = true;
    }
    if (changed) {
      box.content = paddedRect(box.canvas, m.padding, childK);
      layoutChildren(ctx, n, box.content, childK, visible, n.id);
    }
  }
  return box;
}

function padAmounts(r: Rect, padding: ResolvedNode | undefined, k: number) {
  if (!padding) return { t: 0, b: 0, l: 0, r: 0 };
  return {
    t: ud(propOf<UDim>(padding, "PaddingTop"), r.h, k),
    b: ud(propOf<UDim>(padding, "PaddingBottom"), r.h, k),
    l: ud(propOf<UDim>(padding, "PaddingLeft"), r.w, k),
    r: ud(propOf<UDim>(padding, "PaddingRight"), r.w, k),
  };
}

function paddedRect(r: Rect, padding: ResolvedNode | undefined, k: number): Rect {
  const p = padAmounts(r, padding, k);
  return { x: r.x + p.l, y: r.y + p.t, w: Math.max(0, r.w - p.l - p.r), h: Math.max(0, r.h - p.t - p.b) };
}

/**
 * Lay out the GuiObject children of `n` inside `area`. Returns the content
 * extent (size of the children's bounding box relative to `area`), used for
 * AutomaticSize. Non-GUI children (modifiers) get a zero box at the parent.
 */
function layoutChildren(ctx: Ctx, n: ResolvedNode, area: Rect, k: number, visible: boolean, parentId: string): { w: number; h: number } | null {
  const m = modifiersOf(n);
  const guiKids = n.children.filter(isGui);
  for (const c of n.children) {
    if (!isGui(c)) {
      ctx.out.set(c.id, {
        id: c.id, parentId, className: c.className, x: area.x, y: area.y, w: 0, h: 0, rotation: 0,
        scale: k, visible, clips: false, laidOut: false, content: { ...area, w: 0, h: 0 },
      });
    }
  }
  if (!guiKids.length) return null;

  const layout = m.layout;
  if (!layout) {
    let maxX = 0;
    let maxY = 0;
    for (const c of guiKids) {
      const b = placeNode(ctx, c, parentId, area, k, visible);
      maxX = Math.max(maxX, b.x + b.w - area.x);
      maxY = Math.max(maxY, b.y + b.h - area.y);
    }
    return { w: maxX, h: maxY };
  }

  const sortOrder = propOf<string>(layout, "SortOrder");
  const items = guiKids
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      if (sortOrder === "Name") return a.c.name.localeCompare(b.c.name) || a.i - b.i;
      return (propOf<number>(a.c, "LayoutOrder") - propOf<number>(b.c, "LayoutOrder")) || a.i - b.i;
    })
    .map((x) => x.c);
  const visibleItems = items.filter((c) => propOf<boolean>(c, "Visible") !== false);
  // Invisible items still get boxes (hidden) so selection works, but take no space.
  for (const c of items) if (!visibleItems.includes(c)) placeNode(ctx, c, parentId, area, k, false);

  const hAlign = propOf<string>(layout, "HorizontalAlignment");
  const vAlign = propOf<string>(layout, "VerticalAlignment");
  const alignOff = (free: number, a: string, start: string, end: string) => (a === start ? 0 : a === end ? free : free / 2);

  if (layout.className === "UIGridLayout") {
    const cs = propOf<UDim2>(layout, "CellSize");
    const cp = propOf<UDim2>(layout, "CellPadding");
    const cw = area.w * cs.xs + cs.xo * k;
    const ch = area.h * cs.ys + cs.yo * k;
    const px = area.w * cp.xs + cp.xo * k;
    const py = area.h * cp.ys + cp.yo * k;
    const horizontal = propOf<string>(layout, "FillDirection") === "Horizontal";
    const maxCells = propOf<number>(layout, "FillDirectionMaxCells");
    const fit = horizontal ? Math.floor((area.w + px) / (cw + px)) : Math.floor((area.h + py) / (ch + py));
    let perLine = Math.max(1, fit);
    if (maxCells > 0) perLine = Math.min(perLine, maxCells);
    const count = visibleItems.length;
    const lines = Math.ceil(count / perLine);
    const cols = horizontal ? Math.min(perLine, count) : lines;
    const rows = horizontal ? lines : Math.min(perLine, count);
    const gw = cols * cw + Math.max(0, cols - 1) * px;
    const gh = rows * ch + Math.max(0, rows - 1) * py;
    const ox = area.x + alignOff(area.w - gw, hAlign, "Left", "Right");
    const oy = area.y + alignOff(area.h - gh, vAlign, "Top", "Bottom");
    const corner = propOf<string>(layout, "StartCorner");
    visibleItems.forEach((c, i) => {
      let col = horizontal ? i % perLine : Math.floor(i / perLine);
      let row = horizontal ? Math.floor(i / perLine) : i % perLine;
      if (corner === "TopRight" || corner === "BottomRight") col = cols - 1 - col;
      if (corner === "BottomLeft" || corner === "BottomRight") row = rows - 1 - row;
      placeNode(ctx, c, parentId, area, k, visible, {
        forced: { x: ox + col * (cw + px), y: oy + row * (ch + py), w: cw, h: ch },
      });
    });
    return { w: gw, h: gh };
  }

  // List and page layouts: compute natural sizes first.
  const vertical = propOf<string>(layout, "FillDirection") === "Vertical";
  const padU = propOf<UDim>(layout, "Padding");
  const gap = ud(padU, vertical ? area.h : area.w, k);
  const sizes = visibleItems.map((c) => {
    // Items with AutomaticSize are measured by a full placement first (their final size depends on content).
    if (propOf<string>(c, "AutomaticSize") !== "None") {
      const b = placeNode(ctx, c, parentId, area, k, visible);
      return { c, w: b.w, h: b.h };
    }
    const s = baseSize(c, area, k, modifiersOf(c));
    return { c, w: s.w, h: s.h };
  });

  if (layout.className === "UIPageLayout") {
    const current = Math.max(0, Math.min(sizes.length - 1, propOf<number>(layout, "_CurrentPage")));
    let cursor = 0;
    const starts: number[] = [];
    for (const s of sizes) {
      starts.push(cursor);
      cursor += (vertical ? s.h : s.w) + gap;
    }
    const cur = sizes[current];
    // Align the current page within the area, shift all pages accordingly.
    const offMain = vertical
      ? alignOff(area.h - cur.h, vAlign, "Top", "Bottom") - starts[current]
      : alignOff(area.w - cur.w, hAlign, "Left", "Right") - starts[current];
    sizes.forEach((s, i) => {
      const x = vertical ? area.x + alignOff(area.w - s.w, hAlign, "Left", "Right") : area.x + offMain + starts[i];
      const y = vertical ? area.y + offMain + starts[i] : area.y + alignOff(area.h - s.h, vAlign, "Top", "Bottom");
      placeNode(ctx, s.c, parentId, area, k, visible, { forced: { x, y, w: s.w, h: s.h } });
    });
    return { w: vertical ? Math.max(...sizes.map((s) => s.w)) : cursor - gap, h: vertical ? cursor - gap : Math.max(...sizes.map((s) => s.h)) };
  }

  // UIListLayout (with optional wrapping).
  const wraps = propOf<boolean>(layout, "Wraps");
  const mainLen = vertical ? area.h : area.w;
  const lines: (typeof sizes)[] = [[]];
  let used = 0;
  for (const s of sizes) {
    const len = vertical ? s.h : s.w;
    const line = lines[lines.length - 1];
    if (wraps && line.length && used + gap + len > mainLen + 0.01) {
      lines.push([s]);
      used = len;
    } else {
      used += (line.length ? gap : 0) + len;
      line.push(s);
    }
  }
  // Cross-axis gap between wrapped lines uses the same padding.
  const lineCross = lines.map((l) => Math.max(0, ...l.map((s) => (vertical ? s.w : s.h))));
  const lineMain = lines.map((l) => l.reduce((a, s) => a + (vertical ? s.h : s.w), 0) + gap * Math.max(0, l.length - 1));
  const totalCross = lineCross.reduce((a, b) => a + b, 0) + gap * Math.max(0, lines.length - 1);
  // Placement of the whole block on the cross axis (only meaningful for wrapped lists).
  let crossCursor =
    lines.length > 1
      ? vertical
        ? alignOff(area.w - totalCross, hAlign, "Left", "Right")
        : alignOff(area.h - totalCross, vAlign, "Top", "Bottom")
      : 0;
  lines.forEach((line, li) => {
    let mainCursor = vertical
      ? alignOff(area.h - lineMain[li], vAlign, "Top", "Bottom")
      : alignOff(area.w - lineMain[li], hAlign, "Left", "Right");
    for (const s of line) {
      let x: number, y: number;
      if (vertical) {
        y = area.y + mainCursor;
        x = lines.length > 1 ? area.x + crossCursor + alignOff(lineCross[li] - s.w, hAlign, "Left", "Right") : area.x + alignOff(area.w - s.w, hAlign, "Left", "Right");
        mainCursor += s.h + gap;
      } else {
        x = area.x + mainCursor;
        y = lines.length > 1 ? area.y + crossCursor + alignOff(lineCross[li] - s.h, vAlign, "Top", "Bottom") : area.y + alignOff(area.h - s.h, vAlign, "Top", "Bottom");
        mainCursor += s.w + gap;
      }
      placeNode(ctx, s.c, parentId, area, k, visible, { forced: { x, y, w: s.w, h: s.h } });
    }
    crossCursor += lineCross[li] + gap;
  });
  const contentMain = Math.max(0, ...lineMain);
  return vertical ? { w: totalCross, h: contentMain } : { w: contentMain, h: totalCross };
}

/** Root rect for a top-level node on the canvas. */
export function rootRectOf(node: { className: string; props: Record<string, unknown>; canvas?: { x: number; y: number; w?: number; h?: number } }): Rect {
  const x = node.canvas?.x ?? 0;
  const y = node.canvas?.y ?? 0;
  if (node.className === "ScreenGui") return { x, y, w: node.canvas?.w ?? 1920, h: node.canvas?.h ?? 1080 };
  const size = (node.props.Size as UDim2 | undefined) ?? { xs: 0, xo: 100, ys: 0, yo: 100 };
  return { x, y, w: Math.max(1, size.xo), h: Math.max(1, size.yo) };
}
