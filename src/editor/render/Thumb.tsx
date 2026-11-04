/** Scaled-down rendering of a resolved tree (library, components, home cards). */
import { useMemo } from "react";
import type { ResolvedNode } from "../../core/document";
import { computeLayout } from "../../core/layout";
import { api } from "../api";
import { browserMeasurer } from "./measure";
import { RootRenderer } from "./Renderer";

export function Thumb({ tree, w, h, maxW, maxH, version = 0 }: { tree: ResolvedNode; w: number; h: number; maxW: number; maxH: number; version?: number }) {
  const layout = useMemo(() => computeLayout(tree, { x: 0, y: 0, w, h }, { measurer: browserMeasurer }), [tree, w, h, version]);
  const scale = Math.min(1, maxW / Math.max(1, w), maxH / Math.max(1, h));
  return (
    <div style={{ width: w * scale, height: h * scale, position: "relative", pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        <RootRenderer tree={tree} layout={layout} opts={{ assetUrl: api.assetUrl }} />
      </div>
    </div>
  );
}
