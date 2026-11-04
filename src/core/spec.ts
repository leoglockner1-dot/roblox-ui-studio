/**
 * NodeSpec: a compact, nested JSON description of a subtree.
 *
 * Used by presets, clipboard, the HTTP API and MCP (`create_element`). Specs
 * support shorthands for common modifiers so a whole card can be described
 * in a few lines:
 *
 *   { className: "Frame", name: "Card", props: { Size: [0,200,0,260] },
 *     corner: 12, stroke: { Color: "#FFFFFF", Thickness: 2 }, padding: 12,
 *     list: { Padding: 8 }, children: [ … ] }
 */
import { CLASSES, isGuiClass } from "./classes";
import { makeNode, newId, propOf } from "./document";
import { resolveOverrideClass } from "./ops";
import { coerceProp } from "./schema";
import type { DesignDocument, DesignNode, NodeId, Props } from "./types";

export interface NodeSpec {
  className: string;
  name?: string;
  props?: Record<string, unknown>;
  /** Prop -> token id (or token name). "$textStyle" binds a text style. */
  tokens?: Record<string, string>;
  children?: NodeSpec[];
  /** Create an instance of this component (id or name) instead of a plain node. */
  component?: string;
  /** For component instances: overrides keyed by child path (see types.ts). */
  overrides?: Record<string, Record<string, unknown>>;
  notes?: string;
  /** Skip the designer baseline defaults (white frames, no borders…). */
  raw?: boolean;
  // ---- modifier shorthands (each becomes a child modifier instance)
  corner?: number | Record<string, unknown>;
  stroke?: Record<string, unknown> | number;
  gradient?: Record<string, unknown> | string[];
  padding?: number | number[] | Record<string, unknown>;
  list?: Record<string, unknown> | true;
  grid?: Record<string, unknown>;
  pages?: Record<string, unknown> | true;
  aspect?: number | Record<string, unknown>;
  scale?: number;
  sizeConstraint?: Record<string, unknown>;
  textSizeConstraint?: Record<string, unknown>;
}

export class SpecError extends Error {
  constructor(message: string, public path: string) {
    super(`${path}: ${message}`);
    this.name = "SpecError";
  }
}

/** Designer-friendly defaults applied to newly created objects (unless `raw`). */
export function baselineProps(className: string): Props {
  const def = CLASSES[className];
  if (!def || def.kind !== "gui") return {};
  const base: Props = { BorderSizePixel: 0 };
  if (className === "Frame" || className === "CanvasGroup" || className === "ScrollingFrame") {
    base.BackgroundColor3 = "#FFFFFF";
  }
  if (className === "ScrollingFrame") {
    base.ScrollBarThickness = 6;
    base.ScrollBarImageColor3 = "#FFFFFF";
    base.ScrollBarImageTransparency = 0.5;
    base.CanvasSize = { xs: 0, xo: 0, ys: 0, yo: 0 };
    base.AutomaticCanvasSize = "Y";
    base.BackgroundTransparency = 1;
  }
  if (def.isText) {
    base.FontFace = { family: "GothamSSm", weight: "Bold", style: "Normal" };
    base.TextSize = 18;
    base.TextColor3 = "#FFFFFF";
    base.BackgroundColor3 = "#FFFFFF";
    if (className === "TextLabel") base.BackgroundTransparency = 1;
    if (className === "TextButton") {
      base.BackgroundColor3 = "#4F7CFF";
      base.Size = { xs: 0, xo: 160, ys: 0, yo: 48 };
    }
    if (className === "TextLabel") base.Size = { xs: 0, xo: 200, ys: 0, yo: 40 };
  }
  if (def.isImage) {
    base.BackgroundTransparency = 1;
  }
  return base;
}

function modifierSpecs(spec: NodeSpec): NodeSpec[] {
  const out: NodeSpec[] = [];
  const obj = (v: unknown) => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  if (spec.corner !== undefined) {
    out.push({ className: "UICorner", props: typeof spec.corner === "number" ? { CornerRadius: { s: 0, o: spec.corner } } : spec.corner });
  }
  if (spec.stroke !== undefined) {
    out.push({ className: "UIStroke", props: typeof spec.stroke === "number" ? { Thickness: spec.stroke } : spec.stroke });
  }
  if (spec.gradient !== undefined) {
    if (Array.isArray(spec.gradient)) {
      const n = spec.gradient.length;
      out.push({
        className: "UIGradient",
        props: { Color: spec.gradient.map((c, i) => ({ t: n === 1 ? 0 : i / (n - 1), color: c })), Rotation: 90 },
      });
    } else out.push({ className: "UIGradient", props: spec.gradient });
  }
  if (spec.padding !== undefined) {
    const p = spec.padding;
    let props: Record<string, unknown>;
    if (typeof p === "number") props = { PaddingTop: p, PaddingBottom: p, PaddingLeft: p, PaddingRight: p };
    else if (Array.isArray(p)) {
      // CSS order: [all] | [vertical, horizontal] | [top, right, bottom, left]
      const [t, r = t, b = t, l = r] = p.length === 2 ? [p[0], p[1], p[0], p[1]] : p;
      props = { PaddingTop: t, PaddingRight: r, PaddingBottom: b, PaddingLeft: l };
    } else props = p;
    out.push({ className: "UIPadding", props });
  }
  if (spec.list !== undefined) out.push({ className: "UIListLayout", props: obj(spec.list) ?? {} });
  if (spec.grid !== undefined) out.push({ className: "UIGridLayout", props: spec.grid });
  if (spec.pages !== undefined) out.push({ className: "UIPageLayout", props: obj(spec.pages) ?? {} });
  if (spec.aspect !== undefined)
    out.push({ className: "UIAspectRatioConstraint", props: typeof spec.aspect === "number" ? { AspectRatio: spec.aspect } : spec.aspect });
  if (spec.scale !== undefined) out.push({ className: "UIScale", props: { Scale: spec.scale } });
  if (spec.sizeConstraint !== undefined) out.push({ className: "UISizeConstraint", props: spec.sizeConstraint });
  if (spec.textSizeConstraint !== undefined) out.push({ className: "UITextSizeConstraint", props: spec.textSizeConstraint });
  return out;
}

function resolveTokenId(doc: DesignDocument, ref: string): string | null {
  const all = [...doc.tokens.colors, ...doc.tokens.numbers, ...doc.tokens.textStyles];
  const t = all.find((x) => x.id === ref) ?? all.find((x) => x.name.toLowerCase() === ref.toLowerCase());
  return t ? t.id : null;
}

export function findComponentId(doc: DesignDocument, ref: string): string | null {
  if (doc.components[ref]) return ref;
  const c = Object.values(doc.components).find((x) => x.name.toLowerCase() === ref.toLowerCase());
  return c ? c.id : null;
}

/**
 * Turn a spec into DesignNodes (root first), ready for an `insert` op.
 * Validates every class and property; throws SpecError with a path on failure.
 */
export function buildNodes(doc: DesignDocument, spec: NodeSpec, parentId: NodeId | null, path = "root"): DesignNode[] {
  const out: DesignNode[] = [];
  build(doc, spec, parentId, path, out);
  return out;
}

function build(doc: DesignDocument, spec: NodeSpec, parentId: NodeId | null, path: string, out: DesignNode[]): NodeId {
  if (!spec || typeof spec !== "object") throw new SpecError("spec must be an object", path);
  const id = newId();
  let className = spec.className;
  let instance: DesignNode["instance"];
  if (spec.component) {
    const compId = findComponentId(doc, spec.component);
    if (!compId) throw new SpecError(`component "${spec.component}" not found`, path);
    const master = doc.nodes[doc.components[compId].rootId];
    className = master.className;
    instance = { componentId: compId, overrides: {} };
    for (const [rawKey, v] of Object.entries(spec.overrides ?? {})) {
      const k = overrideKeyFromPath(doc, master.id, rawKey);
      if (!k) throw new SpecError(`override "${rawKey}" does not match any node in component "${doc.components[compId].name}"`, path);
      const props: Props = {};
      for (const [pk, pv] of Object.entries(v)) {
        // Class is validated by the op engine (needs master lookup); coerce loosely here.
        props[pk] = pv as Props[string];
      }
      instance.overrides[k] = props;
    }
  }
  if (!className || !CLASSES[className]) throw new SpecError(`unknown className "${className}"`, path);
  const props: Props = spec.raw || instance ? {} : baselineProps(className);
  for (const [k, v] of Object.entries(spec.props ?? {})) {
    const r = coerceProp(className, k, v);
    if (!r.ok) throw new SpecError(r.error, path);
    props[k] = r.value;
  }
  let tokens: Record<string, string> | undefined;
  if (spec.tokens) {
    tokens = {};
    for (const [k, ref] of Object.entries(spec.tokens)) {
      const tid = resolveTokenId(doc, ref);
      if (!tid) throw new SpecError(`token "${ref}" not found`, path);
      tokens[k] = tid;
    }
  }
  const node = makeNode(className, {
    id,
    name: spec.name ?? (instance ? doc.components[instance.componentId].name : className),
    parent: parentId,
    props,
    instance,
    tokens,
  });
  if (spec.notes) node.notes = spec.notes;
  out.push(node);
  if (instance) {
    if (spec.children?.length) throw new SpecError("component instances cannot have children", path);
    return id;
  }
  const kids = [...modifierSpecs(spec), ...(spec.children ?? [])];
  kids.forEach((c, i) => {
    if (!isGuiClass(className) && className !== "ScreenGui")
      throw new SpecError(`${className} cannot have children`, path);
    const cid = build(doc, c, id, `${path}.children[${i}]${c?.name ? `(${c.name})` : ""}`, out);
    node.children.push(cid);
  });
  return id;
}

/** Convert a stored subtree back to a spec (for inspection, copy/paste, presets). */
export function toSpec(doc: DesignDocument, id: NodeId): NodeSpec {
  const n = doc.nodes[id];
  if (!n) throw new Error(`node "${id}" not found`);
  const spec: NodeSpec = { className: n.className, name: n.name, raw: true };
  if (Object.keys(n.props).length) spec.props = structuredClone(n.props) as Record<string, unknown>;
  if (n.tokens) spec.tokens = { ...n.tokens };
  if (n.notes) spec.notes = n.notes;
  if (n.instance) {
    spec.component = n.instance.componentId;
    if (Object.keys(n.instance.overrides).length) spec.overrides = structuredClone(n.instance.overrides) as NodeSpec["overrides"];
    return spec;
  }
  if (n.children.length) spec.children = n.children.map((c) => toSpec(doc, c));
  return spec;
}

/** Is this a node users can see (not a modifier)? */
export const isVisualNode = (n: { className: string }) => isGuiClass(n.className) || n.className === "ScreenGui";

export { propOf };

/**
 * Accept an override key as either an id path ("n_ab/n_cd") or a name path
 * ("Header/Title"), returning the canonical id path or null.
 */
export function overrideKeyFromPath(doc: DesignDocument, masterRootId: NodeId, key: string): string | null {
  if (resolveOverrideClass(doc, masterRootId, key)) return key;
  let container = masterRootId;
  const ids: string[] = [];
  for (const seg of key.split("/")) {
    const kids = doc.nodes[container]?.children ?? [];
    const hit = kids.find((c) => doc.nodes[c]?.name === seg) ?? kids.find((c) => doc.nodes[c]?.name.toLowerCase() === seg.toLowerCase());
    if (!hit) return null;
    ids.push(hit);
    const n = doc.nodes[hit];
    if (n.instance) {
      const comp = doc.components[n.instance.componentId];
      if (!comp) return null;
      container = comp.rootId;
    } else container = hit;
  }
  return ids.join("/");
}
