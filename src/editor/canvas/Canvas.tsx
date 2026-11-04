/**
 * The infinite canvas: renders the page's artboards and handles all pointer
 * interaction (select, move, resize, marquee, draw, pan, zoom, drop, text edit).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CLASSES } from "../../core/classes";
import { propOf, type ResolvedNode } from "../../core/document";
import { propOps } from "../../core/edit";
import type { LayoutBox, Rect } from "../../core/layout";
import { ROBLOX_TOPBAR_INSET } from "../../core/layout";
import type { Op } from "../../core/ops";
import type { CanvasReference, UDim2, Vector2 } from "../../core/types";
import { cssFont } from "../../core/fonts";
import { api } from "../api";
import * as A from "../actions";
import { RootRenderer } from "../render/Renderer";
import { store, useEditor } from "../store";
import type { SceneRoot } from "../scene";
import { deeperTarget, hitChain, pickTarget } from "./hit";
import { measureBetween, measureToContainer, snapRect, type Guide, type Measure } from "./snap";
import { ContextMenu, type MenuState } from "./ContextMenu";

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "move"; sx: number; sy: number; items: MoveItem[]; moved: boolean; union: Rect; scopeParent: string | null; reorder?: { id: string; parent: string } }
  | { kind: "resize"; sx: number; sy: number; id: string; dir: string; box: LayoutBox; moved: boolean }
  | { kind: "marquee"; sx: number; sy: number; scope: string | null; additive: string[] }
  | { kind: "draw"; sx: number; sy: number; parent: string | null; tool: string }
  | { kind: "label"; sx: number; sy: number; id: string; canvas: { x: number; y: number }; moved: boolean }
  | { kind: "ref"; sx: number; sy: number; ref: CanvasReference; mode: "move" | "resize" };

interface MoveItem {
  id: string;
  box: LayoutBox;
  pos: UDim2;
  k: number;
  topLevel: boolean;
  canvas?: { x: number; y: number; w?: number; h?: number };
  laidOut: boolean;
}

const HANDLE_DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const doc = useEditor((s) => s.doc)!;
  const pageId = useEditor((s) => s.pageId);
  const viewport = useEditor((s) => s.viewport);
  const selection = useEditor((s) => s.selection);
  const hover = useEditor((s) => s.hover);
  const tool = useEditor((s) => s.tool);
  const editingTextId = useEditor((s) => s.editingTextId);
  useEditor((s) => s.anim.time);
  useEditor((s) => s.fontsVersion);
  useEditor((s) => s.timelineOpen);
  const assets = useEditor((s) => s.assets);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [drawRect, setDrawRect] = useState<Rect | null>(null);
  const [space, setSpace] = useState(false);
  const [alt, setAlt] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dropping, setDropping] = useState(false);
  const roots = store.scene();
  const page = doc.pages.find((p) => p.id === pageId) ?? doc.pages[0];
  const { x: vx, y: vy, zoom } = viewport;

  // keep the store informed of the canvas size (for fit/zoom)
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => {
      store.canvasSize = { w: el.clientWidth, h: el.clientHeight };
    });
    ro.observe(el);
    store.canvasSize = { w: el.clientWidth, h: el.clientHeight };
    return () => ro.disconnect();
  }, []);

  // space-to-pan and alt-measure
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable) return;
      if (e.code === "Space") {
        setSpace(true);
        e.preventDefault();
      }
      if (e.key === "Alt") setAlt(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
      if (e.key === "Alt") setAlt(false);
    };
    const blur = () => {
      setSpace(false);
      setAlt(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // wheel: pinch/ctrl = zoom at cursor, otherwise pan (non-passive to prevent browser zoom)
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const v = store.state.viewport;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 ? 0.01 : 0.002));
        store.zoomTo(v.zoom * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        store.set({ viewport: { ...v, x: v.x - dx, y: v.y - dy } });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toWorld = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    const v = store.state.viewport;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  };
  const toScreen = (b: Rect): Rect => ({ x: b.x * zoom + vx, y: b.y * zoom + vy, w: b.w * zoom, h: b.h * zoom });

  const isLocked = (id: string) => {
    let cur: string | null = id.split("/")[0];
    while (cur) {
      if (doc.nodes[cur]?.locked) return true;
      cur = doc.nodes[cur]?.parent ?? null;
    }
    return false;
  };

  // ------------------------------------------------------------ pointer down
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    ref.current!.focus();
    const w = toWorld(e.clientX, e.clientY);
    if (e.button === 1 || space || tool === "hand") {
      setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx, vy });
      return;
    }
    if (store.state.editingTextId) store.set({ editingTextId: null });
    const hit = hitChain(roots, w.x, w.y);
    if (tool !== "select") {
      const parent = hit ? A.containerFor(hit.chain[hit.chain.length - 1].id) : null;
      setDrag({ kind: "draw", sx: w.x, sy: w.y, parent, tool });
      return;
    }
    // reference images (below artboards)
    if (!hit) {
      const refHit = [...(page.references ?? [])].reverse().find((r) => w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h);
      if (refHit && !refHit.locked) {
        const nearCorner = Math.abs(w.x - (refHit.x + refHit.w)) < 12 / zoom && Math.abs(w.y - (refHit.y + refHit.h)) < 12 / zoom;
        store.set({ selection: [`ref:${refHit.id}`] });
        store.beginGesture();
        setDrag({ kind: "ref", sx: w.x, sy: w.y, ref: refHit, mode: nearCorner ? "resize" : "move" });
        return;
      }
      if (!e.shiftKey) store.select([]);
      setDrag({ kind: "marquee", sx: w.x, sy: w.y, scope: null, additive: e.shiftKey ? store.state.selection : [] });
      return;
    }
    const deep = e.metaKey || e.ctrlKey;
    const target = pickTarget(hit.chain, store.state.selection, A.parentOf, deep);
    if (!target) return;
    if (target.className === "ScreenGui" && !deep) {
      // Empty screen area: marquee inside the screen; a click selects the screen.
      if (!e.shiftKey) store.select([target.id]);
      setDrag({ kind: "marquee", sx: w.x, sy: w.y, scope: target.id, additive: e.shiftKey ? store.state.selection.filter((s) => s !== target.id) : [] });
      return;
    }
    let sel = store.state.selection;
    if (e.shiftKey) {
      store.select([target.id], "toggle");
      return;
    }
    if (!sel.includes(target.id)) {
      sel = [target.id];
      store.select(sel);
    }
    startMove(sel, e.clientX, e.clientY);
  };

  const startMove = (sel: string[], cx: number, cy: number) => {
    const items: MoveItem[] = [];
    for (const id of sel) {
      if (id.startsWith("ref:") || isLocked(id)) continue;
      const box = A.boxOf(id);
      const r = A.resolvedOf(id);
      if (!box || !r) continue;
      const stored = A.isStored(id) ? doc.nodes[id] : null;
      const topLevel = !!stored && !stored.parent;
      const parent = A.parentOf(id);
      items.push({
        id, box, pos: propOf<UDim2>(r, "Position"), k: parent ? (A.boxOf(parent)?.scale ?? 1) : 1, topLevel,
        canvas: topLevel ? { ...(stored!.canvas ?? { x: 0, y: 0 }) } : undefined, laidOut: box.laidOut,
      });
    }
    if (!items.length) return;
    const union = unionOf(items.map((i) => i.box));
    const w = toWorld(cx, cy);
    store.beginGesture();
    const parents = new Set(items.map((i) => A.parentOf(i.id)));
    setDrag({ kind: "move", sx: w.x, sy: w.y, items, moved: false, union, scopeParent: parents.size === 1 ? [...parents][0] : null });
  };

  // ------------------------------------------------------------ pointer move
  const onPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    if (!drag) {
      if (tool === "select" && !space) {
        const hit = hitChain(roots, w.x, w.y);
        const t = hit ? pickTarget(hit.chain, store.state.selection, A.parentOf, e.metaKey || e.ctrlKey) : null;
        const id = t && t.className !== "ScreenGui" ? t.id : null;
        if (id !== store.state.hover) store.set({ hover: id });
        if (e.altKey && id && store.state.selection.length === 1 && !store.state.selection.includes(id)) {
          const a = A.boxOf(store.state.selection[0]);
          const b = A.boxOf(id);
          setMeasures(a && b ? measureBetween(a, b) : []);
        } else if (measures.length && !e.altKey) setMeasures([]);
      }
      return;
    }
    switch (drag.kind) {
      case "pan":
        store.set({ viewport: { ...store.state.viewport, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy } });
        return;
      case "move": {
        let dx = w.x - drag.sx;
        let dy = w.y - drag.sy;
        if (!drag.moved && Math.hypot(dx * zoom, dy * zoom) < 3) return;
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        const laid = drag.items.length === 1 && drag.items[0].laidOut;
        if (laid) {
          // Reorder within a layout parent.
          const it = drag.items[0];
          const parent = A.parentOf(it.id)!;
          const r = A.resolvedOf(parent);
          setDrag({ ...drag, moved: true, reorder: { id: it.id, parent } });
          if (r) setGuides(reorderGuides(r, w));
          return;
        }
        const moving = { ...drag.union, x: drag.union.x + dx, y: drag.union.y + dy };
        let g: Guide[] = [];
        if (!e.metaKey && !e.ctrlKey) {
          const targets = snapTargets(drag.scopeParent, drag.items.map((i) => i.id));
          const s = snapRect(moving, targets, 6 / zoom);
          dx += s.dx;
          dy += s.dy;
          g = s.guides;
        }
        setGuides(g);
        const ops: Op[] = [];
        const grid = store.state.snapToGrid ? store.state.gridSize : 0;
        for (const it of drag.items) {
          if (it.topLevel) {
            let nx = it.canvas!.x + dx;
            let ny = it.canvas!.y + dy;
            if (grid) (nx = Math.round(nx / grid) * grid), (ny = Math.round(ny / grid) * grid);
            ops.push({ type: "update", id: it.id, fields: { canvas: { ...it.canvas!, x: Math.round(nx), y: Math.round(ny) } } });
          } else if (!it.laidOut) {
            let xo = it.pos.xo + dx / it.k;
            let yo = it.pos.yo + dy / it.k;
            xo = grid ? Math.round(xo / grid) * grid : Math.round(xo);
            yo = grid ? Math.round(yo / grid) * grid : Math.round(yo);
            ops.push(propOps(it.id, { Position: { ...it.pos, xo, yo } }));
          }
        }
        store.previewGesture(ops);
        if (drag.scopeParent && drag.items.length) {
          const pb = A.boxOf(drag.scopeParent);
          const box = A.boxOf(drag.items[0].id);
          setMeasures(pb && box && drag.items.length === 1 ? measureToContainer(box, pb.content) : []);
        }
        if (!drag.moved) setDrag({ ...drag, moved: true });
        return;
      }
      case "resize":
        doResize(drag, w, e.shiftKey, e.altKey, !(e.metaKey || e.ctrlKey));
        return;
      case "marquee": {
        const r = normRect(drag.sx, drag.sy, w.x, w.y);
        setMarquee(r);
        const ids = marqueeHits(r, drag.scope);
        store.set({ selection: [...new Set([...drag.additive, ...ids])] });
        return;
      }
      case "draw": {
        let r = normRect(drag.sx, drag.sy, w.x, w.y);
        if (e.shiftKey) {
          const s = Math.max(r.w, r.h);
          r = { x: w.x < drag.sx ? drag.sx - s : drag.sx, y: w.y < drag.sy ? drag.sy - s : drag.sy, w: s, h: s };
        }
        setDrawRect(r);
        return;
      }
      case "label": {
        const dx = w.x - drag.sx;
        const dy = w.y - drag.sy;
        const n = doc.nodes[drag.id];
        store.previewGesture([{ type: "update", id: drag.id, fields: { canvas: { ...n.canvas!, x: Math.round(drag.canvas.x + dx), y: Math.round(drag.canvas.y + dy) } } }]);
        if (!drag.moved) setDrag({ ...drag, moved: true });
        return;
      }
      case "ref": {
        const dx = w.x - drag.sx;
        const dy = w.y - drag.sy;
        const r = drag.ref;
        const next = drag.mode === "move" ? { ...r, x: Math.round(r.x + dx), y: Math.round(r.y + dy) } : { ...r, w: Math.max(20, Math.round(r.w + dx)), h: Math.max(20, Math.round((r.w + dx) * (r.h / r.w))) };
        store.previewGesture([{ type: "updatePage", id: page.id, references: (page.references ?? []).map((x) => (x.id === r.id ? next : x)) }]);
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    const d = drag;
    setDrag(null);
    setGuides([]);
    setMarquee(null);
    if (!d) return;
    if (d.kind === "move") {
      if (d.reorder) {
        store.cancelGesture();
        const r = A.resolvedOf(d.reorder.parent);
        if (r && A.isStored(d.reorder.id)) {
          const idx = reorderIndex(r, d.reorder.id, w);
          if (idx !== null) store.apply([{ type: "move", id: d.reorder.id, parentId: d.reorder.parent, index: idx }], "Reorder");
        }
      } else if (d.moved) store.commitGesture("Move");
      else store.cancelGesture();
      setMeasures([]);
    } else if (d.kind === "resize") {
      if (d.moved) store.commitGesture("Resize");
      else store.cancelGesture();
      setMeasures([]);
    } else if (d.kind === "label") {
      if (d.moved) store.commitGesture("Move screen");
      else store.cancelGesture();
    } else if (d.kind === "ref") {
      store.commitGesture(d.mode === "move" ? "Move reference" : "Resize reference");
    } else if (d.kind === "draw") {
      let r = drawRect ?? { x: d.sx, y: d.sy, w: 0, h: 0 };
      setDrawRect(null);
      if (r.w < 4 && r.h < 4) {
        const def = d.tool === "text" ? { w: 200, h: 40 } : d.tool === "button" ? { w: 160, h: 48 } : { w: 100, h: 100 };
        r = { x: d.sx - def.w / 2, y: d.sy - def.h / 2, ...def };
      }
      A.createFromTool(d.tool, d.parent, r);
    }
  };

  // ------------------------------------------------------------ resize
  const startResize = (e: React.PointerEvent, id: string, dir: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const box = A.boxOf(id);
    if (!box || isLocked(id)) return;
    const w = toWorld(e.clientX, e.clientY);
    store.beginGesture();
    setDrag({ kind: "resize", sx: w.x, sy: w.y, id, dir, box, moved: false });
  };

  const doResize = (d: Extract<Drag, { kind: "resize" }>, w: { x: number; y: number }, keepAspect: boolean, fromCenter: boolean, snap: boolean) => {
    const b = d.box;
    const dx = w.x - d.sx;
    const dy = w.y - d.sy;
    let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
    const has = (c: string) => d.dir.includes(c);
    if (has("e")) x2 += dx;
    if (has("w")) x1 += dx;
    if (has("s")) y2 += dy;
    if (has("n")) y1 += dy;
    if (snap) {
      const parent = A.parentOf(d.id);
      const targets = snapTargets(parent, [d.id]);
      const which = { x: has("e") ? [2] : has("w") ? [0] : undefined, y: has("s") ? [2] : has("n") ? [0] : undefined };
      const s = snapRect(normRect(x1, y1, x2, y2), targets, 6 / zoom, { ...(which.x ? { x: which.x } : {}), ...(which.y ? { y: which.y } : {}) } as never);
      if (has("e")) x2 += s.dx;
      if (has("w")) x1 += s.dx;
      if (has("s")) y2 += s.dy;
      if (has("n")) y1 += s.dy;
      setGuides(s.guides);
    }
    if (fromCenter) {
      if (has("e")) x1 = b.x - (x2 - (b.x + b.w));
      if (has("w")) x2 = b.x + b.w + (b.x - x1);
      if (has("s")) y1 = b.y - (y2 - (b.y + b.h));
      if (has("n")) y2 = b.y + b.h + (b.y - y1);
    }
    if (keepAspect && b.w > 0 && b.h > 0) {
      const ratio = b.w / b.h;
      const nw = Math.abs(x2 - x1);
      const nh = Math.abs(y2 - y1);
      if (d.dir.length === 2 || has("e") || has("w")) {
        const hh = nw / ratio;
        if (has("n")) y1 = y2 - hh;
        else y2 = y1 + hh;
      } else {
        const ww = nh * ratio;
        if (has("w")) x1 = x2 - ww;
        else x2 = x1 + ww;
      }
    }
    const nb = normRect(x1, y1, x2, y2);
    nb.w = Math.max(1, Math.round(nb.w));
    nb.h = Math.max(1, Math.round(nb.h));
    const ops = resizeOps(d.id, nb);
    if (ops.length) store.previewGesture(ops);
    if (!d.moved) setDrag({ ...d, moved: true });
  };

  /** Convert a desired world box into Size/Position ops, preserving each axis' scale/offset mode. */
  const resizeOps = (id: string, nb: Rect): Op[] => {
    const r = A.resolvedOf(id);
    if (!r) return [];
    const stored = A.isStored(id) ? store.state.doc!.nodes[id] : null;
    if (stored && !stored.parent) {
      const c = stored.canvas ?? { x: 0, y: 0 };
      if (stored.className === "ScreenGui") return [{ type: "update", id, fields: { canvas: { ...c, x: Math.round(nb.x), y: Math.round(nb.y), w: nb.w, h: nb.h, device: undefined } } }];
      const size = propOf<UDim2>(r, "Size");
      return [
        { type: "update", id, fields: { canvas: { ...c, x: Math.round(nb.x), y: Math.round(nb.y) } } },
        { type: "update", id, props: { Size: { ...size, xo: nb.w, yo: nb.h } } },
      ];
    }
    const parent = A.parentOf(id);
    const pb = parent ? A.boxOf(parent) : null;
    if (!pb) return [];
    const area = pb.content;
    const k = pb.scale;
    const own = (A.boxOf(id)?.scale ?? k) / k;
    const size = propOf<UDim2>(r, "Size");
    const pos = propOf<UDim2>(r, "Position");
    const anchor = propOf<Vector2>(r, "AnchorPoint");
    const bw = nb.w / own;
    const bh = nb.h / own;
    const ns: UDim2 = { ...size };
    if (size.xs !== 0 && size.xo === 0) ns.xs = +(bw / Math.max(1, area.w)).toFixed(4);
    else ns.xo = Math.round((bw - area.w * size.xs) / k);
    if (size.ys !== 0 && size.yo === 0) ns.ys = +(bh / Math.max(1, area.h)).toFixed(4);
    else ns.yo = Math.round((bh - area.h * size.ys) / k);
    const props: Record<string, unknown> = { Size: ns };
    if (!A.boxOf(id)?.laidOut) {
      const ax = nb.x + anchor.x * nb.w;
      const ay = nb.y + anchor.y * nb.h;
      const np: UDim2 = { ...pos };
      if (pos.xs !== 0 && pos.xo === 0) np.xs = +((ax - area.x) / Math.max(1, area.w)).toFixed(4);
      else np.xo = Math.round((ax - area.x - area.w * pos.xs) / k);
      if (pos.ys !== 0 && pos.yo === 0) np.ys = +((ay - area.y) / Math.max(1, area.h)).toFixed(4);
      else np.yo = Math.round((ay - area.y - area.h * pos.ys) / k);
      props.Position = np;
    }
    return [propOps(id, props as never)];
  };

  // ------------------------------------------------------------ helpers
  const snapTargets = (parent: string | null, exclude: string[]): Rect[] => {
    const out: Rect[] = [];
    if (parent) {
      const pb = A.boxOf(parent);
      if (pb) out.push(pb.content, pb);
      const pr = A.resolvedOf(parent);
      for (const c of pr?.children ?? []) {
        if (exclude.includes(c.id) || CLASSES[c.className]?.kind !== "gui") continue;
        const b = A.boxOf(c.id);
        if (b && b.visible) out.push(b);
      }
    } else for (const r of roots) if (!exclude.includes(r.id)) out.push(r.rect);
    return out;
  };

  const marqueeHits = (r: Rect, scope: string | null): string[] => {
    const hits = (b: Rect) => b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
    if (!scope) return roots.filter((x) => hits(x.rect) && !doc.nodes[x.id]?.locked).map((x) => x.id);
    const sr = roots.find((x) => x.id === scope);
    if (!sr) return [];
    return sr.tree.children.filter((c) => CLASSES[c.className]?.kind === "gui" && propOf<boolean>(c, "Visible") !== false && !c.locked).filter((c) => {
      const b = sr.layout.get(c.id);
      return b && hits(b);
    }).map((c) => c.id);
  };

  const reorderIndex = (parent: ResolvedNode, id: string, w: { x: number; y: number }): number | null => {
    const stored = doc.nodes[parent.id];
    if (!stored) return null;
    const layoutNode = parent.children.find((c) => ["UIListLayout", "UIGridLayout", "UIPageLayout"].includes(c.className));
    const vertical = layoutNode ? propOf<string>(layoutNode, "FillDirection") === "Vertical" : true;
    const sibs = stored.children.filter((c) => c !== id && CLASSES[doc.nodes[c].className].kind === "gui");
    // Sorted by visual position, find the first sibling whose centre is past the pointer.
    const withBox = sibs.map((c) => ({ c, b: A.boxOf(c)! })).filter((x) => x.b).sort((a, b) => (vertical ? a.b.y - b.b.y : a.b.y - b.b.y || a.b.x - b.b.x));
    let before: string | null = null;
    for (const { c, b } of withBox) {
      const past = vertical ? w.y < b.y + b.h / 2 : (w.y < b.y + b.h && w.x < b.x + b.w / 2) || w.y < b.y;
      if (past) {
        before = c;
        break;
      }
    }
    const order = stored.children.filter((c) => c !== id);
    const idx = before ? order.indexOf(before) : order.length;
    // LayoutOrder takes precedence over child order when SortOrder = LayoutOrder; normalise to equal LayoutOrders via toast.
    return idx;
  };

  const reorderGuides = (parent: ResolvedNode, w: { x: number; y: number }): Guide[] => {
    const pb = A.boxOf(parent.id);
    if (!pb) return [];
    const layoutNode = parent.children.find((c) => ["UIListLayout", "UIGridLayout", "UIPageLayout"].includes(c.className));
    const vertical = layoutNode ? propOf<string>(layoutNode, "FillDirection") === "Vertical" && layoutNode.className !== "UIGridLayout" : false;
    return vertical ? [{ axis: "y", pos: w.y, from: pb.content.x, to: pb.content.x + pb.content.w }] : [{ axis: "x", pos: w.x, from: pb.content.y, to: pb.content.y + pb.content.h }];
  };

  // ------------------------------------------------------------ double click / context menu / drop
  const onDoubleClick = (e: React.MouseEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    const hit = hitChain(roots, w.x, w.y);
    if (!hit) return;
    const sel = store.state.selection;
    const cur = sel.length === 1 ? A.resolvedOf(sel[0]) : null;
    if (cur && CLASSES[cur.className]?.isText && hit.chain.some((n) => n.id === cur.id)) {
      store.set({ editingTextId: cur.id });
      return;
    }
    const t = deeperTarget(hit.chain, sel);
    if (t) {
      store.select([t.id]);
      if (CLASSES[t.className]?.isText && t.id === hit.chain[hit.chain.length - 1].id && sel.includes(A.parentOf(t.id) ?? "")) store.set({ editingTextId: t.id });
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    const hit = hitChain(roots, w.x, w.y);
    if (hit) {
      const t = pickTarget(hit.chain, store.state.selection, A.parentOf, e.metaKey || e.ctrlKey);
      if (t && !store.state.selection.includes(t.id)) store.select([t.id]);
    }
    setMenu({ x: e.clientX, y: e.clientY, world: w });
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const w = toWorld(e.clientX, e.clientY);
    const hit = hitChain(roots, w.x, w.y);
    const parent = hit ? A.containerFor(hit.chain[hit.chain.length - 1].id) : null;
    if (parent) store.select([parent]);
    const raw = e.dataTransfer.getData("application/x-ruis");
    if (raw) {
      const item = JSON.parse(raw) as { kind: string; id: string };
      if (item.kind === "preset") A.insertPreset(item.id, w);
      else if (item.kind === "component") A.insertComponent(item.id, w);
      else if (item.kind === "asset") {
        const a = store.state.assets.find((x) => x.id === item.id);
        if (a?.reference) addReference(a.id, w, a.width, a.height);
        else A.insertImageAsset(item.id, w);
      }
      return;
    }
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/") || f.name.endsWith(".svg"));
    for (const f of files) {
      try {
        const asset = await api.uploadAsset(f);
        await store.loadAssets();
        A.insertImageAsset(asset.id, w);
      } catch (err) {
        store.toast(`Import failed: ${(err as Error).message}`, "error");
      }
    }
  };

  const addReference = (assetId: string, w: { x: number; y: number }, aw = 400, ah = 300) => {
    const scale = Math.min(1, 800 / Math.max(aw, ah));
    const ref: CanvasReference = { id: `r${Date.now().toString(36)}`, assetId, x: Math.round(w.x), y: Math.round(w.y), w: Math.round(aw * scale), h: Math.round(ah * scale), opacity: 1 };
    store.apply([{ type: "updatePage", id: page.id, references: [...(page.references ?? []), ref] }], "Add reference image", { selection: [`ref:${ref.id}`] });
  };

  // ------------------------------------------------------------ render
  const selBoxes = selection.map((id) => ({ id, box: A.boxOf(id) })).filter((x): x is { id: string; box: LayoutBox } => !!x.box);
  const single = selBoxes.length === 1 ? selBoxes[0] : null;
  const hoverBox = hover && !selection.includes(hover) ? A.boxOf(hover) : null;
  const selectedRef = selection.length === 1 && selection[0].startsWith("ref:") ? (page.references ?? []).find((r) => `ref:${r.id}` === selection[0]) : null;
  const isComponentish = (id: string) => {
    const r = A.resolvedOf(id);
    return !!(r?.instanceOf || r?.masterOf || r?.instanceRoot);
  };
  const editing = editingTextId ? A.resolvedOf(editingTextId) : null;
  const editingBox = editingTextId ? A.boxOf(editingTextId) : null;
  const toolCursor = tool === "hand" || space ? "tool-hand" : tool !== "select" ? "tool-create" : "";
  const gridStep = zoom >= 8 ? 1 : 0;

  return (
    <div
      ref={ref}
      className={`canvas ${toolCursor}${drag?.kind === "pan" ? " panning dragging" : ""}${dropping ? " dropzone-active" : ""}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => store.state.hover && store.set({ hover: null })}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dropping) setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
      data-testid="canvas"
    >
      {gridStep > 0 && <div className="grid-bg" style={{ backgroundImage: `linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)`, backgroundSize: `${zoom}px ${zoom}px`, backgroundPosition: `${vx}px ${vy}px` }} />}
      <div className="world" style={{ transform: `translate(${vx}px, ${vy}px) scale(${zoom})` }}>
        {(page.references ?? []).map((r) => (
          <img key={r.id} className="reference-img" src={api.assetUrl(r.assetId)} style={{ left: r.x, top: r.y, width: r.w, height: r.h, opacity: r.opacity }} draggable={false} />
        ))}
        {roots.map((r) => (
          <Artboard key={r.id} root={r} zoom={zoom} selected={selection.includes(r.id)} assets={assets} onLabelDown={(e) => {
            e.stopPropagation();
            (e.target as Element).setPointerCapture?.(e.pointerId);
            store.select([r.id]);
            if (doc.nodes[r.id]?.locked) return;
            const w = toWorld(e.clientX, e.clientY);
            store.beginGesture();
            setDrag({ kind: "label", sx: w.x, sy: w.y, id: r.id, canvas: { ...(doc.nodes[r.id].canvas ?? { x: 0, y: 0 }) }, moved: false });
          }} />
        ))}
      </div>
      <div className="overlay">
        {drag?.kind === "move" && drag.scopeParent && A.boxOf(drag.scopeParent) && <div className="parent-box" style={rectStyle(toScreen(A.boxOf(drag.scopeParent)!.content))} />}
        {hoverBox && <div className="hover-box" style={rectStyle(toScreen(hoverBox))} />}
        {selBoxes.map(({ id, box }) => (
          <div key={id} className={`sel-box${isComponentish(id) ? " component" : ""}`} style={{ ...rectStyle(toScreen(box)), transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined }} />
        ))}
        {selectedRef && <div className="sel-box" style={rectStyle(toScreen(selectedRef))}><div className="handle" style={{ left: "100%", top: "100%" }} /></div>}
        {single && !drag && !editingTextId && !isLocked(single.id) && (
          <>
            {HANDLE_DIRS.map((dir) => {
              const s = toScreen(single.box);
              const hx = dir.includes("w") ? s.x : dir.includes("e") ? s.x + s.w : s.x + s.w / 2;
              const hy = dir.includes("n") ? s.y : dir.includes("s") ? s.y + s.h : s.y + s.h / 2;
              if ((dir === "n" || dir === "s") && s.w < 24) return null;
              if ((dir === "e" || dir === "w") && s.h < 24) return null;
              return <div key={dir} className="handle" data-handle={dir} style={{ left: hx, top: hy, cursor: `${dir}-resize` }} onPointerDown={(e) => startResize(e, single.id, dir)} />;
            })}
          </>
        )}
        {single && !editingTextId && (() => {
          const s = toScreen(single.box);
          return <div className="size-label" style={{ left: s.x + s.w / 2, top: s.y + s.h + 6 }}>{Math.round(single.box.w)} × {Math.round(single.box.h)}</div>;
        })()}
        {guides.map((g, i) =>
          g.axis === "x" ? (
            <div key={i} className="guide" style={{ left: g.pos * zoom + vx, top: g.from * zoom + vy, width: 1, height: (g.to - g.from) * zoom }} />
          ) : (
            <div key={i} className="guide" style={{ top: g.pos * zoom + vy, left: g.from * zoom + vx, height: 1, width: (g.to - g.from) * zoom }} />
          ),
        )}
        {(drag?.kind === "move" || drag?.kind === "resize" || alt) && measures.map((m, i) => {
          const x1 = m.x1 * zoom + vx, y1 = m.y1 * zoom + vy, x2 = m.x2 * zoom + vx, y2 = m.y2 * zoom + vy;
          return (
            <div key={i}>
              <div className="measure" style={{ left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.max(1, Math.abs(x2 - x1)), height: Math.max(1, Math.abs(y2 - y1)) }} />
              <div className="measure-label" style={{ left: (x1 + x2) / 2, top: (y1 + y2) / 2 }}>{m.label}</div>
            </div>
          );
        })}
        {marquee && <div className="marquee" style={rectStyle(toScreen(marquee))} />}
        {drawRect && <div className="marquee" style={rectStyle(toScreen(drawRect))} />}
        {editing && editingBox && <TextEditor node={editing} box={editingBox} screen={toScreen(editingBox)} zoom={zoom} />}
      </div>
      {tool !== "select" && tool !== "hand" && <div className="canvas-hint">Drag to draw a {A.TOOL_CLASS[tool]} · click for default size · Esc to cancel</div>}
      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} onAddReference={addReference} />}
    </div>
  );
}

function Artboard({ root, zoom, selected, onLabelDown, assets }: { root: SceneRoot; zoom: number; selected: boolean; onLabelDown: (e: React.PointerEvent) => void; assets: { id: string; width?: number; height?: number }[] }) {
  const { tree, layout, rect } = root;
  const isScreen = tree.className === "ScreenGui";
  const opts = {
    assetUrl: api.assetUrl,
    assetSize: (id: string) => {
      const a = assets.find((x) => x.id === id);
      return a?.width && a?.height ? { w: a.width, h: a.height } : undefined;
    },
    respectEditorHidden: true,
  };
  const d = store.state.doc!;
  const stored = d.nodes[root.id];
  const label = (
    <div className={`artboard-label${selected ? " selected" : ""}`} style={{ transform: `scale(${1 / zoom})`, width: `${rect.w * zoom}px` }} onPointerDown={onLabelDown}>
      <span>{tree.name}</span>
      {isScreen && <span className="dim">{rect.w}×{rect.h}</span>}
      {tree.masterOf && <span style={{ color: "var(--component)" }}>◆ Component</span>}
    </div>
  );
  if (!isScreen) {
    return (
      <div className="artboard" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} data-root={root.id}>
        {label}
        <RootRenderer tree={tree} layout={layout} opts={opts} />
      </div>
    );
  }
  const inset = !propOf<boolean>(tree, "IgnoreGuiInset");
  return (
    <div className="artboard" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} data-root={root.id}>
      {label}
      <div className="artboard-screen">
        <div className="world-bg" />
        {inset && <div className="topbar-inset" style={{ height: ROBLOX_TOPBAR_INSET }} />}
        <RootRenderer tree={tree} layout={layout} opts={opts} />
      </div>
      {stored?.locked && <div style={{ position: "absolute", right: 0, bottom: "100%", fontSize: 12 / zoom, color: "var(--text-3)" }}>locked</div>}
    </div>
  );
}

function TextEditor({ node, box, screen, zoom }: { node: ResolvedNode; box: LayoutBox; screen: Rect; zoom: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const original = propOf<string>(node, "Text");
  useEffect(() => {
    const el = ref.current!;
    el.innerText = original;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const text = ref.current?.innerText ?? original;
    store.set({ editingTextId: null });
    if (text !== original) A.setProps([node.id], { Text: text.replace(/\n$/, "") }, "Edit text");
  };
  const f = cssFont(propOf(node, "FontFace"));
  const size = (box.textSize ?? propOf<number>(node, "TextSize")) * zoom;
  const xa = propOf<string>(node, "TextXAlignment");
  const style: CSSProperties = {
    ...rectStyle(screen), fontFamily: f.family, fontWeight: f.weight, fontStyle: f.style, fontSize: size,
    lineHeight: `${propOf<number>(node, "LineHeight") * size}px`, color: propOf<string>(node, "TextColor3"),
    textAlign: xa === "Left" ? "left" : xa === "Right" ? "right" : "center", display: "flex", alignItems: "center",
    justifyContent: xa === "Left" ? "flex-start" : xa === "Right" ? "flex-end" : "center", background: "rgba(0,0,0,0.25)",
  };
  return (
    <div
      ref={ref}
      className="text-editor"
      contentEditable
      suppressContentEditableWarning
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        }
      }}
    />
  );
}

function rectStyle(r: Rect): CSSProperties {
  return { left: r.x, top: r.y, width: r.w, height: r.h };
}

function normRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function unionOf(rs: Rect[]): Rect {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}
