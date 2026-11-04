/**
 * Renders a resolved, laid-out Roblox GUI tree to DOM.
 *
 * Positions/sizes come from the core layout engine (never from CSS layout),
 * so what you see is exactly what the layout engine computed. This renderer
 * is shared by the canvas, the preview, thumbnails and headless rendering.
 * Known differences from Roblox are documented in ROBLOX_PREVIEW.md.
 */
import { memo, type CSSProperties, type ReactNode } from "react";
import { CLASSES } from "../../core/classes";
import { cssFont } from "../../core/fonts";
import { propOf, type ResolvedNode } from "../../core/document";
import type { LayoutBox, LayoutMap } from "../../core/layout";
import { hexToRgb } from "../../core/schema";
import { ASSET_SCHEME, type ColorStop, type FontFace, type NumberStop, type Rect2D, type UDim, type UDim2, type Vector2 } from "../../core/types";

export interface RenderOptions {
  assetUrl: (assetId: string) => string;
  /** Source pixel size of a library asset (needed for 9-slice). */
  assetSize?: (assetId: string) => { w: number; h: number } | undefined;
  /** Preview mode: hover/press feedback, scrolling. */
  interactive?: boolean;
  onScroll?: (nodeId: string, dx: number, dy: number) => void;
  onActivate?: (nodeId: string) => void;
  onHover?: (nodeId: string, entering: boolean) => void;
  /** Hide nodes flagged editorHidden (canvas only). */
  respectEditorHidden?: boolean;
}

const rgba = (hex: string, transparency: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, 1 - transparency))})`;
};

function mulColor(a: string, b: string): [number, number, number] {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return [Math.round((x[0] * y[0]) / 255), Math.round((x[1] * y[1]) / 255), Math.round((x[2] * y[2]) / 255)];
}

/** Sample a number sequence at t (linear). */
function sampleNum(seq: NumberStop[], t: number): number {
  for (let i = 1; i < seq.length; i++) {
    if (t <= seq[i].t) {
      const a = seq[i - 1];
      const b = seq[i];
      const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return a.value + (b.value - a.value) * f;
    }
  }
  return seq[seq.length - 1].value;
}

/** CSS linear-gradient emulating UIGradient applied to a base colour/transparency. */
export function gradientCss(g: ResolvedNode, base: string, baseTransparency: number): string {
  const color = propOf<ColorStop[]>(g, "Color");
  const trans = propOf<NumberStop[]>(g, "Transparency");
  const rot = propOf<number>(g, "Rotation");
  const offset = propOf<Vector2>(g, "Offset");
  const ts = new Set<number>([...color.map((c) => c.t), ...trans.map((s) => s.t)]);
  const stops = [...ts].sort((a, b) => a - b).map((t) => {
    // colour at t
    let c = color[color.length - 1].color;
    for (let i = 1; i < color.length; i++) {
      if (t <= color[i].t) {
        const a = hexToRgb(color[i - 1].color);
        const b = hexToRgb(color[i].color);
        const f = color[i].t === color[i - 1].t ? 1 : (t - color[i - 1].t) / (color[i].t - color[i - 1].t);
        c = "#" + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, "0")).join("");
        break;
      }
    }
    const [r, gg, b] = mulColor(c, base);
    const tr = 1 - (1 - baseTransparency) * (1 - sampleNum(trans, t));
    const shift = (rot % 180 === 0 ? offset.x : offset.y) * 100;
    return `rgba(${r}, ${gg}, ${b}, ${(1 - tr).toFixed(3)}) ${(t * 100 + shift).toFixed(2)}%`;
  });
  return `linear-gradient(${90 + rot}deg, ${stops.join(", ")})`;
}

// ------------------------------------------------------------ rich text (safe subset)

const ESC: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&amp;": "&" };
const unescape = (s: string) => s.replace(/&(lt|gt|quot|apos|amp);/g, (m) => ESC[m]);

/** Convert Roblox RichText (b, i, u, s, br, font color/size/weight, stroke ignored) into React nodes. */
export function richText(src: string, key = "r"): ReactNode[] {
  const out: ReactNode[] = [];
  const stack: { tag: string; style: CSSProperties; children: ReactNode[] }[] = [{ tag: "#root", style: {}, children: out }];
  const re = /<(\/?)(\w+)([^>]*)>|([^<]+)|(<)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined || m[5] !== undefined) {
      top.children.push(unescape(m[4] ?? m[5]));
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "br") {
      top.children.push(<br key={`${key}${i++}`} />);
      continue;
    }
    if (closing) {
      if (stack.length > 1 && top.tag === tag) {
        stack.pop();
        stack[stack.length - 1].children.push(
          <span key={`${key}${i++}`} style={top.style}>
            {top.children}
          </span>,
        );
      }
      continue;
    }
    const style: CSSProperties = {};
    if (tag === "b") style.fontWeight = 700;
    else if (tag === "i") style.fontStyle = "italic";
    else if (tag === "u") style.textDecoration = "underline";
    else if (tag === "s") style.textDecoration = "line-through";
    else if (tag === "font") {
      const color = /color\s*=\s*["']([^"']+)["']/i.exec(m[3]);
      const size = /size\s*=\s*["'](\d+)["']/i.exec(m[3]);
      const weight = /weight\s*=\s*["'](\w+)["']/i.exec(m[3]);
      if (color) style.color = /^#[0-9a-f]{3,8}$/i.test(color[1]) || /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i.test(color[1]) ? color[1] : undefined;
      if (size) style.fontSize = `${size[1]}px`;
      if (weight) style.fontWeight = { thin: 100, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 900 }[weight[1].toLowerCase()] ?? undefined;
    } else if (tag === "stroke" || tag === "mark" || tag === "uc" || tag === "smallcaps" || tag === "uppercase" || tag === "sc") {
      if (tag === "uc" || tag === "uppercase") style.textTransform = "uppercase";
      if (tag === "sc" || tag === "smallcaps") style.fontVariant = "small-caps";
    } else {
      top.children.push(m[0]); // unknown tags render literally, as in Roblox
      continue;
    }
    stack.push({ tag, style, children: [] });
  }
  // Unclosed tags: flush
  while (stack.length > 1) {
    const top = stack.pop()!;
    stack[stack.length - 1].children.push(
      <span key={`${key}${i++}`} style={top.style}>
        {top.children}
      </span>,
    );
  }
  return out;
}

// ------------------------------------------------------------ node rendering

interface NodeProps {
  node: ResolvedNode;
  layout: LayoutMap;
  parentBox: { x: number; y: number };
  opts: RenderOptions;
}

function imageUrl(opts: RenderOptions, v: string): string | null {
  if (!v) return null;
  if (v.startsWith(ASSET_SCHEME)) return opts.assetUrl(v.slice(ASSET_SCHEME.length));
  return null;
}

function ImageContent({ node, box, opts, gradient }: { node: ResolvedNode; box: LayoutBox; opts: RenderOptions; gradient?: ResolvedNode }) {
  const src = propOf<string>(node, "Image");
  const url = imageUrl(opts, src);
  const transparency = propOf<number>(node, "ImageTransparency");
  const tint = propOf<string>(node, "ImageColor3");
  if (!src) return null;
  if (!url) {
    // rbxassetid: Roblox images cannot be fetched here — show a labelled placeholder.
    const id = src.replace(/^rbxassetid:\/\//, "");
    return (
      <div className="checker" style={{ position: "absolute", inset: 0, opacity: 1 - transparency, display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.max(8, Math.min(12, box.h / 5)), color: "#fff", textShadow: "0 1px 2px #000", overflow: "hidden" }}>
        {box.w > 50 && box.h > 20 ? `rbxassetid ${id}` : ""}
      </div>
    );
  }
  const scaleType = propOf<string>(node, "ScaleType");
  const rectSize = propOf<Vector2>(node, "ImageRectSize");
  const rectOffset = propOf<Vector2>(node, "ImageRectOffset");
  const pixelated = propOf<string>(node, "ResamplerMode") === "Pixelated";
  const base: CSSProperties = { position: "absolute", inset: 0, opacity: 1 - transparency, imageRendering: pixelated ? "pixelated" : undefined, pointerEvents: "none" };
  let el: ReactNode;
  if (rectSize.x > 0 && rectSize.y > 0) {
    // Sprite sheet region, stretched to the box.
    el = (
      <div style={{ ...base, overflow: "hidden" }}>
        <img src={url} alt="" draggable={false} style={{ position: "absolute", left: (-rectOffset.x * box.w) / rectSize.x, top: (-rectOffset.y * box.h) / rectSize.y, transformOrigin: "0 0", width: "auto", height: "auto", transform: `scale(${box.w / rectSize.x}, ${box.h / rectSize.y})`, imageRendering: base.imageRendering }} />
      </div>
    );
  } else if (scaleType === "Slice") {
    const sc = propOf<Rect2D>(node, "SliceCenter");
    const s = propOf<number>(node, "SliceScale") * box.scale;
    const dims = src.startsWith(ASSET_SCHEME) ? opts.assetSize?.(src.slice(ASSET_SCHEME.length)) : undefined;
    // SliceCenter is a rect in source pixels: insets are min (top/left) and size - max (bottom/right).
    const insets = {
      t: sc.minY,
      l: sc.minX,
      r: dims ? Math.max(0, dims.w - sc.maxX) : sc.minX,
      b: dims ? Math.max(0, dims.h - sc.maxY) : sc.minY,
    };
    el = <SlicedImage url={url} insets={insets} scale={s} style={base} />;
  } else if (scaleType === "Tile") {
    const tile = propOf<UDim2>(node, "TileSize");
    el = <div style={{ ...base, backgroundImage: `url("${url}")`, backgroundRepeat: "repeat", backgroundSize: `${box.w * tile.xs + tile.xo}px ${box.h * tile.ys + tile.yo}px` }} />;
  } else {
    const fit = scaleType === "Fit" ? "contain" : scaleType === "Crop" ? "cover" : "fill";
    el = <img src={url} alt="" draggable={false} style={{ ...base, width: "100%", height: "100%", objectFit: fit }} />;
  }
  const needsTint = tint.toUpperCase() !== "#FFFFFF" || gradient;
  if (!needsTint) return <>{el}</>;
  // Multiply tint, masked to the image's alpha.
  const fit = scaleType === "Fit" ? "contain" : scaleType === "Crop" ? "cover" : "100% 100%";
  const mask = `url("${url}") center / ${fit} no-repeat`;
  return (
    <>
      {el}
      <div style={{ ...base, background: gradient ? gradientCss(gradient, tint, 0) : tint, mixBlendMode: "multiply", WebkitMask: mask, mask }} />
    </>
  );
}

/** 9-slice using CSS border-image (slice values are source pixels). */
function SlicedImage({ url, insets, scale, style }: { url: string; insets: { t: number; l: number; r: number; b: number }; scale: number; style: CSSProperties }) {
  return (
    <div
      style={{
        ...style,
        borderStyle: "solid",
        borderWidth: `${insets.t * scale}px ${insets.r * scale}px ${insets.b * scale}px ${insets.l * scale}px`,
        borderImageSource: `url("${url}")`,
        borderImageSlice: `${insets.t} ${insets.r} ${insets.b} ${insets.l} fill`,
        borderImageRepeat: "stretch",
        boxSizing: "border-box",
      }}
    />
  );
}

function textStyle(node: ResolvedNode, box: LayoutBox, gradient?: ResolvedNode, stroke?: ResolvedNode): CSSProperties {
  const font = cssFont(propOf<FontFace>(node, "FontFace"));
  const xa = propOf<string>(node, "TextXAlignment");
  const ya = propOf<string>(node, "TextYAlignment");
  const wrapped = propOf<boolean>(node, "TextWrapped") || propOf<boolean>(node, "TextScaled");
  const truncate = propOf<string>(node, "TextTruncate") !== "None";
  const size = box.textSize ?? propOf<number>(node, "TextSize");
  const color = propOf<string>(node, "TextColor3");
  const transparency = propOf<number>(node, "TextTransparency");
  const s: CSSProperties = {
    position: "absolute", inset: 0, display: "flex",
    alignItems: ya === "Top" ? "flex-start" : ya === "Bottom" ? "flex-end" : "center",
    justifyContent: xa === "Left" ? "flex-start" : xa === "Right" ? "flex-end" : "center",
    textAlign: xa === "Left" ? "left" : xa === "Right" ? "right" : "center",
    fontFamily: font.family, fontWeight: font.weight, fontStyle: font.style, fontSize: size,
    lineHeight: `${propOf<number>(node, "LineHeight") * size}px`,
    color: rgba(color, transparency),
    whiteSpace: wrapped ? "pre-wrap" : "pre",
    overflowWrap: wrapped ? "break-word" : undefined,
    pointerEvents: "none",
  };
  const st = propOf<number>(node, "TextStrokeTransparency");
  const shadows: string[] = [];
  if (st < 1) {
    const c = rgba(propOf<string>(node, "TextStrokeColor3"), st);
    shadows.push(`-1px -1px 0 ${c}`, `1px -1px 0 ${c}`, `-1px 1px 0 ${c}`, `1px 1px 0 ${c}`);
  }
  if (stroke && propOf<boolean>(stroke, "Enabled") && propOf<string>(stroke, "ApplyStrokeMode") === "Contextual") {
    const th = propOf<number>(stroke, "Thickness") * box.scale;
    s.WebkitTextStroke = `${th * 2}px ${rgba(propOf<string>(stroke, "Color"), propOf<number>(stroke, "Transparency"))}`;
    s.paintOrder = "stroke fill";
  }
  if (shadows.length) s.textShadow = shadows.join(", ");
  if (gradient && propOf<boolean>(gradient, "Enabled")) {
    s.backgroundImage = gradientCss(gradient, color, transparency);
    s.WebkitBackgroundClip = "text";
    s.backgroundClip = "text";
    s.color = "transparent";
  }
  if (truncate) {
    s.overflow = "hidden";
    s.textOverflow = "ellipsis";
  }
  return s;
}

const RNode = memo(function RNode({ node, layout, parentBox, opts }: NodeProps) {
  const cls = CLASSES[node.className];
  if (!cls || cls.kind !== "gui") return null;
  const box = layout.get(node.id);
  if (!box) return null;
  if (propOf<boolean>(node, "Visible") === false) return null;
  if (opts.respectEditorHidden && node.editorHidden) return null;

  let corner: ResolvedNode | undefined;
  let gradient: ResolvedNode | undefined;
  const strokes: ResolvedNode[] = [];
  for (const c of node.children) {
    if (c.className === "UICorner") corner ??= c;
    else if (c.className === "UIGradient" && propOf<boolean>(c, "Enabled")) gradient ??= c;
    else if (c.className === "UIStroke" && propOf<boolean>(c, "Enabled")) strokes.push(c);
  }
  const bgT = propOf<number>(node, "BackgroundTransparency");
  const bg = propOf<string>(node, "BackgroundColor3");
  const radius = corner ? (() => {
    const r = propOf<UDim>(corner, "CornerRadius");
    return Math.min(Math.min(box.w, box.h) / 2, Math.min(box.w, box.h) * r.s + r.o * box.scale);
  })() : 0;

  const style: CSSProperties = {
    position: "absolute",
    left: box.x - parentBox.x,
    top: box.y - parentBox.y,
    width: box.w,
    height: box.h,
    zIndex: propOf<number>(node, "ZIndex"),
    borderRadius: radius || undefined,
    transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
  };
  if (bgT < 1) {
    style.background = gradient ? gradientCss(gradient, bg, bgT) : rgba(bg, bgT);
  }
  const shadows: string[] = [];
  const border = propOf<number>(node, "BorderSizePixel");
  if (border > 0 && bgT < 1) shadows.push(`0 0 0 ${border * box.scale}px ${rgba(propOf<string>(node, "BorderColor3"), bgT)}`);
  const contextualText = cls.isText;
  for (const s of strokes) {
    if (contextualText && propOf<string>(s, "ApplyStrokeMode") === "Contextual") continue;
    const th = propOf<number>(s, "Thickness") * box.scale;
    shadows.push(`0 0 0 ${th}px ${rgba(propOf<string>(s, "Color"), propOf<number>(s, "Transparency"))}`);
  }
  if (shadows.length) style.boxShadow = shadows.join(", ");
  if (node.className === "CanvasGroup") style.opacity = 1 - propOf<number>(node, "GroupTransparency");

  const isScroll = cls.isScrolling;
  const clips = box.clips || isScroll;
  const kids = node.children
    .filter((c) => CLASSES[c.className]?.kind === "gui")
    .map((c, i) => ({ c, i, z: propOf<number>(c, "ZIndex") }))
    .sort((a, b) => a.z - b.z || a.i - b.i);

  let content: ReactNode = null;
  if (cls.isText) {
    const text = propOf<string>(node, "Text");
    const placeholder = node.className === "TextBox" && !text ? propOf<string>(node, "PlaceholderText") : "";
    const stroke = strokes.find((s) => propOf<string>(s, "ApplyStrokeMode") === "Contextual");
    const ts = textStyle(node, box, gradient, stroke);
    if (placeholder) ts.color = rgba(propOf<string>(node, "PlaceholderColor3"), propOf<number>(node, "TextTransparency"));
    // Roblox: a UIGradient on a text object tints both its background and its text.
    content = <div style={ts}>{placeholder ? placeholder : propOf<boolean>(node, "RichText") ? <span>{richText(text, node.id)}</span> : <span>{text}</span>}</div>;
  } else if (cls.isImage) {
    content = <ImageContent node={node} box={box} opts={opts} gradient={gradient} />;
  } else if (node.className === "ViewportFrame") {
    content = <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.45)", fontSize: 11, border: "1px dashed rgba(255,255,255,0.25)", borderRadius: "inherit" }}>3D Viewport</div>;
  }

  const inner = (
    <>
      {content}
      {kids.map(({ c }) => (
        <RNode key={c.id} node={c} layout={layout} parentBox={box} opts={opts} />
      ))}
    </>
  );

  const scrollbar = isScroll && box.canvas ? <ScrollBar node={node} box={box} /> : null;
  const interactive = opts.interactive && cls.isButton;
  const className = interactive && propOf<boolean>(node, "AutoButtonColor") ? "ruis-btn" : undefined;
  const handlers = opts.interactive
    ? {
        onWheel: isScroll && propOf<boolean>(node, "ScrollingEnabled") ? (e: React.WheelEvent) => {
          e.stopPropagation();
          opts.onScroll?.(node.id, e.deltaX, e.deltaY);
        } : undefined,
        onClick: cls.isButton ? (e: React.MouseEvent) => {
          e.stopPropagation();
          opts.onActivate?.(node.id);
        } : undefined,
        onMouseEnter: () => opts.onHover?.(node.id, true),
        onMouseLeave: () => opts.onHover?.(node.id, false),
      }
    : {};

  return (
    <div data-node={node.id} className={className} style={{ ...style, overflow: clips && !box.rotation ? "hidden" : undefined, cursor: interactive ? "pointer" : undefined }} {...handlers}>
      {inner}
      {scrollbar}
    </div>
  );
});

function ScrollBar({ node, box }: { node: ResolvedNode; box: LayoutBox }) {
  const c = box.canvas!;
  const th = propOf<number>(node, "ScrollBarThickness");
  if (th <= 0 || c.h <= box.h + 0.5) return null;
  const color = rgba(propOf<string>(node, "ScrollBarImageColor3"), propOf<number>(node, "ScrollBarImageTransparency"));
  const pos = propOf<Vector2>(node, "CanvasPosition");
  const frac = box.h / c.h;
  const top = (pos.y / c.h) * box.h;
  return <div style={{ position: "absolute", right: 0, top, width: th, height: Math.max(12, frac * box.h), background: color, borderRadius: th / 2, zIndex: 10000, pointerEvents: "none" }} />;
}

/** Render the children of a root (ScreenGui or loose frame) inside a container of the root's size. */
export function RootRenderer({ tree, layout, opts }: { tree: ResolvedNode; layout: LayoutMap; opts: RenderOptions }) {
  const rootBox = layout.get(tree.id);
  if (!rootBox) return null;
  if (tree.className === "ScreenGui") {
    if (!rootBox.visible) return null;
    const kids = tree.children
      .filter((c) => CLASSES[c.className]?.kind === "gui")
      .map((c, i) => ({ c, i, z: propOf<number>(c, "ZIndex") }))
      .sort((a, b) => a.z - b.z || a.i - b.i);
    return (
      <>
        {kids.map(({ c }) => (
          <RNode key={c.id} node={c} layout={layout} parentBox={rootBox} opts={opts} />
        ))}
      </>
    );
  }
  return <RNode node={tree} layout={layout} parentBox={rootBox} opts={opts} />;
}

export const BUTTON_CSS = `.ruis-btn:hover{filter:brightness(0.9)}.ruis-btn:active{filter:brightness(0.75)}`;
