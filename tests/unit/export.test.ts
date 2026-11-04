import { describe, expect, it } from "vitest";
import { newId } from "../../src/core/document";
import { exportDocument, exportSingleScript, makeContext, exportZip } from "../../src/core/export";
import { luauValue } from "../../src/core/export/luau";
import { getPropDef } from "../../src/core/classes";
import { applyOps } from "../../src/core/ops";
import { validateDocument } from "../../src/core/validate";
import type { Animation, AssetRecord } from "../../src/core/types";
import { checkLuau, parseXml, tokenize, type XmlNode } from "./luauCheck";
import { byName, docWithScreen, insertSpec } from "./helpers";

function shopDoc() {
  const { doc, screenId } = docWithScreen();
  // Component: ItemCard (master on the canvas, not inside the screen)
  let r = insertSpec(doc, {
    className: "Frame", name: "ItemCard", props: { Size: [0, 120, 0, 150], BackgroundColor3: "#252B3A" }, corner: 12,
    stroke: { Color: "#FFFFFF", Thickness: 2, Transparency: 0.8 },
    children: [
      { className: "ImageLabel", name: "Icon", props: { Size: [1, -20, 0, 90], Position: [0, 10, 0, 10], Image: "asset://a_sword" } },
      { className: "TextLabel", name: "Title", props: { Text: 'Iron "Sword"', Position: [0, 0, 1, -40], Size: [1, 0, 0, 30], TextScaled: true }, textSizeConstraint: { MaxTextSize: 20 } },
    ],
  }, null);
  const masterId = r.id;
  const compId = newId("cmp");
  let d = applyOps(r.doc, [
    { type: "setComponent", id: compId, def: { id: compId, name: "Item Card", rootId: masterId, createdAt: "" } },
    { type: "update", id: masterId, fields: { componentId: compId } },
  ]).doc;
  r = insertSpec(d, {
    className: "Frame", name: "MainFrame",
    props: { Size: [0.6, 0, 0.7, 0], Position: [0.5, 0, 0.5, 0], AnchorPoint: [0.5, 0.5], BackgroundColor3: "#1B1F2A" },
    corner: 16, padding: 16,
    children: [
      { className: "TextLabel", name: "Header", props: { Text: "SHOP", Size: [1, 0, 0, 48], TextSize: 32, FontFace: { family: "LuckiestGuy", weight: "Regular", style: "Normal" } } },
      {
        className: "ScrollingFrame", name: "Grid", props: { Size: [1, 0, 1, -60], Position: [0, 0, 0, 60] },
        grid: { CellSize: [0, 120, 0, 150], CellPadding: [0, 12, 0, 12] },
        children: [
          { className: "Frame", component: compId, name: "Slot1" },
          { className: "Frame", component: compId, name: "Slot2", overrides: { Title: { Text: "Bow" } }, props: { LayoutOrder: 2 } },
        ],
      },
      { className: "TextButton", name: "Close", props: { Text: "X", Size: [0, 40, 0, 40], Position: [1, 0, 0, 0], AnchorPoint: [1, 0], BackgroundColor3: "#FF5A5F" }, corner: { CornerRadius: { s: 1, o: 0 } }, gradient: ["#FF7A7F", "#E04045"] },
    ],
  }, screenId);
  d = r.doc;
  const anim: Animation = {
    id: "an_open", name: "Open", trigger: "onShow", repeat: 0, reverses: false,
    tracks: [
      { id: "t1", nodeId: byName(d, "MainFrame").id, property: "Position", keyframes: [
        { time: 0, value: { xs: 0.5, xo: 0, ys: 0.6, yo: 0 }, easingStyle: "Linear", easingDirection: "Out" },
        { time: 0.4, value: { xs: 0.5, xo: 0, ys: 0.5, yo: 0 }, easingStyle: "Back", easingDirection: "Out" },
      ] },
      { id: "t2", nodeId: byName(d, "MainFrame").id, property: "BackgroundTransparency", keyframes: [
        { time: 0, value: 1, easingStyle: "Linear", easingDirection: "Out" },
        { time: 0.3, value: 0, easingStyle: "Quad", easingDirection: "Out" },
      ] },
    ],
  };
  d = applyOps(d, [{ type: "setAnimation", id: anim.id, anim }]).doc;
  const assets: AssetRecord[] = [{ id: "a_sword", name: "sword.png", folder: "", mime: "image/png", fileName: "a_sword.png", bytes: 10, tags: [], createdAt: "", robloxAssetId: "1234567" }];
  return { doc: d, screenId, compId, assets };
}

describe("luau checker sanity", () => {
  it("accepts valid code and rejects broken blocks", () => {
    expect(() => checkLuau("local x = if a then 1 else 2\nfor i = 1, 3 do print(i) end\nwhile x do x = nil end")).not.toThrow();
    expect(() => checkLuau("function f()\nif a then\nend")).toThrow(/unclosed/);
    expect(() => checkLuau("local t = { a = (1 }")).toThrow(/unbalanced/);
    expect(() => checkLuau('local s = "abc')).toThrow(/unterminated/);
  });
});

describe("Luau export", () => {
  it("produces modular, syntactically valid files", () => {
    const { doc, assets } = shopDoc();
    const b = exportDocument(doc, assets);
    const paths = b.files.map((f) => f.path).sort();
    expect(paths).toEqual(["Animations/Screen.luau", "Components/ItemCard.luau", "Screens/Screen.luau", "Theme.luau", "Util.luau"]);
    for (const f of b.files) {
      try {
        checkLuau(f.content);
      } catch (e) {
        throw new Error(`${f.path}: ${(e as Error).message}\n${f.content}`);
      }
    }
  });

  it("screen code uses the component module with diffs only", () => {
    const { doc, assets } = shopDoc();
    const b = exportDocument(doc, assets);
    const screen = b.files.find((f) => f.path === "Screens/Screen.luau")!.content;
    expect(screen).toContain("local ItemCard = require(script.Parent.Parent.Components.ItemCard)");
    expect(screen).toMatch(/Util\.instance\(ItemCard, \{\n\s+Name = "Slot1",\n\s+\}\)/);
    expect(screen).toMatch(/\["Title"\] = \{\n\s+Text = "Bow",/);
    expect(screen).toContain("LayoutOrder = 2");
    expect(screen).toContain('make("UIGridLayout"');
    expect(screen).toContain("AnchorPoint = Vector2.new(0.5, 0.5)");
    expect(screen).toContain("Size = UDim2.fromScale(0.6, 0.7)");
    expect(screen).toContain('FontFace = Font.new("rbxasset://fonts/families/LuckiestGuy.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)');
    expect(screen).toContain("ColorSequence.new({ ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 122, 127)), ColorSequenceKeypoint.new(1, Color3.fromRGB(224, 64, 69)) })");
    // never emits design-only props
    expect(screen).not.toContain("_CurrentPage");
  });

  it("component module builds the master; strings are escaped; assets resolved", () => {
    const { doc, assets } = shopDoc();
    const b = exportDocument(doc, assets);
    const comp = b.files.find((f) => f.path === "Components/ItemCard.luau")!.content;
    expect(comp).toContain("function ItemCard.create(): Frame");
    expect(comp).toContain('Text = "Iron \\"Sword\\"",');
    expect(comp).toContain('Image = "rbxassetid://1234567"');
    expect(comp).toContain('make("UITextSizeConstraint", {');
    expect(b.diagnostics).toEqual([]);
  });

  it("warns about local assets without a Roblox id and exports them empty", () => {
    const { doc, assets } = shopDoc();
    const b = exportDocument(doc, [{ ...assets[0], robloxAssetId: undefined }]);
    expect(b.diagnostics.some((d) => d.severity === "warning" && /no Roblox asset id/.test(d.message))).toBe(true);
    expect(b.files.find((f) => f.path === "Components/ItemCard.luau")!.content).not.toContain("asset://a_sword");
  });

  it("animation module uses TweenService track data and binds onShow", () => {
    const { doc, assets } = shopDoc();
    const b = exportDocument(doc, assets);
    const a = b.files.find((f) => f.path === "Animations/Screen.luau")!.content;
    expect(a).toContain('target = Util.find(gui, "MainFrame")');
    expect(a).toContain("{ time = 0.4, value = UDim2.fromScale(0.5, 0.5), style = Enum.EasingStyle.Back, direction = Enum.EasingDirection.Out }");
    expect(a).toContain("function Animations.bind(gui: Instance)\n\tAnimations.Open(gui)");
  });

  it("single-script export is valid Luau and self-contained", () => {
    const { doc, screenId, assets } = shopDoc();
    const src = exportSingleScript(makeContext(doc, assets), screenId);
    checkLuau(src);
    expect(src).not.toMatch(/require\(/);
    expect(src).toContain("function ItemCard.create(): Frame");
    expect(src).toContain('gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")');
    expect(src).toContain("Animations.bind(gui)");
    // every identifier used as `X.create` is defined
    const toks = tokenize(src).map((t) => t.v);
    expect(toks.filter((t) => t === "ItemCard").length).toBeGreaterThan(2);
  });

  it("value formatting covers every property type", () => {
    const cases: [string, string, unknown, string][] = [
      ["UISizeConstraint", "MaxSize", { x: 1e9, y: 200 }, "Vector2.new(math.huge, 200)"],
      ["UICorner", "CornerRadius", { s: 0, o: 8.6 }, "UDim.new(0, 9)"],
      ["Frame", "BackgroundColor3", "#0A0B0C", "Color3.fromRGB(10, 11, 12)"],
      ["ImageLabel", "ScaleType", "Slice", "Enum.ScaleType.Slice"],
      ["ImageLabel", "SliceCenter", { minX: 1, minY: 2, maxX: 3, maxY: 4 }, "Rect.new(1, 2, 3, 4)"],
      ["UIGradient", "Transparency", [{ t: 0, value: 0 }, { t: 1, value: 1 }], "NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(1, 1) })"],
      ["Frame", "Position", { xs: 0.25, xo: 10, ys: 0, yo: -5 }, "UDim2.new(0.25, 10, 0, -5)"],
    ];
    for (const [cls, prop, value, expected] of cases) expect(luauValue({ def: getPropDef(cls, prop)!, value: value as never })).toBe(expected);
  });
});

describe("rbxmx export", () => {
  const items = (n: XmlNode): XmlNode[] => n.children.filter((c) => c.tag === "Item");
  const propsOf = (n: XmlNode) => n.children.find((c) => c.tag === "Properties")!.children;
  const nameOf = (n: XmlNode) => propsOf(n).find((p) => p.attrs.name === "Name")!.text;

  it("GUI model is well-formed and mirrors the hierarchy with expanded instances", () => {
    const { doc, assets } = shopDoc();
    const b = exportDocument(doc, assets);
    const x = parseXml(b.guiModel);
    const roblox = x.children[0];
    expect(roblox.tag).toBe("roblox");
    expect(roblox.attrs.version).toBe("4");
    const [screen] = items(roblox);
    expect(screen.attrs.class).toBe("ScreenGui");
    const main = items(screen)[0];
    expect(nameOf(main)).toBe("MainFrame");
    const grid = items(main).find((i) => nameOf(i) === "Grid")!;
    const slots = items(grid).filter((i) => i.attrs.class === "Frame");
    expect(slots.map(nameOf)).toEqual(["Slot1", "Slot2"]);
    const title2 = items(slots[1]).find((i) => nameOf(i) === "Title")!;
    expect(propsOf(title2).find((p) => p.attrs.name === "Text")!.text).toBe("Bow");
    // typed values
    const anchor = propsOf(main).find((p) => p.attrs.name === "AnchorPoint")!;
    expect(anchor.tag).toBe("Vector2");
    const font = propsOf(items(main).find((i) => nameOf(i) === "Header")!).find((p) => p.attrs.name === "FontFace")!;
    expect(font.children.map((c) => c.tag)).toEqual(["Family", "Weight", "Style"]);
    // referents are unique
    const refs: string[] = [];
    const walk = (n: XmlNode) => {
      if (n.attrs.referent) refs.push(n.attrs.referent);
      n.children.forEach(walk);
    };
    walk(roblox);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("code package contains ModuleScripts with the exact Luau source", () => {
    const { doc, assets } = shopDoc();
    const b = exportDocument(doc, assets);
    const x = parseXml(b.codeModel).children[0];
    const pkg = items(x)[0];
    expect(pkg.attrs.class).toBe("Folder");
    const util = items(pkg).find((i) => nameOf(i) === "Util")!;
    expect(util.attrs.class).toBe("ModuleScript");
    const src = propsOf(util).find((p) => p.attrs.name === "Source")!.text;
    expect(src).toBe(b.files.find((f) => f.path === "Util.luau")!.content);
    const folders = items(pkg).filter((i) => i.attrs.class === "Folder").map(nameOf).sort();
    expect(folders).toEqual(["Animations", "Components", "Screens"]);
  });

  it("zip contains every file", () => {
    const { doc, assets } = shopDoc();
    const z = exportZip(exportDocument(doc, assets));
    const text = new TextDecoder().decode(z);
    expect(text).toContain("Components/ItemCard.luau");
    expect(text).toContain(".gui.rbxmx");
    expect(z[0]).toBe(0x50);
  });
});

describe("validation", () => {
  it("clean design has no errors", () => {
    const { doc, assets } = shopDoc();
    const issues = validateDocument(doc, assets);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("flags low contrast, off-screen, broken animations", () => {
    const { doc, screenId } = docWithScreen();
    let r = insertSpec(doc, { className: "Frame", name: "Bg", props: { Size: [0, 300, 0, 300], BackgroundColor3: "#FFFFFF" }, children: [{ className: "TextLabel", name: "Faint", props: { Text: "hi", TextColor3: "#EEEEEE" } }] }, screenId);
    r = insertSpec(r.doc, { className: "Frame", name: "Away", props: { Position: [0, 5000, 0, 0] } }, screenId);
    const d = applyOps(r.doc, [{ type: "setAnimation", id: "a1", anim: { id: "a1", name: "Bad", trigger: "manual", repeat: 0, reverses: false, tracks: [{ id: "t", nodeId: "nope", property: "Position", keyframes: [] }] } }]).doc;
    const codes = validateDocument(d).map((i) => i.code);
    expect(codes).toContain("low-contrast");
    expect(codes).toContain("off-screen");
    expect(codes).toContain("animation-missing-node");
  });
});
