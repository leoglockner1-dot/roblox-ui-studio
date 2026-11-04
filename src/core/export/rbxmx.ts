/**
 * Roblox XML model (.rbxmx) writer.
 *
 * Roblox Studio imports .rbxmx via right-click > "Insert from File…", which
 * creates real instances without running any code. We write:
 *   - GUI models (the ScreenGui/frames as instances), and
 *   - a code package (Folder of ModuleScripts produced by the Luau exporter).
 */
import { FONT_WEIGHTS, fontAssetUrl } from "../fonts";
import { ENUMS, HUGE } from "../classes";
import { hexToRgb } from "../schema";
import type { ColorStop, FontFace, NumberStop, Rect2D, UDim, UDim2, Vector2 } from "../types";
import type { IRInstance, IRProp } from "./ir";
import type { ExportFile } from "./luau";

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const f = (n: number) => (n >= HUGE ? "INF" : n <= -HUGE ? "-INF" : String(Math.round(n * 1e6) / 1e6));

export function xmlProp(p: Pick<IRProp, "name" | "def" | "value">): string {
  const name = xmlEscape(p.name);
  const v = p.value;
  switch (p.def.type) {
    case "number":
      return `<float name="${name}">${f(v as number)}</float>`;
    case "int":
      return `<int name="${name}">${Math.round(v as number)}</int>`;
    case "bool":
      return `<bool name="${name}">${v ? "true" : "false"}</bool>`;
    case "string":
      return `<string name="${name}">${xmlEscape(v as string)}</string>`;
    case "content":
      return v ? `<Content name="${name}"><url>${xmlEscape(v as string)}</url></Content>` : `<Content name="${name}"><null></null></Content>`;
    case "color": {
      const [r, g, b] = hexToRgb(v as string);
      return `<Color3 name="${name}"><R>${f(r / 255)}</R><G>${f(g / 255)}</G><B>${f(b / 255)}</B></Color3>`;
    }
    case "udim": {
      const u = v as UDim;
      return `<UDim name="${name}"><S>${f(u.s)}</S><O>${Math.round(u.o)}</O></UDim>`;
    }
    case "udim2": {
      const u = v as UDim2;
      return `<UDim2 name="${name}"><XS>${f(u.xs)}</XS><XO>${Math.round(u.xo)}</XO><YS>${f(u.ys)}</YS><YO>${Math.round(u.yo)}</YO></UDim2>`;
    }
    case "vector2": {
      const u = v as Vector2;
      return `<Vector2 name="${name}"><X>${f(u.x)}</X><Y>${f(u.y)}</Y></Vector2>`;
    }
    case "enum":
      return `<token name="${name}">${ENUMS[p.def.enumName!][v as string]}</token>`;
    case "font": {
      const ff = v as FontFace;
      return `<Font name="${name}"><Family><url>${xmlEscape(fontAssetUrl(ff.family))}</url></Family><Weight>${FONT_WEIGHTS[ff.weight]}</Weight><Style>${ff.style}</Style></Font>`;
    }
    case "rect": {
      const r = v as Rect2D;
      return `<Rect2D name="${name}"><min><X>${f(r.minX)}</X><Y>${f(r.minY)}</Y></min><max><X>${f(r.maxX)}</X><Y>${f(r.maxY)}</Y></max></Rect2D>`;
    }
    case "colorSeq": {
      const s = (v as ColorStop[]).map((k) => {
        const [r, g, b] = hexToRgb(k.color);
        return `${f(k.t)} ${f(r / 255)} ${f(g / 255)} ${f(b / 255)} 0 `;
      });
      return `<ColorSequence name="${name}">${s.join("")}</ColorSequence>`;
    }
    case "numberSeq": {
      const s = (v as NumberStop[]).map((k) => `${f(k.t)} ${f(k.value)} 0 `);
      return `<NumberSequence name="${name}">${s.join("")}</NumberSequence>`;
    }
  }
}

class Referents {
  private n = 0;
  next() {
    return `RBX${(this.n++).toString(16).toUpperCase().padStart(8, "0")}`;
  }
}

function writeInstance(ir: IRInstance, refs: Referents, depth: number, out: string[]) {
  const pad = "\t".repeat(depth);
  out.push(`${pad}<Item class="${xmlEscape(ir.className)}" referent="${refs.next()}">`);
  out.push(`${pad}\t<Properties>`);
  out.push(`${pad}\t\t<string name="Name">${xmlEscape(ir.name)}</string>`);
  for (const p of ir.props) out.push(`${pad}\t\t${xmlProp(p)}`);
  out.push(`${pad}\t</Properties>`);
  for (const c of ir.children) writeInstance(c, refs, depth + 1, out);
  out.push(`${pad}</Item>`);
}

const HEADER =
  '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">';

/** rbxmx for one or more GUI instance trees. */
export function writeModel(roots: IRInstance[]): string {
  const refs = new Referents();
  const out: string[] = [HEADER];
  for (const r of roots) writeInstance(r, refs, 1, out);
  out.push("</roblox>");
  return out.join("\n") + "\n";
}

function cdata(s: string): string {
  return `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

/**
 * rbxmx for a code package: a Folder named `packageName` containing Folders
 * and ModuleScripts mirroring the file paths ("Components/Card.luau" -> Folder
 * Components > ModuleScript Card).
 */
export function writeCodePackage(packageName: string, files: ExportFile[]): string {
  interface Dir {
    folders: Map<string, Dir>;
    scripts: { name: string; source: string; kind: ExportFile["kind"] }[];
  }
  const root: Dir = { folders: new Map(), scripts: [] };
  for (const file of files) {
    if (!file.path.endsWith(".luau")) continue;
    const parts = file.path.split("/");
    const name = parts.pop()!.replace(/\.luau$/, "");
    let dir = root;
    for (const p of parts) {
      if (!dir.folders.has(p)) dir.folders.set(p, { folders: new Map(), scripts: [] });
      dir = dir.folders.get(p)!;
    }
    dir.scripts.push({ name, source: file.content, kind: file.kind });
  }
  const refs = new Referents();
  const out: string[] = [HEADER];
  const writeDir = (name: string, dir: Dir, depth: number) => {
    const pad = "\t".repeat(depth);
    out.push(`${pad}<Item class="Folder" referent="${refs.next()}">`);
    out.push(`${pad}\t<Properties><string name="Name">${xmlEscape(name)}</string></Properties>`);
    for (const s of dir.scripts) {
      const cls = s.kind === "local" ? "LocalScript" : "ModuleScript";
      out.push(`${pad}\t<Item class="${cls}" referent="${refs.next()}">`);
      out.push(`${pad}\t\t<Properties>`);
      out.push(`${pad}\t\t\t<string name="Name">${xmlEscape(s.name)}</string>`);
      out.push(`${pad}\t\t\t<ProtectedString name="Source">${cdata(s.source)}</ProtectedString>`);
      out.push(`${pad}\t\t</Properties>`);
      out.push(`${pad}\t</Item>`);
    }
    for (const [n, d] of dir.folders) writeDir(n, d, depth + 1);
    out.push(`${pad}</Item>`);
  };
  writeDir(packageName, root, 1);
  out.push("</roblox>");
  return out.join("\n") + "\n";
}
