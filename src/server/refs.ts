/**
 * Node references and compact outlines for tools.
 *
 * Tools accept a node reference as:
 *   - a stored node id                      "n_abc123"
 *   - an effective id inside an instance    "n_inst/n_child"
 *   - a name path from a top-level node     "MainMenu/MainFrame/Title"
 *   - a unique name anywhere                "Title"
 */
import { CLASSES } from "../core/classes";
import { findResolved, resolveTree, walkResolved, type ResolvedNode } from "../core/document";
import { computeLayout, rootRectOf, type LayoutMap } from "../core/layout";
import type { DesignDocument, PropValue } from "../core/types";

export class ToolError extends Error {
  constructor(message: string, public hint?: string) {
    super(message);
    this.name = "ToolError";
  }
}

export interface NodeRef {
  /** Effective id (equals stored id unless inside an instance). */
  id: string;
  /** Stored node if this is a real node. */
  storedId?: string;
  /** For nodes inside an instance. */
  instanceRoot?: string;
  overrideKey?: string;
  className: string;
  name: string;
}

function topLevel(doc: DesignDocument) {
  return doc.pages.flatMap((p) => p.children);
}

export function resolveRef(doc: DesignDocument, ref: string): NodeRef {
  if (!ref || typeof ref !== "string") throw new ToolError("node reference is required");
  const stored = doc.nodes[ref];
  if (stored) return { id: ref, storedId: ref, className: stored.className, name: stored.name };
  // effective id
  const first = ref.split("/")[0];
  if (doc.nodes[first]) {
    const tree = resolveTree(doc, rootOfStored(doc, first));
    const hit = tree && findResolved(tree, ref);
    if (hit) return toRef(hit);
  }
  // name path
  const segs = ref.split("/").filter(Boolean);
  const trees = topLevel(doc).map((id) => resolveTree(doc, id)).filter((t): t is ResolvedNode => !!t);
  for (const t of trees) {
    if (t.name !== segs[0]) continue;
    let cur: ResolvedNode | undefined = t;
    for (const s of segs.slice(1)) cur = cur?.children.find((c) => c.name === s);
    if (cur) return toRef(cur);
  }
  // unique name anywhere
  const matches: ResolvedNode[] = [];
  for (const t of trees) walkResolved(t, (n) => n.name === ref && matches.push(n));
  if (matches.length === 1) return toRef(matches[0]);
  if (matches.length > 1)
    throw new ToolError(`"${ref}" is ambiguous (${matches.length} nodes have that name)`, `use an id or a path: ${matches.slice(0, 5).map((m) => m.id).join(", ")}`);
  throw new ToolError(`node "${ref}" not found`, "use inspect_design to list node ids and names");
}

function rootOfStored(doc: DesignDocument, id: string) {
  let cur = doc.nodes[id];
  while (cur?.parent) cur = doc.nodes[cur.parent];
  return cur?.id ?? id;
}

function toRef(n: ResolvedNode): NodeRef {
  if (n.instanceRoot) return { id: n.id, instanceRoot: n.instanceRoot, overrideKey: n.overrideKey, className: n.className, name: n.name };
  return { id: n.id, storedId: n.sourceId, className: n.className, name: n.name };
}

// ---------------------------------------------------------------- outline

function fmtVal(v: PropValue): string {
  if (typeof v === "number") return String(Math.round(v * 1000) / 1000);
  if (typeof v === "string") return v.length > 60 ? JSON.stringify(v.slice(0, 57) + "…") : JSON.stringify(v);
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map((s) => ("color" in s ? `${s.t}:${s.color}` : `${s.t}:${s.value}`)).join(" ")}]`;
  if ("xs" in v) return `{${v.xs},${v.xo},${v.ys},${v.yo}}`;
  if ("s" in v) return `{${v.s},${v.o}}`;
  if ("x" in v) return `(${v.x},${v.y})`;
  if ("family" in v) return `${v.family}/${v.weight}${v.style === "Italic" ? "/Italic" : ""}`;
  if ("minX" in v) return `(${v.minX},${v.minY},${v.maxX},${v.maxY})`;
  return JSON.stringify(v);
}

export function layoutFor(doc: DesignDocument, rootId: string): { tree: ResolvedNode; layout: LayoutMap } | null {
  const tree = resolveTree(doc, rootId);
  const stored = doc.nodes[rootId];
  if (!tree || !stored) return null;
  return { tree, layout: computeLayout(tree, rootRectOf({ ...stored, props: tree.props })) };
}

/** Human/Claude-readable outline of a subtree, with explicit props and computed boxes. */
export function outline(doc: DesignDocument, opts: { rootId?: string; depth?: number; layout?: boolean } = {}): string {
  const lines: string[] = [];
  const maxDepth = opts.depth ?? 50;
  const emit = (n: ResolvedNode, depth: number, layout: LayoutMap | null, rel: { x: number; y: number }) => {
    const pad = "  ".repeat(depth);
    const kind = CLASSES[n.className]?.kind;
    const label = n.name === n.className ? n.className : `${n.className} "${n.name}"`;
    const tags = [n.instanceOf ? `instance of ${doc.components[n.instanceOf]?.name ?? n.instanceOf}` : "", n.masterOf ? `component master "${doc.components[n.masterOf]?.name}"` : "", n.locked ? "locked" : "", n.instanceRoot ? "in-instance" : ""].filter(Boolean);
    const props = Object.entries(n.props).filter(([k]) => !k.startsWith("_") || k === "_CurrentPage").map(([k, v]) => `${k}=${fmtVal(v)}`);
    let box = "";
    if (layout && kind === "gui") {
      const b = layout.get(n.id);
      if (b) box = ` → ${Math.round(b.x - rel.x)},${Math.round(b.y - rel.y)} ${Math.round(b.w)}×${Math.round(b.h)}${b.visible ? "" : " (hidden)"}`;
    }
    lines.push(`${pad}${label} [${n.id}]${tags.length ? ` (${tags.join(", ")})` : ""}${props.length ? " " + props.join(" ") : ""}${box}`);
    if (depth >= maxDepth) {
      if (n.children.length) lines.push(`${pad}  … ${n.children.length} children`);
      return;
    }
    for (const c of n.children) emit(c, depth + 1, layout, rel);
  };
  const roots = opts.rootId ? [opts.rootId] : null;
  for (const page of doc.pages) {
    const ids = roots ? page.children.filter((id) => roots.includes(id)) : page.children;
    if (!roots) lines.push(`Page "${page.name}" [${page.id}]`);
    for (const id of roots && !page.children.includes(roots[0]) ? [] : ids) {
      const l = layoutFor(doc, id);
      if (!l) continue;
      const rootBox = l.layout.get(l.tree.id);
      const stored = doc.nodes[id];
      const canvas = stored.canvas ? ` @canvas(${stored.canvas.x},${stored.canvas.y})${stored.canvas.w ? ` screen ${stored.canvas.w}×${stored.canvas.h}${stored.canvas.device ? ` ${stored.canvas.device}` : ""}` : ""}` : "";
      lines.push(`${roots ? "" : "  "}# root${canvas}`);
      const indentBase = roots ? 0 : 1;
      const walk = (n: ResolvedNode, d: number) => emit(n, d, opts.layout === false ? null : l.layout, { x: rootBox?.x ?? 0, y: rootBox?.y ?? 0 });
      walk(l.tree, indentBase);
    }
  }
  // Subtree inside a root (not top-level)
  if (opts.rootId && !lines.length) {
    const ref = resolveRef(doc, opts.rootId);
    const top = rootOfStored(doc, (ref.instanceRoot ?? ref.storedId ?? ref.id).split("/")[0]);
    const l = layoutFor(doc, top);
    const n = l && findResolved(l.tree, ref.id);
    if (n && l) {
      const rootBox = l.layout.get(l.tree.id)!;
      emit(n, 0, opts.layout === false ? null : l.layout, { x: rootBox.x, y: rootBox.y });
    }
  }
  return lines.join("\n");
}
