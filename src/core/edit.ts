/**
 * Higher-level editing operations that produce op batches. Shared by the
 * editor UI and the tool API so both behave identically.
 */
import { CLASSES } from "./classes";
import { descendants, makeNode, newId, resolveTree } from "./document";
import type { LayoutMap } from "./layout";
import type { Op, PropPatch } from "./ops";
import type { DesignDocument, DesignNode, Props, UDim2, Vector2 } from "./types";

/** Split an effective id into stored id or (instance root, override key). */
export function splitRef(effId: string): { storedId?: string; instanceRoot?: string; overrideKey?: string } {
  const i = effId.indexOf("/");
  if (i < 0) return { storedId: effId };
  return { instanceRoot: effId.slice(0, i), overrideKey: effId.slice(i + 1) };
}

/** Ops to set props on a node or, inside an instance, as an override. */
export function propOps(effId: string, props: PropPatch): Op {
  const r = splitRef(effId);
  if (r.instanceRoot) return { type: "override", instanceId: r.instanceRoot, key: r.overrideKey!, props };
  return { type: "update", id: r.storedId!, props };
}

/** Deep copy of a stored subtree with fresh ids. Masters become plain nodes. */
export function cloneSubtree(d: DesignDocument, rootId: string, parent: string | null): DesignNode[] {
  const map = new Map<string, string>();
  const ids = [rootId, ...descendants(d, rootId)];
  for (const id of ids) map.set(id, newId());
  return ids.map((id) => {
    const n = structuredClone(d.nodes[id]);
    const copy: DesignNode = { ...n, id: map.get(id)!, parent: id === rootId ? parent : map.get(n.parent!)!, children: n.children.map((c) => map.get(c)!) };
    delete copy.componentId;
    return copy;
  });
}

export function topOf(d: DesignDocument, id: string): string {
  let cur = d.nodes[id];
  while (cur?.parent) cur = d.nodes[cur.parent];
  return cur?.id ?? id;
}

/** Wrap sibling nodes in a transparent Frame covering them; children keep their screen position. */
export function groupOps(d: DesignDocument, layout: LayoutMap, ids: string[], parent: string, name: string): { ops: Op[]; groupId: string } {
  const pbox = layout.get(parent)!;
  const boxes = ids.map((id) => layout.get(id)!);
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  const group = makeNode("Frame", {
    name, parent,
    props: {
      BackgroundTransparency: 1, BorderSizePixel: 0,
      Position: { xs: 0, xo: Math.round(minX - pbox.content.x), ys: 0, yo: Math.round(minY - pbox.content.y) },
      Size: { xs: 0, xo: Math.round(maxX - minX), ys: 0, yo: Math.round(maxY - minY) },
    },
  });
  const order = d.nodes[parent].children;
  const sorted = [...ids].sort((x, y) => order.indexOf(x) - order.indexOf(y));
  const ops: Op[] = [{ type: "insert", nodes: [group], index: order.indexOf(sorted[0]) }];
  sorted.forEach((id, i) => {
    const b = layout.get(id)!;
    const n = d.nodes[id];
    const anchor = (n.props.AnchorPoint as Vector2) ?? { x: 0, y: 0 };
    const size = (n.props.Size as UDim2) ?? { xs: 0, xo: 100, ys: 0, yo: 100 };
    ops.push({ type: "move", id, parentId: group.id, index: i });
    ops.push({
      type: "update", id,
      props: {
        Position: { xs: 0, xo: Math.round(b.x - minX + anchor.x * b.w), ys: 0, yo: Math.round(b.y - minY + anchor.y * b.h) },
        ...(size.xs || size.ys ? { Size: { xs: 0, xo: Math.round(b.w), ys: 0, yo: Math.round(b.h) } } : {}),
      },
    });
  });
  return { ops, groupId: group.id };
}

/** Move a group's GUI children to its parent (keeping positions) and remove the group. */
export function ungroupOps(d: DesignDocument, layout: LayoutMap, groupId: string): Op[] {
  const g = d.nodes[groupId];
  if (!g?.parent) throw new Error("can only ungroup a nested node");
  const pbox = layout.get(g.parent)!;
  const idx = d.nodes[g.parent].children.indexOf(g.id);
  const ops: Op[] = [];
  let i = 0;
  for (const cid of g.children) {
    const c = d.nodes[cid];
    if (CLASSES[c.className].kind !== "gui") continue;
    const b = layout.get(cid);
    if (!b) continue;
    const anchor = (c.props.AnchorPoint as Vector2) ?? { x: 0, y: 0 };
    ops.push({ type: "move", id: cid, parentId: g.parent, index: idx + i++ });
    ops.push({ type: "update", id: cid, props: { Position: { xs: 0, xo: Math.round(b.x - pbox.content.x + anchor.x * b.w), ys: 0, yo: Math.round(b.y - pbox.content.y + anchor.y * b.h) } } });
  }
  ops.push({ type: "remove", id: g.id });
  return ops;
}

/** Replace an instance with a plain copy of its resolved tree (overrides baked in). */
export function detachOps(d: DesignDocument, instId: string): { ops: Op[]; newId: string } {
  const inst = d.nodes[instId];
  const tree = resolveTree(d, instId)!;
  const nodes: DesignNode[] = [];
  const build = (n: typeof tree, parent: string | null): string => {
    const id = newId();
    const rec = makeNode(n.className, { id, name: n.name, parent, props: structuredClone(n.props) as Props });
    nodes.push(rec);
    rec.children = n.children.map((c) => build(c, id));
    return id;
  };
  const rootId = build(tree, inst.parent);
  if (inst.canvas) nodes[0].canvas = { ...inst.canvas };
  const page = d.pages.find((p) => p.children.includes(instId));
  const siblings = inst.parent ? d.nodes[inst.parent].children : page!.children;
  return { ops: [{ type: "remove", id: instId }, { type: "insert", nodes, index: siblings.indexOf(instId), pageId: inst.parent ? undefined : page!.id }], newId: rootId };
}
