/**
 * Browser text measurer for the layout engine, using canvas metrics of the
 * bundled web fonts. Roblox's line height is TextSize * LineHeight.
 */
import { cssFont } from "../../core/fonts";
import type { TextMeasurer } from "../../core/layout";

const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
const ctx = canvas?.getContext("2d") ?? null;
const cache = new Map<string, number>();

function width(text: string, font: string): number {
  const key = font + "\u0000" + text;
  let w = cache.get(key);
  if (w === undefined) {
    ctx!.font = font;
    w = ctx!.measureText(text).width;
    if (cache.size > 20000) cache.clear();
    cache.set(key, w);
  }
  return w;
}

export function stripRichText(s: string): string {
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export const browserMeasurer: TextMeasurer = {
  measure(text, font, size, wrapWidth, lineHeight) {
    if (!ctx) return { w: text.length * size * 0.5, h: size * lineHeight };
    const f = cssFont(font);
    const fontStr = `${f.style} ${f.weight} ${size}px ${f.family}`;
    const plain = stripRichText(text);
    let lines = 0;
    let maxW = 0;
    for (const para of plain.split("\n")) {
      if (wrapWidth === null || wrapWidth <= 0) {
        maxW = Math.max(maxW, width(para, fontStr));
        lines++;
        continue;
      }
      const words = para.split(/(\s+)/);
      let cur = "";
      let n = 0;
      for (const word of words) {
        const next = cur + word;
        if (cur && width(next.trimEnd(), fontStr) > wrapWidth + 0.5) {
          maxW = Math.max(maxW, width(cur.trimEnd(), fontStr));
          n++;
          cur = word.trimStart();
        } else cur = next;
      }
      maxW = Math.max(maxW, width(cur.trimEnd(), fontStr));
      lines += n + 1;
    }
    return { w: Math.ceil(maxW), h: lines * size * lineHeight };
  },
};

export function clearMeasureCache() {
  cache.clear();
}
