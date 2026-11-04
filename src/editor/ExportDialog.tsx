/** Export to Roblox Studio: .rbxmx models, Luau modules, single script, ZIP, document JSON. */
import { useEffect, useState } from "react";
import type { ExportBundle } from "../core/export";
import { api } from "./api";
import { store, useEditor } from "./store";
import { Select } from "./ui/fields";
import { Icon } from "./ui/icons";
import * as A from "./actions";

type Tab = "studio" | "luau" | "single" | "document";

export function ExportDialog() {
  const doc = useEditor((s) => s.doc)!;
  const selection = useEditor((s) => s.selection);
  const roots = doc.pages.flatMap((p) => p.children).filter((id) => doc.nodes[id] && !doc.nodes[id].componentId);
  const selRoot = (() => {
    const id = selection[0]?.split("/")[0];
    let cur = id ? doc.nodes[id] : undefined;
    while (cur?.parent) cur = doc.nodes[cur.parent];
    return cur && roots.includes(cur.id) ? cur.id : "";
  })();
  const [scope, setScope] = useState<string>(selRoot);
  const [tab, setTab] = useState<Tab>("studio");
  const [bundle, setBundle] = useState<ExportBundle | null>(null);
  const [single, setSingle] = useState<string>("");
  const [file, setFile] = useState("Screens");
  const [error, setError] = useState<string | null>(null);
  const rootsParam = scope ? [scope] : undefined;

  useEffect(() => {
    let alive = true;
    setError(null);
    (async () => {
      try {
        const res = await fetch(api.exportUrl(doc.id, "json", rootsParam));
        const j = await res.json();
        if (!j.ok) throw new Error(j.error);
        if (alive) {
          setBundle(j as ExportBundle);
          const first = (j as ExportBundle).files.find((f) => f.path.startsWith("Screens/")) ?? (j as ExportBundle).files[0];
          setFile(first?.path ?? "");
        }
        const singleRoot = scope || roots.find((id) => doc.nodes[id].className === "ScreenGui");
        if (singleRoot) {
          const s = await (await fetch(api.exportUrl(doc.id, "single", [singleRoot]))).json();
          if (alive && s.ok) setSingle(s.source);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [doc.id, doc.revision, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => store.toast(`${what} copied`), () => store.toast("Clipboard not available", "error"));
  const current = bundle?.files.find((f) => f.path === file);
  const download = (format: string) => {
    const a = document.createElement("a");
    a.href = api.exportUrl(doc.id, format, rootsParam);
    a.click();
  };

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && store.set({ exportOpen: false })}>
      <div className="modal" style={{ width: 980, height: "min(760px, calc(100vh - 48px))" }} data-testid="export">
        <div className="modal-head">
          <Icon.export /> Export to Roblox
          <div style={{ width: 240 }}>
            <Select value={scope} options={[{ value: "", label: "Whole document" }, ...roots.map((id) => ({ value: id, label: doc.nodes[id].name }))]} onChange={setScope} />
          </div>
          <span className="spacer" />
          <button className="icon-btn" onClick={() => store.set({ exportOpen: false })}><Icon.close /></button>
        </div>
        <div className="tabs" style={{ paddingLeft: 16 }}>
          {([["studio", "Roblox Studio"], ["luau", "Luau modules"], ["single", "Single script"], ["document", "Design file"]] as [Tab, string][]).map(([t, l]) => (
            <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>{l}</button>
          ))}
        </div>
        <div className="modal-body" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          {error && <div style={{ color: "var(--error)" }}>Export failed: {error}</div>}
          {bundle && bundle.diagnostics.length > 0 && (
            <div style={{ background: "rgba(255,181,71,0.08)", border: "1px solid rgba(255,181,71,0.3)", borderRadius: 8, padding: 8 }}>
              {bundle.diagnostics.map((d, i) => (
                <div key={i} className="diag" onClick={() => { if (d.nodeId) { store.set({ exportOpen: false }); store.select([d.nodeId]); A.zoomToSelection(); } }}>
                  <span className={`sev ${d.severity}`} /> <span>{d.message}</span>
                </div>
              ))}
            </div>
          )}
          {tab === "studio" && bundle && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="section" style={{ border: "1px solid var(--line)", borderRadius: 10 }}>
                <div className="section-title"><span>A · Instances (no code)</span></div>
                <p style={{ color: "var(--text-2)", lineHeight: 1.6 }}>The ScreenGui(s) as real Roblox instances. In Studio: right-click <b>StarterGui</b> → <b>Insert from File…</b> → choose the file.</p>
                <button className="btn primary" onClick={() => download("gui")}><Icon.export size={14} /> Download {bundle.packageName}.gui.rbxmx</button>
              </div>
              <div className="section" style={{ border: "1px solid var(--line)", borderRadius: 10 }}>
                <div className="section-title"><span>B · Code modules (recommended)</span></div>
                <p style={{ color: "var(--text-2)", lineHeight: 1.6 }}>A Folder of ModuleScripts (components, screens, TweenService animations). Right-click <b>ReplicatedStorage</b> → <b>Insert from File…</b>, then add the LocalScript below.</p>
                <button className="btn primary" onClick={() => download("code")}><Icon.export size={14} /> Download {bundle.packageName}.code.rbxmx</button>
              </div>
              <div style={{ gridColumn: "1 / 3" }}>
                <div className="section-title"><span>LocalScript (StarterPlayer › StarterPlayerScripts)</span><button className="btn small" onClick={() => copy(bundle.usage, "Snippet")}><Icon.copy size={12} /> Copy</button></div>
                <div className="code">{bundle.usage || "Nothing to export."}</div>
              </div>
              <div style={{ gridColumn: "1 / 3", display: "flex", gap: 8, alignItems: "center" }}>
                <button className="btn" onClick={() => download("zip")}>Download everything (.zip — Rojo-ready folder + both .rbxmx)</button>
                <span style={{ color: "var(--text-3)", fontSize: 11 }}>Images need Roblox asset ids (set them in Assets) — local-only images export as empty.</span>
              </div>
            </div>
          )}
          {tab === "luau" && bundle && (
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, flex: 1, minHeight: 0 }}>
              <div className="file-list" style={{ overflow: "auto" }}>
                {bundle.files.map((f) => (
                  <button key={f.path} className={f.path === file ? "active" : ""} onClick={() => setFile(f.path)}>{f.path}</button>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0, gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-3)", fontFamily: "var(--mono)" }}>{bundle.packageName}/{current?.path}</span>
                  {current && <button className="btn small" onClick={() => copy(current.content, current.path)}><Icon.copy size={12} /> Copy</button>}
                </div>
                <div className="code" style={{ flex: 1 }}>{current?.content}</div>
              </div>
            </div>
          )}
          {tab === "single" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minHeight: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-2)" }}>One self-contained LocalScript for quick testing — paste into StarterPlayerScripts.</span>
                <button className="btn small" onClick={() => copy(single, "Script")}><Icon.copy size={12} /> Copy</button>
              </div>
              <div className="code" style={{ flex: 1 }}>{single || "Choose a screen to export as a single script."}</div>
            </div>
          )}
          {tab === "document" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, color: "var(--text-2)", lineHeight: 1.6 }}>
              <p>The design itself is a versioned JSON document (format <code>roblox-ui-studio</code> v{doc.version}). Download it to back up, share or version in git; import it from the home screen.</p>
              <div><button className="btn primary" onClick={() => download("document")}>Download {doc.name}.ruis.json</button></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
