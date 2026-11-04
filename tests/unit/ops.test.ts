import { describe, expect, it } from "vitest";
import { resolveTree, findResolved, newId } from "../../src/core/document";
import { applyOps, OpError, type Op } from "../../src/core/ops";
import { buildNodes, toSpec } from "../../src/core/spec";
import { byName, docWithScreen, insertSpec } from "./helpers";

describe("ops", () => {
  it("insert + inverse restores the document", () => {
    const { doc, screenId } = docWithScreen();
    const r = insertSpec(doc, { className: "Frame", name: "Panel", corner: 8, children: [{ className: "TextLabel", name: "Title" }] }, screenId);
    expect(Object.keys(r.doc.nodes)).toHaveLength(4); // screen, panel, corner, title
    expect(r.doc.nodes[screenId].children).toContain(r.id);
    const undone = applyOps(r.doc, r.inverse).doc;
    expect(undone.nodes).toEqual(doc.nodes);
    expect(undone.pages).toEqual(doc.pages);
  });

  it("does not mutate the input document", () => {
    const { doc, screenId } = docWithScreen();
    const before = structuredClone(doc);
    insertSpec(doc, { className: "Frame" }, screenId);
    expect(doc).toEqual(before);
  });

  it("update + inverse round-trips props and fields", () => {
    const { doc, screenId } = docWithScreen();
    const r = insertSpec(doc, { className: "Frame", name: "A", props: { BackgroundTransparency: 0.5 } }, screenId);
    const u = applyOps(r.doc, [
      { type: "update", id: r.id, props: { BackgroundTransparency: 0.2, Rotation: 15, Size: [0.5, 0, 0, 40] as never }, fields: { name: "B", locked: true } },
    ]);
    const n = u.doc.nodes[r.id];
    expect(n.name).toBe("B");
    expect(n.locked).toBe(true);
    expect(n.props.Size).toEqual({ xs: 0.5, xo: 0, ys: 0, yo: 40 });
    const back = applyOps(u.doc, u.inverse).doc.nodes[r.id];
    expect(back).toEqual(r.doc.nodes[r.id]);
  });

  it("rejects invalid props atomically with a clear error", () => {
    const { doc, screenId } = docWithScreen();
    const r = insertSpec(doc, { className: "Frame" }, screenId);
    const bad: Op[] = [
      { type: "update", id: r.id, props: { Rotation: 10 } },
      { type: "update", id: r.id, props: { TextSize: 12 } },
    ];
    expect(() => applyOps(r.doc, bad)).toThrow(OpError);
    expect(() => applyOps(r.doc, bad)).toThrow(/op #1.*Frame has no property "TextSize"/);
    expect(r.doc.nodes[r.id].props.Rotation).toBeUndefined();
  });

  it("enforces parenting rules", () => {
    const { doc, screenId } = docWithScreen();
    expect(() => insertSpec(doc, { className: "UICorner" }, screenId)).toThrow(/UICorner cannot be a child of ScreenGui/);
    expect(() => insertSpec(doc, { className: "TextLabel", children: [{ className: "Frame" }] }, null)).not.toThrow();
    expect(() => insertSpec(doc, { className: "UICorner" }, null)).toThrow(/must be inside a GUI object/);
  });

  it("move + inverse, and prevents cycles", () => {
    const { doc, screenId } = docWithScreen();
    let r = insertSpec(doc, { className: "Frame", name: "Outer", children: [{ className: "Frame", name: "Inner" }] }, screenId);
    const inner = byName(r.doc, "Inner").id;
    expect(() => applyOps(r.doc, [{ type: "move", id: r.id, parentId: inner }])).toThrow(/into itself/);
    const m = applyOps(r.doc, [{ type: "move", id: inner, parentId: screenId, index: 0 }]);
    expect(m.doc.nodes[screenId].children[0]).toBe(inner);
    expect(m.doc.nodes[inner].parent).toBe(screenId);
    const back = applyOps(m.doc, m.inverse).doc;
    expect(back.nodes[inner].parent).toBe(r.id);
    expect(back.nodes[screenId].children).toEqual(r.doc.nodes[screenId].children);
  });

  it("remove restores whole subtrees at the same index", () => {
    const { doc, screenId } = docWithScreen();
    let r = insertSpec(doc, { className: "Frame", name: "A" }, screenId);
    r = insertSpec(r.doc, { className: "Frame", name: "B", corner: 4, children: [{ className: "TextLabel" }] }, screenId);
    r = insertSpec(r.doc, { className: "Frame", name: "C" }, screenId);
    const b = byName(r.doc, "B").id;
    const del = applyOps(r.doc, [{ type: "remove", id: b }]);
    expect(Object.keys(del.doc.nodes)).toHaveLength(3); // screen, A, C
    const back = applyOps(del.doc, del.inverse).doc;
    expect(back.nodes).toEqual(r.doc.nodes);
  });

  it("pages: add, rename, remove (with nodes) and undo", () => {
    const { doc } = docWithScreen();
    const pid = newId("pg");
    const a = applyOps(doc, [{ type: "addPage", page: { id: pid, name: "Shop", children: [] } }]);
    const withNode = insertSpec(a.doc, { className: "Frame" }, null);
    // move the loose frame to the new page
    const moved = applyOps(withNode.doc, [{ type: "move", id: withNode.id, parentId: null, pageId: pid }]);
    expect(moved.doc.pages[1].children).toEqual([withNode.id]);
    const rm = applyOps(moved.doc, [{ type: "removePage", id: pid }]);
    expect(rm.doc.pages).toHaveLength(1);
    expect(rm.doc.nodes[withNode.id]).toBeUndefined();
    const back = applyOps(rm.doc, rm.inverse).doc;
    expect(back.pages).toEqual(moved.doc.pages);
    expect(back.nodes).toEqual(moved.doc.nodes);
    expect(() => applyOps(doc, [{ type: "removePage", id: doc.pages[0].id }])).toThrow(/last page/);
  });

  it("spec round-trip via toSpec", () => {
    const { doc, screenId } = docWithScreen();
    const r = insertSpec(doc, { className: "Frame", name: "Card", corner: 12, padding: [8, 16], list: { Padding: 4 }, children: [{ className: "TextLabel", name: "T", props: { Text: "Hi" } }] }, screenId);
    const spec = toSpec(r.doc, r.id);
    const again = buildNodes(r.doc, spec, screenId);
    expect(again.map((n) => n.className)).toEqual(["Frame", "UICorner", "UIPadding", "UIListLayout", "TextLabel"]);
    expect(again[2].props).toMatchObject({ PaddingTop: { s: 0, o: 8 }, PaddingLeft: { s: 0, o: 16 } });
    expect(again[4].props.Text).toBe("Hi");
  });

  it("spec errors carry a path", () => {
    const { doc, screenId } = docWithScreen();
    expect(() => buildNodes(doc, { className: "Frame", children: [{ className: "TextLabel", name: "Bad", props: { TextXAlignment: "Middle" } }] }, screenId)).toThrow(
      /root\.children\[0\]\(Bad\).*TextXAlignment/,
    );
  });
});

describe("components", () => {
  function setup() {
    const { doc, screenId } = docWithScreen();
    const m = insertSpec(doc, { className: "Frame", name: "Card", props: { Size: [0, 100, 0, 120] }, children: [{ className: "TextLabel", name: "Title", props: { Text: "Item" } }] }, null);
    const compId = newId("cmp");
    const d = applyOps(m.doc, [
      { type: "setComponent", id: compId, def: { id: compId, name: "Card", rootId: m.id, createdAt: "" } },
      { type: "update", id: m.id, fields: { componentId: compId } },
    ]).doc;
    return { doc: d, screenId, masterId: m.id, compId };
  }

  it("instances expand the master and apply overrides by name path", () => {
    const { doc, screenId, compId } = setup();
    const r = insertSpec(doc, { className: "Frame", component: "Card", props: { Position: [0, 50, 0, 50] }, overrides: { Title: { Text: "Sword" } } }, screenId);
    const tree = resolveTree(r.doc, screenId)!;
    const inst = findResolved(tree, r.id)!;
    expect(inst.instanceOf).toBe(compId);
    expect(inst.props.Size).toEqual({ xs: 0, xo: 100, ys: 0, yo: 120 });
    expect(inst.children[0].props.Text).toBe("Sword");
    expect(inst.children[0].id).toBe(`${r.id}/${inst.children[0].sourceId}`);
  });

  it("master edits propagate; override op is reversible", () => {
    const { doc, screenId } = setup();
    const r = insertSpec(doc, { className: "Frame", component: "Card" }, screenId);
    const title = byName(r.doc, "Title").id;
    const edited = applyOps(r.doc, [{ type: "update", id: title, props: { TextColor3: "#ff0000" } }]).doc;
    let inst = findResolved(resolveTree(edited, screenId)!, r.id)!;
    expect(inst.children[0].props.TextColor3).toBe("#FF0000");
    const o = applyOps(edited, [{ type: "override", instanceId: r.id, key: title, props: { Text: "Bow" } }]);
    inst = findResolved(resolveTree(o.doc, screenId)!, r.id)!;
    expect(inst.children[0].props.Text).toBe("Bow");
    expect(applyOps(o.doc, o.inverse).doc.nodes[r.id].instance!.overrides).toEqual({});
    expect(() => applyOps(edited, [{ type: "override", instanceId: r.id, key: "nope", props: { Text: "x" } }])).toThrow(/does not exist/);
  });

  it("nested instances resolve overrides through both levels", () => {
    const { doc, screenId, compId } = setup();
    // Shelf component containing a Card instance
    const shelf = insertSpec(doc, { className: "Frame", name: "Shelf", list: true, children: [{ className: "Frame", name: "Slot1", component: compId }] }, null);
    const shelfComp = newId("cmp");
    const d = applyOps(shelf.doc, [{ type: "setComponent", id: shelfComp, def: { id: shelfComp, name: "Shelf", rootId: shelf.id, createdAt: "" } }]).doc;
    const r = insertSpec(d, { className: "Frame", component: "Shelf", overrides: { "Slot1/Title": { Text: "Deep" } } }, screenId);
    const inst = findResolved(resolveTree(r.doc, screenId)!, r.id)!;
    const slot = inst.children.find((c) => c.name === "Slot1")!;
    expect(slot.instanceOf).toBe(compId);
    expect(slot.children[0].props.Text).toBe("Deep");
    expect(slot.children[0].instanceRoot).toBe(r.id);
  });
});
