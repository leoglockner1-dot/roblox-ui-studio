/**
 * Export IR: a resolved, Roblox-ready instance tree.
 *
 * Built from the resolved document tree. Every property here is a value
 * Roblox accepts (asset references resolved, design-only props removed,
 * defaults dropped unless they must be explicit). Both the Luau generator
 * and the rbxmx writer consume this IR, so they cannot disagree.
 */
import { CLASSES, isDesignProp, type PropDef } from "../classes";
import { propOf, resolveTree, type ResolvedNode } from "../document";
import { ASSET_SCHEME, type AssetRecord, type DesignDocument, type PropValue } from "../types";

export interface IRProp {
  name: string;
  def: PropDef;
  value: PropValue;
}

export interface IRInstance {
  className: string;
  name: string;
  props: IRProp[];
  children: IRInstance[];
  /** Effective id in the resolved tree (for mapping animations/diagnostics). */
  id: string;
  /** Set when this instance is the root of a component instance. */
  componentId?: string;
  /** Set when this instance is a component master root. */
  masterOf?: string;
}

export interface ExportDiagnostic {
  severity: "error" | "warning" | "info";
  nodeId?: string;
  message: string;
}

export interface IRContext {
  doc: DesignDocument;
  assets: Map<string, AssetRecord>;
  diagnostics: ExportDiagnostic[];
}

export function makeContext(doc: DesignDocument, assets: AssetRecord[] = []): IRContext {
  return { doc, assets: new Map(assets.map((a) => [a.id, a])), diagnostics: [] };
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Resolve an Image-like value to a Roblox content id ("" if not resolvable). */
export function resolveContent(ctx: IRContext, value: string, nodeId: string, prop: string): string {
  if (!value) return "";
  if (value.startsWith(ASSET_SCHEME)) {
    const id = value.slice(ASSET_SCHEME.length);
    const rec = ctx.assets.get(id);
    if (!rec) {
      ctx.diagnostics.push({ severity: "error", nodeId, message: `${prop} references missing library asset "${id}"` });
      return "";
    }
    if (rec.reference) {
      ctx.diagnostics.push({ severity: "warning", nodeId, message: `${prop} uses reference image "${rec.name}" — reference images are not exported` });
      return "";
    }
    if (!rec.robloxAssetId) {
      ctx.diagnostics.push({
        severity: "warning",
        nodeId,
        message: `${prop} uses local asset "${rec.name}" which has no Roblox asset id yet — upload it to Roblox and set its asset id; exported as empty`,
      });
      return "";
    }
    return `rbxassetid://${rec.robloxAssetId}`;
  }
  return value;
}

/** Convert one resolved node's props into exportable IR props. */
export function irProps(ctx: IRContext, n: ResolvedNode): IRProp[] {
  const cls = CLASSES[n.className];
  const out: IRProp[] = [];
  for (const def of cls.props) {
    if (isDesignProp(def.name)) continue;
    let value = propOf(n, def.name);
    if (value === undefined) continue;
    if (def.type === "content") value = resolveContent(ctx, value as string, n.id, def.name);
    if (!def.alwaysEmit && equal(value, def.default)) continue;
    out.push({ name: def.name, def, value });
  }
  return out;
}

/** Full (flattened) instance tree of a stored node: component instances are expanded. */
export function buildIR(ctx: IRContext, rootId: string): IRInstance | null {
  const tree = resolveTree(ctx.doc, rootId);
  if (!tree) return null;
  return fromResolved(ctx, tree);
}

export function fromResolved(ctx: IRContext, n: ResolvedNode): IRInstance {
  return {
    className: n.className,
    name: n.name,
    id: n.id,
    props: irProps(ctx, n),
    children: n.children.map((c) => fromResolved(ctx, c)),
    componentId: n.instanceOf,
    masterOf: n.masterOf,
  };
}

/** Sanitize a name into a Luau identifier / module name (PascalCase). */
export function moduleName(name: string, taken: Set<string>): string {
  let base = name
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ""))
    .replace(/^[^A-Za-z_]+/, "");
  if (!base) base = "Item";
  base = base[0].toUpperCase() + base.slice(1);
  let n = base;
  let i = 2;
  while (taken.has(n)) n = `${base}${i++}`;
  taken.add(n);
  return n;
}
