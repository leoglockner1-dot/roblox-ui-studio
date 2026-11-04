import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../../src/server/store";
import { runTool, TOOLS, type ToolContext } from "../../src/server/tools";
import { checkLuau } from "./luauCheck";

let dir: string;
let ctx: ToolContext;
const call = async (name: string, input: Record<string, unknown> = {}) => {
  const r = await runTool(name, input, ctx);
  if (r.ok === false) throw new Error(`${name} failed: ${r.error} ${r.hint ?? ""}`);
  return r as Record<string, any>;
};

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ruis-"));
  ctx = { store: new Store(dir), source: "mcp" };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("tool registry", () => {
  it("every tool has a description and unique name", () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) expect(t.description.length).toBeGreaterThan(20);
  });

  it("reports invalid input and unknown tools cleanly", async () => {
    expect(await runTool("nope", {}, ctx)).toMatchObject({ ok: false });
    const r = await runTool("create_document", { name: 5 }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid input.*name/);
  });
});

describe("Claude workflow: build a shop", () => {
  let docId: string;

  it("creates a document with a screen", async () => {
    const r = await call("create_document", { name: "Shop", device: "desktop-1080p" });
    docId = r.document.id;
    expect(r.document.pages[0].roots[0].className).toBe("ScreenGui");
  });

  it("sets tokens and builds a panel with nested specs", async () => {
    await call("set_design_tokens", { documentId: docId, colors: [{ name: "Primary", value: "#7C5CFF" }, { name: "Gold", value: "#FFD54A" }] });
    const r = await call("create_element", {
      documentId: docId,
      parentId: "MainScreen",
      spec: {
        className: "Frame", name: "ShopPanel",
        props: { Size: [0.7, 0, 0.75, 0], Position: [0.5, 0, 0.5, 0], AnchorPoint: [0.5, 0.5], BackgroundColor3: "#161A24" },
        corner: 20, padding: 24,
        children: [
          { className: "TextLabel", name: "Title", props: { Text: "SHOP", Size: [1, 0, 0, 48], TextSize: 36 }, tokens: { TextColor3: "Gold" } },
          { className: "ScrollingFrame", name: "Items", props: { Size: [1, 0, 1, -64], Position: [0, 0, 0, 64] }, grid: { CellSize: [0, 180, 0, 240], CellPadding: [0, 16, 0, 16] } },
        ],
      },
    });
    expect(r.ids.ShopPanel).toBeTruthy();
    expect(r.ids.Items).toBeTruthy();
  });

  it("rejects an invalid spec without changing anything", async () => {
    const before = (await call("inspect_design", { documentId: docId })).document.revision;
    const r = await runTool("create_element", { documentId: docId, parentId: "Items", spec: { className: "Frame", props: { Colour: "#fff" } } }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Frame has no property "Colour"/);
    expect((await call("inspect_design", { documentId: docId })).document.revision).toBe(before);
  });

  it("builds a card from a preset, makes it a component and fills the grid", async () => {
    const card = await call("create_element", { documentId: docId, preset: "shop-card", canvas: { x: 2100, y: 0 } });
    const comp = await call("create_component", { documentId: docId, nodeId: card.rootIds[0], name: "ShopCard" });
    for (const [i, title] of ["Sword", "Shield", "Potion"].entries()) {
      await call("insert_component", { documentId: docId, component: "ShopCard", parentId: "Items", name: `Card${i + 1}`, props: { LayoutOrder: i }, overrides: { Title: { Text: title } } });
    }
    const list = await call("list_components", { documentId: docId });
    expect(list.components[0]).toMatchObject({ id: comp.componentId, instances: 3 });
    expect(list.components[0].overridePaths).toContain("Title (TextLabel)");
  });

  it("edits inside an instance become overrides; editing the master propagates", async () => {
    await call("update_element", { documentId: docId, nodeId: "MainScreen/ShopPanel/Items/Card2/Subtitle", props: { Text: "Blocks 50%" } });
    await call("update_element", { documentId: docId, nodeId: "ShopCard", props: { BackgroundColor3: "#2A2140" } });
    const o = (await call("inspect_design", { documentId: docId, nodeId: "Card2" })).outline as string;
    expect(o).toContain('"Blocks 50%"');
    expect(o).toContain("BackgroundColor3=\"#2A2140\"");
    expect(o).toContain('Text="Shield"');
  });

  it("outline includes computed boxes", async () => {
    const o = (await call("inspect_design", { documentId: docId, nodeId: "MainScreen" })).outline as string;
    // ShopPanel: 0.7*1920=1344 wide, centred -> x=288
    expect(o).toMatch(/Frame "ShopPanel" \[n_\w+\].* → 288,135 1344×810/);
  });

  it("animation create + preview samples", async () => {
    const a = await call("create_animation", {
      documentId: docId, name: "Open", trigger: "onShow",
      tracks: [{ nodeId: "ShopPanel", property: "Position", keyframes: [{ time: 0, value: [0.5, 0, 0.6, 0] }, { time: 0.4, value: [0.5, 0, 0.5, 0], easingStyle: "Back" }] }],
    });
    const p = await call("preview_animation", { documentId: docId, animationId: a.animationId, times: [0, 0.4] });
    const panelId = Object.keys(p.samples[1].values)[0];
    expect(p.samples[1].values[panelId].Position).toEqual({ xs: 0.5, xo: 0, ys: 0.5, yo: 0 });
    const bad = await runTool("create_animation", { documentId: docId, name: "x", tracks: [{ nodeId: "ShopPanel", property: "Name", keyframes: [{ time: 0, value: "a" }] }] }, ctx);
    expect(bad.error).toMatch(/not tweenable/);
  });

  it("validates and exports valid Luau", async () => {
    const v = await call("validate_design", { documentId: docId });
    expect(v.errors).toBe(0);
    const e = await call("export_luau", { documentId: docId, outputDir: path.join(dir, "out") });
    const paths = e.files.map((f: { path: string }) => f.path);
    expect(paths).toContain("Components/ShopCard.luau");
    expect(paths).toContain("Animations/MainScreen.luau");
    for (const f of e.files) checkLuau(f.content);
    expect(e.written.some((p: string) => p.endsWith(".gui.rbxmx"))).toBe(true);
    const single = await call("export_luau", { documentId: docId, format: "single" });
    checkLuau(single.source);
  });

  it("undo reverts only this source's changes, redo re-applies", async () => {
    await ctx.store.applyOps(docId, [{ type: "setDoc", name: "Shop (user edit)" }], { source: "editor" });
    const u = await call("undo", { documentId: docId });
    expect(u.undone[0]).toMatch(/Create animation/);
    const d = await ctx.store.getDocument(docId);
    expect(Object.keys(d.animations)).toHaveLength(0);
    expect(d.name).toBe("Shop (user edit)");
    await call("redo", { documentId: docId });
    expect(Object.keys((await ctx.store.getDocument(docId)).animations)).toHaveLength(1);
  });

  it("variants and swap", async () => {
    const v = await call("create_component_variant", { documentId: docId, component: "ShopCard", values: { State: "Sold" }, props: { BackgroundTransparency: 0.5 } });
    const s = await call("swap_component", { documentId: docId, instanceId: "Card1", component: v.componentId });
    expect(s.keptOverrides).toBe(1);
    const list = await call("list_components", { documentId: docId });
    expect(list.components.map((c: { variantOf?: { setName: string } }) => c.variantOf?.setName)).toEqual(["ShopCard", "ShopCard"]);
  });

  it("group / ungroup keep on-screen positions", async () => {
    const r = await call("create_element", {
      documentId: docId, parentId: "MainScreen",
      specs: [
        { className: "Frame", name: "G1", props: { Position: [0, 100, 0, 100], Size: [0, 50, 0, 50] } },
        { className: "Frame", name: "G2", props: { Position: [0, 200, 0, 150], Size: [0, 50, 0, 50] } },
      ],
    });
    const g = await call("group_elements", { documentId: docId, nodeIds: [r.ids.G1, r.ids.G2], name: "Pair" });
    let o = (await call("inspect_design", { documentId: docId, nodeId: g.groupId })).outline as string;
    expect(o).toMatch(/Frame "Pair".* → 100,100 150×100/);
    expect(o).toMatch(/Frame "G2".* → 200,150 50×50/);
    await call("ungroup_element", { documentId: docId, nodeId: g.groupId });
    o = (await call("inspect_design", { documentId: docId, nodeId: "MainScreen" })).outline as string;
    expect(o).toMatch(/Frame "G2".* → 200,150 50×50/);
    expect(o).not.toContain("Pair");
  });

  it("variation duplicates a screen with its animations", async () => {
    const r = await call("create_variation", { documentId: docId, rootId: "MainScreen", name: "MainScreen B" });
    const d = await ctx.store.getDocument(docId);
    expect(d.nodes[r.rootId].canvas!.x).toBeGreaterThan(1920);
    expect(Object.values(d.animations).some((a) => a.name === "Open (MainScreen B)")).toBe(true);
  });

  it("assets: import, reference, set Roblox id, view", async () => {
    // 1x1 PNG
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const file = path.join(dir, "coin.png");
    writeFileSync(file, png);
    const a = await call("import_asset", { path: file, folder: "Icons/Currency" });
    expect(a.asset).toMatchObject({ width: 1, height: 1, mime: "image/png", folder: "Icons/Currency" });
    await call("update_element", { documentId: docId, nodeId: "ShopCard/Art/Icon", props: { Image: a.imageValue } });
    let v = await call("validate_design", { documentId: docId });
    expect(v.issues.some((i: { code: string }) => i.code === "asset-not-uploaded")).toBe(true);
    await call("update_asset", { assetId: a.asset.id, robloxAssetId: "rbxassetid://987654321" });
    v = await call("validate_design", { documentId: docId });
    expect(v.issues.some((i: { code: string }) => i.code === "asset-not-uploaded")).toBe(false);
    const e = await call("export_component", { documentId: docId, component: "ShopCard" });
    expect(e.files[0].content).toContain("rbxassetid://987654321");
    const view = await runTool("view_asset", { assetId: a.asset.id }, ctx);
    expect(view._images![0].mimeType).toBe("image/png");
    const s = await call("list_assets", { search: "coin" });
    expect(s.count).toBe(1);
    const bad = await runTool("import_asset", { base64: Buffer.from("hello").toString("base64"), name: "x.txt" }, ctx);
    expect(bad.error).toMatch(/unsupported image/);
  });

  it("find + delete + history", async () => {
    const f = await call("find_elements", { documentId: docId, text: "shield" });
    expect(f.count).toBeGreaterThan(0);
    await call("delete_element", { documentId: docId, nodeIds: ["MainScreen/G1", "MainScreen/G2"] });
    const h = await call("get_history", { documentId: docId, limit: 3 });
    expect(h.undo[0].label).toBe("Delete 2");
    expect(h.undo[0].source).toBe("mcp");
  });
});

describe("store concurrency", () => {
  it("serializes concurrent writers without losing updates", async () => {
    const r = await call("create_document", { name: "Race" });
    const id = r.document.id;
    const screen = r.document.pages[0].roots[0].id;
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => runTool("create_element", { documentId: id, parentId: screen, spec: { className: "Frame", name: `F${i}` } }, ctx)),
    );
    const d = await ctx.store.getDocument(id);
    expect(d.nodes[screen].children).toHaveLength(20);
    expect(d.revision).toBe(21);
  });
});
