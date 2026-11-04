/** Home: documents, creation/import and Claude connection instructions. */
import { useEffect, useRef, useState } from "react";
import { api, type DocSummary } from "./api";
import { store, useEditor } from "./store";
import { Icon } from "./ui/icons";

export function Home() {
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [name, setName] = useState("");
  const [health, setHealth] = useState<{ installDir?: string; workspace?: string } | null>(null);
  const connected = useEditor((s) => s.connected);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => api.listDocuments().then(setDocs).catch(() => setDocs([]));
  useEffect(() => {
    void refresh();
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
  }, [connected]);

  const create = async () => {
    const d = await api.createDocument(name.trim() || "Untitled UI");
    setName("");
    await store.openDocument(d.id);
  };
  const mcpPath = health?.installDir ? `${health.installDir.replace(/\\/g, "/")}/dist/mcp.mjs` : "<path-to>/roblox-ui-studio/dist/mcp.mjs";
  const config = JSON.stringify({ mcpServers: { "roblox-ui-studio": { command: "node", args: [mcpPath] } } }, null, 2);

  return (
    <div className="home">
      <div className="home-inner">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div className="toolbar" style={{ background: "transparent", border: 0, padding: 0 }}><div className="brand" style={{ cursor: "default" }}><div className="logo" /></div></div>
          <h1>Roblox UI Studio</h1>
        </div>
        <p className="lead">Design Roblox game interfaces visually, preview them on real device sizes, and export clean Luau or Studio models. Claude can build and edit designs here through MCP.</p>
        {!connected && <div className="toast error" style={{ marginBottom: 16 }}>Not connected to the Roblox UI Studio server. Start it with <code>npm start</code>.</div>}
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <input className="input" style={{ width: 280 }} placeholder="New document name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
          <button className="btn primary" style={{ height: 30 }} onClick={() => void create()}><Icon.plus size={14} /> New design</button>
          <button className="btn" style={{ height: 30 }} onClick={() => fileRef.current?.click()}><Icon.upload size={14} /> Import .ruis.json</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const d = await api.importDocument(JSON.parse(await f.text()));
              await store.openDocument(d.id);
            } catch (err) {
              store.toast(`Import failed: ${(err as Error).message}`, "error");
            }
          }} />
        </div>
        <div className="doc-grid">
          {docs?.map((d) => (
            <div key={d.id} className="doc-card" onClick={() => void store.openDocument(d.id)} data-testid="doc-card">
              <div className="thumb"><Icon.screen size={40} /></div>
              <div className="meta">
                <div className="t">{d.name}</div>
                <div className="s">{d.nodes} objects · {d.components} components · {new Date(d.updatedAt).toLocaleString()}</div>
              </div>
              <div className="acts" onClick={(e) => e.stopPropagation()}>
                <button className="btn small" onClick={async () => {
                  const n = prompt("Name of the copy", `${d.name} copy`);
                  if (!n) return;
                  await api.tool("duplicate_document", { documentId: d.id, name: n });
                  void refresh();
                }}>Duplicate</button>
                <button className="btn small danger" onClick={async () => {
                  if (!confirm(`Delete "${d.name}" permanently?`)) return;
                  await api.deleteDocument(d.id);
                  void refresh();
                }}>Delete</button>
              </div>
            </div>
          ))}
          {docs && !docs.length && <div className="doc-card new-card" onClick={() => void create()}><Icon.plus size={24} /> Create your first design</div>}
        </div>

        <div style={{ marginTop: 40, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="section" style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10 }}>
            <div className="section-title"><span>Connect Claude (MCP)</span></div>
            <p style={{ color: "var(--text-2)", lineHeight: 1.6, marginTop: 0 }}>Add this to Claude Desktop's <code>claude_desktop_config.json</code> (Settings → Developer → Edit Config), then restart Claude. Ask: <i>“Use Roblox UI Studio to build a fantasy shop screen.”</i> Changes appear here live.</p>
            <div className="code" style={{ fontSize: 11 }}>{config}</div>
            <p style={{ color: "var(--text-3)", fontSize: 11 }}>Claude Code: <code>claude mcp add roblox-ui-studio -- node {mcpPath}</code></p>
          </div>
          <div className="section" style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10 }}>
            <div className="section-title"><span>Workspace</span></div>
            <p style={{ color: "var(--text-2)", lineHeight: 1.6, marginTop: 0 }}>Designs and assets are stored as files in:</p>
            <div className="code" style={{ fontSize: 11 }}>{health?.workspace ?? "…"}</div>
            <p style={{ color: "var(--text-3)", fontSize: 11 }}>Set <code>RUIS_WORKSPACE</code> to use a different folder (for example inside a git repo or synced drive).</p>
          </div>
        </div>
      </div>
    </div>
  );
}
