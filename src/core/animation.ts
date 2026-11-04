/**
 * Animation model evaluation: TweenService-compatible easing, interpolation
 * of Roblox value types and sampling an Animation at a point in time.
 *
 * Semantics (mirrored by the TweenService exporter):
 *  - Each track animates one property of one node.
 *  - Before its first keyframe a track holds the first keyframe value.
 *  - Between keyframes k[i-1] -> k[i] the value is eased with k[i]'s easing.
 *  - After the last keyframe the value holds.
 *  - `reverses` plays the timeline forward then backward (duration doubles).
 */
import { getPropDef } from "./classes";
import { hexToRgb, rgbToHex } from "./schema";
import type { Animation, AnimationTrack, EasingDirection, EasingStyle, PropValue, UDim, UDim2, Vector2 } from "./types";

export const EASING_STYLES: EasingStyle[] = ["Linear", "Sine", "Quad", "Cubic", "Quart", "Quint", "Exponential", "Circular", "Back", "Elastic", "Bounce"];
export const EASING_DIRECTIONS: EasingDirection[] = ["In", "Out", "InOut"];

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/** "In" form of each style. Out/InOut are derived. */
const IN: Record<EasingStyle, (t: number) => number> = {
  Linear: (t) => t,
  Sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  Quad: (t) => t * t,
  Cubic: (t) => t * t * t,
  Quart: (t) => t ** 4,
  Quint: (t) => t ** 5,
  Exponential: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  Circular: (t) => 1 - Math.sqrt(1 - t * t),
  Back: (t) => {
    const s = 1.70158;
    return t * t * ((s + 1) * t - s);
  },
  Elastic: (t) => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * c4);
  },
  Bounce: (t) => 1 - bounceOut(1 - t),
};

export function ease(style: EasingStyle, dir: EasingDirection, t: number): number {
  const x = Math.max(0, Math.min(1, t));
  const f = IN[style] ?? IN.Linear;
  if (dir === "In") return f(x);
  if (dir === "Out") return 1 - f(1 - x);
  return x < 0.5 ? f(2 * x) / 2 : 1 - f(2 * (1 - x)) / 2;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Interpolate two values of the same Roblox type. Non-numeric types snap at t >= 1. */
export function interpolate(a: PropValue, b: PropValue, t: number): PropValue {
  if (typeof a === "number" && typeof b === "number") return lerp(a, b, t);
  if (typeof a === "string" && typeof b === "string" && a.startsWith("#") && b.startsWith("#")) {
    const [r1, g1, b1] = hexToRgb(a);
    const [r2, g2, b2] = hexToRgb(b);
    return rgbToHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t));
  }
  if (typeof a === "object" && typeof b === "object" && a && b && !Array.isArray(a) && !Array.isArray(b)) {
    if ("xs" in a && "xs" in b) {
      const p = a as UDim2;
      const q = b as UDim2;
      return { xs: lerp(p.xs, q.xs, t), xo: lerp(p.xo, q.xo, t), ys: lerp(p.ys, q.ys, t), yo: lerp(p.yo, q.yo, t) };
    }
    if ("s" in a && "s" in b) {
      const p = a as UDim;
      const q = b as UDim;
      return { s: lerp(p.s, q.s, t), o: lerp(p.o, q.o, t) };
    }
    if ("x" in a && "x" in b) {
      const p = a as Vector2;
      const q = b as Vector2;
      return { x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) };
    }
  }
  return t >= 1 ? b : a;
}

export function trackDuration(track: AnimationTrack): number {
  return track.keyframes.reduce((m, k) => Math.max(m, k.time), 0);
}

/** Length of one forward play (without reverses/repeats). */
export function animationDuration(anim: Animation): number {
  return anim.tracks.reduce((m, t) => Math.max(m, trackDuration(t)), 0);
}

/** Length of a full play including the reverse leg. */
export function cycleDuration(anim: Animation): number {
  return animationDuration(anim) * (anim.reverses ? 2 : 1);
}

export function sampleTrack(track: AnimationTrack, time: number): PropValue | undefined {
  const ks = [...track.keyframes].sort((a, b) => a.time - b.time);
  if (!ks.length) return undefined;
  if (time <= ks[0].time) return ks[0].value;
  for (let i = 1; i < ks.length; i++) {
    const k0 = ks[i - 1];
    const k1 = ks[i];
    if (time <= k1.time) {
      const span = k1.time - k0.time;
      const t = span <= 0 ? 1 : (time - k0.time) / span;
      return interpolate(k0.value, k1.value, ease(k1.easingStyle, k1.easingDirection, t));
    }
  }
  return ks[ks.length - 1].value;
}

/**
 * Sample all tracks at `time` (seconds since the animation started, may exceed
 * one cycle when repeating). Returns nodeId -> { prop: value }.
 */
export function sampleAnimation(anim: Animation, time: number): Map<string, Record<string, PropValue>> {
  const dur = animationDuration(anim);
  const cycle = cycleDuration(anim);
  let t = time;
  if (cycle > 0) {
    const plays = anim.repeat < 0 ? Infinity : anim.repeat + 1;
    const n = Math.floor(t / cycle);
    if (n >= plays) t = cycle; // finished: hold final state
    else t = t - n * cycle;
    if (anim.reverses && t > dur) t = Math.max(0, 2 * dur - t);
    if (n >= plays && anim.reverses) t = 0;
  }
  const out = new Map<string, Record<string, PropValue>>();
  for (const tr of anim.tracks) {
    const v = sampleTrack(tr, t);
    if (v === undefined) continue;
    const rec = out.get(tr.nodeId) ?? {};
    rec[tr.property] = v;
    out.set(tr.nodeId, rec);
  }
  return out;
}

/** Is the property animatable for this class? */
export function isTweenable(className: string, prop: string): boolean {
  return !!getPropDef(className, prop)?.tweenable;
}

export function totalPlayTime(anim: Animation): number {
  if (anim.repeat < 0) return Infinity;
  return cycleDuration(anim) * (anim.repeat + 1);
}
