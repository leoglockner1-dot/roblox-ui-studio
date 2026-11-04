/**
 * Luau code generation.
 *
 * Produces a small, readable module structure (Rojo-compatible file layout):
 *
 *   Util.luau                 make/find/apply helpers + TweenService track player
 *   Theme.luau                design tokens as a Luau table
 *   Components/<Name>.luau    one ModuleScript per component: `create()`
 *   Screens/<Name>.luau       one ModuleScript per ScreenGui/top-level frame: `create()`
 *   Animations/<Name>.luau    TweenService animations for that screen + `bind(gui)`
 *
 * The hierarchy is written declaratively with `make(class, props, children)`
 * so the code reads like the layer tree. Component instances become
 * `Util.instance(Component, propDiffs, overrideDiffs)`.
 */
import { fontAssetUrl } from "../fonts";
import { getPropDef, HUGE } from "../classes";
import { hexToRgb } from "../schema";
import { findResolved, resolveTree, type ResolvedNode } from "../document";
import type { Animation, ColorStop, DesignDocument, FontFace, NumberStop, Rect2D, UDim, UDim2, Vector2 } from "../types";
import { buildIR, fromResolved, moduleName, type IRContext, type IRInstance, type IRProp } from "./ir";

const INDENT = "\t";

export function fmtNum(n: number): string {
  if (n >= HUGE) return "math.huge";
  if (n <= -HUGE) return "-math.huge";
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? "0" : String(r);
}

const int = (n: number) => String(Math.round(n));

export function luauString(s: string): string {
  return (
    '"' +
    s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t") +
    '"'
  );
}

export function luauColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `Color3.fromRGB(${r}, ${g}, ${b})`;
}

export function luauUDim2(u: UDim2): string {
  const xo = Math.round(u.xo);
  const yo = Math.round(u.yo);
  if (u.xs === 0 && u.ys === 0) return `UDim2.fromOffset(${xo}, ${yo})`;
  if (xo === 0 && yo === 0) return `UDim2.fromScale(${fmtNum(u.xs)}, ${fmtNum(u.ys)})`;
  return `UDim2.new(${fmtNum(u.xs)}, ${xo}, ${fmtNum(u.ys)}, ${yo})`;
}

export function luauFont(f: FontFace): string {
  return `Font.new(${luauString(fontAssetUrl(f.family))}, Enum.FontWeight.${f.weight}, Enum.FontStyle.${f.style})`;
}

/** Luau expression for a property value. */
export function luauValue(p: Pick<IRProp, "def" | "value">): string {
  const v = p.value;
  switch (p.def.type) {
    case "number":
      return fmtNum(v as number);
    case "int":
      return int(v as number);
    case "bool":
      return v ? "true" : "false";
    case "string":
    case "content":
      return luauString(v as string);
    case "color":
      return luauColor(v as string);
    case "udim": {
      const u = v as UDim;
      return `UDim.new(${fmtNum(u.s)}, ${Math.round(u.o)})`;
    }
    case "udim2":
      return luauUDim2(v as UDim2);
    case "vector2": {
      const u = v as Vector2;
      return `Vector2.new(${fmtNum(u.x)}, ${fmtNum(u.y)})`;
    }
    case "font":
      return luauFont(v as FontFace);
    case "enum":
      return `Enum.${p.def.enumName}.${v}`;
    case "rect": {
      const r = v as Rect2D;
      return `Rect.new(${fmtNum(r.minX)}, ${fmtNum(r.minY)}, ${fmtNum(r.maxX)}, ${fmtNum(r.maxY)})`;
    }
    case "colorSeq": {
      const stops = v as ColorStop[];
      if (stops.length === 2 && stops[0].color === stops[1].color) return `ColorSequence.new(${luauColor(stops[0].color)})`;
      return `ColorSequence.new({ ${stops.map((s) => `ColorSequenceKeypoint.new(${fmtNum(s.t)}, ${luauColor(s.color)})`).join(", ")} })`;
    }
    case "numberSeq": {
      const stops = v as NumberStop[];
      if (stops.length === 2 && stops[0].value === stops[1].value) return `NumberSequence.new(${fmtNum(stops[0].value)})`;
      return `NumberSequence.new({ ${stops.map((s) => `NumberSequenceKeypoint.new(${fmtNum(s.t)}, ${fmtNum(s.value)})`).join(", ")} })`;
    }
  }
}

// ------------------------------------------------------------------ Util module

export const UTIL_SOURCE = `--!strict
-- Util: tiny helpers used by generated Roblox UI Studio modules.
-- Safe to edit; regenerate to restore.
local TweenService = game:GetService("TweenService")

local Util = {}

export type Props = { [string]: any }

--- Create an instance, assign properties, then parent the children to it.
function Util.make(className: string, props: Props, children: { Instance }?): any
	local instance = Instance.new(className)
	for key, value in props do
		(instance :: any)[key] = value
	end
	if children then
		for _, child in children do
			child.Parent = instance
		end
	end
	return instance
end

--- Find a descendant by a "/"-separated path of names.
function Util.find(root: Instance, path: string): any
	local current = root
	for name in string.gmatch(path, "[^/]+") do
		local nextChild = current:FindFirstChild(name)
		assert(nextChild, \`UI: "{name}" not found under {current:GetFullName()}\`)
		current = nextChild
	end
	return current
end

--- Assign properties to an instance and to descendants addressed by path.
function Util.apply(instance: Instance, props: Props?, overrides: { [string]: Props }?): any
	if props then
		for key, value in props do
			(instance :: any)[key] = value
		end
	end
	if overrides then
		for path, overrideProps in overrides do
			local target = Util.find(instance, path)
			for key, value in overrideProps do
				target[key] = value
			end
		end
	end
	return instance
end

--- Create an instance of a component module and apply property/descendant overrides.
function Util.instance(component: { create: () -> Instance }, props: Props?, overrides: { [string]: Props }?): any
	return Util.apply(component.create(), props, overrides)
end

export type Keyframe = { time: number, value: any, style: Enum.EasingStyle, direction: Enum.EasingDirection }
export type Track = { target: Instance, property: string, keyframes: { Keyframe } }
export type PlayOptions = { repeatCount: number, reverses: boolean }

local FLIP = {
	[Enum.EasingDirection.In] = Enum.EasingDirection.Out,
	[Enum.EasingDirection.Out] = Enum.EasingDirection.In,
	[Enum.EasingDirection.InOut] = Enum.EasingDirection.InOut,
}

--- Play keyframe tracks with TweenService. repeatCount: 0 = once, -1 = forever.
--- Returns a function that stops the animation.
function Util.playTracks(tracks: { Track }, options: PlayOptions): () -> ()
	local running = true
	local active: { [Tween]: boolean } = {}
	local duration = 0
	for _, track in tracks do
		local last = track.keyframes[#track.keyframes]
		if last and last.time > duration then
			duration = last.time
		end
	end

	local function tween(target: Instance, property: string, goal: any, info: TweenInfo)
		if not running then
			return
		end
		local t = TweenService:Create(target, info, { [property] = goal })
		active[t] = true
		t.Completed:Once(function()
			active[t] = nil
		end)
		t:Play()
	end

	local function playLeg(forward: boolean)
		for _, track in tracks do
			local keyframes = track.keyframes
			if #keyframes == 0 then
				continue
			end
			local target = track.target :: any
			target[track.property] = if forward then keyframes[1].value else keyframes[#keyframes].value
			for i = 2, #keyframes do
				local from, to = keyframes[i - 1], keyframes[i]
				local length = to.time - from.time
				local startTime = if forward then from.time else duration - to.time
				local goal = if forward then to.value else from.value
				local direction = if forward then to.direction else FLIP[to.direction]
				local info = TweenInfo.new(length, to.style, direction)
				if startTime <= 0 then
					tween(target, track.property, goal, info)
				else
					task.delay(startTime, tween, target, track.property, goal, info)
				end
			end
		end
	end

	task.spawn(function()
		local plays = 0
		while running do
			playLeg(true)
			task.wait(duration)
			if options.reverses and running then
				playLeg(false)
				task.wait(duration)
			end
			plays += 1
			if options.repeatCount >= 0 and plays > options.repeatCount then
				break
			end
		end
	end)

	return function()
		running = false
		for t in active do
			t:Cancel()
		end
	end
end

return Util
`;

// ------------------------------------------------------------------ tree emission

interface EmitEnv {
  ctx: IRContext;
  /** componentId -> Luau expression for its module (e.g. `ItemCard` or `Components.ItemCard`). */
  componentRef: (componentId: string) => string;
  /** Component masters' IR (cached). */
  masterIR: (componentId: string) => IRInstance | null;
  /** The component currently being emitted (its root is emitted with make, not as an instance). */
  selfComponent?: string;
}

function propsTable(props: { name: string; expr: string }[], depth: number): string {
  if (!props.length) return "{}";
  const pad = INDENT.repeat(depth + 1);
  return `{\n${props.map((p) => `${pad}${/^[A-Za-z_]\w*$/.test(p.name) ? p.name : `[${luauString(p.name)}]`} = ${p.expr},`).join("\n")}\n${INDENT.repeat(depth)}}`;
}

function ownProps(ir: IRInstance): { name: string; expr: string }[] {
  return [{ name: "Name", expr: luauString(ir.name) }, ...ir.props.map((p) => ({ name: p.name, expr: luauValue(p) }))];
}

/** Diff two IR trees of the same shape: returns root prop diffs and per-path diffs. */
function diffIR(
  ctx: IRContext,
  master: IRInstance,
  inst: IRInstance,
): { root: { name: string; expr: string }[]; paths: { path: string; props: { name: string; expr: string }[] }[] } {
  const propDiff = (a: IRInstance, b: IRInstance) => {
    const out: { name: string; expr: string }[] = [];
    const am = new Map(a.props.map((p) => [p.name, p]));
    const bm = new Map(b.props.map((p) => [p.name, p]));
    for (const p of b.props) {
      const q = am.get(p.name);
      if (!q || JSON.stringify(q.value) !== JSON.stringify(p.value)) out.push({ name: p.name, expr: luauValue(p) });
    }
    for (const q of a.props) {
      if (!bm.has(q.name)) out.push({ name: q.name, expr: luauValue({ def: q.def, value: q.def.default }) });
    }
    return out;
  };
  const root = propDiff(master, inst);
  if (master.name !== inst.name) root.unshift({ name: "Name", expr: luauString(inst.name) });
  const paths: { path: string; props: { name: string; expr: string }[] }[] = [];
  const walk = (a: IRInstance, b: IRInstance, prefix: string) => {
    const names = new Map<string, number>();
    for (const c of a.children) names.set(c.name, (names.get(c.name) ?? 0) + 1);
    a.children.forEach((ac, i) => {
      const bc = b.children[i];
      if (!bc) return;
      const path = prefix ? `${prefix}/${ac.name}` : ac.name;
      const d = propDiff(ac, bc);
      if (d.length) {
        if ((names.get(ac.name) ?? 0) > 1)
          ctx.diagnostics.push({
            severity: "warning",
            nodeId: bc.id,
            message: `override on "${path}" is ambiguous: several siblings are named "${ac.name}" in the component; give them unique names`,
          });
        paths.push({ path, props: d });
      }
      walk(ac, bc, path);
    });
  };
  walk(master, inst, "");
  return { root, paths };
}

function emitNode(env: EmitEnv, ir: IRInstance, depth: number): string {
  const pad = INDENT.repeat(depth);
  const comp = ir.componentId ?? (ir.masterOf && ir.masterOf !== env.selfComponent ? ir.masterOf : undefined);
  if (comp) {
    const master = env.masterIR(comp);
    if (master) {
      const { root, paths } = diffIR(env.ctx, master, ir);
      const args = [env.componentRef(comp)];
      if (root.length || paths.length) args.push(propsTable(root, depth));
      if (paths.length) {
        const p2 = INDENT.repeat(depth + 1);
        args.push(`{\n${paths.map((p) => `${p2}[${luauString(p.path)}] = ${propsTable(p.props, depth + 1)},`).join("\n")}\n${pad}}`);
      }
      return `Util.instance(${args.join(", ")})`;
    }
  }
  const props = propsTable(ownProps(ir), depth);
  if (!ir.children.length) return `make(${luauString(ir.className)}, ${props})`;
  const kids = ir.children.map((c) => `${INDENT.repeat(depth + 1)}${emitNode(env, c, depth + 1)},`).join("\n");
  return `make(${luauString(ir.className)}, ${props}, {\n${kids}\n${pad}})`;
}

/** Which components does this tree reference (directly)? */
function referencedComponents(ir: IRInstance, self?: string, out = new Set<string>()): Set<string> {
  const comp = ir.componentId ?? (ir.masterOf && ir.masterOf !== self ? ir.masterOf : undefined);
  if (comp) {
    out.add(comp);
    return out;
  }
  for (const c of ir.children) referencedComponents(c, self, out);
  return out;
}

// ------------------------------------------------------------------ public API

export interface ExportFile {
  path: string;
  content: string;
  /** For rbxmx packaging: ModuleScript or LocalScript. */
  kind: "module" | "local" | "data";
}

export interface LuauExport {
  files: ExportFile[];
  /** componentId -> module name; screen root id -> module name. */
  componentModules: Record<string, string>;
  screenModules: Record<string, string>;
  /** Root folder name used for the Studio package. */
  packageName: string;
}

function header(doc: DesignDocument, what: string): string {
  return `--!strict\n-- ${what}\n-- Generated by Roblox UI Studio from "${doc.name.replace(/\n/g, " ")}" (revision ${doc.revision}).\n-- Regenerate from the design rather than hand-editing structure.\n`;
}

export function exportLuau(ctx: IRContext, opts: { rootIds?: string[]; componentIds?: string[] } = {}): LuauExport {
  const doc = ctx.doc;
  const takenC = new Set<string>(["Util", "Theme", "Components", "Screens", "Animations"]);
  const componentModules: Record<string, string> = {};
  for (const c of Object.values(doc.components)) componentModules[c.id] = moduleName(c.name, takenC);
  const masterCache = new Map<string, IRInstance | null>();
  const masterIR = (cid: string) => {
    if (!masterCache.has(cid)) {
      const comp = doc.components[cid];
      masterCache.set(cid, comp ? buildIR({ ...ctx, diagnostics: [] }, comp.rootId) : null);
    }
    return masterCache.get(cid)!;
  };

  const files: ExportFile[] = [{ path: "Util.luau", content: UTIL_SOURCE, kind: "module" }];
  files.push({ path: "Theme.luau", content: themeModule(doc), kind: "module" });

  // Which components to export: requested + everything referenced transitively.
  const roots = opts.rootIds ?? doc.pages.flatMap((p) => p.children).filter((id) => {
    const n = doc.nodes[id];
    return n && !n.componentId; // masters on the canvas are exported as components
  });
  const needed = new Set<string>(opts.componentIds ?? []);
  const rootIRs = roots.map((id) => ({ id, ir: buildIR(ctx, id) })).filter((r): r is { id: string; ir: IRInstance } => !!r.ir);
  if (!opts.componentIds) for (const c of Object.keys(doc.components)) needed.add(c);
  for (const r of rootIRs) for (const c of referencedComponents(r.ir)) needed.add(c);
  // transitive closure
  let grew = true;
  while (grew) {
    grew = false;
    for (const cid of [...needed]) {
      const m = masterIR(cid);
      if (!m) continue;
      for (const c of referencedComponents(m, cid)) if (!needed.has(c)) needed.add(c), (grew = true);
    }
  }

  for (const cid of needed) {
    const comp = doc.components[cid];
    const master = masterIR(cid);
    if (!comp || !master) continue;
    const mod = componentModules[cid];
    const deps = [...referencedComponents(master, cid)];
    const env: EmitEnv = { ctx, masterIR, componentRef: (id) => componentModules[id], selfComponent: cid };
    const body = emitNode(env, master, 1);
    const lines = [
      header(doc, `Component: ${comp.name}${comp.description ? ` — ${comp.description}` : ""}`),
      `local Util = require(script.Parent.Parent.Util)`,
      ...deps.map((d) => `local ${componentModules[d]} = require(script.Parent.${componentModules[d]})`),
      `local make = Util.make`,
      ``,
      `local ${mod} = {}`,
      ``,
      `function ${mod}.create(): ${master.className}`,
      `${INDENT}return ${body}`,
      `end`,
      ``,
      `return ${mod}`,
      ``,
    ];
    files.push({ path: `Components/${mod}.luau`, content: lines.join("\n"), kind: "module" });
  }

  const takenS = new Set<string>(Object.values(componentModules).concat(["Util", "Theme"]));
  const screenModules: Record<string, string> = {};
  for (const { id, ir } of rootIRs) {
    const mod = moduleName(ir.name, takenS);
    screenModules[id] = mod;
    const deps = [...referencedComponents(ir)];
    const env: EmitEnv = { ctx, masterIR, componentRef: (cid) => componentModules[cid] };
    const body = emitNode(env, ir, 1);
    const lines = [
      header(doc, `${ir.className === "ScreenGui" ? "Screen" : "Frame"}: ${ir.name}`),
      `local Util = require(script.Parent.Parent.Util)`,
      ...deps.map((d) => `local ${componentModules[d]} = require(script.Parent.Parent.Components.${componentModules[d]})`),
      `local make = Util.make`,
      ``,
      `local ${mod} = {}`,
      ``,
      `--- Build the UI. Parent the result to PlayerGui (ScreenGui) or another GuiObject.`,
      `function ${mod}.create(): ${ir.className}`,
      `${INDENT}return ${body}`,
      `end`,
      ``,
      `return ${mod}`,
      ``,
    ];
    files.push({ path: `Screens/${mod}.luau`, content: lines.join("\n"), kind: "module" });

    const anims = animationsForRoot(doc, id);
    if (anims.length) files.push({ path: `Animations/${mod}.luau`, content: animationModule(ctx, id, mod, anims), kind: "module" });
  }

  return { files, componentModules, screenModules, packageName: moduleName(`UI ${doc.name}`, new Set()) };
}

function themeModule(doc: DesignDocument): string {
  const taken = new Set<string>();
  const col = doc.tokens.colors.map((t) => `${INDENT}${INDENT}${moduleName(t.name, taken)} = ${luauColor(t.value)},`);
  const takenN = new Set<string>();
  const num = doc.tokens.numbers.map((t) => `${INDENT}${INDENT}${moduleName(t.name, takenN)} = ${fmtNum(t.value)},`);
  const takenT = new Set<string>();
  const txt = doc.tokens.textStyles.map(
    (t) => `${INDENT}${INDENT}${moduleName(t.name, takenT)} = { Font = ${luauFont(t.font)}, Size = ${fmtNum(t.size)} },`,
  );
  return [
    header(doc, "Theme: design tokens (colors, spacing/radius numbers, text styles)."),
    "return {",
    `${INDENT}Colors = {`,
    ...col,
    `${INDENT}},`,
    `${INDENT}Numbers = {`,
    ...num,
    `${INDENT}},`,
    `${INDENT}TextStyles = {`,
    ...txt,
    `${INDENT}},`,
    "}",
    "",
  ].join("\n");
}

// ------------------------------------------------------------------ animations

/** Animations whose tracks all target nodes inside `rootId`'s resolved tree. */
export function animationsForRoot(doc: DesignDocument, rootId: string): Animation[] {
  const tree = resolveTree(doc, rootId);
  if (!tree) return [];
  return Object.values(doc.animations).filter((a) => a.tracks.length && a.tracks.every((t) => !!findResolved(tree, t.nodeId)));
}

/** Name path from root (exclusive) to node, e.g. "MainFrame/Header/Title". */
export function namePath(root: ResolvedNode, id: string): string | null {
  const walk = (n: ResolvedNode, prefix: string[]): string[] | null => {
    if (n.id === id) return prefix;
    for (const c of n.children) {
      const r = walk(c, [...prefix, c.name]);
      if (r) return r;
    }
    return null;
  };
  const r = walk(root, []);
  return r ? r.join("/") : null;
}

function animationModule(ctx: IRContext, rootId: string, screenMod: string, anims: Animation[]): string {
  const doc = ctx.doc;
  const tree = resolveTree(doc, rootId)!;
  const taken = new Set<string>(["bind", "stopAll"]);
  const fnNames = new Map(anims.map((a) => [a.id, moduleName(a.name, taken)]));
  const out: string[] = [
    header(doc, `Animations for screen ${screenMod} (TweenService).`),
    `local Util = require(script.Parent.Parent.Util)`,
    ``,
    `local Animations = {}`,
    ``,
  ];
  for (const a of anims) {
    const fn = fnNames.get(a.id)!;
    out.push(`--- "${a.name}" · trigger: ${a.trigger} · repeat: ${a.repeat < 0 ? "forever" : a.repeat}${a.reverses ? " · reverses" : ""}`);
    out.push(`--- Returns a function that stops the animation.`);
    out.push(`function Animations.${fn}(gui: Instance): () -> ()`);
    out.push(`${INDENT}return Util.playTracks({`);
    for (const tr of a.tracks) {
      const node = findResolved(tree, tr.nodeId)!;
      const path = namePath(tree, tr.nodeId) ?? "";
      const ir = fromResolved({ ...ctx, diagnostics: [] }, node);
      const def = ir.props.find((p) => p.name === tr.property)?.def ?? findDef(node.className, tr.property);
      out.push(`${INDENT}${INDENT}{`);
      out.push(`${INDENT}${INDENT}${INDENT}target = ${path ? `Util.find(gui, ${luauString(path)})` : "gui"},`);
      out.push(`${INDENT}${INDENT}${INDENT}property = ${luauString(tr.property)},`);
      out.push(`${INDENT}${INDENT}${INDENT}keyframes = {`);
      for (const k of [...tr.keyframes].sort((x, y) => x.time - y.time)) {
        const val = def ? luauValue({ def, value: k.value }) : "nil";
        out.push(
          `${INDENT}${INDENT}${INDENT}${INDENT}{ time = ${fmtNum(k.time)}, value = ${val}, style = Enum.EasingStyle.${k.easingStyle}, direction = Enum.EasingDirection.${k.easingDirection} },`,
        );
      }
      out.push(`${INDENT}${INDENT}${INDENT}},`);
      out.push(`${INDENT}${INDENT}},`);
    }
    out.push(`${INDENT}}, { repeatCount = ${a.repeat}, reverses = ${a.reverses} })`);
    out.push(`end`);
    out.push(``);
  }
  // bind(): wire triggers
  out.push(`--- Wire up automatic triggers (onShow / loop / onHover / onClick).`);
  out.push(`--- onHide animations are only exposed as functions: call them before hiding the UI.`);
  out.push(`function Animations.bind(gui: Instance)`);
  for (const a of anims) {
    const fn = fnNames.get(a.id)!;
    if (a.trigger === "onShow" || a.trigger === "loop") out.push(`${INDENT}Animations.${fn}(gui)`);
    if (a.trigger === "onHover" || a.trigger === "onClick") {
      const trig = a.triggerNodeId ?? a.tracks[0]?.nodeId;
      const path = trig ? namePath(tree, trig) : null;
      const target = path ? `Util.find(gui, ${luauString(path)})` : "gui";
      if (a.trigger === "onHover") out.push(`${INDENT}(${target} :: GuiObject).MouseEnter:Connect(function()\n${INDENT}${INDENT}Animations.${fn}(gui)\n${INDENT}end)`);
      else out.push(`${INDENT}(${target} :: GuiButton).Activated:Connect(function()\n${INDENT}${INDENT}Animations.${fn}(gui)\n${INDENT}end)`);
    }
  }
  out.push(`end`);
  out.push(``);
  out.push(`return Animations`);
  out.push(``);
  return out.join("\n");
}

function findDef(className: string, prop: string) {
  return getPropDef(className, prop);
}

// ------------------------------------------------------------------ single script

/**
 * A single LocalScript that builds one root (and the components it uses) and
 * parents it to PlayerGui. Handy for quick tests: paste into StarterPlayerScripts.
 */
export function exportSingleScript(ctx: IRContext, rootId: string): string {
  const mods = exportLuau(ctx, { rootIds: [rootId], componentIds: [] });
  const strip = (src: string) =>
    src
      .split("\n")
      .filter((l) => !l.startsWith("--!strict") && !/^local \w+ = require\(/.test(l) && l !== "local make = Util.make")
      .join("\n");
  const util = UTIL_SOURCE.replace("--!strict\n", "").replace(/\nreturn Util\n$/, "\n");
  const parts: string[] = [
    "--!strict",
    `-- Single-script export of "${ctx.doc.nodes[rootId]?.name}" from "${ctx.doc.name}". Generated by Roblox UI Studio.`,
    "-- Place in StarterPlayer > StarterPlayerScripts as a LocalScript.",
    "",
    "-- ===== Util =====",
    util,
    "local make = Util.make",
    "",
  ];
  const comps = mods.files.filter((f) => f.path.startsWith("Components/"));
  // Order components so dependencies are defined first.
  const order: ExportFile[] = [];
  const pending = [...comps];
  let guard = 0;
  while (pending.length && guard++ < 1000) {
    const f = pending.shift()!;
    const deps = [...f.content.matchAll(/require\(script\.Parent\.(\w+)\)/g)].map((m) => m[1]).filter((d) => d !== "Parent");
    if (deps.every((d) => order.some((o) => o.path === `Components/${d}.luau`))) order.push(f);
    else pending.push(f);
  }
  for (const f of order) {
    parts.push(`-- ===== Component ${f.path.slice(11, -5)} =====`);
    parts.push(strip(f.content).replace(/\nreturn \w+\n?$/, "\n").replace(/^-- .*\n/gm, ""));
  }
  const screen = mods.files.find((f) => f.path.startsWith("Screens/"));
  const mod = mods.screenModules[rootId];
  if (screen) {
    parts.push(`-- ===== ${mod} =====`);
    parts.push(strip(screen.content).replace(/\nreturn \w+\n?$/, "\n").replace(/^-- .*\n/gm, ""));
  }
  const anim = mods.files.find((f) => f.path.startsWith("Animations/"));
  if (anim) {
    parts.push(`-- ===== Animations =====`);
    parts.push(strip(anim.content).replace(/\nreturn Animations\n?$/, "\n").replace(/^-- (?!-).*\n/gm, ""));
  }
  parts.push(`local Players = game:GetService("Players")`);
  parts.push(`local gui = ${mod}.create()`);
  const isScreen = ctx.doc.nodes[rootId]?.className === "ScreenGui";
  if (isScreen) parts.push(`gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")`);
  else
    parts.push(
      `local holder = Instance.new("ScreenGui")\nholder.Name = ${luauString(mod)}\nholder.ResetOnSpawn = false\nholder.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")\ngui.Parent = holder`,
    );
  if (anim) parts.push(`Animations.bind(gui)`);
  parts.push("");
  return parts.join("\n");
}
