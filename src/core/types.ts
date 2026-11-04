/**
 * Core value types and the design document model.
 *
 * The document format is plain JSON, versioned (see FORMAT_VERSION) and fully
 * independent of the editor. Property names mirror Roblox exactly so that a
 * design can be reasoned about (by people and by Claude) in Roblox terms.
 */

export const FORMAT_ID = "roblox-ui-studio" as const;
export const FORMAT_VERSION = 1 as const;

// ---------------------------------------------------------------- values

/** Roblox UDim: Scale (fraction of parent) + Offset (pixels). */
export interface UDim {
  s: number;
  o: number;
}

/** Roblox UDim2: X and Y UDims. Stored flat for compact, readable JSON. */
export interface UDim2 {
  xs: number;
  xo: number;
  ys: number;
  yo: number;
}

export interface Vector2 {
  x: number;
  y: number;
}

/** A colour as "#RRGGBB" hex. Transparency is always a separate property, as in Roblox. */
export type Color3 = string;

export interface ColorStop {
  t: number; // 0..1
  color: Color3;
}

export interface NumberStop {
  t: number; // 0..1
  value: number;
}

export interface FontFace {
  /** Roblox font family name, e.g. "GothamSSm", "BuilderSans", "FredokaOne". See core/fonts.ts. */
  family: string;
  weight: FontWeight;
  style: "Normal" | "Italic";
}

export type FontWeight =
  | "Thin"
  | "ExtraLight"
  | "Light"
  | "Regular"
  | "Medium"
  | "SemiBold"
  | "Bold"
  | "ExtraBold"
  | "Heavy";

export interface Rect2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Any property value that can live on a node. */
export type PropValue =
  | number
  | string
  | boolean
  | UDim
  | UDim2
  | Vector2
  | FontFace
  | Rect2D
  | ColorStop[]
  | NumberStop[];

export type Props = Record<string, PropValue>;

// ---------------------------------------------------------------- nodes

export type NodeId = string;

/**
 * A node is one Roblox Instance. Modifiers (UICorner, UIStroke, UIListLayout…)
 * are child nodes exactly like in Roblox, so the hierarchy maps 1:1 to export.
 */
export interface DesignNode {
  id: NodeId;
  className: string;
  name: string;
  parent: NodeId | null;
  children: NodeId[];
  /** Roblox properties. Missing properties fall back to class defaults (core/classes.ts). */
  props: Props;
  /**
   * Design-time only: position of a top-level node on the infinite canvas.
   * For a top-level ScreenGui, w/h is the simulated screen (device) size.
   */
  canvas?: { x: number; y: number; w?: number; h?: number; device?: string };
  /** Design-time flags. Not exported. */
  locked?: boolean;
  /** Hidden in editor only (Roblox `Visible` is a separate exported prop). */
  editorHidden?: boolean;
  collapsed?: boolean;
  /** Marks this node as the master of a component. */
  componentId?: string;
  /**
   * When set, this node is an instance of a component. Its own `props` override
   * the master root's props; descendants are derived from the master and must
   * NOT be stored in `children` (only overrides are stored).
   */
  instance?: ComponentInstanceData;
  /** Prop name -> token id. A bound property follows the token's value. */
  tokens?: Record<string, string>;
  /** Free-form notes (for designers and for Claude). Not exported. */
  notes?: string;
}

export interface ComponentInstanceData {
  componentId: string;
  /**
   * Overrides keyed by the descendant's path relative to the master root:
   * "<masterNodeId>" for direct descendants, "<nestedInstanceId>/<nodeId>" for
   * nodes inside nested instances. Use "" to override the root itself is NOT
   * needed: the instance node's own `props` are the root overrides.
   */
  overrides: Record<NodeId, Props>;
}

// ---------------------------------------------------------------- pages / components

export interface Page {
  id: string;
  name: string;
  /** Top-level nodes on this page (usually ScreenGuis or loose frames/components). */
  children: NodeId[];
}

export interface ComponentDef {
  id: string;
  name: string;
  description?: string;
  /** Root node of the master (lives on a page in `nodes`). */
  rootId: NodeId;
  /** Variant set membership: components sharing `setName` are variants of each other. */
  variantOf?: { setName: string; values: Record<string, string> };
  createdAt: string;
}

// ---------------------------------------------------------------- tokens

export interface ColorToken {
  id: string;
  name: string;
  value: Color3;
}
export interface NumberToken {
  id: string;
  name: string;
  value: number;
}
export interface TextStyleToken {
  id: string;
  name: string;
  font: FontFace;
  size: number;
  lineHeight?: number;
}

export interface DesignTokens {
  colors: ColorToken[];
  /** Spacing / radius / stroke tokens, in pixels (offset). */
  numbers: NumberToken[];
  textStyles: TextStyleToken[];
}

// ---------------------------------------------------------------- animations

export type EasingStyle =
  | "Linear"
  | "Sine"
  | "Back"
  | "Quad"
  | "Quart"
  | "Quint"
  | "Bounce"
  | "Elastic"
  | "Exponential"
  | "Circular"
  | "Cubic";
export type EasingDirection = "In" | "Out" | "InOut";

export interface Keyframe {
  /** Seconds from the start of the animation. */
  time: number;
  value: PropValue;
  /** Easing used to arrive at this keyframe from the previous one. */
  easingStyle: EasingStyle;
  easingDirection: EasingDirection;
}

export interface AnimationTrack {
  id: string;
  nodeId: NodeId;
  property: string;
  keyframes: Keyframe[];
}

export type AnimationTrigger = "manual" | "onShow" | "onHide" | "onHover" | "onClick" | "loop";

export interface Animation {
  id: string;
  name: string;
  trigger: AnimationTrigger;
  /** Node whose events trigger the animation (for onHover/onClick); defaults to first track node. */
  triggerNodeId?: NodeId;
  /** 0 = play once; -1 = loop forever; n = repeat n extra times. */
  repeat: number;
  /** Reverse back to the start after each play (TweenInfo.Reverses analogue). */
  reverses: boolean;
  tracks: AnimationTrack[];
}

// ---------------------------------------------------------------- document

export interface DesignDocument {
  format: typeof FORMAT_ID;
  version: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Incremented on every saved change. Used for sync/conflict detection. */
  revision: number;
  pages: Page[];
  nodes: Record<NodeId, DesignNode>;
  components: Record<string, ComponentDef>;
  tokens: DesignTokens;
  animations: Record<string, Animation>;
  /** Free-form metadata (e.g. description, target game, reference notes). */
  meta: Record<string, string>;
}

// ---------------------------------------------------------------- assets (workspace level)

export interface AssetRecord {
  id: string;
  name: string;
  folder: string;
  mime: string;
  fileName: string;
  width?: number;
  height?: number;
  bytes: number;
  /** Roblox asset id (numeric string) once uploaded to Roblox. Required for export. */
  robloxAssetId?: string;
  /** True for reference images (inspiration). These are never exported. */
  reference?: boolean;
  tags: string[];
  createdAt: string;
}

/** Image property values: "asset://<assetId>" (library), "rbxassetid://<n>" or "" (none). */
export const ASSET_SCHEME = "asset://";
