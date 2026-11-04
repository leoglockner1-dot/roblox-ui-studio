/** Global keyboard shortcuts for the editor. */
import { useEffect } from "react";
import * as A from "./actions";
import { store, type Tool } from "./store";

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const mod = isMac ? "⌘" : "Ctrl+";

const TOOL_KEYS: Record<string, Tool> = { v: "select", h: "hand", f: "frame", r: "frame", t: "text", b: "button", i: "image", s: "scroll" };

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "V / H", action: "Select / Hand tool" },
  { keys: "F (R) / T / B / I / S", action: "Frame / Text / Button / Image / ScrollingFrame tool" },
  { keys: "Space + drag, middle-drag", action: "Pan" },
  { keys: `${mod}scroll, pinch`, action: "Zoom at cursor" },
  { keys: "⇧1 / ⇧2 / ⇧0", action: "Zoom to fit / selection / 100%" },
  { keys: `${mod}Z / ${mod}⇧Z`, action: "Undo / Redo" },
  { keys: `${mod}C / X / V / D`, action: "Copy / Cut / Paste / Duplicate" },
  { keys: `${mod}G / ${mod}⇧G`, action: "Group in Frame / Ungroup" },
  { keys: `${mod}⌥K / ${mod}⌥B`, action: "Create component / Detach instance" },
  { keys: `${mod}] [ (⇧ = to front/back)`, action: "Change draw order" },
  { keys: "Arrows (⇧ ×10)", action: "Nudge" },
  { keys: "Enter / ⇧Enter / Esc", action: "Select children / parent / clear" },
  { keys: `${mod}A`, action: "Select all siblings" },
  { keys: `${mod}click / double-click`, action: "Select deepest / go one level deeper; edit text" },
  { keys: "Alt (hover)", action: "Measure distances" },
  { keys: "P / E", action: "Preview / Export" },
  { keys: `${mod}⇧L / ${mod}⇧H`, action: "Lock / Toggle Visible" },
  { keys: "'", action: "Toggle timeline" },
];

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = store.state;
      if (s.route.name !== "editor" || !s.doc) return;
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable) return;
      if (s.previewOpen || s.exportOpen) {
        if (e.key === "Escape") store.set({ previewOpen: false, exportOpen: false });
        return;
      }
      const cmd = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (cmd) {
        if (k === "z" && !e.shiftKey) return run(() => store.undo());
        if ((k === "z" && e.shiftKey) || k === "y") return run(() => store.redo());
        if (k === "c") return run(() => void A.copySelection());
        if (k === "x") return run(() => void A.copySelection(true));
        if (k === "v") return run(() => void A.paste());
        if (k === "d") return run(() => A.duplicateSelection());
        if (k === "g" && e.shiftKey) return run(A.ungroupSelection);
        if (k === "g") return run(A.groupSelection);
        if (k === "k" && e.altKey) return run(A.makeComponent);
        if (k === "b" && e.altKey) return run(A.detachSelection);
        if (k === "a") return run(A.selectAll);
        if (k === "]") return run(() => A.reorder(e.shiftKey ? "front" : "forward"));
        if (k === "[") return run(() => A.reorder(e.shiftKey ? "back" : "backward"));
        if (k === "l" && e.shiftKey) return run(() => s.selection[0] && A.toggleLock(s.selection[0]));
        if (k === "h" && e.shiftKey) return run(() => s.selection.forEach(A.toggleVisible));
        if (k === "s") return run(() => store.toast(s.sync === "saved" ? "All changes are saved automatically" : "Saving…"));
        if (k === "=" || k === "+") return run(() => store.zoomTo(s.viewport.zoom * 1.25));
        if (k === "-") return run(() => store.zoomTo(s.viewport.zoom / 1.25));
        if (k === "0") return run(() => store.zoomTo(1));
        if (k === "e") return run(() => store.set({ exportOpen: true }));
        return;
      }
      if (e.shiftKey && (e.code === "Digit1" || k === "!")) return run(() => store.fitAll());
      if (e.shiftKey && (e.code === "Digit2" || k === "@")) return run(A.zoomToSelection);
      if (e.shiftKey && (e.code === "Digit0" || k === ")")) return run(() => store.zoomTo(1));
      if (k === "delete" || k === "backspace") {
        const refId = s.selection[0]?.startsWith("ref:") ? s.selection[0].slice(4) : null;
        if (refId) {
          const page = s.doc.pages.find((p) => p.id === s.pageId)!;
          return run(() => store.apply([{ type: "updatePage", id: page.id, references: (page.references ?? []).filter((r) => r.id !== refId) }], "Remove reference", { selection: [] }));
        }
        return run(A.deleteSelection);
      }
      if (k === "escape") return run(() => (s.tool !== "select" ? store.set({ tool: "select" }) : s.selection.length ? A.selectParentOrClear() : undefined));
      if (k === "enter") return run(() => (e.shiftKey ? A.selectParent() : A.selectChildren()));
      if (k.startsWith("arrow")) {
        const step = e.shiftKey ? 10 : 1;
        const dx = k === "arrowleft" ? -step : k === "arrowright" ? step : 0;
        const dy = k === "arrowup" ? -step : k === "arrowdown" ? step : 0;
        return run(() => A.nudge(dx, dy));
      }
      if (k === "p") return run(() => store.set({ previewOpen: true }));
      if (k === "e") return run(() => store.set({ exportOpen: true }));
      if (k === "'") return run(() => store.set({ timelineOpen: !s.timelineOpen }));
      if (!e.altKey && TOOL_KEYS[k]) return run(() => store.set({ tool: TOOL_KEYS[k] }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
