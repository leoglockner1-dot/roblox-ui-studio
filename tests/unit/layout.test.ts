import { describe, expect, it } from "vitest";
import { resolveTree } from "../../src/core/document";
import { computeLayout, ROBLOX_TOPBAR_INSET, type TextMeasurer } from "../../src/core/layout";
import type { NodeSpec } from "../../src/core/spec";
import { byName, docWithScreen, insertSpec } from "./helpers";

function layoutOf(spec: NodeSpec, opts: { w?: number; h?: number; screenProps?: Record<string, unknown>; measurer?: TextMeasurer } = {}) {
  const { doc, screenId } = docWithScreen(opts.w ?? 1000, opts.h ?? 500);
  let d = doc;
  if (opts.screenProps) d = { ...d, nodes: { ...d.nodes, [screenId]: { ...d.nodes[screenId], props: { ...d.nodes[screenId].props, ...opts.screenProps } as never } } };
  const r = insertSpec(d, spec, screenId);
  const map = computeLayout(resolveTree(r.doc, screenId)!, { x: 0, y: 0, w: opts.w ?? 1000, h: opts.h ?? 500 }, { measurer: opts.measurer });
  const box = (name: string) => map.get(byName(r.doc, name).id)!;
  return { box, map };
}

describe("layout: UDim2 + AnchorPoint", () => {
  it("scale and offset are relative to the parent", () => {
    const { box } = layoutOf({ className: "Frame", name: "F", props: { Size: [0.5, 20, 0.2, 0], Position: [0.1, 5, 0, 10] } });
    expect(box("F")).toMatchObject({ x: 105, y: 10, w: 520, h: 100 });
  });

  it("anchor point centers the element", () => {
    const { box } = layoutOf({ className: "Frame", name: "F", props: { Size: [0, 200, 0, 100], Position: [0.5, 0, 0.5, 0], AnchorPoint: [0.5, 0.5] } });
    expect(box("F")).toMatchObject({ x: 400, y: 200, w: 200, h: 100 });
  });

  it("top bar inset applies unless IgnoreGuiInset", () => {
    const { box } = layoutOf({ className: "Frame", name: "F", props: { Size: [1, 0, 1, 0] } }, { screenProps: { IgnoreGuiInset: false } });
    expect(box("F")).toMatchObject({ y: ROBLOX_TOPBAR_INSET, h: 500 - ROBLOX_TOPBAR_INSET });
  });

  it("UIPadding shrinks the child area", () => {
    const { box } = layoutOf({
      className: "Frame", name: "P", props: { Size: [0, 200, 0, 200] }, padding: [10, 20],
      children: [{ className: "Frame", name: "C", props: { Size: [1, 0, 1, 0] } }],
    });
    expect(box("C")).toMatchObject({ x: 20, y: 10, w: 160, h: 180 });
  });

  it("UIScale scales size around the anchor and scales descendant offsets", () => {
    const { box } = layoutOf({
      className: "Frame", name: "P", props: { Size: [0, 100, 0, 100], Position: [0, 200, 0, 200], AnchorPoint: [0.5, 0.5] }, scale: 2,
      children: [{ className: "Frame", name: "C", props: { Size: [0, 10, 0, 10], Position: [0, 5, 0, 5] } }],
    });
    expect(box("P")).toMatchObject({ x: 100, y: 100, w: 200, h: 200 });
    expect(box("C")).toMatchObject({ x: 110, y: 110, w: 20, h: 20 });
  });

  it("UIAspectRatioConstraint FitWithinMaxSize keeps the ratio inside the box", () => {
    const { box } = layoutOf({ className: "Frame", name: "F", props: { Size: [0, 400, 0, 100] }, aspect: 2 });
    expect(box("F")).toMatchObject({ w: 200, h: 100 });
  });

  it("UISizeConstraint clamps", () => {
    const { box } = layoutOf({ className: "Frame", name: "F", props: { Size: [1, 0, 1, 0] }, sizeConstraint: { MaxSize: [300, 200], MinSize: [0, 0] } });
    expect(box("F")).toMatchObject({ w: 300, h: 200 });
  });
});

describe("layout: UIListLayout / UIGridLayout / UIPageLayout", () => {
  const items = (n: number, w = 50, h = 30) => Array.from({ length: n }, (_, i) => ({ className: "Frame", name: `I${i}`, props: { Size: [0, w, 0, h], LayoutOrder: n - i } }));

  it("vertical list respects LayoutOrder, padding and alignment", () => {
    const { box } = layoutOf({
      className: "Frame", name: "L", props: { Size: [0, 200, 0, 200] },
      list: { Padding: 10, HorizontalAlignment: "Center" }, children: items(3),
    });
    // LayoutOrder is reversed, so I2 comes first
    expect(box("I2")).toMatchObject({ x: 75, y: 0 });
    expect(box("I1")).toMatchObject({ x: 75, y: 40 });
    expect(box("I0")).toMatchObject({ x: 75, y: 80 });
  });

  it("horizontal list centered on both axes", () => {
    const { box } = layoutOf({
      className: "Frame", name: "L", props: { Size: [0, 300, 0, 100] },
      list: { FillDirection: "Horizontal", Padding: 10, HorizontalAlignment: "Center", VerticalAlignment: "Center" },
      children: items(2).map((s, i) => ({ ...s, props: { ...s.props, LayoutOrder: i } })),
    });
    // total = 50+10+50 = 110, start = (300-110)/2 = 95
    expect(box("I0")).toMatchObject({ x: 95, y: 35 });
    expect(box("I1")).toMatchObject({ x: 155, y: 35 });
  });

  it("invisible items take no space in a list", () => {
    const kids = items(3).map((s, i) => ({ ...s, props: { ...s.props, LayoutOrder: i, Visible: i !== 1 } }));
    const { box } = layoutOf({ className: "Frame", name: "L", props: { Size: [0, 200, 0, 200] }, list: true, children: kids });
    expect(box("I2").y).toBe(30);
    expect(box("I1").visible).toBe(false);
  });

  it("grid fills rows and wraps", () => {
    const { box } = layoutOf({
      className: "Frame", name: "G", props: { Size: [0, 230, 0, 400] },
      grid: { CellSize: [0, 70, 0, 70], CellPadding: [0, 10, 0, 10] },
      children: items(4).map((s, i) => ({ ...s, props: { ...s.props, LayoutOrder: i } })),
    });
    // (230+10)/(70+10) = 3 per row
    expect(box("I0")).toMatchObject({ x: 0, y: 0, w: 70, h: 70 });
    expect(box("I2")).toMatchObject({ x: 160, y: 0 });
    expect(box("I3")).toMatchObject({ x: 0, y: 80 });
  });

  it("grid FillDirectionMaxCells limits columns", () => {
    const { box } = layoutOf({
      className: "Frame", name: "G", props: { Size: [0, 1000, 0, 400] },
      grid: { CellSize: [0, 50, 0, 50], CellPadding: [0, 0, 0, 0], FillDirectionMaxCells: 2 },
      children: items(3).map((s, i) => ({ ...s, props: { ...s.props, LayoutOrder: i } })),
    });
    expect(box("I2")).toMatchObject({ x: 0, y: 50 });
  });

  it("page layout shows the current page", () => {
    const pages = [0, 1, 2].map((i) => ({ className: "Frame", name: `Pg${i}`, props: { Size: [1, 0, 1, 0], LayoutOrder: i } }));
    const { box } = layoutOf({ className: "Frame", name: "P", props: { Size: [0, 300, 0, 200] }, pages: { _CurrentPage: 1 }, children: pages });
    expect(box("Pg1")).toMatchObject({ x: 0, y: 0, w: 300 });
    expect(box("Pg0").x).toBe(-300);
    expect(box("Pg2").x).toBe(300);
  });
});

describe("layout: automatic sizing, scrolling, text", () => {
  const fixed: TextMeasurer = {
    measure: (text, _f, size, wrap, lh) => {
      const w = text.length * size * 0.5;
      if (wrap && w > wrap) {
        const lines = Math.ceil(w / wrap);
        return { w: wrap, h: lines * size * lh };
      }
      return { w, h: size * lh };
    },
  };

  it("AutomaticSize Y grows a frame to fit its list content", () => {
    const { box } = layoutOf({
      className: "Frame", name: "A", props: { Size: [0, 100, 0, 0], AutomaticSize: "Y" }, padding: 10,
      list: { Padding: 5 }, children: [0, 1, 2].map((i) => ({ className: "Frame", name: `C${i}`, props: { Size: [1, 0, 0, 20], LayoutOrder: i } })),
    });
    expect(box("A").h).toBe(10 + 20 * 3 + 5 * 2 + 10);
  });

  it("AutomaticSize X sizes a label to its text", () => {
    const { box } = layoutOf({ className: "TextLabel", name: "T", props: { Text: "abcd", TextSize: 20, Size: [0, 0, 0, 30], AutomaticSize: "X" } }, { measurer: fixed });
    expect(box("T").w).toBe(40);
  });

  it("TextScaled picks the largest fitting size", () => {
    const { box } = layoutOf({ className: "TextLabel", name: "T", props: { Text: "abcdefghij", TextScaled: true, Size: [0, 200, 0, 100] } }, { measurer: fixed });
    // width limit: 10 chars * s * 0.5 <= 200 -> s <= 40
    expect(box("T").textSize).toBe(40);
  });

  it("UITextSizeConstraint caps TextScaled", () => {
    const { box } = layoutOf({ className: "TextLabel", name: "T", props: { Text: "ab", TextScaled: true, Size: [0, 400, 0, 400] }, textSizeConstraint: { MaxTextSize: 24 } }, { measurer: fixed });
    expect(box("T").textSize).toBe(24);
  });

  it("ScrollingFrame lays children out on the canvas and auto-sizes it", () => {
    const { box } = layoutOf({
      className: "ScrollingFrame", name: "S", props: { Size: [0, 200, 0, 100], CanvasSize: [0, 0, 0, 0], AutomaticCanvasSize: "Y", CanvasPosition: [0, 30] },
      list: true, children: [0, 1, 2, 3].map((i) => ({ className: "Frame", name: `R${i}`, props: { Size: [1, 0, 0, 50], LayoutOrder: i } })),
    });
    expect(box("S").canvas!.h).toBe(200);
    expect(box("R0").y).toBe(-30);
    expect(box("R3").y).toBe(120);
  });
});
