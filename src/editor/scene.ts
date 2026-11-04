/**
 * Scene: resolved trees + layouts for every top-level node on a page,
 * cached per document object so React re-renders are cheap.
 */
import { resolveTree, type ResolvedNode } from "../core/document";
import { computeLayout, rootRectOf, type LayoutMap, type Rect, type SafeInsets } from "../core/layout";
import type { DesignDocument, PropValue } from "../core/types";
import { browserMeasurer } from "./render/measure";

export interface SceneRoot {
  id: string;
  tree: ResolvedNode;
  layout: LayoutMap;
  rect: Rect;
}

export type Sample = Map<string, Record<string, PropValue>>;

/** Return a copy of the tree with sampled animation values applied. */
export function applySample(tree: ResolvedNode, sample: Sample | null): ResolvedNode {
  if (!sample || !sample.size) return tree;
  const visit = (n: ResolvedNode): ResolvedNode => {
    const s = sample.get(n.id);
    let changed = !!s;
    const kids = n.children.map((c) => {
      const k = visit(c);
      if (k !== c) changed = true;
      return k;
    });
    if (!changed) return n;
    return { ...n, props: s ? { ...n.props, ...s } : n.props, children: kids };
  };
  return visit(tree);
}

export function buildRoot(doc: DesignDocument, id: string, opts: { sample?: Sample | null; size?: { w: number; h: number }; safe?: SafeInsets; overrides?: Sample } = {}): SceneRoot | null {
  const stored = doc.nodes[id];
  if (!stored) return null;
  let tree = resolveTree(doc, id);
  if (!tree) return null;
  tree = applySample(tree, opts.overrides ?? null);
  tree = applySample(tree, opts.sample ?? null);
  const base = rootRectOf({ ...stored, props: tree.props });
  const rect = opts.size ? { ...base, w: opts.size.w, h: opts.size.h } : base;
  return { id, tree, layout: computeLayout(tree, rect, { measurer: browserMeasurer, safeInsets: opts.safe }), rect };
}

const cache = new WeakMap<DesignDocument, Map<string, SceneRoot[]>>();

/** All roots of a page laid out at their canvas positions (cached by doc identity + key). */
export function pageScene(doc: DesignDocument, pageId: string, sample: Sample | null, version: number): SceneRoot[] {
  const key = `${pageId}|${version}`;
  let m = cache.get(doc);
  if (!m) cache.set(doc, (m = new Map()));
  if (!sample) {
    const hit = m.get(key);
    if (hit) return hit;
  }
  const page = doc.pages.find((p) => p.id === pageId) ?? doc.pages[0];
  const roots = page.children.map((id) => buildRoot(doc, id, { sample })).filter((r): r is SceneRoot => !!r);
  if (!sample) {
    if (m.size > 8) m.clear();
    m.set(key, roots);
  }
  return roots;
}
