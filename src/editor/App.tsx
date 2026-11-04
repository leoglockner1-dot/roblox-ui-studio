/** App shell: routing, toolbar, panels, modals and toasts. */
import { useEffect, useState } from "react";
import * as A from "./actions";
import { Canvas } from "./canvas/Canvas";
import { ExportDialog } from "./ExportDialog";
import { Home } from "./Home";
import { LayersPanel, PagesList } from "./panels/Layers";
import { AssetsPanel, ComponentsPanel, LibraryPanel, StylesPanel } from "./panels/Library";
import { PropertiesPanel } from "./panels/Properties";
import { Timeline } from "./panels/Timeline";
import { PreviewModal, RenderPage } from "./Preview";
import { mod, SHORTCUTS, useShortcuts } from "./shortcuts";
import { store, useEditor, type LeftTab, type Tool } from "./store";
import { Icon } from "./ui/icons";

function route() {
  const h = location.hash;
  if (h.startsWith("#/render")) return { name: "render" as const };
  const m = /^#\/doc\/([\w-]+)/.exec(h);
  if (m) return { name: "editor" as const, docId: m[1] };
  return { name: "home" as const };
}

export function App() {
  const r = useEditor((s) => s.route);
  const [initial] = useState(route);
  useEffect(() => {
    if (initial.name === "render") {
      store.set({ route: { name: "render" } });
      return;
    }
    store.start();
    if (initial.name === "editor") void store.openDocument(initial.docId);
    const onHash = () => {
      const nr = route();
      if (nr.name === "editor" && store.state.doc?.id !== nr.docId) void store.openDocument(nr.docId);
      if (nr.name === "home" && store.state.route.name !== "home") store.goHome();
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      store.stop();
    };
  }, [initial]);
  if (initial.name === "render") return <RenderPage />;
  return (
    <>
      {r.name === "editor" ? <Editor /> : <Home />}
      <Toasts />
    </>
  );
}

function Editor() {
  const doc = useEditor((s) => s.doc);
  const leftTab = useEditor((s) => s.leftTab);
  const timelineOpen = useEditor((s) => s.timelineOpen);
  const previewOpen = useEditor((s) => s.previewOpen);
  const exportOpen = useEditor((s) => s.exportOpen);
  useShortcuts();
  if (!doc) return <div className="empty" style={{ paddingTop: 80 }}>Loading…</div>;
  const tabs: [LeftTab, string][] = [["layers", "Layers"], ["library", "Library"], ["components", "Components"], ["assets", "Assets"], ["styles", "Styles"]];
  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <aside className="sidebar left">
          <div className="tabs">
            {tabs.map(([t, l]) => (
              <button key={t} className={`tab${leftTab === t ? " active" : ""}`} onClick={() => store.set({ leftTab: t })}>{l}</button>
            ))}
          </div>
          {leftTab === "layers" && (
            <>
              <PagesList />
              <LayersPanel />
            </>
          )}
          {leftTab === "library" && <LibraryPanel />}
          {leftTab === "components" && <ComponentsPanel />}
          {leftTab === "assets" && <AssetsPanel />}
          {leftTab === "styles" && <StylesPanel />}
        </aside>
        <main className="center">
          <Canvas />
          {timelineOpen && <Timeline />}
        </main>
        <aside className="sidebar right" data-testid="properties">
          <PropertiesPanel />
        </aside>
      </div>
      {previewOpen && <PreviewModal />}
      {exportOpen && <ExportDialog />}
    </div>
  );
}

const TOOLS: { tool: Tool; icon: keyof typeof Icon; tip: string }[] = [
  { tool: "select", icon: "select", tip: "Select (V)" },
  { tool: "hand", icon: "hand", tip: "Hand (H, or hold Space)" },
  { tool: "frame", icon: "frame", tip: "Frame (F)" },
  { tool: "text", icon: "text", tip: "TextLabel (T)" },
  { tool: "button", icon: "button", tip: "TextButton (B)" },
  { tool: "image", icon: "image", tip: "ImageLabel (I)" },
  { tool: "scroll", icon: "scroll", tip: "ScrollingFrame (S)" },
];

function Toolbar() {
  const doc = useEditor((s) => s.doc)!;
  const tool = useEditor((s) => s.tool);
  const zoom = useEditor((s) => s.viewport.zoom);
  const sync = useEditor((s) => s.sync);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const issues = useEditor((s) => s.issues);
  const issuesOpen = useEditor((s) => s.issuesOpen);
  const timelineOpen = useEditor((s) => s.timelineOpen);
  const snap = useEditor((s) => s.snapToGrid);
  const [help, setHelp] = useState(false);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  return (
    <header className="toolbar">
      <div className="brand" onClick={() => store.goHome()} data-tip="All documents"><div className="logo" /></div>
      {TOOLS.map((t) => {
        const I = Icon[t.icon];
        return (
          <button key={t.tool} className={`tbtn${tool === t.tool ? " active" : ""}`} data-tip={t.tip} onClick={() => store.set({ tool: t.tool })} data-testid={`tool-${t.tool}`}>
            <I />
          </button>
        );
      })}
      <div className="sep" />
      <button className="tbtn" data-tip="Add a ScreenGui artboard (1920×1080)" onClick={() => A.addScreen(`Screen${doc.pages.flatMap((p) => p.children).length + 1}`)}><Icon.screen /> <span>Screen</span></button>
      <button className="tbtn" data-tip={`Undo (${mod}Z)`} disabled={!canUndo} onClick={() => store.undo()}><Icon.undo /></button>
      <button className="tbtn" data-tip={`Redo (${mod}⇧Z)`} disabled={!canRedo} onClick={() => store.redo()}><Icon.redo /></button>
      <button className={`tbtn${snap ? " active" : ""}`} data-tip={`Snap positions to ${store.state.gridSize}px grid`} onClick={() => store.set({ snapToGrid: !snap })}><Icon.magnet /></button>
      <div className="spacer" />
      <div className="docname">
        <input key={doc.name} defaultValue={doc.name} onBlur={(e) => e.target.value.trim() && e.target.value !== doc.name && store.apply([{ type: "setDoc", name: e.target.value }], "Rename document")} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      </div>
      <div className="spacer" />
      <div className={`status ${sync}`} title={sync === "saved" ? "All changes saved to the workspace" : sync}>
        <span className="dot" />
        {sync === "saved" ? "Saved" : sync === "saving" ? "Saving…" : sync === "offline" ? "Offline — retrying" : "Error"}
      </div>
      <button className="tbtn" data-tip="Zoom out" onClick={() => store.zoomTo(zoom / 1.25)}><Icon.minus /></button>
      <button className="tbtn zoom-label" data-tip="Zoom to fit (⇧1)" onClick={() => store.fitAll()}>{Math.round(zoom * 100)}%</button>
      <button className="tbtn" data-tip="Zoom in" onClick={() => store.zoomTo(zoom * 1.25)}><Icon.plus /></button>
      <div className="sep" />
      <div style={{ position: "relative" }}>
        <button className={`tbtn${issuesOpen ? " active" : ""}`} data-tip="Design check" onClick={() => store.set({ issuesOpen: !issuesOpen })} data-testid="issues-btn">
          <Icon.warn />
          {(errors || warnings) > 0 && <span className={`badge ${errors ? "err" : "warn"}`}>{errors || warnings}</span>}
        </button>
        {issuesOpen && <IssuesPopover />}
      </div>
      <button className={`tbtn${timelineOpen ? " active" : ""}`} data-tip="Animation timeline (')" onClick={() => store.set({ timelineOpen: !timelineOpen })}><Icon.timeline /></button>
      <div style={{ position: "relative" }}>
        <button className="tbtn" data-tip="Keyboard shortcuts" onClick={() => setHelp(!help)}>?</button>
        {help && (
          <div className="popover" style={{ right: 0, top: 38, width: 420, padding: 12 }} onMouseLeave={() => setHelp(false)}>
            {SHORTCUTS.map((s) => (
              <div key={s.keys} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" }}>
                <span style={{ color: "var(--text-2)" }}>{s.action}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{s.keys}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="tbtn" data-tip="Preview on devices (P)" onClick={() => store.set({ previewOpen: true })} data-testid="preview-btn"><Icon.preview /> <span>Preview</span></button>
      <button className="tbtn primary" data-tip="Export to Roblox (E)" onClick={() => store.set({ exportOpen: true })} data-testid="export-btn"><Icon.export /> <span>Export</span></button>
    </header>
  );
}

function IssuesPopover() {
  const issues = useEditor((s) => s.issues);
  const doc = useEditor((s) => s.doc)!;
  const go = (nodeId?: string) => {
    if (!nodeId) return;
    const top = (() => {
      let cur = doc.nodes[nodeId.split("/")[0]];
      while (cur?.parent) cur = doc.nodes[cur.parent];
      return cur?.id;
    })();
    const page = doc.pages.find((p) => top && p.children.includes(top));
    if (page && page.id !== store.state.pageId) store.set({ pageId: page.id });
    store.select([nodeId]);
    A.zoomToSelection();
  };
  return (
    <div className="popover" style={{ right: 0, top: 38, width: 440, maxHeight: 460, overflow: "auto", padding: 6 }}>
      <div className="section-title" style={{ padding: "4px 6px" }}><span>Design check</span><span className="muted">{issues.length} findings</span></div>
      {!issues.length && <div className="empty">No problems found. 🎉</div>}
      {issues.map((i, k) => (
        <div key={k} className="diag" onClick={() => go(i.nodeId)}>
          <span className={`sev ${i.severity}`} />
          <span style={{ color: i.severity === "info" ? "var(--text-2)" : "var(--text)" }}>{i.message}</span>
        </div>
      ))}
    </div>
  );
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}
