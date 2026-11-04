/**
 * The tool registry: every operation Claude (via MCP) or a script (via
 * POST /api/tools/<name>) can perform. One implementation, two transports.
 *
 * Conventions
 *  - Every tool returns `{ ok: true, ... }` or throws ToolError (reported as
 *    `{ ok: false, error, hint }`). Nothing is partially applied: each tool
 *    call is one atomic op batch and one undo step.
 *  - Node references accept ids, instance paths, name paths or unique names
 *    (see refs.ts).
 *  - Changes made through tools are recorded with source "mcp"/"api" so
 *    `undo` can revert Claude's changes without touching the user's edits.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CLASSES, ENUMS, getClass } from "../core/classes";
import { createDocument, descendants, makeNode, newId, nowIso, resolveTree, findResolved } from "../core/document";
import { DEVICES, findDevice } from "../core/devices";
import { exportDocument, exportSingleScript, makeContext } from "../core/export";
import { FONT_FAMILIES, WEIGHT_NAMES } from "../core/fonts";
import { OpError, type Op, type PropPatch } from "../core/ops";
import { findPreset, PRESETS } from "../core/presets";
import { coerceProp, coerceValue, describeType, normalizeColor } from "../core/schema";
import { buildNodes, findComponentId, overrideKeyFromPath, SpecError, toSpec, type NodeSpec } from "../core/spec";
import { animationDuration, isTweenable, sampleAnimation, EASING_STYLES } from "../core/animation";
import { validateDocument } from "../core/validate";
import { cloneSubtree, detachOps, groupOps, topOf, ungroupOps } from "../core/edit";
import type { Animation, AnimationTrack, DesignDocument, DesignNode, DesignTokens, Keyframe, Props } from "../core/types";
import { DESIGN_GUIDE } from "./guide";
import { outline, resolveRef, ToolError, layoutFor } from "./refs";
import { Store, StoreError } from "./store";

export interface ToolContext {
  store: Store;
  /** History source label ("mcp" or "api"). */
  source: string;
  /** Optional: notify running editors (open document, play animation…). */
  notify?: (event: Record<string, unknown>) => Promise<void> | void;
  /** Optional: render a PNG of a root (requires the editor build + Playwright). */
  render?: (opts: { documentId: string; rootId: string; device?: string; width?: number; height?: number; animationId?: string; time?: number }) => Promise<Buffer>;
}

export interface ToolResult {
  [k: string]: unknown;
  /** Images to return to the model (MCP image content). */
  _images?: { data: string; mimeType: string }[];
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** Does not modify anything. */
  readOnly?: boolean;
  run: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<ToolResult>;
}

const tools: ToolDef[] = [];
function tool<S extends z.ZodRawShape>(def: ToolDef<S>) {
  tools.push(def as unknown as ToolDef);
}

// ---------------------------------------------------------------- shared schema pieces

const docId = z.string().describe("Document id (from list_documents / create_document)");
const nodeRef = z.string().describe('Node reference: id ("n_…"), name path ("Screen/MainFrame/Title") or unique name');
const specSchema = z
  .any()
  .describe(
    "NodeSpec: { className, name?, props?, children?: NodeSpec[], tokens?, component?, overrides?, notes?, " +
      "corner?, stroke?, gradient?, padding?, list?, grid?, pages?, aspect?, scale?, sizeConstraint?, textSizeConstraint? }. " +
      "See get_schema / CLAUDE_INTEGRATION.md.",
  );

async function load(ctx: ToolContext, id: string) {
  return ctx.store.getDocument(id);
}

/** Apply ops as one history entry; converts errors into ToolErrors. */
async function commit(ctx: ToolContext, id: string, ops: Op[], label: string) {
  try {
    const r = await ctx.store.applyOps(id, ops, { source: ctx.source, label });
    return r.doc;
  } catch (e) {
    if (e instanceof OpError) throw new ToolError(e.message);
    throw e;
  }
}

function nameMap(nodes: DesignNode[]) {
  const out: Record<string, string> = {};
  for (const n of nodes) {
    if (!CLASSES[n.className] || CLASSES[n.className].kind === "modifier" || CLASSES[n.className].kind === "layout") continue;
    out[out[n.name] ? `${n.name}#${n.id}` : n.name] = n.id;
  }
  return out;
}

/** Build ops that update props/fields for a reference (override if inside an instance). */
function updateOpsFor(doc: DesignDocument, ref: string, props: Record<string, unknown> | undefined, fields: Record<string, unknown> = {}): Op[] {
  const r = resolveRef(doc, ref);
  if (r.instanceRoot) {
    if (Object.keys(fields).length) throw new ToolError(`"${r.name}" is inside a component instance; only properties can be overridden`, "edit the component master to change structure or names, or detach_instance");
    return [{ type: "override", instanceId: r.instanceRoot, key: r.overrideKey!, props: (props ?? {}) as PropPatch }];
  }
  return [{ type: "update", id: r.storedId!, ...(props ? { props: props as PropPatch } : {}), ...(Object.keys(fields).length ? { fields } : {}) }];
}

function summary(doc: DesignDocument) {
  return {
    id: doc.id, name: doc.name, revision: doc.revision,
    pages: doc.pages.map((p) => ({ id: p.id, name: p.name, roots: p.children.map((c) => ({ id: c, name: doc.nodes[c]?.name, className: doc.nodes[c]?.className })) })),
    components: Object.values(doc.components).map((c) => ({ id: c.id, name: c.name, rootId: c.rootId, variantOf: c.variantOf })),
    animations: Object.values(doc.animations).map((a) => ({ id: a.id, name: a.name, trigger: a.trigger, tracks: a.tracks.length, duration: animationDuration(a) })),
  };
}

function screenNode(name: string, w: number, h: number, x: number, y: number, device?: string): DesignNode {
  return makeNode("ScreenGui", { name, props: { ResetOnSpawn: false, IgnoreGuiInset: true, ZIndexBehavior: "Sibling", ScreenInsets: "CoreUISafeInsets" }, canvas: { x, y, w, h, ...(device ? { device } : {}) } });
}

/** Place a new top-level node to the right of existing ones on a page. */
function nextCanvasPos(doc: DesignDocument, pageId: string): { x: number; y: number } {
  const page = doc.pages.find((p) => p.id === pageId) ?? doc.pages[0];
  let maxX = 0;
  for (const id of page.children) {
    const n = doc.nodes[id];
    if (!n) continue;
    const l = layoutFor(doc, id);
    const b = l?.layout.get(id);
    const right = (n.canvas?.x ?? 0) + (b?.w ?? n.canvas?.w ?? 0);
    maxX = Math.max(maxX, right + 160);
  }
  return { x: maxX, y: 0 };
}

// ================================================================ documents

tool({
  name: "list_documents",
  title: "List documents",
  description: "List all design documents in the workspace (id, name, revision, counts).",
  input: {},
  readOnly: true,
  run: async (_a, ctx) => ({ ok: true, documents: await ctx.store.listDocuments() }),
});

tool({
  name: "create_document",
  title: "Create document",
  description:
    "Create a new design document. By default it contains one ScreenGui artboard (1920×1080). Returns the document summary including the screen id.",
  input: {
    name: z.string().min(1),
    screenName: z.string().optional().describe("Name of the initial ScreenGui (default 'MainScreen'); empty string for no screen"),
    device: z.string().optional().describe(`Device preset for the screen: ${DEVICES.map((d) => d.id).join(", ")}`),
    description: z.string().optional(),
  },
  run: async (a, ctx) => {
    const doc = createDocument(a.name);
    if (a.description) doc.meta.description = a.description;
    await ctx.store.putDocument(doc);
    let d = doc;
    if (a.screenName !== "") {
      const dev = findDevice(a.device) ?? DEVICES[0];
      const s = screenNode(a.screenName || "MainScreen", dev.width, dev.height, 0, 0, dev.id);
      d = await commit(ctx, doc.id, [{ type: "insert", nodes: [s], pageId: doc.pages[0].id }], "Create screen");
    }
    await ctx.notify?.({ type: "open", documentId: d.id });
    return { ok: true, document: summary(d) };
  },
});

tool({
  name: "open_document",
  title: "Open document",
  description: "Load a document summary and ask any running editor window to open it.",
  input: { documentId: docId },
  readOnly: true,
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    await ctx.notify?.({ type: "open", documentId: d.id });
    return { ok: true, document: summary(d) };
  },
});

tool({
  name: "duplicate_document",
  title: "Duplicate document",
  description: "Copy a whole document (e.g. to explore a different direction safely).",
  input: { documentId: docId, name: z.string().min(1) },
  run: async (a, ctx) => {
    const src = await load(ctx, a.documentId);
    const copy = await ctx.store.createDocument(a.name, src);
    return { ok: true, document: summary(copy) };
  },
});

tool({
  name: "rename_document",
  title: "Rename document",
  description: "Rename a document and/or set its description.",
  input: { documentId: docId, name: z.string().optional(), description: z.string().optional() },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const op: Op = { type: "setDoc" };
    if (a.name) op.name = a.name;
    if (a.description !== undefined) op.meta = { ...d.meta, description: a.description };
    return { ok: true, document: summary(await commit(ctx, a.documentId, [op], "Rename document")) };
  },
});

tool({
  name: "delete_document",
  title: "Delete document",
  description: "Permanently delete a document. Requires confirm: true.",
  input: { documentId: docId, confirm: z.boolean() },
  run: async (a, ctx) => {
    if (!a.confirm) throw new ToolError("set confirm: true to delete");
    await load(ctx, a.documentId);
    await ctx.store.deleteDocument(a.documentId);
    return { ok: true, deleted: a.documentId };
  },
});

// ================================================================ inspection

tool({
  name: "inspect_design",
  title: "Inspect design",
  description:
    "Describe a document: pages, screens, full node tree with ids, explicitly-set properties and computed absolute boxes (x,y relative to the screen, w×h in px), components, tokens and animations. " +
    "Use format 'json' for the raw stored nodes of a subtree. Call this before editing an existing design.",
  input: {
    documentId: docId,
    nodeId: nodeRef.optional().describe("Limit to this subtree"),
    depth: z.number().int().min(0).optional(),
    format: z.enum(["outline", "json", "spec"]).optional().describe("outline (default), json (stored nodes) or spec (NodeSpec you can edit and re-create)"),
    includeLayout: z.boolean().optional().describe("Include computed boxes (default true)"),
  },
  readOnly: true,
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const base = { ok: true, document: summary(d), tokens: d.tokens };
    if (a.format === "json" || a.format === "spec") {
      if (!a.nodeId) throw new ToolError(`format '${a.format}' requires nodeId`);
      const r = resolveRef(d, a.nodeId);
      if (!r.storedId) throw new ToolError("json/spec output needs a stored node (not one inside an instance)");
      if (a.format === "spec") return { ...base, spec: toSpec(d, r.storedId) };
      const ids = [r.storedId, ...descendants(d, r.storedId)];
      return { ...base, nodes: ids.map((id) => d.nodes[id]) };
    }
    return { ...base, outline: outline(d, { rootId: a.nodeId, depth: a.depth, layout: a.includeLayout !== false }) };
  },
});

tool({
  name: "find_elements",
  title: "Find elements",
  description: "Search nodes by name (substring, case-insensitive), className and/or text content.",
  input: { documentId: docId, name: z.string().optional(), className: z.string().optional(), text: z.string().optional(), limit: z.number().int().optional() },
  readOnly: true,
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const out: { id: string; name: string; className: string; text?: string; root: string }[] = [];
    for (const rootId of d.pages.flatMap((p) => p.children)) {
      const t = resolveTree(d, rootId);
      if (!t) continue;
      const visit = (n: typeof t) => {
        const text = typeof n.props.Text === "string" ? n.props.Text : undefined;
        if ((!a.name || n.name.toLowerCase().includes(a.name.toLowerCase())) && (!a.className || n.className === a.className) && (!a.text || (text ?? "").toLowerCase().includes(a.text.toLowerCase())))
          out.push({ id: n.id, name: n.name, className: n.className, ...(text !== undefined ? { text } : {}), root: d.nodes[rootId].name });
        n.children.forEach(visit);
      };
      visit(t);
    }
    return { ok: true, count: out.length, results: out.slice(0, a.limit ?? 100) };
  },
});

tool({
  name: "get_schema",
  title: "Roblox class & property schema",
  description:
    "Reference for supported Roblox classes, their properties (type, default, enum values), fonts, device presets, presets and easing styles. Pass className for one class.",
  input: { className: z.string().optional() },
  readOnly: true,
  run: async (a) => {
    const classes = (a.className ? [getClassSafe(a.className)] : Object.values(CLASSES)).map((c) => ({
      className: c.name, kind: c.kind, description: c.description,
      ...(a.className ? { props: c.props.map((p) => ({ name: p.name, type: describeType(p), default: p.default, tweenable: !!p.tweenable, ...(p.description ? { note: p.description } : {}) })) } : { props: c.props.map((p) => p.name) }),
    }));
    return {
      ok: true, classes,
      ...(a.className
        ? {}
        : {
            enums: ENUMS, fonts: FONT_FAMILIES.map((f) => f.family), fontWeights: WEIGHT_NAMES, easingStyles: EASING_STYLES,
            devices: DEVICES.map((d) => ({ id: d.id, name: d.name, width: d.width, height: d.height })),
            presets: PRESETS.map((p) => ({ id: p.id, name: p.name, category: p.category, description: p.description })),
            valueFormats: {
              UDim2: "{xs,xo,ys,yo} or [xs,xo,ys,yo]", UDim: "{s,o} or [s,o] or number(offset)", Vector2: "{x,y} or [x,y]",
              Color3: '"#RRGGBB"', FontFace: '{family:"GothamSSm",weight:"Bold",style:"Normal"}', Enum: '"Center" (name only)',
              ColorSequence: '[{t:0,color:"#FFF"},{t:1,color:"#000"}]', NumberSequence: "[{t:0,value:0},{t:1,value:1}]",
              Content: '"asset://<libraryAssetId>" | "rbxassetid://123"',
            },
          }),
    };
  },
});

function getClassSafe(name: string) {
  try {
    return getClass(name);
  } catch {
    throw new ToolError(`unknown class "${name}"`, `valid: ${Object.keys(CLASSES).join(", ")}`);
  }
}

// ================================================================ pages & screens

tool({
  name: "create_page",
  title: "Create page",
  description: "Add a page (a separate canvas, e.g. 'Shop', 'HUD', 'Explorations').",
  input: { documentId: docId, name: z.string().min(1) },
  run: async (a, ctx) => {
    const id = newId("pg");
    const d = await commit(ctx, a.documentId, [{ type: "addPage", page: { id, name: a.name, children: [] } }], `Create page ${a.name}`);
    return { ok: true, pageId: id, document: summary(d) };
  },
});

tool({
  name: "rename_page",
  title: "Rename page",
  description: "Rename a page (pageId from inspect_design / the document summary).",
  input: { documentId: docId, pageId: z.string(), name: z.string().min(1) },
  run: async (a, ctx) => ({ ok: true, document: summary(await commit(ctx, a.documentId, [{ type: "updatePage", id: a.pageId, name: a.name }], "Rename page")) }),
});

tool({
  name: "delete_page",
  title: "Delete page",
  description: "Delete a page and everything on it (undoable).",
  input: { documentId: docId, pageId: z.string() },
  run: async (a, ctx) => ({ ok: true, document: summary(await commit(ctx, a.documentId, [{ type: "removePage", id: a.pageId }], "Delete page")) }),
});

tool({
  name: "create_screen",
  title: "Create screen (ScreenGui artboard)",
  description: "Create a ScreenGui artboard at a device size. Its children use Scale/Offset relative to the screen. Placed to the right of existing artboards unless x/y given.",
  input: {
    documentId: docId,
    name: z.string().min(1),
    pageId: z.string().optional(),
    device: z.string().optional().describe("Device preset id (default desktop-1080p)"),
    width: z.number().optional(),
    height: z.number().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    ignoreGuiInset: z.boolean().optional().describe("Default true (full screen). false = leave room for the Roblox top bar."),
  },
  run: async (a, ctx) => {
    const d0 = await load(ctx, a.documentId);
    const pageId = a.pageId ?? d0.pages[0].id;
    const dev = findDevice(a.device) ?? DEVICES[0];
    const pos = a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : nextCanvasPos(d0, pageId);
    const s = screenNode(a.name, a.width ?? dev.width, a.height ?? dev.height, pos.x, pos.y, a.width ? undefined : dev.id);
    if (a.ignoreGuiInset === false) s.props.IgnoreGuiInset = false;
    const d = await commit(ctx, a.documentId, [{ type: "insert", nodes: [s], pageId }], `Create screen ${a.name}`);
    return { ok: true, screenId: s.id, document: summary(d) };
  },
});

tool({
  name: "set_screen_size",
  title: "Set screen size",
  description: "Change the simulated device size of a ScreenGui artboard (to test responsiveness).",
  input: { documentId: docId, screenId: nodeRef, device: z.string().optional(), width: z.number().optional(), height: z.number().optional() },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const r = resolveRef(d, a.screenId);
    const n = r.storedId && d.nodes[r.storedId];
    if (!n || n.className !== "ScreenGui" || n.parent) throw new ToolError(`"${a.screenId}" is not a top-level ScreenGui`);
    const dev = findDevice(a.device);
    const w = a.width ?? dev?.width ?? n.canvas?.w ?? 1920;
    const h = a.height ?? dev?.height ?? n.canvas?.h ?? 1080;
    const canvas = { x: n.canvas?.x ?? 0, y: n.canvas?.y ?? 0, w, h, ...(dev ? { device: dev.id } : {}) };
    await commit(ctx, a.documentId, [{ type: "update", id: n.id, fields: { canvas } }], "Resize screen");
    return { ok: true, screenId: n.id, width: w, height: h };
  },
});

// ================================================================ elements

tool({
  name: "create_element",
  title: "Create element(s)",
  description:
    "Create a subtree from a NodeSpec (or several via `specs`, or a preset via `preset`). parentId omitted = top level of the page (loose frame). " +
    "Returns the root id(s) and a name→id map of every created GUI object. Specs are validated fully before anything is applied.",
  input: {
    documentId: docId,
    parentId: nodeRef.optional(),
    pageId: z.string().optional(),
    index: z.number().int().optional().describe("Child index (default: append)"),
    spec: specSchema.optional(),
    specs: z.array(specSchema).optional(),
    preset: z.string().optional().describe("Preset id from get_schema (e.g. 'shop-card'); merged with `spec.name`/`spec.props` if given"),
    canvas: z.object({ x: z.number(), y: z.number() }).optional().describe("Canvas position for top-level nodes"),
  },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    let parentId: string | null = null;
    if (a.parentId) {
      const r = resolveRef(d, a.parentId);
      if (!r.storedId) throw new ToolError(`cannot add children inside component instance "${r.name}"`, "edit the component master or detach_instance first");
      parentId = r.storedId;
    }
    let specs: NodeSpec[] = a.specs ?? (a.spec ? [a.spec] : []);
    if (a.preset) {
      const p = findPreset(a.preset);
      if (!p) throw new ToolError(`unknown preset "${a.preset}"`, `available: ${PRESETS.map((x) => x.id).join(", ")}`);
      const over = (a.spec ?? {}) as Partial<NodeSpec>;
      specs = [{ ...structuredClone(p.spec), ...(over.name ? { name: over.name } : {}), props: { ...(p.spec.props ?? {}), ...(over.props ?? {}) } }];
    }
    if (!specs.length) throw new ToolError("provide spec, specs or preset");
    const ops: Op[] = [];
    const all: DesignNode[] = [];
    const roots: string[] = [];
    try {
      specs.forEach((s, i) => {
        const nodes = buildNodes(d, s, parentId, `specs[${i}]`, { lenientTokens: !!a.preset });
        if (!parentId) {
          const pos = a.canvas ?? nextCanvasPos(d, a.pageId ?? d.pages[0].id);
          nodes[0].canvas = { x: pos.x, y: pos.y + i * 40 };
        }
        ops.push({ type: "insert", nodes, pageId: a.pageId, index: a.index !== undefined ? a.index + i : undefined });
        all.push(...nodes);
        roots.push(nodes[0].id);
      });
    } catch (e) {
      if (e instanceof SpecError) throw new ToolError(e.message, "check property names/types with get_schema");
      throw e;
    }
    const doc = await commit(ctx, a.documentId, ops, `Create ${specs.map((s) => s.name ?? s.className).join(", ")}`);
    return { ok: true, revision: doc.revision, rootIds: roots, ids: nameMap(all) };
  },
});

const updateItem = z.object({
  nodeId: nodeRef,
  props: z.record(z.string(), z.any()).optional().describe("Property patch. null removes a property (back to default)."),
  name: z.string().optional(),
  tokens: z.record(z.string(), z.string().nullable()).optional().describe('Bind props to tokens: {BackgroundColor3: "Primary", "$textStyle": "Title"}; null unbinds'),
  notes: z.string().optional(),
  locked: z.boolean().optional(),
});

function tokenField(d: DesignDocument, node: DesignNode, patch: Record<string, string | null>) {
  const cur = { ...(node.tokens ?? {}) };
  const all = [...d.tokens.colors, ...d.tokens.numbers, ...d.tokens.textStyles];
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete cur[k];
    else {
      const t = all.find((x) => x.id === v) ?? all.find((x) => x.name.toLowerCase() === v.toLowerCase());
      if (!t) throw new ToolError(`token "${v}" not found`, `tokens: ${all.map((x) => x.name).join(", ")}`);
      cur[k] = t.id;
    }
  }
  return Object.keys(cur).length ? cur : null;
}

function opsForUpdate(d: DesignDocument, u: z.infer<typeof updateItem>): Op[] {
  const fields: Record<string, unknown> = {};
  if (u.name !== undefined) fields.name = u.name;
  if (u.notes !== undefined) fields.notes = u.notes || null;
  if (u.locked !== undefined) fields.locked = u.locked || null;
  if (u.tokens) {
    const r = resolveRef(d, u.nodeId);
    if (!r.storedId) throw new ToolError("token bindings can only be set on stored nodes (not inside instances)");
    fields.tokens = tokenField(d, d.nodes[r.storedId], u.tokens);
  }
  return updateOpsFor(d, u.nodeId, u.props, fields);
}

tool({
  name: "update_element",
  title: "Update element",
  description:
    "Change properties, name, token bindings, notes or lock state of a node. Inside a component instance, property changes become instance overrides automatically.",
  input: { documentId: docId, ...updateItem.shape },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const { documentId: _, ...u } = a;
    const doc = await commit(ctx, a.documentId, opsForUpdate(d, u), `Update ${a.nodeId}`);
    return { ok: true, revision: doc.revision };
  },
});

tool({
  name: "update_elements",
  title: "Update many elements",
  description: "Batch version of update_element (atomic: all or nothing, one undo step).",
  input: { documentId: docId, updates: z.array(updateItem).min(1) },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const ops = a.updates.flatMap((u) => opsForUpdate(d, u));
    const doc = await commit(ctx, a.documentId, ops, `Update ${a.updates.length} elements`);
    return { ok: true, revision: doc.revision, updated: a.updates.length };
  },
});

tool({
  name: "delete_element",
  title: "Delete element(s)",
  description: "Delete nodes (and their subtrees). Undoable.",
  input: { documentId: docId, nodeIds: z.array(nodeRef).min(1) },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const ids = a.nodeIds.map((r) => {
      const ref = resolveRef(d, r);
      if (!ref.storedId) throw new ToolError(`"${ref.name}" is inside a component instance and cannot be deleted`, "hide it with Visible=false instead");
      return ref.storedId;
    });
    // skip nodes whose ancestor is also being deleted
    const set = new Set(ids);
    const tops = ids.filter((id) => {
      let p = d.nodes[id].parent;
      while (p) {
        if (set.has(p)) return false;
        p = d.nodes[p]?.parent ?? null;
      }
      return true;
    });
    const doc = await commit(ctx, a.documentId, tops.map((id) => ({ type: "remove", id }) as Op), `Delete ${tops.length}`);
    return { ok: true, revision: doc.revision, deleted: tops };
  },
});

tool({
  name: "duplicate_element",
  title: "Duplicate element",
  description: "Duplicate a node (with its subtree) next to the original. Optional new name and property patch for the copy (e.g. a new Position).",
  input: { documentId: docId, nodeId: nodeRef, name: z.string().optional(), props: z.record(z.string(), z.any()).optional(), count: z.number().int().min(1).max(50).optional() },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const r = resolveRef(d, a.nodeId);
    if (!r.storedId) throw new ToolError("cannot duplicate a node inside a component instance; duplicate the instance itself");
    const src = d.nodes[r.storedId];
    const ops: Op[] = [];
    const created: string[] = [];
    const siblings = src.parent ? d.nodes[src.parent].children : d.pages.find((p) => p.children.includes(src.id))!.children;
    const idx = siblings.indexOf(src.id);
    for (let i = 0; i < (a.count ?? 1); i++) {
      const nodes = cloneSubtree(d, src.id, src.parent);
      nodes[0].name = a.name ?? src.name;
      if (a.props) nodes[0].props = { ...nodes[0].props, ...(a.props as Props) };
      if (!src.parent && src.canvas) nodes[0].canvas = { ...src.canvas, x: src.canvas.x + 40 * (i + 1), y: src.canvas.y + 40 * (i + 1) };
      ops.push({ type: "insert", nodes, index: idx + 1 + i, pageId: src.parent ? undefined : d.pages.find((p) => p.children.includes(src.id))!.id });
      created.push(nodes[0].id);
    }
    const doc = await commit(ctx, a.documentId, ops, `Duplicate ${src.name}`);
    return { ok: true, revision: doc.revision, createdIds: created };
  },
});

tool({
  name: "move_element",
  title: "Move / reparent element",
  description: "Reparent and/or reorder a node (parentId null = top level), and/or set its Position (UDim2).",
  input: { documentId: docId, nodeId: nodeRef, parentId: nodeRef.nullable().optional(), index: z.number().int().optional(), position: z.any().optional().describe("UDim2"), pageId: z.string().optional() },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const r = resolveRef(d, a.nodeId);
    const ops: Op[] = [];
    if (a.parentId !== undefined || a.index !== undefined || a.pageId) {
      if (!r.storedId) throw new ToolError("cannot reparent nodes inside a component instance");
      let parent: string | null = r.storedId ? d.nodes[r.storedId].parent : null;
      if (a.parentId !== undefined) {
        if (a.parentId === null) parent = null;
        else {
          const p = resolveRef(d, a.parentId);
          if (!p.storedId) throw new ToolError("target parent is inside a component instance");
          parent = p.storedId;
        }
      }
      ops.push({ type: "move", id: r.storedId, parentId: parent, index: a.index, pageId: a.pageId });
    }
    if (a.position !== undefined) ops.push(...updateOpsFor(d, a.nodeId, { Position: a.position }));
    if (!ops.length) throw new ToolError("nothing to do: give parentId, index, pageId or position");
    const doc = await commit(ctx, a.documentId, ops, `Move ${r.name}`);
    return { ok: true, revision: doc.revision };
  },
});

tool({
  name: "resize_element",
  title: "Resize element",
  description: "Set Size (UDim2) and optionally AnchorPoint of a node.",
  input: { documentId: docId, nodeId: nodeRef, size: z.any().describe("UDim2"), anchorPoint: z.any().optional() },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const props: Record<string, unknown> = { Size: a.size };
    if (a.anchorPoint !== undefined) props.AnchorPoint = a.anchorPoint;
    const doc = await commit(ctx, a.documentId, updateOpsFor(d, a.nodeId, props), "Resize");
    return { ok: true, revision: doc.revision };
  },
});

tool({
  name: "group_elements",
  title: "Group elements",
  description: "Wrap sibling nodes in a new transparent Frame that exactly covers them (offset-positioned). Children keep their on-screen position.",
  input: { documentId: docId, nodeIds: z.array(nodeRef).min(1), name: z.string().optional() },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const refs = a.nodeIds.map((r) => resolveRef(d, r));
    if (refs.some((r) => !r.storedId)) throw new ToolError("cannot group nodes inside a component instance");
    const ids = refs.map((r) => r.storedId!);
    const parent = d.nodes[ids[0]].parent;
    if (!parent || ids.some((id) => d.nodes[id].parent !== parent)) throw new ToolError("all nodes must share the same (non-top-level) parent");
    const ops = groupOps(d, layoutFor(d, topOf(d, parent))!.layout, ids, parent, a.name ?? "Group");
    const doc = await commit(ctx, a.documentId, ops.ops, "Group");
    return { ok: true, revision: doc.revision, groupId: ops.groupId };
  },
});

tool({
  name: "ungroup_element",
  title: "Ungroup",
  description: "Remove a Frame wrapper, moving its GUI children to its parent (positions converted to stay in place).",
  input: { documentId: docId, nodeId: nodeRef },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const r = resolveRef(d, a.nodeId);
    const g = r.storedId ? d.nodes[r.storedId] : null;
    if (!g || !g.parent) throw new ToolError("can only ungroup a nested (non top-level) stored node");
    const ops = ungroupOps(d, layoutFor(d, topOf(d, g.id))!.layout, g.id);
    const doc = await commit(ctx, a.documentId, ops, "Ungroup");
    return { ok: true, revision: doc.revision };
  },
});

// ================================================================ components

tool({
  name: "create_component",
  title: "Create component",
  description: "Turn an existing node into a reusable component master (it stays where it is). Insert copies with insert_component; editing the master updates all instances.",
  input: { documentId: docId, nodeId: nodeRef, name: z.string().optional(), description: z.string().optional() },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const r = resolveRef(d, a.nodeId);
    if (!r.storedId) throw new ToolError("cannot make a node inside an instance a component");
    const n = d.nodes[r.storedId];
    if (n.componentId) throw new ToolError(`"${n.name}" is already the master of a component`);
    if (n.instance) throw new ToolError(`"${n.name}" is an instance; detach it first`);
    if (CLASSES[n.className].kind !== "gui") throw new ToolError("only GUI objects can be components");
    const id = newId("cmp");
    const name = a.name ?? n.name;
    const doc = await commit(ctx, a.documentId, [
      { type: "setComponent", id, def: { id, name, description: a.description, rootId: n.id, createdAt: nowIso() } },
      { type: "update", id: n.id, fields: { componentId: id } },
    ], `Create component ${name}`);
    return { ok: true, revision: doc.revision, componentId: id };
  },
});

tool({
  name: "list_components",
  title: "List components",
  description: "List components with their master id, instance count and overridable child paths.",
  input: { documentId: docId },
  readOnly: true,
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const comps = Object.values(d.components).map((c) => {
      const count = Object.values(d.nodes).filter((n) => n.instance?.componentId === c.id).length;
      const paths: string[] = [];
      const t = resolveTree(d, c.rootId);
      const walk = (n: NonNullable<typeof t>, prefix: string) => {
        for (const ch of n.children) {
          const p = prefix ? `${prefix}/${ch.name}` : ch.name;
          paths.push(`${p} (${ch.className})`);
          walk(ch, p);
        }
      };
      if (t) walk(t, "");
      return { id: c.id, name: c.name, description: c.description, masterId: c.rootId, className: d.nodes[c.rootId]?.className, instances: count, variantOf: c.variantOf, overridePaths: paths };
    });
    return { ok: true, components: comps };
  },
});

tool({
  name: "insert_component",
  title: "Insert component instance",
  description: "Insert an instance of a component. overrides are keyed by child name path (e.g. {\"Title\": {\"Text\": \"Sword\"}}).",
  input: {
    documentId: docId, component: z.string().describe("Component id or name"), parentId: nodeRef.optional(), index: z.number().int().optional(),
    name: z.string().optional(), props: z.record(z.string(), z.any()).optional(), overrides: z.record(z.string(), z.record(z.string(), z.any())).optional(),
    canvas: z.object({ x: z.number(), y: z.number() }).optional(),
  },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const cid = findComponentId(d, a.component);
    if (!cid) throw new ToolError(`component "${a.component}" not found`, `components: ${Object.values(d.components).map((c) => c.name).join(", ") || "none"}`);
    let parentId: string | null = null;
    if (a.parentId) {
      const r = resolveRef(d, a.parentId);
      if (!r.storedId) throw new ToolError("cannot insert inside a component instance");
      parentId = r.storedId;
      const masterRoot = d.components[cid].rootId;
      if (parentId === masterRoot || descendants(d, masterRoot).includes(parentId)) throw new ToolError("cannot insert a component inside its own master");
    }
    let nodes: DesignNode[];
    try {
      nodes = buildNodes(d, { className: "Frame", component: cid, name: a.name, props: a.props, overrides: a.overrides }, parentId);
    } catch (e) {
      if (e instanceof SpecError) throw new ToolError(e.message);
      throw e;
    }
    if (!parentId) nodes[0].canvas = a.canvas ?? nextCanvasPos(d, d.pages[0].id);
    const doc = await commit(ctx, a.documentId, [{ type: "insert", nodes, index: a.index }], `Insert ${d.components[cid].name}`);
    return { ok: true, revision: doc.revision, instanceId: nodes[0].id };
  },
});

tool({
  name: "update_component",
  title: "Update component",
  description: "Rename a component or change its description. (Edit its master node with update_element to change the design.)",
  input: { documentId: docId, component: z.string(), name: z.string().optional(), description: z.string().optional() },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const cid = findComponentId(d, a.component);
    if (!cid) throw new ToolError(`component "${a.component}" not found`);
    const def = { ...d.components[cid], ...(a.name ? { name: a.name } : {}), ...(a.description !== undefined ? { description: a.description } : {}) };
    const doc = await commit(ctx, a.documentId, [{ type: "setComponent", id: cid, def }], "Update component");
    return { ok: true, revision: doc.revision };
  },
});

tool({
  name: "set_instance_override",
  title: "Override inside an instance",
  description: "Set (or with null values, clear) property overrides on a child of a component instance, addressed by name path.",
  input: { documentId: docId, instanceId: nodeRef, path: z.string().describe('Child name path inside the component, e.g. "Header/Title"'), props: z.record(z.string(), z.any()) },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const r = resolveRef(d, a.instanceId);
    const inst = r.storedId ? d.nodes[r.storedId] : null;
    if (!inst?.instance) throw new ToolError(`"${a.instanceId}" is not a component instance`);
    const key = overrideKeyFromPath(d, d.components[inst.instance.componentId].rootId, a.path);
    if (!key) throw new ToolError(`"${a.path}" not found in component`, "list_components shows overridePaths");
    const doc = await commit(ctx, a.documentId, [{ type: "override", instanceId: inst.id, key, props: a.props as PropPatch }], "Override");
    return { ok: true, revision: doc.revision };
  },
});

tool({
  name: "detach_instance",
  title: "Detach instance",
  description: "Convert a component instance into ordinary editable nodes (overrides baked in).",
  input: { documentId: docId, instanceId: nodeRef },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const r = resolveRef(d, a.instanceId);
    const inst = r.storedId ? d.nodes[r.storedId] : null;
    if (!inst?.instance) throw new ToolError(`"${a.instanceId}" is not a component instance`);
    const ops = detachOps(d, inst.id);
    const doc = await commit(ctx, a.documentId, ops.ops, "Detach instance");
    return { ok: true, revision: doc.revision, nodeId: ops.newId };
  },
});

tool({
  name: "create_component_variant",
  title: "Create component variant",
  description: "Duplicate a component's master as a new component in the same variant set (e.g. Button / State=Hover). Edit the new master, then swap instances with swap_component.",
  input: {
    documentId: docId, component: z.string(), setName: z.string().optional().describe("Variant set name (default: component name)"),
    values: z.record(z.string(), z.string()).describe('Variant property values, e.g. {"State":"Hover"}'),
    baseValues: z.record(z.string(), z.string()).optional().describe("Values to assign to the original if it is not yet in a set (default: same keys = 'Default')"),
    props: z.record(z.string(), z.any()).optional().describe("Prop patch applied to the new master root"),
  },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const cid = findComponentId(d, a.component);
    if (!cid) throw new ToolError(`component "${a.component}" not found`);
    const base = d.components[cid];
    const setName = a.setName ?? base.variantOf?.setName ?? base.name;
    const master = d.nodes[base.rootId];
    const nodes = cloneSubtree(d, master.id, master.parent);
    const vname = `${setName} / ${Object.entries(a.values).map(([k, v]) => `${k}=${v}`).join(", ")}`;
    nodes[0].name = vname.replace(/[/]/g, "-");
    if (a.props) nodes[0].props = { ...nodes[0].props, ...(a.props as Props) };
    const pageId = master.parent ? undefined : d.pages.find((p) => p.children.includes(master.id))?.id;
    if (!master.parent && master.canvas) {
      const l = layoutFor(d, master.id);
      nodes[0].canvas = { x: master.canvas.x + (l?.layout.get(master.id)?.w ?? 100) + 40, y: master.canvas.y };
    }
    const id = newId("cmp");
    const ops: Op[] = [
      { type: "insert", nodes, pageId, index: (master.parent ? d.nodes[master.parent].children : d.pages.find((p) => p.children.includes(master.id))!.children).indexOf(master.id) + 1 },
      { type: "setComponent", id, def: { id, name: vname, rootId: nodes[0].id, variantOf: { setName, values: a.values }, createdAt: nowIso() } },
      { type: "update", id: nodes[0].id, fields: { componentId: id } },
    ];
    if (!base.variantOf) {
      const baseValues = a.baseValues ?? Object.fromEntries(Object.keys(a.values).map((k) => [k, "Default"]));
      ops.push({ type: "setComponent", id: cid, def: { ...base, variantOf: { setName, values: baseValues } } });
    }
    const doc = await commit(ctx, a.documentId, ops, `Variant ${vname}`);
    return { ok: true, revision: doc.revision, componentId: id, masterId: nodes[0].id };
  },
});

tool({
  name: "swap_component",
  title: "Swap instance component",
  description: "Point an instance at another component (e.g. a different variant). Overrides whose paths still exist are kept.",
  input: { documentId: docId, instanceId: nodeRef, component: z.string() },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const r = resolveRef(d, a.instanceId);
    const inst = r.storedId ? d.nodes[r.storedId] : null;
    if (!inst?.instance) throw new ToolError(`"${a.instanceId}" is not a component instance`);
    const cid = findComponentId(d, a.component);
    if (!cid) throw new ToolError(`component "${a.component}" not found`);
    // Map overrides by name path from old master to new master.
    const oldRoot = d.components[inst.instance.componentId]?.rootId;
    const newRoot = d.components[cid].rootId;
    const overrides: Record<string, Props> = {};
    for (const [key, v] of Object.entries(inst.instance.overrides)) {
      const names = key.split("/").map((id) => d.nodes[id]?.name ?? "");
      const k2 = oldRoot ? overrideKeyFromPath(d, newRoot, names.join("/")) : null;
      if (k2) overrides[k2] = v;
    }
    const doc = await commit(ctx, a.documentId, [{ type: "update", id: inst.id, fields: { instance: { componentId: cid, overrides } } }], "Swap component");
    return { ok: true, revision: doc.revision, keptOverrides: Object.keys(overrides).length };
  },
});

// ================================================================ design system

tool({
  name: "set_design_tokens",
  title: "Set design tokens",
  description:
    "Create/update colour, number (spacing/radius) and text-style tokens. Mode 'merge' (default) updates by name and adds new ones; 'replace' replaces the whole set. Nodes bound to tokens update automatically.",
  input: {
    documentId: docId,
    mode: z.enum(["merge", "replace"]).optional(),
    colors: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    numbers: z.array(z.object({ name: z.string(), value: z.number() })).optional(),
    textStyles: z.array(z.object({ name: z.string(), font: z.any(), size: z.number(), lineHeight: z.number().optional() })).optional(),
  },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const fontDef = CLASSES.TextLabel.props.find((p) => p.name === "FontFace")!;
    const t: DesignTokens = a.mode === "replace" ? { colors: [], numbers: [], textStyles: [] } : structuredClone(d.tokens);
    const upsert = <T extends { id: string; name: string }>(list: T[], item: Omit<T, "id">, prefix: string) => {
      const ex = list.find((x) => x.name.toLowerCase() === item.name.toLowerCase());
      if (ex) Object.assign(ex, item);
      else list.push({ ...(item as T), id: newId(prefix) });
    };
    for (const c of a.colors ?? []) {
      const v = normalizeColor(c.value);
      if (!v) throw new ToolError(`invalid colour "${c.value}" for token ${c.name}`);
      upsert(t.colors, { name: c.name, value: v }, "c");
    }
    for (const n of a.numbers ?? []) upsert(t.numbers, { name: n.name, value: n.value }, "s");
    for (const s of a.textStyles ?? []) {
      const f = coerceValue(fontDef, s.font);
      if (!f.ok) throw new ToolError(`text style ${s.name}: ${f.error}`);
      upsert(t.textStyles, { name: s.name, font: f.value as never, size: s.size, ...(s.lineHeight ? { lineHeight: s.lineHeight } : {}) }, "t");
    }
    const doc = await commit(ctx, a.documentId, [{ type: "setTokens", tokens: t }], "Set tokens");
    return { ok: true, revision: doc.revision, tokens: doc.tokens };
  },
});

tool({
  name: "create_variation",
  title: "Create design variation",
  description: "Duplicate a whole screen (or top-level frame) next to the original to explore an alternative design. Optionally on another page.",
  input: { documentId: docId, rootId: nodeRef, name: z.string(), pageId: z.string().optional() },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const r = resolveRef(d, a.rootId);
    const src = r.storedId ? d.nodes[r.storedId] : null;
    if (!src || src.parent) throw new ToolError("rootId must be a top-level node (a screen or loose frame)");
    const nodes = cloneSubtree(d, src.id, null);
    nodes[0].name = a.name;
    const page = a.pageId ?? d.pages.find((p) => p.children.includes(src.id))!.id;
    const pos = nextCanvasPos(d, page);
    nodes[0].canvas = { ...(src.canvas ?? { x: 0, y: 0 }), x: pos.x, y: src.canvas?.y ?? 0 };
    // Duplicate animations targeting the source tree, remapped to the copy.
    const idMap = new Map<string, string>();
    [src.id, ...descendants(d, src.id)].forEach((id, i) => idMap.set(id, nodes[i].id));
    const ops: Op[] = [{ type: "insert", nodes, pageId: page }];
    for (const anim of Object.values(d.animations)) {
      if (!anim.tracks.every((t) => idMap.has(t.nodeId.split("/")[0]))) continue;
      const id = newId("an");
      ops.push({ type: "setAnimation", id, anim: { ...structuredClone(anim), id, name: `${anim.name} (${a.name})`, triggerNodeId: anim.triggerNodeId ? remap(anim.triggerNodeId, idMap) : undefined, tracks: anim.tracks.map((t) => ({ ...t, id: newId("tr"), nodeId: remap(t.nodeId, idMap) })) } });
    }
    const doc = await commit(ctx, a.documentId, ops, `Variation ${a.name}`);
    return { ok: true, revision: doc.revision, rootId: nodes[0].id };
  },
});

function remap(effId: string, map: Map<string, string>) {
  const [head, ...rest] = effId.split("/");
  return [map.get(head) ?? head, ...rest].join("/");
}

// ================================================================ assets

tool({
  name: "import_asset",
  title: "Import image asset",
  description:
    "Import a PNG/JPEG/GIF/WebP/BMP/SVG into the shared asset library from a local file path, an https URL or base64. Use reference: true for inspiration images (never exported). Returns assetId; use it as Image = \"asset://<assetId>\".",
  input: {
    path: z.string().optional(), url: z.string().optional(), base64: z.string().optional(),
    name: z.string().optional(), folder: z.string().optional(), robloxAssetId: z.string().optional(), reference: z.boolean().optional(), tags: z.array(z.string()).optional(),
  },
  run: async (a, ctx) => {
    let data: Uint8Array;
    let name = a.name;
    let mime: string | undefined;
    if (a.path) {
      data = await readFile(a.path).catch(() => {
        throw new ToolError(`cannot read file "${a.path}"`);
      });
      name ??= path.basename(a.path);
    } else if (a.url) {
      if (!/^https?:\/\//.test(a.url)) throw new ToolError("url must be http(s)");
      const res = await fetch(a.url).catch((e) => {
        throw new ToolError(`download failed: ${(e as Error).message}`);
      });
      if (!res.ok) throw new ToolError(`download failed: HTTP ${res.status}`);
      data = new Uint8Array(await res.arrayBuffer());
      mime = res.headers.get("content-type") ?? undefined;
      name ??= decodeURIComponent(new URL(a.url).pathname.split("/").pop() || "image");
    } else if (a.base64) {
      data = Uint8Array.from(Buffer.from(a.base64.replace(/^data:[^,]+,/, ""), "base64"));
      name ??= "image";
    } else throw new ToolError("provide path, url or base64");
    try {
      const rec = await ctx.store.addAsset(data, { name: name!, mime, folder: a.folder, robloxAssetId: a.robloxAssetId, reference: a.reference, tags: a.tags });
      return { ok: true, asset: rec, imageValue: `asset://${rec.id}` };
    } catch (e) {
      if (e instanceof StoreError) throw new ToolError(e.message);
      throw e;
    }
  },
});

tool({
  name: "list_assets",
  title: "List / search assets",
  description: "List library assets, optionally filtered by folder, search text (name/tags) or kind.",
  input: { folder: z.string().optional(), search: z.string().optional(), kind: z.enum(["all", "references", "uploaded", "local"]).optional() },
  readOnly: true,
  run: async (a, ctx) => {
    let list = await ctx.store.listAssets();
    if (a.folder !== undefined) list = list.filter((x) => x.folder === a.folder || x.folder.startsWith(a.folder + "/"));
    if (a.search) {
      const q = a.search.toLowerCase();
      list = list.filter((x) => x.name.toLowerCase().includes(q) || x.tags.some((t) => t.toLowerCase().includes(q)) || x.folder.toLowerCase().includes(q));
    }
    if (a.kind === "references") list = list.filter((x) => x.reference);
    if (a.kind === "uploaded") list = list.filter((x) => x.robloxAssetId);
    if (a.kind === "local") list = list.filter((x) => !x.robloxAssetId && !x.reference);
    return { ok: true, count: list.length, assets: list };
  },
});

tool({
  name: "update_asset",
  title: "Update asset",
  description: "Rename an asset, move it to a folder, set its Roblox asset id (after uploading it to Roblox), mark as reference, set tags.",
  input: { assetId: z.string(), name: z.string().optional(), folder: z.string().optional(), robloxAssetId: z.string().optional().describe('Digits or "rbxassetid://…"; empty string clears'), reference: z.boolean().optional(), tags: z.array(z.string()).optional() },
  run: async (a, ctx) => {
    try {
      const { assetId, ...patch } = a;
      return { ok: true, asset: await ctx.store.updateAsset(assetId, patch) };
    } catch (e) {
      if (e instanceof StoreError) throw new ToolError(e.message);
      throw e;
    }
  },
});

tool({
  name: "view_asset",
  title: "View asset image",
  description: "Return an asset's image so you can see it (use for reference images before recreating their style with editable elements).",
  input: { assetId: z.string() },
  readOnly: true,
  run: async (a, ctx) => {
    const { rec, data } = await ctx.store.assetFile(a.assetId).catch(() => {
      throw new ToolError(`asset "${a.assetId}" not found`);
    });
    if (rec.mime === "image/svg+xml") return { ok: true, asset: rec, svg: data.toString("utf8").slice(0, 20000) };
    return { ok: true, asset: rec, _images: [{ data: data.toString("base64"), mimeType: rec.mime }] };
  },
});

// ================================================================ animations

const keyframeSchema = z.object({
  time: z.number().min(0),
  value: z.any(),
  easingStyle: z.enum(EASING_STYLES as [string, ...string[]]).optional(),
  easingDirection: z.enum(["In", "Out", "InOut"]).optional(),
});
const trackSchema = z.object({ nodeId: nodeRef, property: z.string(), keyframes: z.array(keyframeSchema).min(1) });

function buildTracks(d: DesignDocument, input: z.infer<typeof trackSchema>[]): AnimationTrack[] {
  return input.map((t, i) => {
    const r = resolveRef(d, t.nodeId);
    if (!isTweenable(r.className, t.property)) throw new ToolError(`tracks[${i}]: ${r.className}.${t.property} is not tweenable`, "tweenable: Position, Size, Rotation, AnchorPoint, colours, transparencies, TextSize, UIScale.Scale, UICorner.CornerRadius, UIStroke props, UIGradient.Offset/Rotation");
    const keyframes: Keyframe[] = t.keyframes.map((k, j) => {
      const c = coerceProp(r.className, t.property, k.value);
      if (!c.ok) throw new ToolError(`tracks[${i}].keyframes[${j}]: ${c.error}`);
      return { time: k.time, value: c.value, easingStyle: (k.easingStyle ?? "Quad") as Keyframe["easingStyle"], easingDirection: (k.easingDirection ?? "Out") as Keyframe["easingDirection"] };
    });
    keyframes.sort((x, y) => x.time - y.time);
    return { id: newId("tr"), nodeId: r.id, property: t.property, keyframes };
  });
}

const animInput = {
  name: z.string().optional(),
  trigger: z.enum(["manual", "onShow", "onHide", "onHover", "onClick", "loop"]).optional(),
  triggerNodeId: nodeRef.optional().describe("Element whose hover/click triggers the animation"),
  repeat: z.number().int().min(-1).optional().describe("0 = once (default), -1 = forever, n = n extra times"),
  reverses: z.boolean().optional(),
};

tool({
  name: "create_animation",
  title: "Create animation",
  description:
    "Create a TweenService-compatible animation: tracks of keyframes on node properties. Time is in seconds; each keyframe's easing applies to the segment arriving at it. " +
    "Example: pop-in = UIScale.Scale 0→1 with Back/Out, Position slide, BackgroundTransparency fade.",
  input: { documentId: docId, ...animInput, name: z.string(), tracks: z.array(trackSchema).min(1) },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const id = newId("an");
    const anim: Animation = {
      id, name: a.name, trigger: a.trigger ?? "manual", repeat: a.repeat ?? 0, reverses: a.reverses ?? false, tracks: buildTracks(d, a.tracks),
      ...(a.triggerNodeId ? { triggerNodeId: resolveRef(d, a.triggerNodeId).id } : {}),
    };
    const doc = await commit(ctx, a.documentId, [{ type: "setAnimation", id, anim }], `Create animation ${a.name}`);
    return { ok: true, revision: doc.revision, animationId: id, duration: animationDuration(anim) };
  },
});

tool({
  name: "update_animation",
  title: "Update animation",
  description: "Change an animation's settings; `tracks` (if given) replaces all tracks.",
  input: { documentId: docId, animationId: z.string(), ...animInput, tracks: z.array(trackSchema).optional() },
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const cur = d.animations[a.animationId] ?? Object.values(d.animations).find((x) => x.name === a.animationId);
    if (!cur) throw new ToolError(`animation "${a.animationId}" not found`);
    const anim: Animation = {
      ...cur,
      ...(a.name ? { name: a.name } : {}),
      ...(a.trigger ? { trigger: a.trigger } : {}),
      ...(a.repeat !== undefined ? { repeat: a.repeat } : {}),
      ...(a.reverses !== undefined ? { reverses: a.reverses } : {}),
      ...(a.triggerNodeId ? { triggerNodeId: resolveRef(d, a.triggerNodeId).id } : {}),
      ...(a.tracks ? { tracks: buildTracks(d, a.tracks) } : {}),
    };
    const doc = await commit(ctx, a.documentId, [{ type: "setAnimation", id: cur.id, anim }], `Update animation ${anim.name}`);
    return { ok: true, revision: doc.revision, duration: animationDuration(anim) };
  },
});

tool({
  name: "delete_animation",
  title: "Delete animation",
  description: "Delete an animation (undoable).",
  input: { documentId: docId, animationId: z.string() },
  run: async (a, ctx) => {
    const doc = await commit(ctx, a.documentId, [{ type: "setAnimation", id: a.animationId, anim: null }], "Delete animation");
    return { ok: true, revision: doc.revision };
  },
});

tool({
  name: "preview_animation",
  title: "Preview animation",
  description:
    "Sample an animation's property values at given times (default: 5 evenly spaced samples) and play it in any open editor. If rendering is available, returns PNG frames when `render` is true.",
  input: { documentId: docId, animationId: z.string(), times: z.array(z.number()).optional(), render: z.boolean().optional() },
  readOnly: true,
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const anim = d.animations[a.animationId] ?? Object.values(d.animations).find((x) => x.name === a.animationId);
    if (!anim) throw new ToolError(`animation "${a.animationId}" not found`);
    const dur = animationDuration(anim) * (anim.reverses ? 2 : 1);
    const times = a.times ?? [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * dur * 1000) / 1000);
    const samples = times.map((t) => ({ time: t, values: Object.fromEntries(sampleAnimation(anim, t)) }));
    await ctx.notify?.({ type: "playAnimation", documentId: d.id, animationId: anim.id });
    const out: ToolResult = { ok: true, duration: dur, samples };
    if (a.render) {
      if (!ctx.render) throw new ToolError("rendering is not available", "start Roblox UI Studio (npm start) so frames can be rendered");
      const rootId = d.pages.flatMap((p) => p.children).find((id) => {
        const t = resolveTree(d, id);
        return t && anim.tracks.every((tr) => findResolved(t, tr.nodeId));
      });
      if (!rootId) throw new ToolError("animation tracks span multiple screens");
      out._images = [];
      for (const t of times) {
        const png = await ctx.render({ documentId: d.id, rootId, animationId: anim.id, time: t });
        out._images.push({ data: png.toString("base64"), mimeType: "image/png" });
      }
    }
    return out;
  },
});

// ================================================================ export / validate / render

tool({
  name: "validate_design",
  title: "Validate design",
  description: "Check structural correctness, export readiness (assets, animations) and design quality (contrast, tap targets, responsiveness, text size).",
  input: { documentId: docId, minSeverity: z.enum(["error", "warning", "info"]).optional() },
  readOnly: true,
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const order = { error: 0, warning: 1, info: 2 };
    const issues = validateDocument(d, await ctx.store.listAssets()).filter((i) => order[i.severity] <= order[a.minSeverity ?? "info"]);
    return { ok: true, errors: issues.filter((i) => i.severity === "error").length, warnings: issues.filter((i) => i.severity === "warning").length, issues };
  },
});

tool({
  name: "export_luau",
  title: "Export Luau",
  description:
    "Generate Roblox Luau. format 'modules' (default): Util/Theme/Components/Screens/Animations ModuleScripts. format 'single': one LocalScript for one root. " +
    "Optionally writes files (and .rbxmx models for Studio's Insert from File) to an output directory.",
  input: {
    documentId: docId,
    rootIds: z.array(nodeRef).optional().describe("Screens/top-level frames to export (default: all)"),
    format: z.enum(["modules", "single"]).optional(),
    outputDir: z.string().optional().describe("If set, write the files + .gui.rbxmx + .code.rbxmx there"),
    includeSource: z.boolean().optional().describe("Return file contents (default true)"),
  },
  readOnly: true,
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const assets = await ctx.store.listAssets();
    const rootIds = a.rootIds?.map((r) => {
      const ref = resolveRef(d, r);
      if (!ref.storedId || d.nodes[ref.storedId].parent) throw new ToolError(`"${r}" is not a top-level node`);
      return ref.storedId;
    });
    if (a.format === "single") {
      const id = rootIds?.[0] ?? d.pages.flatMap((p) => p.children).find((x) => d.nodes[x].className === "ScreenGui");
      if (!id) throw new ToolError("no screen to export");
      const ctxE = makeContext(d, assets);
      const source = exportSingleScript(ctxE, id);
      if (a.outputDir) await writeOut(a.outputDir, [{ path: `${d.nodes[id].name}.client.luau`, content: source }]);
      return { ok: true, source, diagnostics: ctxE.diagnostics };
    }
    const b = exportDocument(d, assets, { rootIds });
    let written: string[] | undefined;
    if (a.outputDir) {
      written = await writeOut(a.outputDir, [
        ...b.files.map((f) => ({ path: `${b.packageName}/${f.path}`, content: f.content })),
        { path: `${b.packageName}.gui.rbxmx`, content: b.guiModel },
        { path: `${b.packageName}.code.rbxmx`, content: b.codeModel },
      ]);
    }
    return {
      ok: true, packageName: b.packageName, diagnostics: b.diagnostics, usage: b.usage,
      files: a.includeSource === false ? b.files.map((f) => f.path) : b.files.map((f) => ({ path: f.path, content: f.content })),
      ...(written ? { written } : {}),
    };
  },
});

async function writeOut(dir: string, files: { path: string; content: string }[]) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const out: string[] = [];
  for (const f of files) {
    const p = path.resolve(dir, f.path);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, f.content);
    out.push(p);
  }
  return out;
}

tool({
  name: "export_component",
  title: "Export component",
  description: "Generate the Luau ModuleScript for one component (plus the components it depends on).",
  input: { documentId: docId, component: z.string() },
  readOnly: true,
  run: async (a, ctx) => {
    const d = await load(ctx, a.documentId);
    const cid = findComponentId(d, a.component);
    if (!cid) throw new ToolError(`component "${a.component}" not found`);
    const b = exportDocument(d, await ctx.store.listAssets(), { rootIds: [], componentIds: [cid] });
    const files = b.files.filter((f) => f.path.startsWith("Components/"));
    return { ok: true, module: b.componentModules[cid], files, util: b.files.find((f) => f.path === "Util.luau")!.content, diagnostics: b.diagnostics };
  },
});

tool({
  name: "render_preview",
  title: "Render preview image",
  description: "Render a screen (or top-level frame) to PNG exactly as the editor preview shows it, optionally at a device preset. Requires the Roblox UI Studio server to be running.",
  input: { documentId: docId, rootId: nodeRef.optional(), device: z.string().optional(), width: z.number().optional(), height: z.number().optional() },
  readOnly: true,
  run: async (a, ctx) => {
    if (!ctx.render) throw new ToolError("rendering is not available", "start Roblox UI Studio with `npm start` (rendering uses the editor's preview page)");
    const d = await load(ctx, a.documentId);
    const rootId = a.rootId ? resolveRef(d, a.rootId).storedId : d.pages.flatMap((p) => p.children).find((x) => d.nodes[x].className === "ScreenGui");
    if (!rootId || d.nodes[rootId].parent) throw new ToolError("rootId must be a top-level node");
    const png = await ctx.render({ documentId: d.id, rootId, device: a.device, width: a.width, height: a.height });
    return { ok: true, rootId, _images: [{ data: png.toString("base64"), mimeType: "image/png" }] };
  },
});

// ================================================================ history

tool({
  name: "undo",
  title: "Undo",
  description: "Undo the most recent change made through this interface (source 'mcp'/'api'), or any change with source: 'any'.",
  input: { documentId: docId, count: z.number().int().min(1).max(50).optional(), source: z.enum(["self", "any"]).optional() },
  run: async (a, ctx) => {
    const undone: string[] = [];
    for (let i = 0; i < (a.count ?? 1); i++) {
      try {
        const r = await ctx.store.undo(a.documentId, a.source === "any" ? undefined : ctx.source);
        undone.push(r.entry.label);
      } catch (e) {
        if (e instanceof StoreError) {
          if (!undone.length) throw new ToolError(e.message);
          break;
        }
        throw e;
      }
    }
    return { ok: true, undone };
  },
});

tool({
  name: "redo",
  title: "Redo",
  description: "Redo the most recently undone change.",
  input: { documentId: docId, source: z.enum(["self", "any"]).optional() },
  run: async (a, ctx) => {
    try {
      const r = await ctx.store.redo(a.documentId, a.source === "any" ? undefined : ctx.source);
      return { ok: true, redone: r.entry.label };
    } catch (e) {
      if (e instanceof StoreError) throw new ToolError(e.message);
      throw e;
    }
  },
});

tool({
  name: "get_history",
  title: "Change history",
  description: "List recent changes (newest first) with their source (editor/mcp/api) and label.",
  input: { documentId: docId, limit: z.number().int().optional() },
  readOnly: true,
  run: async (a, ctx) => {
    const h = await ctx.store.getHistory(a.documentId);
    return { ok: true, undo: h.undo.slice(-(a.limit ?? 20)).reverse().map(({ id, at, source, label, revision }) => ({ id, at, source, label, revision })), redoCount: h.redo.length };
  },
});

tool({
  name: "get_design_guide",
  title: "Design & workflow guide",
  description: "Read this first: how to work with Roblox UI Studio efficiently and the design-quality rules to follow.",
  input: {},
  readOnly: true,
  run: async () => ({ ok: true, guide: DESIGN_GUIDE }),
});

// ================================================================ registry API

export const TOOLS: ToolDef[] = tools;

export function getTool(name: string): ToolDef | undefined {
  return tools.find((t) => t.name === name);
}

/** Run a tool with input validation and uniform error reporting. */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
  const t = getTool(name);
  if (!t) return { ok: false, error: `unknown tool "${name}"`, hint: `tools: ${tools.map((x) => x.name).join(", ")}` };
  const parsed = z.object(t.input).safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: `invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}` };
  }
  try {
    return await t.run(parsed.data as never, ctx);
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, error: e.message, ...(e.hint ? { hint: e.hint } : {}) };
    if (e instanceof StoreError) return { ok: false, error: e.message };
    if (e instanceof OpError) return { ok: false, error: e.message };
    return { ok: false, error: `internal error: ${(e as Error).message}` };
  }
}
