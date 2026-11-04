/**
 * Editor commands. Keyboard shortcuts, menus, toolbar and panels all call
 * these, so behaviour is consistent everywhere.
 */
import { CLASSES, canParent } from "../core/classes";
import { findResolved, makeNode, newId, nowIso, propOf, resolveTree } from "../core/document";
import { cloneSubtree, detachOps, groupOps, propOps, splitRef, topOf, ungroupOps } from "../core/edit";
import type { Op, PropPatch } from "../core/ops";
import { findPreset } from "../core/presets";
import { baselineProps, buildNodes, toSpec, type NodeSpec } from "../core/spec";
import type { DesignDocument, DesignNode, UDim2, Vector2 } from "../core/types";
import { store } from "./store";
import type { SceneRoot } from "./scene";

const doc = () => store.state.doc!;

export function sceneRootFor(effId: string): SceneRoot | undefined {
  const d = doc();
  const top = topOf(d, effId.split("/")[0]);
  return store.scene().find((r) => r.id === top);
}

export function boxOf(effId: string) {
  return sceneRootFor(effId)?.layout.get(effId);
}

export function resolvedOf(effId: string) {
  const r = sceneRootFor(effId);
  return r ? findResolved(r.tree, effId) : null;
}

/** Effective parent id of a node (handles instance children). */
export function parentOf(effId: string): string | null {
  const r = sceneRootFor(effId);
  return r?.layout.get(effId)?.parentId ?? null;
}

export const isStored = (effId: string) => !effId.includes("/");

function selectedStored(): string[] {
  return store.state.selection.filter(isStored).filter((id) => doc().nodes[id]);
}

/** Selected stored nodes with ancestors-of-selected removed. */
function selectedTops(): string[] {
  const d = doc();
  const ids = selectedStored();
  const set = new Set(ids);
  return ids.filter((id) => {
    let p = d.nodes[id].parent;
    while (p) {
      if (set.has(p)) return false;
      p = d.nodes[p]?.parent ?? null;
    }
    return true;
  });
}

// ------------------------------------------------------------ props

export function setProps(ids: string[], props: PropPatch, label = "Edit properties") {
  const d = doc();
  const ops: Op[] = [];
  for (const id of ids) {
    const r = resolvedOf(id);
    if (!r) continue;
    // Only apply props the class supports.
    const supported: PropPatch = {};
    for (const [k, v] of Object.entries(props)) if (CLASSES[r.className].props.some((p) => p.name === k)) supported[k] = v;
    if (!Object.keys(supported).length) continue;
    if (!isStored(id) || d.nodes[id]) ops.push(propOps(id, supported));
  }
  return store.apply(ops, label);
}

export function setFields(id: string, fields: Record<string, unknown>, label = "Edit") {
  if (!isStored(id)) return false;
  return store.apply([{ type: "update", id, fields }], label);
}

// ------------------------------------------------------------ creation

/**
 * Find a container for new content at an effective id or its ancestors:
 * a stored, non-instance Frame-like object (not text, image or button —
 * Roblox allows children there, but it is rarely what the user wants).
 */
export function containerFor(effId: string | null): string | null {
  const d = doc();
  let cur = effId;
  while (cur) {
    if (isStored(cur)) {
      const n = d.nodes[cur];
      const c = n && CLASSES[n.className];
      if (n && !n.instance && (n.className === "ScreenGui" || (c.kind === "gui" && !c.isText && !c.isImage && !c.isButton))) return cur;
    }
    cur = parentOf(cur);
  }
  return null;
}

export function insertSpecs(specs: NodeSpec[], parentId: string | null, at?: { x: number; y: number }, label = "Insert"): string[] {
  const d = doc();
  const ops: Op[] = [];
  const roots: string[] = [];
  for (const spec of specs) {
    const nodes = buildNodes(d, spec, parentId, "root", { lenientTokens: true });
    if (!parentId) {
      nodes[0].canvas = { x: Math.round(at?.x ?? 0), y: Math.round(at?.y ?? 0), ...(nodes[0].className === "ScreenGui" ? { w: 1920, h: 1080 } : {}) };
    } else if (at) {
      // Position the new node's top-left at `at` (world coords) inside the parent content box.
      const pbox = boxOf(parentId);
      if (pbox) {
        // Instances inherit Size/AnchorPoint from their main component.
        const masterProps = nodes[0].instance ? d.nodes[d.components[nodes[0].instance.componentId]?.rootId]?.props ?? {} : {};
        const size = (nodes[0].props.Size ?? masterProps.Size ?? { xs: 0, xo: 100, ys: 0, yo: 100 }) as UDim2;
        const w = pbox.content.w * size.xs + size.xo;
        const h = pbox.content.h * size.ys + size.yo;
        const anchor = (nodes[0].props.AnchorPoint ?? masterProps.AnchorPoint ?? { x: 0, y: 0 }) as Vector2;
        nodes[0].props.Position = { xs: 0, xo: Math.round(at.x - pbox.content.x + anchor.x * w), ys: 0, yo: Math.round(at.y - pbox.content.y + anchor.y * h) };
      }
    }
    ops.push({ type: "insert", nodes, pageId: parentId ? undefined : store.state.pageId });
    roots.push(nodes[0].id);
  }
  if (store.apply(ops, label, { selection: roots })) return roots;
  return [];
}

export const TOOL_CLASS: Record<string, string> = { frame: "Frame", text: "TextLabel", button: "TextButton", image: "ImageLabel", scroll: "ScrollingFrame" };

export function createFromTool(tool: string, parentId: string | null, rect: { x: number; y: number; w: number; h: number }) {
  const className = TOOL_CLASS[tool];
  const props: Record<string, unknown> = { Size: [0, Math.round(rect.w), 0, Math.round(rect.h)] };
  if (tool === "text") Object.assign(props, { Text: "Text", TextColor3: "#FFFFFF", TextSize: 24 });
  if (tool === "button") Object.assign(props, { Text: "Button" });
  if (tool === "frame" && !parentId) Object.assign(props, { BackgroundColor3: "#FFFFFF" });
  const spec: NodeSpec = { className, name: tool === "text" ? "TextLabel" : className, props, ...(tool === "button" ? { corner: 8 } : {}) };
  if (tool === "scroll") spec.list = { Padding: 8 };
  const ids = insertSpecs([spec], parentId, { x: rect.x, y: rect.y }, `Create ${className}`);
  if (ids.length) store.set({ tool: "select", ...(tool === "text" ? { editingTextId: ids[0] } : {}) });
  return ids[0];
}

export function addScreen(name = "Screen", w = 1920, h = 1080, device = "desktop-1080p") {
  const roots = store.scene();
  const x = roots.length ? Math.max(...roots.map((r) => r.rect.x + r.rect.w)) + 160 : 0;
  const s = makeNode("ScreenGui", { name, props: { ResetOnSpawn: false, IgnoreGuiInset: true, ZIndexBehavior: "Sibling", ScreenInsets: "CoreUISafeInsets" }, canvas: { x, y: 0, w, h, device } });
  if (store.apply([{ type: "insert", nodes: [s], pageId: store.state.pageId }], "Add screen", { selection: [s.id] })) {
    store.fitRect({ x, y: -30, w, h: h + 30 });
  }
}

export function insertPreset(presetId: string, at?: { x: number; y: number }) {
  const p = findPreset(presetId);
  if (!p) return;
  const target = containerFor(store.state.selection[0] ?? null) ?? firstScreen();
  const pos = at ?? centerOfParent(target, p.spec);
  insertSpecs([structuredClone(p.spec)], target, pos, `Insert ${p.name}`);
}

function firstScreen(): string | null {
  const d = doc();
  const page = d.pages.find((p) => p.id === store.state.pageId)!;
  return page.children.find((id) => d.nodes[id]?.className === "ScreenGui") ?? null;
}

/** World position so that a spec's offset box is centred in a parent. */
function centerOfParent(parentId: string | null, spec: NodeSpec): { x: number; y: number } | undefined {
  if (!parentId) return viewportCenter();
  const b = boxOf(parentId);
  if (!b) return undefined;
  const s = spec.props?.Size as number[] | undefined;
  const w = Array.isArray(s) ? b.content.w * s[0] + s[1] : 100;
  const h = Array.isArray(s) ? b.content.h * s[2] + s[3] : 100;
  return { x: b.content.x + (b.content.w - w) / 2, y: b.content.y + (b.content.h - h) / 2 };
}

export function viewportCenter() {
  const v = store.state.viewport;
  return { x: (store.canvasSize.w / 2 - v.x) / v.zoom, y: (store.canvasSize.h / 2 - v.y) / v.zoom };
}

export function insertComponent(componentId: string, at?: { x: number; y: number }) {
  const d = doc();
  const master = d.nodes[d.components[componentId]?.rootId];
  if (!master) return;
  let target = containerFor(store.state.selection[0] ?? null) ?? firstScreen();
  // never inside its own master
  while (target && (target === master.id || isInside(target, master.id))) target = d.nodes[target].parent;
  insertSpecs([{ className: master.className, component: componentId }], target, at ?? centerOfParent(target, { className: "Frame", props: { Size: [0, (master.props.Size as UDim2)?.xo ?? 100, 0, (master.props.Size as UDim2)?.yo ?? 100] } }), `Insert ${d.components[componentId].name}`);
}

function isInside(id: string, ancestor: string) {
  let cur = doc().nodes[id]?.parent;
  while (cur) {
    if (cur === ancestor) return true;
    cur = doc().nodes[cur]?.parent ?? null;
  }
  return false;
}

export function insertImageAsset(assetId: string, at?: { x: number; y: number }) {
  const a = store.state.assets.find((x) => x.id === assetId);
  if (!a) return;
  const sel = store.state.selection[0];
  const r = sel ? resolvedOf(sel) : null;
  if (r && CLASSES[r.className].isImage && !at) {
    setProps([sel], { Image: `asset://${assetId}` }, "Set image");
    return;
  }
  const w = Math.min(256, a.width ?? 128);
  const h = Math.round(w * ((a.height ?? 128) / (a.width ?? 128)));
  const target = containerFor(sel ?? null) ?? firstScreen();
  insertSpecs([{ className: "ImageLabel", name: a.name.replace(/\.\w+$/, ""), props: { Image: `asset://${assetId}`, Size: [0, w, 0, h], ScaleType: "Fit" } }], target, at ?? centerOfParent(target, { className: "ImageLabel", props: { Size: [0, w, 0, h] } }), "Insert image");
}

export function addModifier(effId: string, className: string) {
  if (!isStored(effId)) return store.toast("Modifiers can't be added inside a component instance — edit the master", "error");
  const d = doc();
  const n = d.nodes[effId];
  if (!canParent(n.className, className)) return store.toast(`${className} can't be added to ${n.className}`, "error");
  if (CLASSES[className].onePerParent && n.children.some((c) => d.nodes[c]?.className === className)) return store.toast(`${n.name} already has a ${className}`, "error");
  const defaults: Record<string, Record<string, unknown>> = {
    UICorner: { CornerRadius: { s: 0, o: 8 } },
    UIStroke: { Color: "#FFFFFF", Thickness: 2, ApplyStrokeMode: "Border" },
    UIGradient: { Color: [{ t: 0, color: "#FFFFFF" }, { t: 1, color: "#9AA3B8" }], Rotation: 90 },
    UIPadding: { PaddingTop: { s: 0, o: 8 }, PaddingBottom: { s: 0, o: 8 }, PaddingLeft: { s: 0, o: 8 }, PaddingRight: { s: 0, o: 8 } },
    UIListLayout: { Padding: { s: 0, o: 8 } },
    UIGridLayout: { CellPadding: { xs: 0, xo: 8, ys: 0, yo: 8 } },
  };
  const nodes = buildNodes(d, { className, props: defaults[className] ?? {} }, effId);
  // Modifiers go first so layers read "modifiers, then content".
  const firstGui = n.children.findIndex((c) => CLASSES[d.nodes[c]?.className]?.kind === "gui");
  store.apply([{ type: "insert", nodes, index: firstGui < 0 ? n.children.length : firstGui }], `Add ${className}`);
}

// ------------------------------------------------------------ structure

export function deleteSelection() {
  const tops = selectedTops();
  if (!tops.length) {
    if (store.state.selection.length) store.toast("Items inside a component instance can't be deleted (set Visible off, or detach)", "error");
    return;
  }
  store.apply(tops.map((id) => ({ type: "remove", id }) as Op), `Delete ${tops.length}`, { selection: [] });
}

export function duplicateSelection(offset = 16) {
  const d = doc();
  const tops = selectedTops();
  const ops: Op[] = [];
  const created: string[] = [];
  for (const id of tops) {
    const n = d.nodes[id];
    const nodes = cloneSubtree(d, id, n.parent);
    const siblings = n.parent ? d.nodes[n.parent].children : d.pages.find((p) => p.children.includes(id))!.children;
    if (!n.parent && n.canvas) {
      const box = boxOf(id);
      nodes[0].canvas = { ...n.canvas, x: n.canvas.x + (box?.w ?? 100) + 80 };
    } else if (!isLaidOut(id)) {
      const pos = (n.props.Position as UDim2) ?? { xs: 0, xo: 0, ys: 0, yo: 0 };
      nodes[0].props.Position = { ...pos, xo: pos.xo + offset, yo: pos.yo + offset };
    }
    ops.push({ type: "insert", nodes, index: siblings.indexOf(id) + 1, pageId: n.parent ? undefined : store.state.pageId });
    created.push(nodes[0].id);
  }
  store.apply(ops, "Duplicate", { selection: created });
}

export function isLaidOut(effId: string) {
  return !!boxOf(effId)?.laidOut;
}

export async function copySelection(cut = false) {
  const d = doc();
  const tops = selectedTops();
  if (!tops.length) return;
  const specs = tops.map((id) => toSpec(d, id));
  store.clipboard = { specs, sourceParent: d.nodes[tops[0]].parent };
  try {
    await navigator.clipboard.writeText(JSON.stringify({ "roblox-ui-studio/specs": specs }, null, 1));
  } catch {
    /* clipboard permission denied: internal clipboard still works */
  }
  if (cut) deleteSelection();
  else store.toast(`Copied ${tops.length} item${tops.length > 1 ? "s" : ""}`);
}

export async function paste() {
  let specs = store.clipboard?.specs;
  try {
    const text = await navigator.clipboard.readText();
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed["roblox-ui-studio/specs"])) specs = parsed["roblox-ui-studio/specs"];
    else if (parsed && typeof parsed.className === "string") specs = [parsed];
  } catch {
    /* use internal clipboard */
  }
  if (!specs?.length) return;
  const d = doc();
  const sel = store.state.selection[0];
  let parent = sel ? containerFor(sel) : store.clipboard?.sourceParent ?? null;
  if (sel && isStored(sel) && d.nodes[sel] && store.clipboard && d.nodes[sel].parent === store.clipboard.sourceParent && !specs.some((s) => d.nodes[sel].name !== s.name)) parent = d.nodes[sel].parent;
  // Components referenced by id must exist in this document.
  const clean = (s: NodeSpec): NodeSpec => (s.component && !d.components[s.component] ? { ...s, component: undefined, overrides: undefined } : { ...s, children: s.children?.map(clean) });
  const ready = specs.map(clean).map((s) => {
    if (parent && s.props?.Position) {
      const p = s.props.Position as UDim2;
      return { ...s, props: { ...s.props, Position: { ...p, xo: p.xo + 16, yo: p.yo + 16 } } };
    }
    return s;
  });
  if (parent && !canParent(d.nodes[parent].className, ready[0].className)) parent = null;
  const at = parent ? undefined : viewportCenter();
  try {
    insertSpecs(ready, parent, at, "Paste");
  } catch (e) {
    store.toast(`Paste failed: ${(e as Error).message}`, "error");
  }
}

export function groupSelection() {
  const d = doc();
  const ids = selectedTops();
  if (!ids.length) return;
  const parent = d.nodes[ids[0]].parent;
  if (!parent || ids.some((id) => d.nodes[id].parent !== parent)) return store.toast("Select siblings inside the same parent to group them", "error");
  const root = sceneRootFor(ids[0]);
  if (!root) return;
  const g = groupOps(d, root.layout, ids, parent, "Group");
  store.apply(g.ops, "Group", { selection: [g.groupId] });
}

export function ungroupSelection() {
  const d = doc();
  const ids = selectedStored().filter((id) => d.nodes[id].parent && d.nodes[id].className === "Frame" && !d.nodes[id].instance);
  if (!ids.length) return;
  const children: string[] = [];
  const ops: Op[] = [];
  // One group per call keeps child indices exact.
  for (const id of ids.slice(0, 1)) {
    const root = sceneRootFor(id);
    if (!root) continue;
    children.push(...d.nodes[id].children.filter((c) => CLASSES[d.nodes[c].className].kind === "gui"));
    ops.push(...ungroupOps(d, root.layout, id));
  }
  store.apply(ops, "Ungroup", { selection: children });
}

export function wrapInFrame() {
  groupSelection();
}

export function makeComponent() {
  const d = doc();
  const ids = selectedTops();
  if (ids.length !== 1) return store.toast("Select one element to make a component", "error");
  const n = d.nodes[ids[0]];
  if (n.componentId) return store.toast(`${n.name} is already a component`, "error");
  if (n.instance) return store.toast("Detach the instance first", "error");
  if (CLASSES[n.className].kind !== "gui") return store.toast("Only GUI objects can become components", "error");
  const id = newId("cmp");
  store.apply(
    [
      { type: "setComponent", id, def: { id, name: n.name, rootId: n.id, createdAt: nowIso() } },
      { type: "update", id: n.id, fields: { componentId: id } },
    ],
    `Create component ${n.name}`,
  );
}

export function detachSelection() {
  const d = doc();
  const ids = selectedStored().filter((id) => d.nodes[id].instance);
  if (!ids.length) return;
  const ops: Op[] = [];
  const created: string[] = [];
  for (const id of ids) {
    const r = detachOps(d, id);
    ops.push(...r.ops);
    created.push(r.newId);
  }
  store.apply(ops, "Detach instance", { selection: created });
}

export function resetOverrides(instanceId: string) {
  const n = doc().nodes[instanceId];
  if (!n?.instance) return;
  store.apply([{ type: "update", id: instanceId, fields: { instance: { componentId: n.instance.componentId, overrides: {} } } }], "Reset overrides");
}

export function goToMaster(componentId: string) {
  const d = doc();
  const c = d.components[componentId];
  if (!c) return;
  const top = topOf(d, c.rootId);
  const page = d.pages.find((p) => p.children.includes(top));
  if (page && page.id !== store.state.pageId) store.set({ pageId: page.id });
  store.select([c.rootId]);
  zoomToSelection();
}

/** Move selected siblings forward/backward in their parent (draw order). */
export function reorder(dir: "forward" | "backward" | "front" | "back") {
  const d = doc();
  const ops: Op[] = [];
  for (const id of selectedTops()) {
    const n = d.nodes[id];
    const sibs = n.parent ? d.nodes[n.parent].children : d.pages.find((p) => p.children.includes(id))!.children;
    const i = sibs.indexOf(id);
    let j = dir === "forward" ? i + 1 : dir === "backward" ? i - 1 : dir === "front" ? sibs.length - 1 : 0;
    j = Math.max(0, Math.min(sibs.length - 1, j));
    if (j !== i) ops.push({ type: "move", id, parentId: n.parent, index: j, pageId: n.parent ? undefined : store.state.pageId });
  }
  if (ops.length) store.apply(ops, "Reorder");
}

export function nudge(dx: number, dy: number) {
  const d = doc();
  const ops: Op[] = [];
  for (const id of store.state.selection) {
    if (isStored(id) && !d.nodes[id]) continue;
    const r = resolvedOf(id);
    if (!r) continue;
    if (isStored(id) && !d.nodes[id].parent) {
      const c = d.nodes[id].canvas ?? { x: 0, y: 0 };
      ops.push({ type: "update", id, fields: { canvas: { ...c, x: c.x + dx, y: c.y + dy } } });
      continue;
    }
    if (isLaidOut(id)) continue;
    const p = propOf<UDim2>(r, "Position");
    const k = boxOf(id)?.scale ?? 1;
    ops.push(propOps(id, { Position: { ...p, xo: p.xo + dx / k, yo: p.yo + dy / k } }));
  }
  if (ops.length) store.apply(ops, "Nudge");
}

export function selectParent() {
  const id = store.state.selection[0];
  if (!id) return;
  const p = parentOf(id);
  if (p) store.select([p]);
}

export function selectChildren() {
  const id = store.state.selection[0];
  const r = id ? resolvedOf(id) : null;
  if (!r) return;
  const kids = r.children.filter((c) => CLASSES[c.className].kind === "gui").map((c) => c.id);
  if (kids.length) store.select(kids);
}

export function selectAll() {
  const id = store.state.selection[0];
  if (id) {
    const p = parentOf(id);
    const r = p ? resolvedOf(p) : null;
    if (r) return store.select(r.children.filter((c) => CLASSES[c.className].kind === "gui").map((c) => c.id));
  }
  const page = doc().pages.find((p) => p.id === store.state.pageId)!;
  store.select([...page.children]);
}

export function zoomToSelection() {
  const boxes = store.state.selection.map(boxOf).filter((b): b is NonNullable<typeof b> => !!b);
  if (!boxes.length) return store.fitAll();
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  store.fitRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, 120);
}

export function toggleVisible(id: string) {
  const r = resolvedOf(id);
  if (!r) return;
  setProps([id], { Visible: !propOf<boolean>(r, "Visible") }, "Toggle visibility");
}

export function toggleLock(id: string) {
  if (!isStored(id)) return;
  const n = doc().nodes[id];
  setFields(id, { locked: n.locked ? null : true }, n.locked ? "Unlock" : "Lock");
}

/** Convert Size or Position between Scale and Offset, keeping the current on-screen result. */
export function convertUnits(ids: string[], prop: "Size" | "Position", to: "scale" | "offset") {
  const ops: Op[] = [];
  for (const id of ids) {
    const r = resolvedOf(id);
    const box = boxOf(id);
    const parent = parentOf(id);
    const pbox = parent ? boxOf(parent) : null;
    if (!r || !box || !pbox) continue;
    const area = pbox.canvas ? pbox.content : pbox.content;
    const k = pbox.scale;
    const anchor = propOf<Vector2>(r, "AnchorPoint");
    let w = box.w;
    let h = box.h;
    let x = box.x - area.x + anchor.x * box.w;
    let y = box.y - area.y + anchor.y * box.h;
    if (prop === "Size") {
      const own = box.scale / k;
      w /= own;
      h /= own;
    }
    const [vx, vy] = prop === "Size" ? [w, h] : [x, y];
    const v: UDim2 =
      to === "scale"
        ? { xs: area.w ? +(vx / area.w).toFixed(4) : 0, xo: 0, ys: area.h ? +(vy / area.h).toFixed(4) : 0, yo: 0 }
        : { xs: 0, xo: Math.round(vx / k), ys: 0, yo: Math.round(vy / k) };
    ops.push(propOps(id, { [prop]: v }));
  }
  if (ops.length) store.apply(ops, `${prop} to ${to}`);
}

/** Spec for a stored node (for the "copy as JSON" command). */
export function specOf(id: string): NodeSpec | null {
  const d = doc();
  return d.nodes[id] ? toSpec(d, id) : null;
}

export function renameNode(id: string, name: string) {
  if (!isStored(id) || !name.trim()) return;
  setFields(id, { name: name.trim() }, "Rename");
}

export function moveNodeTo(id: string, parentId: string | null, index: number) {
  const d = doc();
  if (!isStored(id) || (parentId && !isStored(parentId))) return;
  const n = d.nodes[id];
  const ops: Op[] = [{ type: "move", id, parentId, index, pageId: parentId ? undefined : store.state.pageId }];
  if (!parentId && n.parent) {
    // becoming top-level: give it a canvas position near its old screen location
    const b = boxOf(id);
    ops.push({ type: "update", id, fields: { canvas: { x: Math.round(b?.x ?? 0), y: Math.round(b?.y ?? 0) } } });
  }
  store.apply(ops, "Move layer");
}

export { baselineProps, splitRef, resolveTree };
export type { DesignDocument, DesignNode };

/** Escape: go to the parent of the selection; at the top level, clear. */
export function selectParentOrClear() {
  const id = store.state.selection[0];
  const p = id ? parentOf(id) : null;
  const d = doc();
  if (p && !(d.nodes[p]?.className === "ScreenGui" && !d.nodes[p].parent)) store.select([p]);
  else store.select([]);
}

/** Resolved node WITHOUT animation sampling (the stored/base values). */
export function baseResolvedOf(effId: string) {
  const d = doc();
  const t = resolveTree(d, topOf(d, effId.split("/")[0]));
  return t ? findResolved(t, effId) : null;
}
