import { describe, expect, it } from "vitest";
import { PRESETS } from "../../src/core/presets";
import { exportDocument } from "../../src/core/export";
import { validateDocument } from "../../src/core/validate";
import { docWithScreen, insertSpec } from "./helpers";
import { checkLuau } from "./luauCheck";

describe("presets", () => {
  for (const p of PRESETS) {
    it(`${p.name} builds, validates and exports`, () => {
      const { doc, screenId } = docWithScreen();
      const r = insertSpec(doc, p.spec, screenId);
      expect(r.nodes.length).toBeGreaterThan(0);
      const errors = validateDocument(r.doc).filter((i) => i.severity === "error");
      expect(errors).toEqual([]);
      const b = exportDocument(r.doc);
      for (const f of b.files) checkLuau(f.content);
    });
  }
  it("ids are unique", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });
});
