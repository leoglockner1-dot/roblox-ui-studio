/**
 * Property input controls, driven by the class registry's PropDefs.
 * Number fields support drag-scrubbing (on the label/tag), arrow keys
 * (Shift = ×10) and simple math expressions ("120+16", "50%*2" is not supported).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ENUMS, HUGE, type PropDef } from "../../core/classes";
import { FONT_FAMILIES, WEIGHT_NAMES } from "../../core/fonts";
import { normalizeColor } from "../../core/schema";
import type { ColorStop, FontFace, NumberStop, PropValue, Rect2D, UDim, UDim2, Vector2 } from "../../core/types";
import { store, useEditor } from "../store";
import { api } from "../api";
import { Icon } from "./icons";

/** Evaluate + - * / ( ) with numbers. Returns null on invalid input. */
export function evalExpr(src: string): number | null {
  const s = src.replace(/\s+/g, "");
  if (!s) return null;
  if (/^(inf|math\.huge|huge)$/i.test(s)) return HUGE;
  let i = 0;
  const num = (): number | null => {
    if (s[i] === "(") {
      i++;
      const v = expr();
      if (s[i] !== ")") return null;
      i++;
      return v;
    }
    if (s[i] === "-") {
      i++;
      const v = num();
      return v === null ? null : -v;
    }
    const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const term = (): number | null => {
    let v = num();
    while (v !== null && (s[i] === "*" || s[i] === "/")) {
      const op = s[i++];
      const r = num();
      if (r === null) return null;
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const expr = (): number | null => {
    let v = term();
    while (v !== null && (s[i] === "+" || s[i] === "-")) {
      const op = s[i++];
      const r = term();
      if (r === null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const v = expr();
  return v !== null && i === s.length && Number.isFinite(v) ? v : null;
}

const fmt = (n: number, digits = 3) => (n >= HUGE ? "inf" : String(Math.round(n * 10 ** digits) / 10 ** digits));

export function NumberField({
  value, onChange, tag, step = 1, min, max, mixed, digits = 3, onScrubStart, onScrubEnd, width,
}: {
  value: number | undefined; onChange: (v: number, final: boolean) => void; tag?: string; step?: number; min?: number; max?: number;
  mixed?: boolean; digits?: number; onScrubStart?: () => void; onScrubEnd?: () => void; width?: number;
}) {
  const [text, setText] = useState(value === undefined ? "" : fmt(value, digits));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === undefined || mixed ? "" : fmt(value, digits));
  }, [value, mixed, digits]);
  const clamp = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
  const commit = () => {
    const v = evalExpr(text);
    if (v === null) {
      setText(value === undefined || mixed ? "" : fmt(value, digits));
      return;
    }
    const c = clamp(v);
    if (c !== value || mixed) onChange(c, true);
    setText(fmt(c, digits));
  };
  const scrub = (e: React.PointerEvent) => {
    if (mixed && value === undefined) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = value ?? 0;
    let moved = false;
    onScrubStart?.();
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 1) moved = true;
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const v = clamp(Math.round((start + dx * step * mult) / (step * (ev.altKey ? 0.1 : 1))) * step * (ev.altKey ? 0.1 : 1));
      onChange(v, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) onScrubEnd?.();
      else onScrubEnd?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className={`field${mixed ? " mixed" : ""}`} style={width ? { flex: `0 0 ${width}px` } : undefined}>
      {tag && <span className="tag" onPointerDown={scrub}>{tag}</span>}
      <input
        value={text}
        placeholder={mixed ? "Mixed" : ""}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(value === undefined ? "" : fmt(value, digits));
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const v = clamp((evalExpr(text) ?? value ?? 0) + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            setText(fmt(v, digits));
            onChange(v, true);
          }
          e.stopPropagation();
        }}
      />
    </div>
  );
}

export function TextField({ value, onChange, mixed, placeholder }: { value: string | undefined; onChange: (v: string) => void; mixed?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value ?? "");
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(mixed ? "" : value ?? "");
  }, [value, mixed]);
  return (
    <div className="field">
      <input
        value={text}
        placeholder={mixed ? "Mixed" : placeholder}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          if (text !== value) onChange(text);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
    </div>
  );
}

export function TextArea({ value, onChange, mixed }: { value: string | undefined; onChange: (v: string) => void; mixed?: boolean }) {
  const [text, setText] = useState(value ?? "");
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(mixed ? "" : value ?? "");
  }, [value, mixed]);
  return (
    <textarea
      className="text-area"
      value={text}
      placeholder={mixed ? "Mixed" : ""}
      rows={2}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        if (text !== value) onChange(text);
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
        e.stopPropagation();
      }}
    />
  );
}

export function Select({ value, options, onChange, mixed }: { value: string | undefined; options: (string | { value: string; label: string })[]; onChange: (v: string) => void; mixed?: boolean }) {
  return (
    <div className="field">
      <select value={mixed ? "" : value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
        {mixed && <option value="">Mixed</option>}
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.value;
          return (
            <option key={v} value={v}>
              {typeof o === "string" ? o : o.label}
            </option>
          );
        })}
      </select>
    </div>
  );
}

export function ColorField({ value, onChange, mixed, tokenId, onBindToken }: { value: string | undefined; onChange: (v: string, final: boolean) => void; mixed?: boolean; tokenId?: string; onBindToken?: (id: string | null) => void }) {
  const tokens = useEditor((s) => s.doc?.tokens.colors);
  const [open, setOpen] = useState(false);
  const token = tokens?.find((t) => t.id === tokenId);
  return (
    <div className="fields" style={{ position: "relative" }}>
      <div className="field">
        <label className="swatch checker" style={{ background: undefined }}>
          <span style={{ position: "absolute", inset: 0, background: mixed ? "transparent" : value }} />
          <input type="color" value={value ?? "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase(), false)} onBlur={(e) => onChange(e.target.value.toUpperCase(), true)} />
        </label>
        {token ? (
          <span style={{ padding: "0 6px", flex: 1, color: "var(--accent-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{token.name}</span>
        ) : (
          <HexInput value={value} mixed={mixed} onChange={(v) => onChange(v, true)} />
        )}
      </div>
      {onBindToken && (
        <button className={`icon-btn${token ? " on" : ""}`} data-tip={token ? "Detach token" : "Use colour token"} onClick={() => (token ? onBindToken(null) : setOpen(!open))}>
          <Icon.token />
        </button>
      )}
      {open && onBindToken && (
        <div className="popover" style={{ right: 0, top: 30, width: 200, padding: 4 }} onMouseLeave={() => setOpen(false)}>
          {!tokens?.length && <div className="empty">No colour tokens. Add them in Styles.</div>}
          {tokens?.map((t) => (
            <div key={t.id} className="menu-item" onClick={() => { onBindToken(t.id); setOpen(false); }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, background: t.value, boxShadow: "inset 0 0 0 1px rgba(255,255,255,.2)" }} />
                {t.name}
              </span>
              <span className="kbd">{t.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HexInput({ value, onChange, mixed }: { value: string | undefined; onChange: (v: string) => void; mixed?: boolean }) {
  const [text, setText] = useState(value?.slice(1) ?? "");
  useEffect(() => setText(mixed ? "" : value?.slice(1) ?? ""), [value, mixed]);
  return (
    <input
      value={text}
      placeholder={mixed ? "Mixed" : ""}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => {
        const c = normalizeColor(text);
        if (c && c !== value) onChange(c);
        else setText(value?.slice(1) ?? "");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
      style={{ fontFamily: "var(--mono)", textTransform: "uppercase" }}
    />
  );
}

export function Toggle({ value, onChange, label, mixed }: { value: boolean | undefined; onChange: (v: boolean) => void; label?: string; mixed?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!mixed;
  }, [mixed]);
  return (
    <label className="toggle">
      <input ref={ref} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ------------------------------------------------------------ PropEditor

export interface PropEditorProps {
  def: PropDef;
  value: PropValue | undefined;
  mixed?: boolean;
  onChange: (v: PropValue, final: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  tokenId?: string;
  onBindToken?: (id: string | null) => void;
}

export function PropEditor(p: PropEditorProps): ReactNode {
  const { def, value, mixed, onChange } = p;
  const scrub = { onScrubStart: p.onScrubStart, onScrubEnd: p.onScrubEnd };
  switch (def.type) {
    case "number":
    case "int":
      return (
        <div className="fields">
          <NumberField value={value as number} mixed={mixed} min={def.min} max={def.max} step={def.step ?? (def.type === "int" ? 1 : (def.max ?? 10) <= 1 ? 0.01 : 1)} digits={def.type === "int" ? 0 : 3} onChange={onChange} tag="" {...scrub} />
        </div>
      );
    case "bool":
      return <Toggle value={value as boolean} mixed={mixed} onChange={(v) => onChange(v, true)} />;
    case "string":
      return def.name === "Text" || def.name === "PlaceholderText" ? <TextArea value={value as string} mixed={mixed} onChange={(v) => onChange(v, true)} /> : <TextField value={value as string} mixed={mixed} onChange={(v) => onChange(v, true)} />;
    case "content":
      return <ContentField value={value as string} mixed={mixed} onChange={(v) => onChange(v, true)} />;
    case "color":
      return <ColorField value={value as string} mixed={mixed} onChange={onChange} tokenId={p.tokenId} onBindToken={p.onBindToken} />;
    case "enum":
      return <Select value={value as string} mixed={mixed} options={Object.keys(ENUMS[def.enumName!])} onChange={(v) => onChange(v, true)} />;
    case "udim": {
      const u = (value as UDim) ?? { s: 0, o: 0 };
      return (
        <div className="fields">
          <NumberField tag="S" value={u.s} mixed={mixed} step={0.01} onChange={(v, f) => onChange({ ...u, s: v }, f)} {...scrub} />
          <NumberField tag="O" value={u.o} mixed={mixed} step={1} digits={0} onChange={(v, f) => onChange({ ...u, o: v }, f)} {...scrub} />
        </div>
      );
    }
    case "udim2":
      return <UDim2Field value={value as UDim2} mixed={mixed} onChange={onChange} {...scrub} />;
    case "vector2": {
      const v = (value as Vector2) ?? { x: 0, y: 0 };
      const step = def.name === "AnchorPoint" || def.name === "Offset" ? 0.05 : 1;
      return (
        <div className="fields">
          <NumberField tag="X" value={v.x} mixed={mixed} step={step} onChange={(x, f) => onChange({ ...v, x }, f)} {...scrub} />
          <NumberField tag="Y" value={v.y} mixed={mixed} step={step} onChange={(y, f) => onChange({ ...v, y }, f)} {...scrub} />
          {def.name === "AnchorPoint" && <AnchorPicker value={v} onChange={(nv) => onChange(nv, true)} />}
        </div>
      );
    }
    case "rect": {
      const r = (value as Rect2D) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {(["minX", "minY", "maxX", "maxY"] as const).map((k) => (
            <NumberField key={k} tag={k} value={r[k]} digits={0} onChange={(v, f) => onChange({ ...r, [k]: v }, f)} />
          ))}
        </div>
      );
    }
    case "font":
      return <FontField value={value as FontFace} mixed={mixed} onChange={(v) => onChange(v, true)} />;
    case "colorSeq":
      return <ColorSeqField value={value as ColorStop[]} onChange={(v) => onChange(v, true)} />;
    case "numberSeq":
      return <NumberSeqField value={value as NumberStop[]} onChange={(v) => onChange(v, true)} />;
  }
}

export function UDim2Field({ value, mixed, onChange, onScrubStart, onScrubEnd }: { value: UDim2 | undefined; mixed?: boolean; onChange: (v: UDim2, final: boolean) => void; onScrubStart?: () => void; onScrubEnd?: () => void }) {
  const u = value ?? { xs: 0, xo: 0, ys: 0, yo: 0 };
  const scrub = { onScrubStart, onScrubEnd };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
      <NumberField tag="X·S" value={u.xs} mixed={mixed} step={0.01} onChange={(v, f) => onChange({ ...u, xs: v }, f)} {...scrub} />
      <NumberField tag="X·O" value={u.xo} mixed={mixed} digits={0} onChange={(v, f) => onChange({ ...u, xo: v }, f)} {...scrub} />
      <NumberField tag="Y·S" value={u.ys} mixed={mixed} step={0.01} onChange={(v, f) => onChange({ ...u, ys: v }, f)} {...scrub} />
      <NumberField tag="Y·O" value={u.yo} mixed={mixed} digits={0} onChange={(v, f) => onChange({ ...u, yo: v }, f)} {...scrub} />
    </div>
  );
}

function AnchorPicker({ value, onChange }: { value: Vector2; onChange: (v: Vector2) => void }) {
  const pts = [0, 0.5, 1];
  return (
    <div className="anchor-grid" data-tip="AnchorPoint presets">
      {pts.map((y) => pts.map((x) => <button key={`${x}${y}`} className={value.x === x && value.y === y ? "on" : ""} onClick={() => onChange({ x, y })} />))}
    </div>
  );
}

export function FontField({ value, mixed, onChange }: { value: FontFace | undefined; mixed?: boolean; onChange: (v: FontFace) => void }) {
  const f = value ?? { family: "BuilderSans", weight: "Regular", style: "Normal" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Select value={f.family} mixed={mixed} options={FONT_FAMILIES.map((x) => ({ value: x.family, label: `${x.label}${x.exact ? "" : " ≈"}` }))} onChange={(family) => onChange({ ...f, family })} />
      <div className="fields">
        <Select value={f.weight} mixed={mixed} options={WEIGHT_NAMES} onChange={(weight) => onChange({ ...f, weight: weight as FontFace["weight"] })} />
        <Select value={f.style} mixed={mixed} options={["Normal", "Italic"]} onChange={(style) => onChange({ ...f, style: style as FontFace["style"] })} />
      </div>
    </div>
  );
}

function ColorSeqField({ value, onChange }: { value: ColorStop[]; onChange: (v: ColorStop[]) => void }) {
  const stops = value ?? [{ t: 0, color: "#FFFFFF" }, { t: 1, color: "#FFFFFF" }];
  const set = (i: number, patch: Partial<ColorStop>) => onChange(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)).sort((a, b) => a.t - b.t));
  return (
    <div className="stops">
      <div className="gradient-bar" style={{ background: `linear-gradient(90deg, ${stops.map((s) => `${s.color} ${s.t * 100}%`).join(", ")})` }} />
      {stops.map((s, i) => (
        <div key={i} className="fields">
          <NumberField tag="t" value={s.t} min={0} max={1} step={0.01} width={70} onChange={(t, f) => f && set(i, { t: i === 0 ? 0 : i === stops.length - 1 ? 1 : t })} />
          <ColorField value={s.color} onChange={(color, f) => f && set(i, { color })} />
          {stops.length > 2 && i > 0 && i < stops.length - 1 && (
            <button className="icon-btn" onClick={() => onChange(stops.filter((_, j) => j !== i))}>
              <Icon.minus />
            </button>
          )}
        </div>
      ))}
      <button className="btn small" onClick={() => onChange([...stops, { t: 0.5, color: stops[0].color }].sort((a, b) => a.t - b.t))}>
        <Icon.plus size={12} /> Stop
      </button>
    </div>
  );
}

function NumberSeqField({ value, onChange }: { value: NumberStop[]; onChange: (v: NumberStop[]) => void }) {
  const stops = value ?? [{ t: 0, value: 0 }, { t: 1, value: 0 }];
  const set = (i: number, patch: Partial<NumberStop>) => onChange(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)).sort((a, b) => a.t - b.t));
  return (
    <div className="stops">
      <div className="gradient-bar checker" style={{ position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 3, background: `linear-gradient(90deg, ${stops.map((s) => `rgba(255,255,255,${1 - s.value}) ${s.t * 100}%`).join(", ")})` }} />
      </div>
      {stops.map((s, i) => (
        <div key={i} className="fields">
          <NumberField tag="t" value={s.t} min={0} max={1} step={0.01} onChange={(t, f) => f && set(i, { t: i === 0 ? 0 : i === stops.length - 1 ? 1 : t })} />
          <NumberField tag="α" value={s.value} min={0} max={1} step={0.05} onChange={(v, f) => f && set(i, { value: v })} />
          {stops.length > 2 && i > 0 && i < stops.length - 1 && (
            <button className="icon-btn" onClick={() => onChange(stops.filter((_, j) => j !== i))}>
              <Icon.minus />
            </button>
          )}
        </div>
      ))}
      <button className="btn small" onClick={() => onChange([...stops, { t: 0.5, value: 0 }].sort((a, b) => a.t - b.t))}>
        <Icon.plus size={12} /> Stop
      </button>
    </div>
  );
}

function ContentField({ value, mixed, onChange }: { value: string | undefined; mixed?: boolean; onChange: (v: string) => void }) {
  const assets = useEditor((s) => s.assets);
  const [open, setOpen] = useState(false);
  const libId = value?.startsWith("asset://") ? value.slice(8) : null;
  const asset = libId ? assets.find((a) => a.id === libId) : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, position: "relative" }}>
      <div className="fields">
        <div className="field" style={{ cursor: "pointer" }} onClick={() => setOpen(!open)}>
          <span style={{ width: 22, height: 22, margin: "0 2px", borderRadius: 3, overflow: "hidden", flex: "none", background: "#2a2f38" }}>
            {asset && <img src={api.assetUrl(asset.id)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
          </span>
          <span style={{ padding: "0 4px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: value ? "var(--text)" : "var(--text-3)" }}>
            {mixed ? "Mixed" : asset ? asset.name : value ? value : "None"}
          </span>
        </div>
        {value && (
          <button className="icon-btn" data-tip="Clear image" onClick={() => onChange("")}>
            <Icon.close />
          </button>
        )}
      </div>
      {asset && !asset.robloxAssetId && !asset.reference && <div style={{ color: "var(--warn)", fontSize: 10.5 }}>Local preview only — set its Roblox asset id in Assets before export.</div>}
      {!asset && <TextField value={libId ? value : value ?? ""} placeholder="rbxassetid://… or id" onChange={(v) => onChange(/^\d+$/.test(v.trim()) ? `rbxassetid://${v.trim()}` : v.trim())} />}
      {open && (
        <div className="popover" style={{ top: 30, left: 0, right: 0, maxHeight: 280, overflow: "auto", padding: 6 }} onMouseLeave={() => setOpen(false)}>
          {!assets.filter((a) => !a.reference).length && <div className="empty">No images yet. Import them in the Assets tab.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
            {assets.filter((a) => !a.reference).map((a) => (
              <button key={a.id} className="lib-item" style={{ padding: 0 }} onClick={() => { onChange(`asset://${a.id}`); setOpen(false); }} title={a.name}>
                <div className="thumb checker" style={{ height: 52 }}>
                  <img className="asset-thumb" src={api.assetUrl(a.id)} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PropRow({ label, children, className, title, onLabelPointerDown }: { label: string; children: ReactNode; className?: string; title?: string; onLabelPointerDown?: (e: React.PointerEvent) => void }) {
  return (
    <div className="prop-row">
      <span className={`prop-label ${className ?? ""}`} title={title ?? label} onPointerDown={onLabelPointerDown}>
        {label}
      </span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export { store };
