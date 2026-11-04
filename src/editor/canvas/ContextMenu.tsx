/** Right-click menu for canvas and layers. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CLASSES, MODIFIER_CLASSES } from "../../core/classes";
import * as A from "../actions";
import { store } from "../store";
import { mod } from "../shortcuts";

export interface MenuState {
  x: number;
  y: number;
  world?: { x: number; y: number };
}

interface Item {
  label: string;
  kbd?: string;
  run?: () => void;
  disabled?: boolean;
  sub?: Item[];
}
type Entry = Item | "sep" | { title: string };

export function ContextMenu({ state, onClose, onAddReference }: { state: MenuState; onClose: () => void; onAddReference?: (assetId: string, w: { x: number; y: number }, aw?: number, ah?: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });
  const [sub, setSub] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(state.x, innerWidth - r.width - 8), y: Math.min(state.y, innerHeight - r.height - 8) });
  }, [state.x, state.y]);
  useEffect(() => {
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const sel = store.state.selection;
  const doc = store.state.doc!;
  const first = sel[0];
  const refSel = first?.startsWith("ref:") ? first.slice(4) : null;
  const r = first && !refSel ? A.resolvedOf(first) : null;
  const storedSel = sel.filter((id) => A.isStored(id) && doc.nodes[id]);
  const stored = first && A.isStored(first) ? doc.nodes[first] : null;
  const page = doc.pages.find((p) => p.id === store.state.pageId)!;
  const entries: Entry[] = [];

  if (refSel) {
    const refItem = page.references?.find((x) => x.id === refSel);
    const setRefs = (fn: (list: NonNullable<typeof page.references>) => NonNullable<typeof page.references>, label: string) =>
      store.apply([{ type: "updatePage", id: page.id, references: fn(page.references ?? []) }], label, { selection: [] });
    entries.push({ title: "Reference image" });
    for (const o of [1, 0.6, 0.3]) entries.push({ label: `Opacity ${o * 100}%`, run: () => setRefs((l) => l.map((x) => (x.id === refSel ? { ...x, opacity: o } : x)), "Reference opacity") });
    entries.push({ label: refItem?.locked ? "Unlock" : "Lock", run: () => setRefs((l) => l.map((x) => (x.id === refSel ? { ...x, locked: !x.locked } : x)), "Lock reference") });
    entries.push("sep", { label: "Remove from canvas", kbd: "Del", run: () => setRefs((l) => l.filter((x) => x.id !== refSel), "Remove reference") });
  } else {
    entries.push(
      { label: "Copy", kbd: `${mod}C`, run: () => void A.copySelection(), disabled: !storedSel.length },
      { label: "Cut", kbd: `${mod}X`, run: () => void A.copySelection(true), disabled: !storedSel.length },
      { label: "Paste", kbd: `${mod}V`, run: () => void A.paste() },
      { label: "Duplicate", kbd: `${mod}D`, run: A.duplicateSelection, disabled: !storedSel.length },
      { label: "Delete", kbd: "Del", run: A.deleteSelection, disabled: !storedSel.length },
      "sep",
      { label: "Group in Frame", kbd: `${mod}G`, run: A.groupSelection, disabled: !storedSel.length || !stored?.parent },
      { label: "Ungroup", kbd: `${mod}⇧G`, run: A.ungroupSelection, disabled: !(stored?.className === "Frame" && stored.parent) },
      { label: "Bring to front", kbd: `${mod}⇧]`, run: () => A.reorder("front"), disabled: !storedSel.length },
      { label: "Bring forward", kbd: `${mod}]`, run: () => A.reorder("forward"), disabled: !storedSel.length },
      { label: "Send backward", kbd: `${mod}[`, run: () => A.reorder("backward"), disabled: !storedSel.length },
      { label: "Send to back", kbd: `${mod}⇧[`, run: () => A.reorder("back"), disabled: !storedSel.length },
      "sep",
    );
    if (stored?.instance) {
      entries.push(
        { label: "Go to main component", run: () => A.goToMaster(stored.instance!.componentId) },
        { label: "Reset overrides", run: () => A.resetOverrides(stored.id) },
        { label: "Detach instance", kbd: `${mod}⌥B`, run: A.detachSelection },
      );
    } else if (r?.masterOf) {
      entries.push({ label: "Insert instance", run: () => A.insertComponent(r.masterOf!) });
    } else {
      entries.push({ label: "Create component", kbd: `${mod}⌥K`, run: A.makeComponent, disabled: !stored || CLASSES[stored.className].kind !== "gui" });
    }
    if (r && CLASSES[r.className].kind === "gui") {
      entries.push({
        label: "Add modifier",
        disabled: !stored || !!stored.instance,
        sub: MODIFIER_CLASSES.map((c) => ({ label: c, run: () => A.addModifier(first!, c) })),
      });
      entries.push({
        label: "Units",
        sub: [
          { label: "Size → Scale", run: () => A.convertUnits(sel, "Size", "scale") },
          { label: "Size → Offset", run: () => A.convertUnits(sel, "Size", "offset") },
          { label: "Position → Scale", run: () => A.convertUnits(sel, "Position", "scale") },
          { label: "Position → Offset", run: () => A.convertUnits(sel, "Position", "offset") },
        ],
      });
    }
    entries.push("sep");
    if (first) {
      entries.push(
        { label: "Select parent", kbd: "⇧Enter", run: A.selectParent },
        { label: "Select children", kbd: "Enter", run: A.selectChildren },
        { label: stored?.locked ? "Unlock" : "Lock", kbd: `${mod}⇧L`, run: () => A.toggleLock(first), disabled: !stored },
        { label: "Show / hide (Visible)", kbd: `${mod}⇧H`, run: () => A.toggleVisible(first) },
        { label: "Zoom to selection", kbd: "⇧2", run: A.zoomToSelection },
        {
          label: "Copy as NodeSpec JSON",
          disabled: !stored,
          run: () => {
            const spec = A.specOf(first);
            if (spec) void navigator.clipboard.writeText(JSON.stringify(spec, null, 2)).then(() => store.toast("NodeSpec copied — paste it to Claude or back into the canvas"));
          },
        },
      );
    } else {
      entries.push({ label: "Add screen", run: () => A.addScreen() }, { label: "Zoom to fit", kbd: "⇧1", run: () => store.fitAll() });
      const refs = store.state.assets.filter((a) => a.reference);
      if (refs.length && state.world && onAddReference)
        entries.push({ label: "Place reference image", sub: refs.map((a) => ({ label: a.name, run: () => onAddReference(a.id, state.world!, a.width, a.height) })) });
    }
  }

  return (
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {entries.map((e, i) => {
        if (e === "sep") return <div key={i} className="menu-sep" />;
        if ("title" in e) return <div key={i} className="menu-label">{e.title}</div>;
        return (
          <div
            key={i}
            className={`menu-item${e.disabled ? " disabled" : ""}`}
            style={{ position: "relative" }}
            onMouseEnter={() => setSub(e.sub ? i : null)}
            onClick={() => {
              if (e.sub) return;
              e.run?.();
              onClose();
            }}
          >
            <span>{e.label}</span>
            <span className="kbd">{e.sub ? "▸" : e.kbd}</span>
            {e.sub && sub === i && (
              <div className="menu" style={{ position: "absolute", left: "100%", top: -4, maxHeight: 360, overflowY: "auto" }}>
                {e.sub.map((s, j) => (
                  <div key={j} className="menu-item" onClick={(ev) => { ev.stopPropagation(); s.run?.(); onClose(); }}>
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
