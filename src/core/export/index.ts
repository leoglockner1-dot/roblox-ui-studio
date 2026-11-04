/**
 * Export entry point: everything a user (or Claude) needs to take a design
 * into Roblox Studio.
 */
import type { AssetRecord, DesignDocument } from "../types";
import { buildIR, makeContext, type ExportDiagnostic } from "./ir";
import { exportLuau, exportSingleScript, type ExportFile } from "./luau";
import { writeCodePackage, writeModel } from "./rbxmx";
import { zip } from "./zip";

export interface ExportBundle {
  /** Luau modules (Rojo layout). */
  files: ExportFile[];
  /** rbxmx with GUI instances for each exported root. */
  guiModel: string;
  /** rbxmx with a Folder of ModuleScripts (the Luau modules). */
  codeModel: string;
  packageName: string;
  diagnostics: ExportDiagnostic[];
  screenModules: Record<string, string>;
  componentModules: Record<string, string>;
  /** Integration snippet for a LocalScript. */
  usage: string;
}

export interface ExportOptions {
  /** Top-level node ids to export (default: all non-master roots on all pages). */
  rootIds?: string[];
  /** Restrict components (default: all). */
  componentIds?: string[];
}

export function exportDocument(doc: DesignDocument, assets: AssetRecord[] = [], opts: ExportOptions = {}): ExportBundle {
  const ctx = makeContext(doc, assets);
  const lua = exportLuau(ctx, opts);
  const roots = Object.keys(lua.screenModules)
    .map((id) => buildIR({ ...ctx, diagnostics: [] }, id))
    .filter((x): x is NonNullable<typeof x> => !!x);
  const guiModel = writeModel(roots);
  const codeModel = writeCodePackage(lua.packageName, lua.files);
  const first = Object.values(lua.screenModules)[0];
  const hasAnim = lua.files.some((f) => f.path === `Animations/${first}.luau`);
  const usage = first
    ? [
        `-- LocalScript (StarterPlayer > StarterPlayerScripts)`,
        `local ReplicatedStorage = game:GetService("ReplicatedStorage")`,
        `local Players = game:GetService("Players")`,
        `local UI = ReplicatedStorage:WaitForChild("${lua.packageName}")`,
        ``,
        `local gui = require(UI.Screens.${first}).create()`,
        `gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")`,
        ...(hasAnim ? [`require(UI.Animations.${first}).bind(gui)`] : []),
      ].join("\n")
    : "";
  // dedupe diagnostics
  const seen = new Set<string>();
  const diagnostics = ctx.diagnostics.filter((d) => {
    const k = `${d.severity}|${d.nodeId}|${d.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { files: lua.files, guiModel, codeModel, packageName: lua.packageName, diagnostics, screenModules: lua.screenModules, componentModules: lua.componentModules, usage };
}

export function exportZip(bundle: ExportBundle, readme?: string): Uint8Array {
  return zip([
    ...bundle.files.map((f) => ({ path: `${bundle.packageName}/${f.path}`, content: f.content })),
    { path: `${bundle.packageName}.gui.rbxmx`, content: bundle.guiModel },
    { path: `${bundle.packageName}.code.rbxmx`, content: bundle.codeModel },
    { path: "README.txt", content: readme ?? IMPORT_README(bundle) },
  ]);
}

export const IMPORT_README = (b: ExportBundle) => `Roblox UI Studio export — ${b.packageName}

Option A (instances, no code):
  In Roblox Studio, right-click StarterGui > Insert from File… and choose
  ${b.packageName}.gui.rbxmx. The ScreenGui(s) appear as editable instances.

Option B (code modules, recommended for games):
  1. Right-click ReplicatedStorage > Insert from File… and choose
     ${b.packageName}.code.rbxmx (a Folder of ModuleScripts), or sync the
     ${b.packageName}/ folder with Rojo.
  2. Add a LocalScript to StarterPlayer > StarterPlayerScripts:

${b.usage.split("\n").map((l) => "     " + l).join("\n")}

Images: local images must be uploaded to Roblox (Asset Manager / Creator Hub)
and their asset ids entered in Roblox UI Studio's Assets panel before export.
`;

export { exportSingleScript, makeContext };
export type { ExportFile };
