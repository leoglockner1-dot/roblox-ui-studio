/** Library (presets), Components, Assets and Styles (design tokens) panels. */
import { useMemo, useRef, useState } from "react";
import { createDocument, newId, resolveTree } from "../../core/document";
import { applyOps } from "../../core/ops";
import { PRESETS } from "../../core/presets";
import { buildNodes } from "../../core/spec";
import { FONT_FAMILIES, WEIGHT_NAMES } from "../../core/fonts";
import type { AssetRecord, DesignTokens, FontFace } from "../../core/types";
import { api } from "../api";
import * as A from "../actions";
import { Thumb } from "../render/Thumb";
import { store, useEditor } from "../store";
import { ColorField, NumberField, Select } from "../ui/fields";
import { Icon } from "../ui/icons";

const dragData = (kind: string, id: string) => (e: React.DragEvent) => {
  e.dataTransfer.setData("application/x-ruis", JSON.stringify({ kind, id }));
  e.dataTransfer.effectAllowed = "copy";
};

// ------------------------------------------------------------ presets

/** Build each preset once into a scratch document for thumbnails. */
function usePresetTrees(version: number) {
  return useMemo(() => {
    const out = new Map<string, { tree: ReturnType<typeof resolveTree>; w: number; h: number }>();
    for (const p of PRESETS) {
      try {
        let d = createDocument("thumb");
        const nodes = buildNodes(d, p.spec, null, "root", { lenientTokens: true });
        d = applyOps(d, [{ type: "insert", nodes, pageId: d.pages[0].id }]).doc;
        const size = nodes[0].props.Size as { xs: number; xo: number; ys: number; yo: number } | undefined;
        // Scale-sized presets (templates) are previewed inside a 1280×720 screen.
        const scaled = !!size && (size.xs > 0 || size.ys > 0);
        const w = scaled ? 1280 : Math.max(24, size?.xo ?? 100);
        const h = scaled ? 720 : Math.max(24, size?.yo ?? 100);
        if (scaled) {
          const screen = { id: newId(), className: "ScreenGui", name: "S", parent: null, children: [nodes[0].id], props: { IgnoreGuiInset: true } };
          const d2 = { ...d, nodes: { ...d.nodes, [screen.id]: screen, [nodes[0].id]: { ...d.nodes[nodes[0].id], parent: screen.id } } };
          out.set(p.id, { tree: resolveTree(d2 as never, screen.id), w, h });
        } else out.set(p.id, { tree: resolveTree(d, nodes[0].id), w, h });
      } catch {
        /* a broken preset just has no thumbnail */
      }
    }
    return out;
  }, [version]);
}

export function LibraryPanel() {
  const v = useEditor((s) => s.fontsVersion);
  const trees = usePresetTrees(v);
  const [q, setQ] = useState("");
  const cats = [...new Set(PRESETS.map((p) => p.category))];
  const match = (p: (typeof PRESETS)[number]) => !q || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q.toLowerCase());
  return (
    <div className="panel-scroll">
      <div className="search"><input className="input" placeholder="Search presets" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></div>
      {cats.map((c) => {
        const items = PRESETS.filter((p) => p.category === c && match(p));
        if (!items.length) return null;
        return (
          <div key={c}>
            <div className="lib-cat">{c}</div>
            <div className="lib-grid">
              {items.map((p) => {
                const t = trees.get(p.id);
                return (
                  <div key={p.id} className="lib-item" draggable onDragStart={dragData("preset", p.id)} onClick={() => A.insertPreset(p.id)} title={`${p.description}\nClick to insert into the selected frame, or drag onto the canvas.`}>
                    <div className="thumb">{t?.tree && <Thumb tree={t.tree} w={t.w} h={t.h} maxW={104} maxH={68} version={v} />}</div>
                    <div className="label">{p.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ components

export function ComponentsPanel() {
  const doc = useEditor((s) => s.doc)!;
  const v = useEditor((s) => s.fontsVersion);
  const comps = Object.values(doc.components);
  if (!comps.length)
    return (
      <div className="empty">
        No components yet.<br />Select an element and press <b>Ctrl/⌘ + Alt + K</b> (or right-click → Create component). Instances update when you edit the main component.
      </div>
    );
  const sets = new Map<string, typeof comps>();
  for (const c of comps) {
    const k = c.variantOf?.setName ?? c.name;
    sets.set(k, [...(sets.get(k) ?? []), c]);
  }
  return (
    <div className="panel-scroll">
      {[...sets].map(([setName, list]) => (
        <div key={setName}>
          {list.length > 1 && <div className="lib-cat">{setName} · {list.length} variants</div>}
          <div className="lib-grid">
            {list.map((c) => {
              const tree = resolveTree(doc, c.rootId);
              const box = A.boxOf(c.rootId);
              const count = Object.values(doc.nodes).filter((n) => n.instance?.componentId === c.id).length;
              return (
                <div key={c.id} className="lib-item" draggable onDragStart={dragData("component", c.id)} onClick={() => A.insertComponent(c.id)} title="Click to insert into the selected frame, or drag onto the canvas">
                  <div className="thumb">{tree && <Thumb tree={tree} w={Math.max(10, box?.w ?? 100)} h={Math.max(10, box?.h ?? 100)} maxW={104} maxH={68} version={v} />}</div>
                  <div className="label" style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.variantOf ? Object.values(c.variantOf.values).join(", ") : c.name}</span>
                    <span style={{ color: "var(--text-3)", cursor: "pointer" }} title="Go to main component" onClick={(e) => { e.stopPropagation(); A.goToMaster(c.id); }}>{count}↗</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ assets

export function AssetsPanel() {
  const assets = useEditor((s) => s.assets);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "images" | "references">("all");
  const [folder, setFolder] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folders = [...new Set(assets.map((a) => a.folder).filter(Boolean))].sort();
  const list = assets.filter((a) =>
    (filter === "all" || (filter === "references" ? a.reference : !a.reference)) &&
    (folder === null || a.folder === folder || a.folder.startsWith(folder + "/")) &&
    (!q || `${a.name} ${a.folder} ${a.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  const sel = assets.find((a) => a.id === selected);

  const upload = async (files: FileList | File[], reference = filter === "references") => {
    for (const f of [...files]) {
      try {
        await api.uploadAsset(f, folder ?? "", reference);
      } catch (e) {
        store.toast(`${f.name}: ${(e as Error).message}`, "error");
      }
    }
    await store.loadAssets();
  };

  return (
    <div
      className={`panel-scroll${over ? " dropzone-active" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files); }}
    >
      <div className="section" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn primary small" onClick={() => fileRef.current?.click()}><Icon.upload size={12} /> Import</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} />
        <Select value={filter} options={[{ value: "all", label: "All" }, { value: "images", label: "UI images" }, { value: "references", label: "References" }]} onChange={(v) => setFilter(v as typeof filter)} />
      </div>
      <div className="search"><input className="input" placeholder="Search assets" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></div>
      {folders.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "8px 12px 0" }}>
          <button className={`pill${folder === null ? " accent" : ""}`} style={{ border: 0, cursor: "pointer" }} onClick={() => setFolder(null)}>All</button>
          {folders.map((f) => <button key={f} className={`pill${folder === f ? " accent" : ""}`} style={{ border: 0, cursor: "pointer" }} onClick={() => setFolder(f)}><Icon.folder size={10} /> {f}</button>)}
        </div>
      )}
      {!list.length && <div className="empty">{assets.length ? "No matching assets." : "Drop PNG/JPG/SVG files here, or click Import. Reference images are for inspiration and are never exported."}</div>}
      <div className="lib-grid">
        {list.map((a) => (
          <div key={a.id} className="lib-item" draggable onDragStart={dragData("asset", a.id)} onClick={() => setSelected(a.id)} onDoubleClick={() => A.insertImageAsset(a.id)} style={selected === a.id ? { borderColor: "var(--accent)" } : undefined} title={`${a.name}\nDouble-click to insert / apply to the selected image`}>
            <div className="thumb checker">
              <img className="asset-thumb" src={api.assetUrl(a.id)} draggable={false} />
              <span className={`asset-badge ${a.reference ? "ref" : a.robloxAssetId ? "ok" : "local"}`}>{a.reference ? "Reference" : a.robloxAssetId ? "Roblox ✓" : "Local"}</span>
            </div>
            <div className="label">{a.name}</div>
          </div>
        ))}
      </div>
      {sel && <AssetDetails a={sel} onClose={() => setSelected(null)} />}
    </div>
  );
}

function AssetDetails({ a, onClose }: { a: AssetRecord; onClose: () => void }) {
  const save = async (patch: Partial<AssetRecord>) => {
    try {
      await api.updateAsset(a.id, patch);
      await store.loadAssets();
    } catch (e) {
      store.toast((e as Error).message, "error");
    }
  };
  const field = (label: string, value: string, key: keyof AssetRecord, placeholder?: string) => (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <div className="field">
        <input defaultValue={value} key={`${a.id}${key}${value}`} placeholder={placeholder} onBlur={(e) => e.target.value !== value && void save({ [key]: e.target.value } as never)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      </div>
    </div>
  );
  return (
    <div className="section" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="section-title"><span>Asset</span><button className="icon-btn" onClick={onClose}><Icon.close /></button></div>
      {field("Name", a.name, "name")}
      {field("Folder", a.folder, "folder", "e.g. Icons/Currency")}
      {!a.reference && field("Roblox ID", a.robloxAssetId ?? "", "robloxAssetId", "upload to Roblox, paste id")}
      <div className="prop-row"><span className="prop-label">Size</span><span style={{ color: "var(--text-2)" }}>{a.width ?? "?"}×{a.height ?? "?"} · {(a.bytes / 1024).toFixed(1)} KB · {a.mime.replace("image/", "")}</span></div>
      <div className="prop-row"><span className="prop-label">Reference</span><label className="toggle"><input type="checkbox" checked={!!a.reference} onChange={(e) => void save({ reference: e.target.checked })} /> inspiration only</label></div>
      <p style={{ color: "var(--text-3)", fontSize: 11, lineHeight: 1.5 }}>
        {a.reference
          ? "Reference images can be placed on the canvas (drag them there) for inspiration. They are never exported."
          : a.robloxAssetId
            ? `Exports as rbxassetid://${a.robloxAssetId}.`
            : "Local images only preview here. Upload the file to Roblox (Creator Hub or Studio Asset Manager), then paste its asset id above — export uses that id."}
      </p>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn small" onClick={() => A.insertImageAsset(a.id)}>Insert / apply</button>
        <button className="btn small danger" onClick={async () => {
          if (!confirm(`Delete asset "${a.name}"? Designs using it will show it as missing.`)) return;
          await api.deleteAsset(a.id);
          await store.loadAssets();
          onClose();
        }}>Delete</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ styles (tokens)

export function StylesPanel() {
  const doc = useEditor((s) => s.doc)!;
  const tokens = doc.tokens;
  const setTokens = (t: DesignTokens, label = "Edit tokens") => store.apply([{ type: "setTokens", tokens: t }], label);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of Object.values(doc.nodes)) for (const t of Object.values(n.tokens ?? {})) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [doc.nodes]);
  const nameInput = (value: string, onChange: (v: string) => void) => (
    <input className="name" defaultValue={value} key={value} onBlur={(e) => e.target.value.trim() && e.target.value !== value && onChange(e.target.value.trim())} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
  const remove = (kind: keyof DesignTokens, id: string) => {
    if (usage.get(id) && !confirm(`This token is used by ${usage.get(id)} element(s). They keep their current values. Remove?`)) return;
    // Detach bound nodes first so values are kept.
    const ops = Object.values(doc.nodes).filter((n) => Object.values(n.tokens ?? {}).includes(id)).map((n) => {
      const t = Object.fromEntries(Object.entries(n.tokens!).filter(([, v]) => v !== id));
      return { type: "update" as const, id: n.id, fields: { tokens: Object.keys(t).length ? t : null } };
    });
    store.apply([...ops, { type: "setTokens", tokens: { ...tokens, [kind]: (tokens[kind] as { id: string }[]).filter((x) => x.id !== id) } as DesignTokens }], "Remove token");
  };
  return (
    <div className="panel-scroll">
      <div className="section">
        <div className="section-title"><span>Colours</span><button className="icon-btn" data-tip="Add colour" onClick={() => setTokens({ ...tokens, colors: [...tokens.colors, { id: newId("c"), name: `Colour ${tokens.colors.length + 1}`, value: "#4F7CFF" }] })}><Icon.plus /></button></div>
        {tokens.colors.map((c) => (
          <div key={c.id} className="token-row">
            <div style={{ width: 120 }}><ColorField value={c.value} onChange={(v, f) => f && setTokens({ ...tokens, colors: tokens.colors.map((x) => (x.id === c.id ? { ...x, value: v } : x)) }, "Edit colour token")} /></div>
            {nameInput(c.name, (name) => setTokens({ ...tokens, colors: tokens.colors.map((x) => (x.id === c.id ? { ...x, name } : x)) }))}
            <span style={{ color: "var(--text-3)", fontSize: 10 }}>{usage.get(c.id) ?? ""}</span>
            <button className="icon-btn" onClick={() => remove("colors", c.id)}><Icon.minus /></button>
          </div>
        ))}
      </div>
      <div className="section">
        <div className="section-title"><span>Spacing & radius</span><button className="icon-btn" data-tip="Add number" onClick={() => setTokens({ ...tokens, numbers: [...tokens.numbers, { id: newId("s"), name: `Space ${tokens.numbers.length + 1}`, value: 8 }] })}><Icon.plus /></button></div>
        {tokens.numbers.map((n) => (
          <div key={n.id} className="token-row">
            <div style={{ width: 70 }}><NumberField value={n.value} digits={1} onChange={(v, f) => f && setTokens({ ...tokens, numbers: tokens.numbers.map((x) => (x.id === n.id ? { ...x, value: v } : x)) })} /></div>
            {nameInput(n.name, (name) => setTokens({ ...tokens, numbers: tokens.numbers.map((x) => (x.id === n.id ? { ...x, name } : x)) }))}
            <span style={{ color: "var(--text-3)", fontSize: 10 }}>{usage.get(n.id) ?? ""}</span>
            <button className="icon-btn" onClick={() => remove("numbers", n.id)}><Icon.minus /></button>
          </div>
        ))}
      </div>
      <div className="section">
        <div className="section-title"><span>Text styles</span><button className="icon-btn" data-tip="Add text style" onClick={() => setTokens({ ...tokens, textStyles: [...tokens.textStyles, { id: newId("t"), name: `Text ${tokens.textStyles.length + 1}`, font: { family: "BuilderSans", weight: "Medium", style: "Normal" }, size: 16 }] })}><Icon.plus /></button></div>
        {tokens.textStyles.map((t) => {
          const set = (patch: Partial<typeof t>) => setTokens({ ...tokens, textStyles: tokens.textStyles.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) }, "Edit text style");
          const css = FONT_FAMILIES.find((f) => f.family === t.font.family)?.web ?? "Inter";
          return (
            <div key={t.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <div className="token-row">
                {nameInput(t.name, (name) => set({ name }))}
                <span style={{ color: "var(--text-3)", fontSize: 10 }}>{usage.get(t.id) ?? ""}</span>
                <button className="icon-btn" onClick={() => remove("textStyles", t.id)}><Icon.minus /></button>
              </div>
              <div style={{ fontFamily: css, fontWeight: { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Heavy: 900 }[t.font.weight], fontSize: Math.min(28, t.size), color: "var(--text)", padding: "2px 4px", whiteSpace: "nowrap", overflow: "hidden" }}>Aa Quest Rewards 123</div>
              <div className="fields" style={{ marginTop: 4 }}>
                <Select value={t.font.family} options={FONT_FAMILIES.map((f) => ({ value: f.family, label: f.label }))} onChange={(family) => set({ font: { ...t.font, family } })} />
                <Select value={t.font.weight} options={WEIGHT_NAMES} onChange={(weight) => set({ font: { ...t.font, weight: weight as FontFace["weight"] } })} />
                <div style={{ width: 60 }}><NumberField value={t.size} digits={0} min={1} max={100} onChange={(size, f) => f && set({ size })} /></div>
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ color: "var(--text-3)", fontSize: 11, padding: "0 12px 12px", lineHeight: 1.5 }}>Bind a property to a token with the ◉ button next to colour fields, or the text-style picker in the Text section. Changing a token updates every bound element.</p>
    </div>
  );
}
