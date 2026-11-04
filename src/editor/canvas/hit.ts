/** Hit testing and selection-depth rules for the canvas. */
import { CLASSES } from "../../core/classes";
import { propOf, type ResolvedNode } from "../../core/document";
import type { LayoutMap } from "../../core/layout";
import type { SceneRoot } from "../scene";

const inside = (b: { x: number; y: number; w: number; h: number }, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/** Chain of resolved nodes under a world point, root first. Respects ZIndex, Visible and clipping. */
export function hitChain(roots: SceneRoot[], x: number, y: number): { root: SceneRoot; chain: ResolvedNode[] } | null {
  for (let i = roots.length - 1; i >= 0; i--) {
    const r = roots[i];
    const rb = r.layout.get(r.tree.id);
    if (!rb) continue;
    if (r.tree.className === "ScreenGui") {
      if (!inside(rb, x, y)) continue;
      return { root: r, chain: [r.tree, ...deepest(r.tree, r.layout, x, y)] };
    }
    const hit = deepest({ ...r.tree, children: [r.tree] } as ResolvedNode, r.layout, x, y);
    if (hit.length) return { root: r, chain: hit };
  }
  return null;
}

function deepest(n: ResolvedNode, layout: LayoutMap, x: number, y: number): ResolvedNode[] {
  const box = layout.get(n.id);
  const clips = box && (box.clips || CLASSES[n.className]?.isScrolling);
  if (clips && box && !inside(box, x, y)) return [];
  const kids = n.children
    .filter((c) => CLASSES[c.className]?.kind === "gui" && propOf<boolean>(c, "Visible") !== false && !c.editorHidden)
    .map((c, i) => ({ c, i, z: propOf<number>(c, "ZIndex") }))
    .sort((a, b) => b.z - a.z || b.i - a.i);
  // Returns the chain of descendants of `n` under the point (excluding n).
  for (const { c } of kids) {
    const sub = deepest(c, layout, x, y);
    if (sub.length) return [c, ...sub];
    const cb = layout.get(c.id);
    if (cb && inside(cb, x, y)) return [c];
  }
  return [];
}

/**
 * Pick which node in the chain a click selects (Figma-style):
 *  - default: the top-most child of the screen (or the loose frame itself);
 *  - keep the depth of the current selection (siblings of a selected node);
 *  - deep: the deepest node.
 */
export function pickTarget(chain: ResolvedNode[], selection: string[], parentOf: (id: string) => string | null, deep: boolean): ResolvedNode | null {
  if (!chain.length) return null;
  const candidates = chain[0].className === "ScreenGui" ? chain.slice(1) : chain;
  if (!candidates.length) return chain[0];
  if (deep) return candidates[candidates.length - 1];
  for (let l = candidates.length - 1; l >= 0; l--) if (selection.includes(candidates[l].id)) return candidates[l];
  const selParents = new Set(selection.map(parentOf));
  for (let l = candidates.length - 1; l >= 0; l--) if (selParents.has(parentOf(candidates[l].id))) return candidates[l];
  // Inside a selected ancestor? Select its child on the chain.
  for (let l = candidates.length - 2; l >= 0; l--) if (selection.includes(candidates[l].id)) return candidates[l + 1];
  return candidates[0];
}

/** One level deeper than the current selection along the chain (double-click). */
export function deeperTarget(chain: ResolvedNode[], selection: string[]): ResolvedNode | null {
  const candidates = chain[0]?.className === "ScreenGui" ? chain.slice(1) : chain;
  for (let l = 0; l < candidates.length; l++) if (selection.includes(candidates[l].id)) return candidates[l + 1] ?? null;
  return candidates[0] ?? null;
}
