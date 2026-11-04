import { createDocument, makeNode } from "../../src/core/document";
import { applyOps } from "../../src/core/ops";
import { buildNodes, type NodeSpec } from "../../src/core/spec";
import type { DesignDocument } from "../../src/core/types";

/** Create a document with one ScreenGui (1920x1080) on page 1. */
export function docWithScreen(w = 1920, h = 1080) {
  let doc = createDocument("Test");
  const screen = makeNode("ScreenGui", { name: "Screen", props: { IgnoreGuiInset: true }, canvas: { x: 0, y: 0, w, h } });
  doc = applyOps(doc, [{ type: "insert", nodes: [screen], pageId: doc.pages[0].id }]).doc;
  return { doc, screenId: screen.id };
}

export function insertSpec(doc: DesignDocument, spec: NodeSpec, parentId: string | null) {
  const nodes = buildNodes(doc, spec, parentId);
  const r = applyOps(doc, [{ type: "insert", nodes, pageId: doc.pages[0].id }]);
  return { doc: r.doc, id: nodes[0].id, nodes, inverse: r.inverse };
}

export function byName(doc: DesignDocument, name: string) {
  const n = Object.values(doc.nodes).find((x) => x.name === name);
  if (!n) throw new Error(`no node named ${name}`);
  return n;
}
