/**
 * Property value validation and coercion against the class registry.
 *
 * Coercion is deliberately forgiving about *shape* (so humans and Claude can
 * write `"#fff"`, `[0.5, 0, 0.5, 0]` or `{"x":0.5,"y":0.5}`) but strict about
 * *meaning*: unknown properties, wrong types and invalid enum values are
 * rejected with a clear message.
 */
import { CLASSES, ENUMS, getPropDef, type PropDef } from "./classes";
import { fontInfo, WEIGHT_NAMES } from "./fonts";
import type { ColorStop, NumberStop, PropValue } from "./types";

export type CoerceResult = { ok: true; value: PropValue } | { ok: false; error: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function normalizeColor(v: unknown): string | null {
  if (typeof v === "string") {
    let s = v.trim();
    if (s.startsWith("#")) s = s.slice(1);
    if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split("").map((c) => c + c).join("");
    if (/^[0-9a-fA-F]{6}$/.test(s)) return "#" + s.toUpperCase();
    const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(v.trim());
    if (m) return rgbToHex(+m[1], +m[2], +m[3]);
    return null;
  }
  if (Array.isArray(v) && v.length === 3 && v.every(isNum)) return rgbToHex(v[0], v[1], v[2]);
  if (isObj(v) && isNum(v.r) && isNum(v.g) && isNum(v.b)) return rgbToHex(v.r, v.g, v.b);
  return null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return ("#" + c(r) + c(g) + c(b)).toUpperCase();
}

export function hexToRgb(hex: string): [number, number, number] {
  const s = (normalizeColor(hex) ?? "#000000").slice(1);
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function coerceUDim(v: unknown): PropValue | null {
  if (isNum(v)) return { s: 0, o: v };
  if (Array.isArray(v) && v.length === 2 && v.every(isNum)) return { s: v[0], o: v[1] };
  if (isObj(v)) {
    const s = v.s ?? v.Scale ?? v.scale ?? 0;
    const o = v.o ?? v.Offset ?? v.offset ?? 0;
    if (isNum(s) && isNum(o)) return { s, o };
  }
  return null;
}

function coerceUDim2(v: unknown): PropValue | null {
  if (Array.isArray(v) && v.length === 4 && v.every(isNum)) return { xs: v[0], xo: v[1], ys: v[2], yo: v[3] };
  if (isObj(v)) {
    if ("xs" in v || "xo" in v || "ys" in v || "yo" in v) {
      const r = { xs: v.xs ?? 0, xo: v.xo ?? 0, ys: v.ys ?? 0, yo: v.yo ?? 0 };
      if (isNum(r.xs) && isNum(r.xo) && isNum(r.ys) && isNum(r.yo)) return r as PropValue;
      return null;
    }
    if ("x" in v || "y" in v || "X" in v || "Y" in v) {
      const x = coerceUDim(v.x ?? v.X ?? { s: 0, o: 0 });
      const y = coerceUDim(v.y ?? v.Y ?? { s: 0, o: 0 });
      if (x && y) {
        const xu = x as { s: number; o: number };
        const yu = y as { s: number; o: number };
        return { xs: xu.s, xo: xu.o, ys: yu.s, yo: yu.o };
      }
    }
  }
  return null;
}

function coerceVector2(v: unknown): PropValue | null {
  if (Array.isArray(v) && v.length === 2 && v.every(isNum)) return { x: v[0], y: v[1] };
  if (isObj(v)) {
    const x = v.x ?? v.X;
    const y = v.y ?? v.Y;
    if (isNum(x) && isNum(y)) return { x, y };
  }
  return null;
}

function coerceFont(v: unknown): PropValue | null | string {
  if (typeof v === "string") {
    if (!fontInfo(v)) return `unknown font family "${v}"`;
    return { family: v, weight: "Regular", style: "Normal" };
  }
  if (!isObj(v)) return null;
  const family = v.family;
  if (typeof family !== "string" || !fontInfo(family)) return `unknown font family "${String(family)}"`;
  const weight = (v.weight ?? "Regular") as string;
  if (!WEIGHT_NAMES.includes(weight as never)) return `invalid font weight "${weight}" (use ${WEIGHT_NAMES.join(", ")})`;
  const style = (v.style ?? "Normal") as string;
  if (style !== "Normal" && style !== "Italic") return `invalid font style "${style}"`;
  return { family, weight: weight as never, style };
}

function coerceSeq(v: unknown, kind: "color" | "number"): PropValue | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const out: (ColorStop | NumberStop)[] = [];
  for (const s of v) {
    if (!isObj(s) || !isNum(s.t) || s.t < 0 || s.t > 1) return null;
    if (kind === "color") {
      const c = normalizeColor(s.color);
      if (!c) return null;
      out.push({ t: s.t, color: c });
    } else {
      if (!isNum(s.value)) return null;
      out.push({ t: s.t, value: Math.max(0, Math.min(1, s.value)) });
    }
  }
  out.sort((a, b) => a.t - b.t);
  if (out[0].t !== 0 || out[out.length - 1].t !== 1) return null;
  return out as PropValue;
}

export function coerceValue(def: PropDef, v: unknown): CoerceResult {
  const fail = (why?: string): CoerceResult => ({
    ok: false,
    error: `${def.name}: ${why ?? `expected ${describeType(def)}`}, got ${JSON.stringify(v)}`,
  });
  switch (def.type) {
    case "number":
    case "int": {
      if (!isNum(v)) return fail();
      let n = def.type === "int" ? Math.round(v) : v;
      if (def.min !== undefined && n < def.min) n = def.min;
      if (def.max !== undefined && n > def.max) n = def.max;
      return { ok: true, value: n };
    }
    case "bool":
      return typeof v === "boolean" ? { ok: true, value: v } : fail();
    case "string":
      return typeof v === "string" ? { ok: true, value: v } : fail();
    case "content": {
      if (typeof v !== "string") return fail();
      const s = v.trim();
      if (/^\d+$/.test(s)) return { ok: true, value: `rbxassetid://${s}` };
      if (s === "" || /^rbxassetid:\/\/\d+$/.test(s) || /^asset:\/\/[\w-]+$/.test(s) || s.startsWith("rbxasset://"))
        return { ok: true, value: s };
      return fail('expected "", "asset://<libraryAssetId>", "rbxassetid://<number>" or a number');
    }
    case "color": {
      const c = normalizeColor(v);
      return c ? { ok: true, value: c } : fail();
    }
    case "udim": {
      const r = coerceUDim(v);
      return r ? { ok: true, value: r } : fail();
    }
    case "udim2": {
      const r = coerceUDim2(v);
      return r ? { ok: true, value: r } : fail();
    }
    case "vector2": {
      const r = coerceVector2(v);
      return r ? { ok: true, value: r } : fail();
    }
    case "rect": {
      if (Array.isArray(v) && v.length === 4 && v.every(isNum))
        return { ok: true, value: { minX: v[0], minY: v[1], maxX: v[2], maxY: v[3] } };
      if (isObj(v) && isNum(v.minX) && isNum(v.minY) && isNum(v.maxX) && isNum(v.maxY))
        return { ok: true, value: { minX: v.minX, minY: v.minY, maxX: v.maxX, maxY: v.maxY } };
      return fail();
    }
    case "font": {
      const r = coerceFont(v);
      if (typeof r === "string") return fail(r);
      return r ? { ok: true, value: r } : fail();
    }
    case "enum": {
      const values = ENUMS[def.enumName!];
      if (typeof v === "string") {
        const name = v.replace(/^Enum\.\w+\./, "");
        if (name in values) return { ok: true, value: name };
      }
      return fail(`expected one of ${Object.keys(values).join(", ")}`);
    }
    case "colorSeq": {
      const r = coerceSeq(v, "color");
      return r ? { ok: true, value: r } : fail("expected [{t:0,color}, …, {t:1,color}]");
    }
    case "numberSeq": {
      const r = coerceSeq(v, "number");
      return r ? { ok: true, value: r } : fail("expected [{t:0,value}, …, {t:1,value}]");
    }
  }
}

export function coerceProp(className: string, name: string, v: unknown): CoerceResult {
  if (!CLASSES[className]) return { ok: false, error: `unknown class "${className}"` };
  const def = getPropDef(className, name);
  if (!def) {
    const known = CLASSES[className].props.map((p) => p.name).join(", ");
    return { ok: false, error: `${className} has no property "${name}". Valid: ${known}` };
  }
  return coerceValue(def, v);
}

export function describeType(def: PropDef): string {
  switch (def.type) {
    case "udim":
      return "UDim {s, o}";
    case "udim2":
      return "UDim2 {xs, xo, ys, yo}";
    case "vector2":
      return "Vector2 {x, y}";
    case "color":
      return 'Color3 "#RRGGBB"';
    case "font":
      return "FontFace {family, weight, style}";
    case "enum":
      return `Enum.${def.enumName} (${Object.keys(ENUMS[def.enumName!]).join("|")})`;
    case "colorSeq":
      return "ColorSequence [{t, color}]";
    case "numberSeq":
      return "NumberSequence [{t, value}]";
    case "rect":
      return "Rect {minX, minY, maxX, maxY}";
    case "content":
      return "Content (asset://id | rbxassetid://n)";
    default:
      return def.type;
  }
}
