/**
 * Design validation: structural correctness, Roblox export readiness and
 * design-quality hints (contrast, tap targets, responsiveness).
 *
 * Severity:
 *   error   — the export would be broken or the document is inconsistent
 *   warning — exports, but probably not what you want
 *   info    — design-quality suggestion
 */
import { CLASSES, getPropDef } from "./classes";
import { isTweenable } from "./animation";
import { propOf, resolveTree, walkResolved, findResolved, type ResolvedNode } from "./document";
import { computeLayout, rootRectOf } from "./layout";
import { coerceProp, hexToRgb } from "./schema";
import { ASSET_SCHEME, type AssetRecord, type DesignDocument } from "./types";

export interface Issue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  nodeId?: string;
  animationId?: string;
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Nearest opaque background colour behind a node (walking up the resolved tree). */
function backgroundBehind(chain: ResolvedNode[]): string | null {
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i];
    if (CLASSES[n.className]?.kind !== "gui") continue;
    if (propOf<number>(n, "BackgroundTransparency") < 0.5 && !n.children.some((c) => c.className === "UIGradient"))
      return propOf<string>(n, "BackgroundColor3");
  }
  return null;
}

export function validateDocument(doc: DesignDocument, assets: AssetRecord[] = []): Issue[] {
  const issues: Issue[] = [];
  const assetMap = new Map(assets.map((a) => [a.id, a]));
  const add = (i: Issue) => issues.push(i);

  // ---- structural integrity of the stored document
  const onPage = new Set(doc.pages.flatMap((p) => p.children));
  for (const n of Object.values(doc.nodes)) {
    if (!CLASSES[n.className]) {
      add({ severity: "error", code: "unknown-class", message: `unknown class ${n.className}`, nodeId: n.id });
      continue;
    }
    if (n.parent) {
      const p = doc.nodes[n.parent];
      if (!p) add({ severity: "error", code: "orphan", message: `"${n.name}" has missing parent`, nodeId: n.id });
      else if (!p.children.includes(n.id)) add({ severity: "error", code: "orphan", message: `"${n.name}" not listed by its parent`, nodeId: n.id });
    } else if (!onPage.has(n.id)) add({ severity: "error", code: "orphan", message: `top-level "${n.name}" is on no page`, nodeId: n.id });
    for (const [k, v] of Object.entries(n.props)) {
      const r = coerceProp(n.className, k, v);
      if (!r.ok) add({ severity: "error", code: "invalid-prop", message: `"${n.name}": ${r.error}`, nodeId: n.id });
    }
    if (n.name.includes("/")) add({ severity: "warning", code: "name-slash", message: `"${n.name}": names containing "/" break path lookups in exported code`, nodeId: n.id });
    if (n.instance && !doc.components[n.instance.componentId])
      add({ severity: "error", code: "broken-instance", message: `"${n.name}" is an instance of a deleted component`, nodeId: n.id });
    // one-per-parent modifiers
    const counts = new Map<string, number>();
    for (const c of n.children) {
      const cn = doc.nodes[c]?.className;
      if (cn && CLASSES[cn]?.onePerParent) counts.set(cn, (counts.get(cn) ?? 0) + 1);
    }
    for (const [cn, k] of counts)
      if (k > 1) add({ severity: "warning", code: "duplicate-modifier", message: `"${n.name}" has ${k} ${cn}s — Roblox only uses one`, nodeId: n.id });
    const layouts = n.children.filter((c) => ["UIListLayout", "UIGridLayout", "UIPageLayout"].includes(doc.nodes[c]?.className ?? ""));
    if (layouts.length > 1) add({ severity: "warning", code: "multiple-layouts", message: `"${n.name}" has ${layouts.length} layout objects — only one takes effect`, nodeId: n.id });
  }

  // ---- components: cycles + ambiguous names
  for (const comp of Object.values(doc.components)) {
    if (!doc.nodes[comp.rootId]) {
      add({ severity: "error", code: "broken-component", message: `component "${comp.name}" has no master`, });
      continue;
    }
    const seen = new Set<string>();
    const visit = (cid: string, stack: string[]): boolean => {
      if (stack.includes(cid)) return true;
      const c = doc.components[cid];
      if (!c || seen.has(cid + stack.join())) return false;
      seen.add(cid + stack.join());
      const ids = [c.rootId];
      while (ids.length) {
        const id = ids.pop()!;
        const nd = doc.nodes[id];
        if (!nd) continue;
        if (nd.instance && id !== c.rootId && visit(nd.instance.componentId, [...stack, cid])) return true;
        ids.push(...nd.children);
      }
      return false;
    };
    if (visit(comp.id, [])) add({ severity: "error", code: "component-cycle", message: `component "${comp.name}" contains itself (directly or through nested instances)`, nodeId: comp.rootId });
  }

  // ---- resolved-tree checks per top-level root
  for (const page of doc.pages) {
    for (const rootId of page.children) {
      const stored = doc.nodes[rootId];
      if (!stored) continue;
      const tree = resolveTree(doc, rootId);
      if (!tree) continue;
      const layout = computeLayout(tree, rootRectOf({ ...stored, props: tree.props }));
      const rootBox = layout.get(tree.id)!;
      const chainOf = new Map<string, ResolvedNode[]>();
      walkResolved(tree, (n, parent) => {
        chainOf.set(n.id, parent ? [...(chainOf.get(parent.id) ?? []), parent] : []);
      });
      walkResolved(tree, (n) => {
        const cls = CLASSES[n.className];
        if (!cls) return;
        // assets
        for (const pd of cls.props) {
          if (pd.type !== "content") continue;
          const v = propOf<string>(n, pd.name);
          if (!v || !v.startsWith(ASSET_SCHEME)) continue;
          const a = assetMap.get(v.slice(ASSET_SCHEME.length));
          if (!a) add({ severity: "error", code: "missing-asset", message: `"${n.name}".${pd.name} references a missing asset`, nodeId: n.id });
          else if (a.reference) add({ severity: "warning", code: "reference-asset", message: `"${n.name}" uses reference image "${a.name}" (not exportable)`, nodeId: n.id });
          else if (!a.robloxAssetId) add({ severity: "warning", code: "asset-not-uploaded", message: `"${n.name}" uses "${a.name}" which has no Roblox asset id — upload it to Roblox, then set the id in the Assets panel`, nodeId: n.id });
        }
        if (cls.kind !== "gui") return;
        const box = layout.get(n.id);
        if (!box || !box.visible) return;
        // outside the screen
        if (stored.className === "ScreenGui" && (box.x + box.w < rootBox.x || box.y + box.h < rootBox.y || box.x > rootBox.x + rootBox.w || box.y > rootBox.y + rootBox.h))
          add({ severity: "warning", code: "off-screen", message: `"${n.name}" is entirely outside the screen`, nodeId: n.id });
        // tap targets
        if (cls.isButton && (box.w < 32 || box.h < 32))
          add({ severity: "info", code: "small-tap-target", message: `"${n.name}" is ${Math.round(box.w)}×${Math.round(box.h)}px — mobile tap targets should be at least ~44px`, nodeId: n.id });
        // contrast
        if (cls.isText && propOf<number>(n, "TextTransparency") < 0.5 && propOf<string>(n, "Text")) {
          const own = propOf<number>(n, "BackgroundTransparency") < 0.5 ? propOf<string>(n, "BackgroundColor3") : null;
          const bg = own ?? backgroundBehind(chainOf.get(n.id) ?? []);
          const fg = propOf<string>(n, "TextColor3");
          const hasStroke = propOf<number>(n, "TextStrokeTransparency") < 0.6 || n.children.some((c) => c.className === "UIStroke");
          if (bg && !hasStroke) {
            const cr = contrastRatio(fg, bg);
            if (cr < 3) add({ severity: "warning", code: "low-contrast", message: `"${n.name}" text contrast is ${cr.toFixed(1)}:1 against ${bg} (aim for ≥ 4.5:1, ≥ 3:1 for large text)`, nodeId: n.id });
          }
          if (!propOf<boolean>(n, "TextScaled") && (box.textSize ?? 14) < 11)
            add({ severity: "info", code: "small-text", message: `"${n.name}" text is ${Math.round(box.textSize ?? 0)}px — likely unreadable on phones`, nodeId: n.id });
          if (propOf<boolean>(n, "TextScaled") && !n.children.some((c) => c.className === "UITextSizeConstraint"))
            add({ severity: "info", code: "textscaled-unconstrained", message: `"${n.name}" uses TextScaled without a UITextSizeConstraint; text may get huge on large screens`, nodeId: n.id });
        }
      });
      // responsiveness: direct children of a ScreenGui sized purely in offset and large
      if (stored.className === "ScreenGui") {
        for (const c of tree.children) {
          if (CLASSES[c.className]?.kind !== "gui") continue;
          const s = propOf<{ xs: number; xo: number; ys: number; yo: number }>(c, "Size");
          const hasConstraint = c.children.some((k) => ["UIAspectRatioConstraint", "UISizeConstraint", "UIScale"].includes(k.className));
          if (s.xs === 0 && s.ys === 0 && (s.xo > 600 || s.yo > 400) && !hasConstraint)
            add({ severity: "info", code: "offset-only", message: `"${c.name}" is a large offset-only (${s.xo}×${s.yo}) panel — it may not fit phone screens; consider Scale sizing, UIScale or UISizeConstraint`, nodeId: c.id });
        }
      }
    }
  }

  // ---- animations
  const allTrees = doc.pages.flatMap((p) => p.children).map((id) => resolveTree(doc, id)).filter((t): t is ResolvedNode => !!t);
  for (const a of Object.values(doc.animations)) {
    if (!a.tracks.length) add({ severity: "info", code: "empty-animation", message: `animation "${a.name}" has no tracks`, animationId: a.id });
    const roots = new Set<string>();
    for (const t of a.tracks) {
      const tree = allTrees.find((tr) => findResolved(tr, t.nodeId));
      const node = tree ? findResolved(tree, t.nodeId) : null;
      if (!node) {
        add({ severity: "error", code: "animation-missing-node", message: `animation "${a.name}" targets a missing node`, animationId: a.id });
        continue;
      }
      roots.add(tree!.id);
      if (!isTweenable(node.className, t.property))
        add({ severity: "error", code: "animation-bad-prop", message: `animation "${a.name}": ${node.className}.${t.property} cannot be tweened`, animationId: a.id, nodeId: node.id });
      const def = getPropDef(node.className, t.property);
      for (const k of t.keyframes) {
        if (!def) break;
        const r = coerceProp(node.className, t.property, k.value);
        if (!r.ok) add({ severity: "error", code: "animation-bad-value", message: `animation "${a.name}" keyframe at ${k.time}s: ${r.error}`, animationId: a.id });
      }
      if (t.keyframes.length < 2) add({ severity: "info", code: "animation-single-key", message: `animation "${a.name}" track ${t.property} has fewer than 2 keyframes`, animationId: a.id });
    }
    if (roots.size > 1) add({ severity: "warning", code: "animation-multi-root", message: `animation "${a.name}" spans several screens; it will not be exported`, animationId: a.id });
  }
  return issues;
}
