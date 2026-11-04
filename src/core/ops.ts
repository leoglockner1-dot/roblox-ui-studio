/**
 * Operations: the only way a document changes.
 *
 * Every op is plain JSON, validated before it is applied, and `applyOps`
 * returns the exact inverse ops so any change (from the editor, the HTTP API
 * or MCP) can be undone. A batch is atomic: if any op fails, the document is
 * left untouched and an OpError explains why.
 */
import { CLASSES, canParent, getClass } from "./classes";
import { ancestors, clone, descendants } from "./document";
import { coerceProp } from "./schema";
import type {
  Animation,
  CanvasReference,
  ComponentDef,
  DesignDocument,
  DesignNode,
  DesignTokens,
  NodeId,
  Page,
  PropValue,
  Props,
} from "./types";

export type PropPatch = Record<string, PropValue | null>;

export interface NodeFieldPatch {
  name?: string;
  locked?: boolean | null;
  editorHidden?: boolean | null;
  collapsed?: boolean | null;
  canvas?: DesignNode["canvas"] | null;
  tokens?: Record<string, string> | null;
  notes?: string | null;
  componentId?: string | null;
  instance?: DesignNode["instance"] | null;
}

export type Op =
  /** Insert a complete subtree. nodes[0] is the root; its `parent` decides where it goes (null = page). */
  | { type: "insert"; nodes: DesignNode[]; pageId?: string; index?: number }
  | { type: "remove"; id: NodeId }
  | { type: "update"; id: NodeId; props?: PropPatch; fields?: NodeFieldPatch }
  | { type: "move"; id: NodeId; parentId: NodeId | null; pageId?: string; index?: number }
  | { type: "override"; instanceId: NodeId; key: string; props: PropPatch }
  | { type: "addPage"; page: Page; index?: number }
  | { type: "removePage"; id: string }
  | { type: "updatePage"; id: string; name?: string; references?: CanvasReference[] }
  | { type: "movePage"; id: string; index: number }
  | { type: "setComponent"; id: string; def: ComponentDef | null }
  | { type: "setTokens"; tokens: DesignTokens }
  | { type: "setAnimation"; id: string; anim: Animation | null }
  | { type: "setDoc"; name?: string; meta?: Record<string, string> };

export class OpError extends Error {
  constructor(message: string, public opIndex = -1) {
    super(message);
    this.name = "OpError";
  }
}

/** Mutable working copy with copy-on-write node records. */
class Draft {
  doc: DesignDocument;
  private copied = new Set<string>();
  private pagesCopied = false;
  constructor(base: DesignDocument) {
    this.doc = { ...base, nodes: { ...base.nodes }, components: { ...base.components }, animations: { ...base.animations } };
  }
  node(id: NodeId): DesignNode {
    const n = this.doc.nodes[id];
    if (!n) throw new OpError(`node "${id}" does not exist`);
    if (!this.copied.has(id)) {
      const c = { ...n, children: [...n.children], props: { ...n.props } };
      this.doc.nodes[id] = c;
      this.copied.add(id);
      return c;
    }
    return n;
  }
  has(id: NodeId) {
    return !!this.doc.nodes[id];
  }
  pages(): Page[] {
    if (!this.pagesCopied) {
      this.doc.pages = this.doc.pages.map((p) => ({ ...p, children: [...p.children] }));
      this.pagesCopied = true;
    }
    return this.doc.pages;
  }
  page(id: string): Page {
    const p = this.pages().find((pg) => pg.id === id);
    if (!p) throw new OpError(`page "${id}" does not exist`);
    return p;
  }
  pageContaining(id: NodeId): Page | undefined {
    return this.pages().find((p) => p.children.includes(id));
  }
}

function clampIndex(i: number | undefined, len: number) {
  if (i === undefined || i < 0 || i > len) return len;
  return Math.floor(i);
}

function coercePatch(className: string, patch: PropPatch, where: string): PropPatch {
  const out: PropPatch = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      out[k] = null;
      continue;
    }
    const r = coerceProp(className, k, v);
    if (!r.ok) throw new OpError(`${where}: ${r.error}`);
    out[k] = r.value;
  }
  return out;
}

/** Apply a batch of ops. Returns the new document and the inverse batch (to undo, apply `inverse`). */
export function applyOps(base: DesignDocument, ops: Op[]): { doc: DesignDocument; inverse: Op[] } {
  const d = new Draft(base);
  const inverse: Op[] = [];
  ops.forEach((op, i) => {
    try {
      inverse.unshift(...applyOne(d, op));
    } catch (e) {
      if (e instanceof OpError) throw new OpError(`op #${i} (${op.type}): ${e.message}`, i);
      throw e;
    }
  });
  return { doc: d.doc, inverse };
}

function applyOne(d: Draft, op: Op): Op[] {
  const doc = d.doc;
  switch (op.type) {
    case "insert": {
      if (!op.nodes.length) throw new OpError("no nodes to insert");
      const ids = new Set<string>();
      for (const n of op.nodes) {
        if (!CLASSES[n.className]) throw new OpError(`unknown class "${n.className}"`);
        if (d.has(n.id) || ids.has(n.id)) throw new OpError(`node id "${n.id}" already exists`);
        if (n.id.includes("/")) throw new OpError(`node id "${n.id}" must not contain "/"`);
        ids.add(n.id);
      }
      const root = op.nodes[0];
      // Validate internal structure: every non-root node's parent must be in the batch and list it.
      for (const n of op.nodes.slice(1)) {
        const p = op.nodes.find((x) => x.id === n.parent);
        if (!p) throw new OpError(`node "${n.id}" parent "${n.parent}" is not part of the inserted subtree`);
        if (!p.children.includes(n.id)) throw new OpError(`node "${p.id}" does not list child "${n.id}"`);
        if (!canParent(p.className, n.className)) throw new OpError(`${n.className} cannot be a child of ${p.className}`);
      }
      for (const n of op.nodes) {
        for (const c of n.children) if (!ids.has(c)) throw new OpError(`child "${c}" of "${n.id}" missing from subtree`);
        if (n.instance && n.children.length) throw new OpError(`component instance "${n.id}" cannot store children`);
        coercePatch(n.className, n.props, n.id);
      }
      for (const n of op.nodes) {
        const rec: DesignNode = { ...clone(n), props: coercePatch(n.className, n.props, n.id) as Props };
        if (rec.instance) {
          const comp = doc.components[rec.instance.componentId];
          if (!comp) throw new OpError(`component "${rec.instance.componentId}" does not exist`);
          const overrides: Record<string, Props> = {};
          for (const [key, patch] of Object.entries(rec.instance.overrides ?? {})) {
            const cls = resolveOverrideClass(doc, comp.rootId, key);
            if (!cls) throw new OpError(`override "${key}" does not exist inside component "${comp.name}"`);
            overrides[key] = coercePatch(cls, patch, `override ${key}`) as Props;
          }
          rec.instance = { componentId: comp.id, overrides };
        }
        doc.nodes[n.id] = rec;
      }
      if (root.parent) {
        const parent = d.node(root.parent);
        if (parent.instance) throw new OpError(`cannot insert into component instance "${parent.name}" (detach it first)`);
        if (!canParent(parent.className, root.className))
          throw new OpError(`${root.className} cannot be a child of ${parent.className}`);
        parent.children.splice(clampIndex(op.index, parent.children.length), 0, root.id);
      } else {
        if (!canParent(null, root.className)) throw new OpError(`${root.className} must be inside a GUI object`);
        const page = op.pageId ? d.page(op.pageId) : d.pages()[0];
        if (!page) throw new OpError("document has no pages");
        page.children.splice(clampIndex(op.index, page.children.length), 0, root.id);
      }
      return [{ type: "remove", id: root.id }];
    }

    case "remove": {
      const n = d.node(op.id);
      const subtree = [op.id, ...descendants(doc, op.id)];
      const snapshot = subtree.map((id) => clone(doc.nodes[id]));
      let index: number;
      let pageId: string | undefined;
      if (n.parent) {
        const parent = d.node(n.parent);
        index = parent.children.indexOf(op.id);
        parent.children.splice(index, 1);
      } else {
        const page = d.pageContaining(op.id);
        if (!page) throw new OpError(`node "${op.id}" is not on a page`);
        index = page.children.indexOf(op.id);
        page.children.splice(index, 1);
        pageId = page.id;
      }
      for (const id of subtree) delete doc.nodes[id];
      return [{ type: "insert", nodes: snapshot, pageId, index }];
    }

    case "update": {
      const n = d.node(op.id);
      const inv: Op = { type: "update", id: op.id };
      if (op.props) {
        const patch = coercePatch(n.className, op.props, n.name);
        const prev: PropPatch = {};
        for (const [k, v] of Object.entries(patch)) {
          prev[k] = k in n.props ? clone(n.props[k]) : null;
          if (v === null) delete n.props[k];
          else n.props[k] = v;
        }
        inv.props = prev;
      }
      if (op.fields) {
        const prev: NodeFieldPatch = {};
        const f = op.fields;
        const rec = n as unknown as Record<string, unknown>;
        for (const key of Object.keys(f) as (keyof NodeFieldPatch)[]) {
          const v = f[key];
          if (key === "name") {
            if (typeof v !== "string" || !v.trim()) throw new OpError("name must be a non-empty string");
            prev.name = n.name;
            n.name = v.trim();
            continue;
          }
          if (key === "instance" && v && n.children.length) throw new OpError("node with children cannot become an instance");
          if (key === "componentId" && v && !doc.components[v as string]) throw new OpError(`component "${v}" does not exist`);
          (prev as Record<string, unknown>)[key] = key in rec ? clone(rec[key]) : null;
          if (v === null || v === undefined) delete rec[key];
          else rec[key] = clone(v);
        }
        inv.fields = prev;
      }
      return [inv];
    }

    case "move": {
      const n = d.node(op.id);
      if (op.parentId === op.id || (op.parentId && ancestors(doc, op.parentId).includes(op.id)))
        throw new OpError("cannot move a node into itself or its descendants");
      // The page the node currently lives on (via its top-level ancestor).
      const anc = ancestors(doc, op.id);
      const homePage = d.pageContaining(anc.length ? anc[anc.length - 1] : op.id);
      // Record where it was.
      let inv: Op;
      if (n.parent) {
        const old = d.node(n.parent);
        const idx = old.children.indexOf(op.id);
        old.children.splice(idx, 1);
        inv = { type: "move", id: op.id, parentId: old.id, index: idx };
      } else {
        const page = d.pageContaining(op.id);
        if (!page) throw new OpError(`node "${op.id}" is not on a page`);
        const idx = page.children.indexOf(op.id);
        page.children.splice(idx, 1);
        inv = { type: "move", id: op.id, parentId: null, pageId: page.id, index: idx };
      }
      if (op.parentId) {
        const parent = d.node(op.parentId);
        if (parent.instance) throw new OpError(`cannot move into component instance "${parent.name}"`);
        if (!canParent(parent.className, n.className)) throw new OpError(`${n.className} cannot be a child of ${parent.className}`);
        parent.children.splice(clampIndex(op.index, parent.children.length), 0, op.id);
        n.parent = parent.id;
      } else {
        if (!canParent(null, n.className)) throw new OpError(`${n.className} must be inside a GUI object`);
        const page = op.pageId ? d.page(op.pageId) : (homePage ?? d.pages()[0]);
        page.children.splice(clampIndex(op.index, page.children.length), 0, op.id);
        n.parent = null;
      }
      return [inv];
    }

    case "override": {
      const n = d.node(op.instanceId);
      if (!n.instance) throw new OpError(`node "${op.instanceId}" is not a component instance`);
      const comp = doc.components[n.instance.componentId];
      if (!comp) throw new OpError(`component "${n.instance.componentId}" does not exist`);
      const target = resolveOverrideClass(doc, comp.rootId, op.key);
      if (!target) throw new OpError(`"${op.key}" does not exist inside component "${comp.name}"`);
      const patch = coercePatch(target, op.props, op.key);
      const overrides = { ...n.instance.overrides };
      const cur = { ...(overrides[op.key] ?? {}) };
      const prev: PropPatch = {};
      for (const [k, v] of Object.entries(patch)) {
        prev[k] = k in cur ? clone(cur[k]) : null;
        if (v === null) delete cur[k];
        else cur[k] = v;
      }
      if (Object.keys(cur).length) overrides[op.key] = cur;
      else delete overrides[op.key];
      n.instance = { ...n.instance, overrides };
      return [{ type: "override", instanceId: op.instanceId, key: op.key, props: prev }];
    }

    case "addPage": {
      if (d.pages().some((p) => p.id === op.page.id)) throw new OpError(`page "${op.page.id}" already exists`);
      for (const c of op.page.children) if (!d.has(c)) throw new OpError(`page child "${c}" does not exist`);
      const pages = d.pages();
      pages.splice(clampIndex(op.index, pages.length), 0, { ...op.page, children: [...op.page.children] });
      return [{ type: "removePage", id: op.page.id }];
    }

    case "removePage": {
      const pages = d.pages();
      const idx = pages.findIndex((p) => p.id === op.id);
      if (idx < 0) throw new OpError(`page "${op.id}" does not exist`);
      if (pages.length === 1) throw new OpError("cannot remove the last page");
      const page = pages[idx];
      // Remove its nodes first (each with its own inverse), then the page.
      const inv: Op[] = [];
      for (const id of [...page.children].reverse()) inv.unshift(...applyOne(d, { type: "remove", id }));
      pages.splice(idx, 1);
      return [{ type: "addPage", page: { ...page, children: [] }, index: idx }, ...inv.reverse()];
    }

    case "updatePage": {
      const p = d.page(op.id);
      const inv: Op = { type: "updatePage", id: op.id };
      if (op.name !== undefined) {
        if (!op.name.trim()) throw new OpError("page name must not be empty");
        inv.name = p.name;
        p.name = op.name.trim();
      }
      if (op.references !== undefined) {
        for (const r of op.references)
          if (!r.id || !r.assetId || ![r.x, r.y, r.w, r.h, r.opacity].every(Number.isFinite)) throw new OpError("invalid canvas reference");
        inv.references = clone(p.references ?? []);
        p.references = clone(op.references);
      }
      return [inv];
    }

    case "movePage": {
      const pages = d.pages();
      const idx = pages.findIndex((p) => p.id === op.id);
      if (idx < 0) throw new OpError(`page "${op.id}" does not exist`);
      const [p] = pages.splice(idx, 1);
      pages.splice(clampIndex(op.index, pages.length), 0, p);
      return [{ type: "movePage", id: op.id, index: idx }];
    }

    case "setComponent": {
      const prev = doc.components[op.id] ? clone(doc.components[op.id]) : null;
      if (op.def) {
        if (op.def.id !== op.id) throw new OpError("component def id mismatch");
        if (!doc.nodes[op.def.rootId]) throw new OpError(`component root "${op.def.rootId}" does not exist`);
        if (!getClass(doc.nodes[op.def.rootId].className) || doc.nodes[op.def.rootId].className === "ScreenGui")
          throw new OpError("a ScreenGui cannot be a component");
        doc.components[op.id] = clone(op.def);
      } else {
        if (!prev) throw new OpError(`component "${op.id}" does not exist`);
        delete doc.components[op.id];
      }
      return [{ type: "setComponent", id: op.id, def: prev }];
    }

    case "setTokens": {
      const prev = clone(doc.tokens);
      doc.tokens = clone(op.tokens);
      return [{ type: "setTokens", tokens: prev }];
    }

    case "setAnimation": {
      const prev = doc.animations[op.id] ? clone(doc.animations[op.id]) : null;
      if (op.anim) {
        if (op.anim.id !== op.id) throw new OpError("animation id mismatch");
        doc.animations[op.id] = clone(op.anim);
      } else {
        if (!prev) throw new OpError(`animation "${op.id}" does not exist`);
        delete doc.animations[op.id];
      }
      return [{ type: "setAnimation", id: op.id, anim: prev }];
    }

    case "setDoc": {
      const inv: Op = { type: "setDoc" };
      if (op.name !== undefined) {
        if (!op.name.trim()) throw new OpError("document name must not be empty");
        inv.name = doc.name;
        doc.name = op.name.trim();
      }
      if (op.meta !== undefined) {
        inv.meta = clone(doc.meta);
        doc.meta = clone(op.meta);
      }
      return [inv];
    }
  }
}

/**
 * Find the className of the node an override key points to.
 * Keys are child paths from the master root ("c", "c/d", "nestedInstance/e"):
 * each segment must be a direct child of the previous segment, where an
 * instance segment continues inside its own component's master.
 */
export function resolveOverrideClass(doc: DesignDocument, masterRootId: NodeId, key: string): string | null {
  let container = masterRootId;
  let className: string | null = null;
  for (const seg of key.split("/")) {
    if (!doc.nodes[container]?.children.includes(seg)) return null;
    const n = doc.nodes[seg];
    if (!n) return null;
    if (n.instance) {
      const comp = doc.components[n.instance.componentId];
      const master = comp ? doc.nodes[comp.rootId] : undefined;
      if (!master) return null;
      container = master.id;
      className = master.className;
    } else {
      container = seg;
      className = n.className;
    }
  }
  return className;
}
