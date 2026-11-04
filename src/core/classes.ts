/**
 * Roblox class registry.
 *
 * Every supported Roblox class is described here once: its kind, its property
 * schema (type, default, enum, group) and parenting rules. The properties
 * panel, layout engine, validator, Luau/rbxmx exporter and the MCP tools all
 * read from this registry, so adding a property here makes it available
 * everywhere.
 *
 * Defaults are Roblox's defaults where known with confidence. Properties whose
 * Roblox default we are not certain of are flagged `alwaysEmit` so the exporter
 * writes them explicitly and the result never depends on an assumed default.
 */
import type { PropValue } from "./types";

export type PropType =
  | "number"
  | "int"
  | "bool"
  | "string"
  | "color"
  | "udim"
  | "udim2"
  | "vector2"
  | "font"
  | "enum"
  | "colorSeq"
  | "numberSeq"
  | "content"
  | "rect";

export type PropGroup =
  | "Transform"
  | "Appearance"
  | "Text"
  | "Image"
  | "Behavior"
  | "Layout"
  | "Scrolling"
  | "Screen"
  | "Modifier";

export interface PropDef {
  name: string;
  type: PropType;
  default: PropValue;
  group: PropGroup;
  enumName?: string;
  min?: number;
  max?: number;
  step?: number;
  alwaysEmit?: boolean;
  /** Can be animated by the animation system / TweenService. */
  tweenable?: boolean;
  description?: string;
}

export type ClassKind = "root" | "gui" | "modifier" | "layout";

export interface ClassDef {
  name: string;
  kind: ClassKind;
  description: string;
  props: PropDef[];
  isText?: boolean;
  isImage?: boolean;
  isButton?: boolean;
  isScrolling?: boolean;
  /** Only one instance of this class is honoured per parent in Roblox. */
  onePerParent?: boolean;
  /** Which parent kinds may contain this class. */
  parentKinds: ClassKind[];
}

// ---------------------------------------------------------------- enums

export const ENUMS: Record<string, Record<string, number>> = {
  TextXAlignment: { Left: 0, Right: 1, Center: 2 },
  TextYAlignment: { Top: 0, Center: 1, Bottom: 2 },
  TextTruncate: { None: 0, AtEnd: 1, SplitWord: 2 },
  AutomaticSize: { None: 0, X: 1, Y: 2, XY: 3 },
  ScaleType: { Stretch: 0, Slice: 1, Tile: 2, Fit: 3, Crop: 4 },
  FillDirection: { Horizontal: 0, Vertical: 1 },
  HorizontalAlignment: { Center: 0, Left: 1, Right: 2 },
  VerticalAlignment: { Center: 0, Top: 1, Bottom: 2 },
  SortOrder: { Name: 0, Custom: 1, LayoutOrder: 2 },
  StartCorner: { TopLeft: 0, TopRight: 1, BottomLeft: 2, BottomRight: 3 },
  ApplyStrokeMode: { Contextual: 0, Border: 1 },
  LineJoinMode: { Round: 0, Bevel: 1, Miter: 2 },
  AspectType: { FitWithinMaxSize: 0, ScaleWithParentSize: 1 },
  DominantAxis: { Width: 0, Height: 1 },
  ScrollingDirection: { X: 1, Y: 2, XY: 4 },
  ZIndexBehavior: { Global: 0, Sibling: 1 },
  ScreenInsets: { None: 0, DeviceSafeInsets: 1, CoreUISafeInsets: 2, TopbarSafeInsets: 3 },
  EasingStyle: {
    Linear: 0, Sine: 1, Back: 2, Quad: 3, Quart: 4, Quint: 5,
    Bounce: 6, Elastic: 7, Exponential: 8, Circular: 9, Cubic: 10,
  },
  EasingDirection: { In: 0, Out: 1, InOut: 2 },
  ResamplerMode: { Default: 0, Pixelated: 1 },
};

export function enumValues(enumName: string): string[] {
  return Object.keys(ENUMS[enumName] ?? {});
}

// ---------------------------------------------------------------- prop helpers

const P = (
  name: string,
  type: PropType,
  def: PropValue,
  group: PropGroup,
  extra: Partial<PropDef> = {},
): PropDef => ({ name, type, default: def, group, ...extra });
const E = (name: string, enumName: string, def: string, group: PropGroup, extra: Partial<PropDef> = {}) =>
  P(name, "enum", def, group, { enumName, ...extra });

const udim2 = (xs: number, xo: number, ys: number, yo: number) => ({ xs, xo, ys, yo });

/** Sentinel for math.huge (JSON has no Infinity). Values >= this export as math.huge. */
export const HUGE = 1e9;

const GUI_OBJECT: PropDef[] = [
  P("AnchorPoint", "vector2", { x: 0, y: 0 }, "Transform", { tweenable: true }),
  P("Position", "udim2", udim2(0, 0, 0, 0), "Transform", { tweenable: true }),
  P("Size", "udim2", udim2(0, 100, 0, 100), "Transform", { tweenable: true }),
  P("Rotation", "number", 0, "Transform", { tweenable: true, step: 1 }),
  E("AutomaticSize", "AutomaticSize", "None", "Transform"),
  P("BackgroundColor3", "color", "#A3A2A5", "Appearance", { tweenable: true }),
  P("BackgroundTransparency", "number", 0, "Appearance", { min: 0, max: 1, step: 0.05, tweenable: true }),
  P("BorderColor3", "color", "#1B2A35", "Appearance"),
  P("BorderSizePixel", "int", 1, "Appearance", { min: 0 }),
  P("ZIndex", "int", 1, "Behavior"),
  P("LayoutOrder", "int", 0, "Behavior"),
  P("Visible", "bool", true, "Behavior"),
  P("ClipsDescendants", "bool", false, "Behavior"),
  P("Active", "bool", false, "Behavior"),
];

const TEXT: PropDef[] = [
  P("Text", "string", "Label", "Text", { alwaysEmit: true }),
  P("FontFace", "font", { family: "BuilderSans", weight: "Regular", style: "Normal" }, "Text", { alwaysEmit: true }),
  P("TextSize", "number", 14, "Text", { min: 1, max: 100, step: 1, alwaysEmit: true, tweenable: true }),
  P("TextColor3", "color", "#000000", "Text", { alwaysEmit: true, tweenable: true }),
  P("TextTransparency", "number", 0, "Text", { min: 0, max: 1, step: 0.05, tweenable: true }),
  P("TextScaled", "bool", false, "Text"),
  P("TextWrapped", "bool", false, "Text"),
  E("TextXAlignment", "TextXAlignment", "Center", "Text"),
  E("TextYAlignment", "TextYAlignment", "Center", "Text"),
  E("TextTruncate", "TextTruncate", "None", "Text"),
  P("TextStrokeColor3", "color", "#000000", "Text", { tweenable: true }),
  P("TextStrokeTransparency", "number", 1, "Text", { min: 0, max: 1, step: 0.05, tweenable: true }),
  P("LineHeight", "number", 1, "Text", { min: 0.5, max: 3, step: 0.05 }),
  P("RichText", "bool", false, "Text"),
];

const IMAGE: PropDef[] = [
  P("Image", "content", "", "Image", { description: "asset://<id> (library) or rbxassetid://<n>" }),
  P("ImageColor3", "color", "#FFFFFF", "Image", { tweenable: true }),
  P("ImageTransparency", "number", 0, "Image", { min: 0, max: 1, step: 0.05, tweenable: true }),
  E("ScaleType", "ScaleType", "Stretch", "Image"),
  P("SliceCenter", "rect", { minX: 0, minY: 0, maxX: 0, maxY: 0 }, "Image"),
  P("SliceScale", "number", 1, "Image", { min: 0.01, step: 0.05 }),
  P("TileSize", "udim2", udim2(1, 0, 1, 0), "Image"),
  P("ImageRectOffset", "vector2", { x: 0, y: 0 }, "Image"),
  P("ImageRectSize", "vector2", { x: 0, y: 0 }, "Image"),
  E("ResamplerMode", "ResamplerMode", "Default", "Image"),
];

const BUTTON: PropDef[] = [P("AutoButtonColor", "bool", true, "Behavior")];

const ALIGN_LAYOUT = (h: string, v: string): PropDef[] => [
  E("HorizontalAlignment", "HorizontalAlignment", h, "Layout", { alwaysEmit: true }),
  E("VerticalAlignment", "VerticalAlignment", v, "Layout", { alwaysEmit: true }),
  E("SortOrder", "SortOrder", "LayoutOrder", "Layout", { alwaysEmit: true }),
];

const GUI_PARENTS: ClassKind[] = ["root", "gui"];

const defs: ClassDef[] = [
  {
    name: "ScreenGui",
    kind: "root",
    description: "Top-level container rendered on the player's screen.",
    parentKinds: [],
    props: [
      P("Enabled", "bool", true, "Screen"),
      P("DisplayOrder", "int", 0, "Screen"),
      P("IgnoreGuiInset", "bool", false, "Screen"),
      P("ResetOnSpawn", "bool", true, "Screen"),
      E("ZIndexBehavior", "ZIndexBehavior", "Sibling", "Screen", { alwaysEmit: true }),
      E("ScreenInsets", "ScreenInsets", "CoreUISafeInsets", "Screen", { alwaysEmit: true }),
    ],
  },
  { name: "Frame", kind: "gui", description: "Basic rectangular container.", parentKinds: GUI_PARENTS, props: [...GUI_OBJECT] },
  {
    name: "CanvasGroup",
    kind: "gui",
    description: "Container whose descendants are composited together (group transparency/tint).",
    parentKinds: GUI_PARENTS,
    props: [
      ...GUI_OBJECT,
      P("GroupTransparency", "number", 0, "Appearance", { min: 0, max: 1, step: 0.05, tweenable: true }),
      P("GroupColor3", "color", "#FFFFFF", "Appearance", { tweenable: true }),
    ],
  },
  {
    name: "TextLabel",
    kind: "gui",
    description: "Displays text.",
    isText: true,
    parentKinds: GUI_PARENTS,
    props: [...GUI_OBJECT.map((p) => (p.name === "BackgroundColor3" ? { ...p, default: "#FFFFFF" } : p)), ...TEXT],
  },
  {
    name: "TextButton",
    kind: "gui",
    description: "Clickable text.",
    isText: true,
    isButton: true,
    parentKinds: GUI_PARENTS,
    props: [
      ...GUI_OBJECT.map((p) => (p.name === "BackgroundColor3" ? { ...p, default: "#FFFFFF" } : p)),
      ...TEXT.map((p) => (p.name === "Text" ? { ...p, default: "Button" } : p)),
      ...BUTTON,
    ],
  },
  {
    name: "TextBox",
    kind: "gui",
    description: "Editable text input.",
    isText: true,
    parentKinds: GUI_PARENTS,
    props: [
      ...GUI_OBJECT.map((p) => (p.name === "BackgroundColor3" ? { ...p, default: "#FFFFFF" } : p)),
      ...TEXT.map((p) => (p.name === "Text" ? { ...p, default: "" } : p)),
      P("PlaceholderText", "string", "", "Text"),
      P("PlaceholderColor3", "color", "#B2B2B2", "Text", { alwaysEmit: true }),
      P("ClearTextOnFocus", "bool", true, "Behavior"),
      P("MultiLine", "bool", false, "Behavior"),
    ],
  },
  {
    name: "ImageLabel",
    kind: "gui",
    description: "Displays an image.",
    isImage: true,
    parentKinds: GUI_PARENTS,
    props: [...GUI_OBJECT.map((p) => (p.name === "BackgroundColor3" ? { ...p, default: "#FFFFFF" } : p)), ...IMAGE],
  },
  {
    name: "ImageButton",
    kind: "gui",
    description: "Clickable image.",
    isImage: true,
    isButton: true,
    parentKinds: GUI_PARENTS,
    props: [
      ...GUI_OBJECT.map((p) => (p.name === "BackgroundColor3" ? { ...p, default: "#FFFFFF" } : p)),
      ...IMAGE,
      P("HoverImage", "content", "", "Image"),
      P("PressedImage", "content", "", "Image"),
      ...BUTTON,
    ],
  },
  {
    name: "ScrollingFrame",
    kind: "gui",
    description: "Frame with scrollable content.",
    isScrolling: true,
    parentKinds: GUI_PARENTS,
    props: [
      ...GUI_OBJECT,
      P("CanvasSize", "udim2", udim2(0, 0, 2, 0), "Scrolling"),
      P("CanvasPosition", "vector2", { x: 0, y: 0 }, "Scrolling"),
      E("AutomaticCanvasSize", "AutomaticSize", "None", "Scrolling"),
      E("ScrollingDirection", "ScrollingDirection", "XY", "Scrolling"),
      P("ScrollBarThickness", "int", 12, "Scrolling", { min: 0 }),
      P("ScrollBarImageColor3", "color", "#000000", "Scrolling", { alwaysEmit: true }),
      P("ScrollBarImageTransparency", "number", 0, "Scrolling", { min: 0, max: 1, step: 0.05 }),
      P("ScrollingEnabled", "bool", true, "Scrolling"),
    ],
  },
  {
    name: "ViewportFrame",
    kind: "gui",
    description: "Renders 3D objects inside the UI. Content is set up in Roblox Studio.",
    parentKinds: GUI_PARENTS,
    props: [
      ...GUI_OBJECT,
      P("Ambient", "color", "#C8C8C8", "Appearance"),
      P("LightColor", "color", "#8C8C8C", "Appearance"),
      P("ImageColor3", "color", "#FFFFFF", "Appearance"),
      P("ImageTransparency", "number", 0, "Appearance", { min: 0, max: 1, step: 0.05 }),
    ],
  },
  // ------------------------------------------------------------ modifiers
  {
    name: "UICorner",
    kind: "modifier",
    description: "Rounds the corners of its parent.",
    onePerParent: true,
    parentKinds: ["gui"],
    props: [P("CornerRadius", "udim", { s: 0, o: 8 }, "Modifier", { tweenable: true })],
  },
  {
    name: "UIStroke",
    kind: "modifier",
    description: "Outline around its parent (or its text, for text objects in Contextual mode).",
    parentKinds: ["gui"],
    props: [
      P("Color", "color", "#000000", "Modifier", { tweenable: true }),
      P("Thickness", "number", 1, "Modifier", { min: 0, step: 0.5, tweenable: true }),
      P("Transparency", "number", 0, "Modifier", { min: 0, max: 1, step: 0.05, tweenable: true }),
      E("ApplyStrokeMode", "ApplyStrokeMode", "Contextual", "Modifier"),
      E("LineJoinMode", "LineJoinMode", "Round", "Modifier"),
      P("Enabled", "bool", true, "Modifier"),
    ],
  },
  {
    name: "UIGradient",
    kind: "modifier",
    description: "Multiplies its parent's colours/transparency by a gradient.",
    onePerParent: true,
    parentKinds: ["gui"],
    props: [
      P("Color", "colorSeq", [{ t: 0, color: "#FFFFFF" }, { t: 1, color: "#FFFFFF" }], "Modifier"),
      P("Transparency", "numberSeq", [{ t: 0, value: 0 }, { t: 1, value: 0 }], "Modifier"),
      P("Rotation", "number", 0, "Modifier", { tweenable: true }),
      P("Offset", "vector2", { x: 0, y: 0 }, "Modifier", { tweenable: true }),
      P("Enabled", "bool", true, "Modifier"),
    ],
  },
  {
    name: "UIPadding",
    kind: "modifier",
    description: "Insets the area children are laid out in.",
    onePerParent: true,
    parentKinds: ["gui"],
    props: [
      P("PaddingTop", "udim", { s: 0, o: 0 }, "Modifier"),
      P("PaddingBottom", "udim", { s: 0, o: 0 }, "Modifier"),
      P("PaddingLeft", "udim", { s: 0, o: 0 }, "Modifier"),
      P("PaddingRight", "udim", { s: 0, o: 0 }, "Modifier"),
    ],
  },
  {
    name: "UIScale",
    kind: "modifier",
    description: "Scales its parent and all descendants.",
    onePerParent: true,
    parentKinds: ["gui"],
    props: [P("Scale", "number", 1, "Modifier", { min: 0, step: 0.05, tweenable: true })],
  },
  {
    name: "UIAspectRatioConstraint",
    kind: "modifier",
    description: "Keeps its parent at a fixed width/height ratio.",
    onePerParent: true,
    parentKinds: ["gui"],
    props: [
      P("AspectRatio", "number", 1, "Modifier", { min: 0.01, step: 0.05 }),
      E("AspectType", "AspectType", "FitWithinMaxSize", "Modifier"),
      E("DominantAxis", "DominantAxis", "Width", "Modifier"),
    ],
  },
  {
    name: "UISizeConstraint",
    kind: "modifier",
    description: "Clamps its parent's absolute size.",
    onePerParent: true,
    parentKinds: ["gui"],
    props: [
      P("MinSize", "vector2", { x: 0, y: 0 }, "Modifier"),
      P("MaxSize", "vector2", { x: HUGE, y: HUGE }, "Modifier"),
    ],
  },
  {
    name: "UITextSizeConstraint",
    kind: "modifier",
    description: "Clamps the text size of a TextScaled parent.",
    onePerParent: true,
    parentKinds: ["gui"],
    props: [
      P("MaxTextSize", "int", 100, "Modifier", { min: 1 }),
      P("MinTextSize", "int", 1, "Modifier", { min: 1 }),
    ],
  },
  // ------------------------------------------------------------ layouts
  {
    name: "UIListLayout",
    kind: "layout",
    description: "Arranges sibling GuiObjects in a row or column.",
    onePerParent: true,
    parentKinds: ["root", "gui"],
    props: [
      E("FillDirection", "FillDirection", "Vertical", "Layout", { alwaysEmit: true }),
      P("Padding", "udim", { s: 0, o: 0 }, "Layout"),
      P("Wraps", "bool", false, "Layout"),
      ...ALIGN_LAYOUT("Left", "Top"),
    ],
  },
  {
    name: "UIGridLayout",
    kind: "layout",
    description: "Arranges sibling GuiObjects in a grid of equal cells.",
    onePerParent: true,
    parentKinds: ["root", "gui"],
    props: [
      P("CellSize", "udim2", udim2(0, 100, 0, 100), "Layout"),
      P("CellPadding", "udim2", udim2(0, 5, 0, 5), "Layout"),
      E("FillDirection", "FillDirection", "Horizontal", "Layout", { alwaysEmit: true }),
      P("FillDirectionMaxCells", "int", 0, "Layout", { min: 0 }),
      E("StartCorner", "StartCorner", "TopLeft", "Layout"),
      ...ALIGN_LAYOUT("Left", "Top"),
    ],
  },
  {
    name: "UIPageLayout",
    kind: "layout",
    description: "Shows sibling GuiObjects as swipeable pages.",
    onePerParent: true,
    parentKinds: ["root", "gui"],
    props: [
      E("FillDirection", "FillDirection", "Horizontal", "Layout", { alwaysEmit: true }),
      P("Padding", "udim", { s: 0, o: 0 }, "Layout"),
      P("Circular", "bool", false, "Layout"),
      P("Animated", "bool", true, "Layout"),
      E("EasingStyle", "EasingStyle", "Back", "Layout", { alwaysEmit: true }),
      E("EasingDirection", "EasingDirection", "Out", "Layout", { alwaysEmit: true }),
      P("TweenTime", "number", 1, "Layout", { min: 0, step: 0.05 }),
      P("_CurrentPage", "int", 0, "Layout", { min: 0, description: "Design-time: page shown in the editor/preview (not exported)." }),
      ...ALIGN_LAYOUT("Center", "Center"),
    ],
  },
];

export const CLASSES: Record<string, ClassDef> = Object.fromEntries(defs.map((d) => [d.name, d]));

export const CLASS_NAMES = defs.map((d) => d.name);
export const GUI_CLASSES = defs.filter((d) => d.kind === "gui").map((d) => d.name);
export const MODIFIER_CLASSES = defs.filter((d) => d.kind === "modifier" || d.kind === "layout").map((d) => d.name);

export function getClass(className: string): ClassDef {
  const c = CLASSES[className];
  if (!c) throw new Error(`Unknown class "${className}"`);
  return c;
}

export function isGuiClass(className: string): boolean {
  return CLASSES[className]?.kind === "gui";
}

const propIndex = new Map<string, Map<string, PropDef>>();
for (const d of defs) propIndex.set(d.name, new Map(d.props.map((p) => [p.name, p])));

export function getPropDef(className: string, prop: string): PropDef | undefined {
  return propIndex.get(className)?.get(prop);
}

/** Can a node of class `child` be parented under a node of class `parent` (null = page/canvas)? */
export function canParent(parentClass: string | null, childClass: string): boolean {
  const child = CLASSES[childClass];
  if (!child) return false;
  if (parentClass === null) return child.kind === "root" || child.kind === "gui";
  const parent = CLASSES[parentClass];
  if (!parent) return false;
  return child.parentKinds.includes(parent.kind);
}

/** Design-time only props start with "_" and are never exported. */
export const isDesignProp = (name: string) => name.startsWith("_");
