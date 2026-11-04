/**
 * Roblox font families and their closest bundled web equivalent.
 *
 * Roblox's FontFace refers to `rbxasset://fonts/families/<Family>.json`.
 * Many Roblox fonts are open fonts that we bundle (exact match); a few
 * proprietary ones (Gotham, Builder Sans) are approximated — see
 * ROBLOX_PREVIEW.md for the documented differences.
 */
import type { FontFace, FontWeight } from "./types";

export interface FontFamilyInfo {
  family: string; // Roblox family name
  label: string;
  web: string; // CSS font-family
  exact: boolean; // true if the bundled web font is the same typeface
  category: "sans" | "display" | "mono" | "fun";
}

export const FONT_FAMILIES: FontFamilyInfo[] = [
  { family: "BuilderSans", label: "Builder Sans", web: "Inter", exact: false, category: "sans" },
  { family: "GothamSSm", label: "Gotham SSm", web: "Montserrat", exact: false, category: "sans" },
  { family: "SourceSansPro", label: "Source Sans Pro", web: "'Source Sans 3'", exact: true, category: "sans" },
  { family: "Roboto", label: "Roboto", web: "Roboto", exact: true, category: "sans" },
  { family: "Ubuntu", label: "Ubuntu", web: "Ubuntu", exact: true, category: "sans" },
  { family: "Arimo", label: "Arimo", web: "Arimo", exact: true, category: "sans" },
  { family: "Arial", label: "Arial", web: "Arimo", exact: false, category: "sans" },
  { family: "Nunito", label: "Nunito", web: "Nunito", exact: true, category: "sans" },
  { family: "TitilliumWeb", label: "Titillium Web", web: "'Titillium Web'", exact: true, category: "sans" },
  { family: "Oswald", label: "Oswald", web: "Oswald", exact: true, category: "display" },
  { family: "Michroma", label: "Michroma", web: "Michroma", exact: true, category: "display" },
  { family: "FredokaOne", label: "Fredoka One", web: "Fredoka", exact: true, category: "fun" },
  { family: "LuckiestGuy", label: "Luckiest Guy", web: "'Luckiest Guy'", exact: true, category: "fun" },
  { family: "Bangers", label: "Bangers", web: "Bangers", exact: true, category: "fun" },
  { family: "PermanentMarker", label: "Permanent Marker", web: "'Permanent Marker'", exact: true, category: "fun" },
  { family: "PressStart2P", label: "Press Start 2P", web: "'Press Start 2P'", exact: true, category: "fun" },
  { family: "RobotoMono", label: "Roboto Mono", web: "'Roboto Mono'", exact: true, category: "mono" },
];

const byFamily = new Map(FONT_FAMILIES.map((f) => [f.family, f]));

export const FONT_WEIGHTS: Record<FontWeight, number> = {
  Thin: 100,
  ExtraLight: 200,
  Light: 300,
  Regular: 400,
  Medium: 500,
  SemiBold: 600,
  Bold: 700,
  ExtraBold: 800,
  Heavy: 900,
};
export const WEIGHT_NAMES = Object.keys(FONT_WEIGHTS) as FontWeight[];

export function fontInfo(family: string): FontFamilyInfo | undefined {
  return byFamily.get(family);
}

export function fontAssetUrl(family: string): string {
  return `rbxasset://fonts/families/${family}.json`;
}

/** CSS font shorthand pieces for the preview renderer. */
export function cssFont(font: FontFace): { family: string; weight: number; style: string } {
  const info = byFamily.get(font.family);
  // Fredoka One only exists in one (heavy) weight in Roblox; mimic that.
  const weight = font.family === "FredokaOne" ? 600 : FONT_WEIGHTS[font.weight] ?? 400;
  return {
    family: `${info?.web ?? "Inter"}, Inter, system-ui, sans-serif`,
    weight,
    style: font.style === "Italic" ? "italic" : "normal",
  };
}
