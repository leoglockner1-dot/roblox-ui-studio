/**
 * Document creation, traversal and the "resolved tree".
 *
 * The stored document is a flat node map. The resolved tree is the effective
 * hierarchy after component instances are expanded, overrides merged and
 * design tokens applied. Layout, rendering, validation and export all work on
 * the resolved tree so they never need to know about components or tokens.
 */
import { CLASSES, getPropDef } from "./classes";
import {
  FORMAT_ID,
  FORMAT_VERSION,
  type DesignDocument,
  type DesignNode,
  type DesignTokens,
  type NodeId,
  type PropValue,
  type Props,
} from "./types";

// ---------------------------------------------------------------- ids

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export function newId(prefix = "n"): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % 36];
  return `${prefix}_${s}`;
}

export const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------- creation

export function defaultTokens(): DesignTokens {
  return {
    colors: [
      { id: "c_primary", name: "Primary", value: "#4F7CFF" },
      { id: "c_accent", name: "Accent", value: "#FFC23D" },
      { id: "c_surface", name: "Surface", value: "#1B1F2A" },
      { id: "c_surface2", name: "Surface Raised", value: "#252B3A" },
      { id: "c_text", name: "Text", value: "#F4F6FB" },
      { id: "c_textMuted", name: "Text Muted", value: "#9AA3B8" },
      { id: "c_success", name: "Success", value: "#3DDC84" },
      { id: "c_danger", name: "Danger", value: "#FF5A5F" },
    ],
    numbers: [
      { id: "s_xs", name: "Space XS", value: 4 },
      { id: "s_sm", name: "Space SM", value: 8 },
      { id: "s_md", name: "Space MD", value: 16 },
      { id: "s_lg", name: "Space LG", value: 24 },
      { id: "s_xl", name: "Space XL", value: 32 },
      { id: "r_sm", name: "Radius SM", value: 6 },
      { id: "r_md", name: "Radius MD", value: 12 },
      { id: "r_lg", name: "Radius LG", value: 20 },
    ],
    textStyles: [
      { id: "t_display", name: "Display", font: { family: "GothamSSm", weight: "Heavy", style: "Normal" }, size: 48 },
      { id: "t_title", name: "Title", font: { family: "GothamSSm", weight: "Bold", style: "Normal" }, size: 28 },
      { id: "t_heading", name: "Heading", font: { family: "GothamSSm", weight: "Bold", style: "Normal" }, size: 20 },
      { id: "t_body", name: "Body", font: { family: "BuilderSans", weight: "Medium", style: "Normal" }, size: 16 },
      { id: "t_caption", name: "Caption", font: { family: "BuilderSans", weight: "Medium", style: "Normal" }, size: 13 },
    ],
  };
}

export function createDocument(name = "Untitled"): DesignDocument {
  const t = nowIso();
  return {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    id: newId("doc"),
    name,
    createdAt: t,
    updatedAt: t,
    revision: 0,
    pages: [{ id: newId("pg"), name: "Page 1", children: [] }],
    nodes: {},
    components: {},
    tokens: defaultTokens(),
    animations: {},
    meta: {},
  };
}

export function makeNode(className: string, init: Partial<DesignNode> = {}): DesignNode {
  if (!CLASSES[className]) throw new Error(`Unknown class "${className}"`);
  return {
    id: init.id ?? newId(),
    className,
    name: init.name ?? className,
    parent: init.parent ?? null,
    children: init.children ?? [],
    props: init.props ?? {},
    ...(init.canvas ? { canvas: init.canvas } : {}),
    ...(init.instance ? { instance: init.instance } : {}),
    ...(init.tokens ? { tokens: init.tokens } : {}),
    ...(init.componentId ? { componentId: init.componentId } : {}),
  };
}

// ---------------------------------------------------------------- traversal

export function getNode(doc: DesignDocument, id: NodeId): DesignNode {
  const n = doc.nodes[id];
  if (!n) throw new Error(`Node "${id}" not found`);
  return n;
}

export function pageOf(doc: DesignDocument, id: NodeId): string | null {
  const root = rootOf(doc, id);
  for (const p of doc.pages) if (p.children.includes(root)) return p.id;
  return null;
}

export function rootOf(doc: DesignDocument, id: NodeId): NodeId {
  let cur = doc.nodes[id];
  while (cur && cur.parent) cur = doc.nodes[cur.parent];
  return cur ? cur.id : id;
}

export function ancestors(doc: DesignDocument, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  let cur = doc.nodes[id]?.parent ?? null;
  while (cur) {
    out.push(cur);
    cur = doc.nodes[cur]?.parent ?? null;
  }
  return out;
}

export function isAncestor(doc: DesignDocument, maybeAncestor: NodeId, id: NodeId): boolean {
  return ancestors(doc, id).includes(maybeAncestor);
}

/** All descendant ids of a stored node (depth-first, excluding the node itself). */
export function descendants(doc: DesignDocument, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const walk = (nid: NodeId) => {
    for (const c of doc.nodes[nid]?.children ?? []) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

export function siblingsOf(doc: DesignDocument, id: NodeId): NodeId[] {
  const n = doc.nodes[id];
  if (!n) return [];
  if (n.parent) return doc.nodes[n.parent]?.children ?? [];
  return doc.pages.find((p) => p.children.includes(id))?.children ?? [];
}

/** Find the master component a stored node belongs to (if inside a master). */
export function enclosingComponent(doc: DesignDocument, id: NodeId): string | null {
  let cur: DesignNode | undefined = doc.nodes[id];
  while (cur) {
    if (cur.componentId) return cur.componentId;
    cur = cur.parent ? doc.nodes[cur.parent] : undefined;
  }
  return null;
}

// ---------------------------------------------------------------- resolved tree

export interface ResolvedNode {
  /** Effective id. Equals the stored id, or "<instanceId>/<path>" for nodes inside an instance. */
  id: string;
  /** Stored node that defines this node's base properties. */
  sourceId: NodeId;
  /** For nodes inside an instance: the outermost instance node id + override key. */
  instanceRoot?: NodeId;
  overrideKey?: string;
  className: string;
  name: string;
  props: Props;
  children: ResolvedNode[];
  /** Component this node is an instance of (only on instance roots). */
  instanceOf?: string;
  /** Component this node is the master of. */
  masterOf?: string;
  locked?: boolean;
  editorHidden?: boolean;
}

const MAX_INSTANCE_DEPTH = 12;

function applyTokens(doc: DesignDocument, className: string, props: Props, tokens?: Record<string, string>): Props {
  if (!tokens) return props;
  const out = { ...props };
  for (const [prop, tokenId] of Object.entries(tokens)) {
    if (prop === "$textStyle") {
      const ts = doc.tokens.textStyles.find((t) => t.id === tokenId);
      if (ts) {
        out.FontFace = { ...ts.font };
        out.TextSize = ts.size;
        if (ts.lineHeight) out.LineHeight = ts.lineHeight;
      }
      continue;
    }
    const def = getPropDef(className, prop);
    if (!def) continue;
    const color = doc.tokens.colors.find((t) => t.id === tokenId);
    if (color && (def.type === "color")) {
      out[prop] = color.value;
      continue;
    }
    const num = doc.tokens.numbers.find((t) => t.id === tokenId);
    if (num) {
      if (def.type === "number" || def.type === "int") out[prop] = num.value;
      else if (def.type === "udim") out[prop] = { s: 0, o: num.value };
    }
  }
  return out;
}

/**
 * Resolve a stored node into its effective tree.
 * `extra` carries overrides from enclosing instances, keyed relative to this node.
 */
export function resolveTree(doc: DesignDocument, id: NodeId): ResolvedNode | null {
  const n = doc.nodes[id];
  if (!n) return null;
  return resolveStored(doc, n, n.id, undefined, undefined, {}, 0);
}

function resolveStored(
  doc: DesignDocument,
  n: DesignNode,
  effectiveId: string,
  instanceRoot: NodeId | undefined,
  overrideKey: string | undefined,
  /** Overrides applying to this subtree, keyed by path relative to `n` ("" = n itself). */
  outer: Record<string, Props>,
  depth: number,
): ResolvedNode {
  if (n.instance) {
    const comp = doc.components[n.instance.componentId];
    const master = comp ? doc.nodes[comp.rootId] : undefined;
    if (!master || depth > MAX_INSTANCE_DEPTH) {
      // Broken instance: render as an empty frame of the instance's own props.
      return {
        id: effectiveId,
        sourceId: n.id,
        instanceRoot,
        overrideKey,
        className: CLASSES[n.className] ? n.className : "Frame",
        name: n.name,
        props: { ...n.props, ...(outer[""] ?? {}) },
        children: [],
        instanceOf: n.instance.componentId,
      };
    }
    // Overrides for the master subtree: the instance's own overrides, then outer ones (outer wins).
    const merged: Record<string, Props> = {};
    for (const [k, v] of Object.entries(n.instance.overrides)) merged[k] = { ...v };
    for (const [k, v] of Object.entries(outer)) {
      if (k === "") continue;
      merged[k] = { ...(merged[k] ?? {}), ...v };
    }
    // Root props: master root props <- instance props <- outer root override.
    const rootProps = applyTokens(
      doc,
      master.className,
      { ...master.props, ...n.props, ...(outer[""] ?? {}) },
      { ...(master.tokens ?? {}), ...(n.tokens ?? {}) },
    );
    const root = instanceRoot ?? n.id;
    const children = master.children
      .map((cid) => doc.nodes[cid])
      .filter((c): c is DesignNode => !!c)
      .map((c) => {
        // Override keys are paths relative to the outermost instance's master.
        const key = overrideKey ? `${overrideKey}/${c.id}` : c.id;
        return resolveStored(doc, c, `${effectiveId}/${c.id}`, root, key, subOverrides(merged, c.id), depth + 1);
      });
    return {
      id: effectiveId,
      sourceId: n.id,
      instanceRoot,
      overrideKey,
      className: master.className,
      name: n.name,
      props: rootProps,
      children,
      instanceOf: n.instance.componentId,
      locked: n.locked,
      editorHidden: n.editorHidden,
    };
  }

  const props = applyTokens(doc, n.className, { ...n.props, ...(outer[""] ?? {}) }, n.tokens);
  const children = n.children
    .map((cid) => doc.nodes[cid])
    .filter((c): c is DesignNode => !!c)
    .map((c) => {
      if (!instanceRoot) return resolveStored(doc, c, c.id, undefined, undefined, {}, depth);
      const key = `${overrideKey}/${c.id}`;
      return resolveStored(doc, c, `${effectiveId}/${c.id}`, instanceRoot, key, subOverrides(outer, c.id), depth + 1);
    });
  return {
    id: effectiveId,
    sourceId: n.id,
    instanceRoot,
    overrideKey,
    className: n.className,
    name: n.name,
    props,
    children,
    masterOf: n.componentId,
    locked: n.locked,
    editorHidden: n.editorHidden,
  };
}

/** Extract overrides that apply below `childId`, re-keyed relative to it. */
function subOverrides(overrides: Record<string, Props>, childId: string): Record<string, Props> {
  const out: Record<string, Props> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (k === childId) out[""] = v;
    else if (k.startsWith(childId + "/")) out[k.slice(childId.length + 1)] = v;
  }
  return out;
}

/** Resolved property value with class default fallback. */
export function propOf<T extends PropValue = PropValue>(node: { className: string; props: Props }, name: string): T {
  const v = node.props[name];
  if (v !== undefined) return v as T;
  const def = getPropDef(node.className, name);
  return (def?.default as T) ?? (undefined as unknown as T);
}

export function findResolved(root: ResolvedNode, id: string): ResolvedNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const f = findResolved(c, id);
    if (f) return f;
  }
  return null;
}

export function walkResolved(root: ResolvedNode, fn: (n: ResolvedNode, parent: ResolvedNode | null) => void, parent: ResolvedNode | null = null) {
  fn(root, parent);
  for (const c of root.children) walkResolved(c, fn, root);
}

/** Deep clone of plain JSON data. */
export function clone<T>(v: T): T {
  return structuredClone(v);
}
