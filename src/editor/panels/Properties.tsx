/** Right sidebar: properties of the selection, driven by the class registry. */
import { useState, type ReactNode } from "react";
import { CLASSES, MODIFIER_CLASSES, isDesignProp, type PropDef, type PropGroup } from "../../core/classes";
import { propOf, type ResolvedNode } from "../../core/document";
import { DEVICES, findDevice } from "../../core/devices";
import { propOps, splitRef } from "../../core/edit";
import type { Op } from "../../core/ops";
import type { PropValue } from "../../core/types";
import * as A from "../actions";
import { store, useEditor } from "../store";
import { NumberField, PropEditor, PropRow, Select, TextArea } from "../ui/fields";
import { Icon, classIcon } from "../ui/icons";

const GROUP_ORDER: PropGroup[] = ["Screen", "Transform", "Appearance", "Text", "Image", "Scrolling", "Layout", "Behavior", "Modifier"];
const GROUP_LABEL: Record<PropGroup, string> = { Screen: "Screen", Transform: "Position & size", Appearance: "Appearance", Text: "Text", Image: "Image", Scrolling: "Scrolling", Layout: "Layout", Behavior: "Behavior", Modifier: "Properties" };
/** Props hidden from the main sections (handled specially). */
const HIDDEN = new Set(["Name"]);

function equal(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Auto-key: while the timeline shows an animation that has a track for this
 * node+property, edits set a keyframe at the playhead instead of the base value.
 */
function autoKeyOps(ids: string[], name: string, value: PropValue): Op[] | null {
  const s = store.state;
  if (!s.timelineOpen || !s.anim.id) return null;
  const anim = s.doc!.animations[s.anim.id];
  if (!anim || !ids.every((id) => anim.tracks.some((t) => t.nodeId === id && t.property === name))) return null;
  const t = Math.round(s.anim.time * 100) / 100;
  const tracks = anim.tracks.map((tr) => {
    if (!ids.includes(tr.nodeId) || tr.property !== name) return tr;
    const existing = tr.keyframes.find((k) => Math.abs(k.time - t) < 0.005);
    const rest = tr.keyframes.filter((k) => k !== existing);
    const kf = existing ? { ...existing, value } : { time: t, value, easingStyle: "Quad" as const, easingDirection: "Out" as const };
    return { ...tr, keyframes: [...rest, kf].sort((a, b) => a.time - b.time) };
  });
  return [{ type: "setAnimation", id: anim.id, anim: { ...anim, tracks } }];
}

/** Edit a property on many nodes, as a live gesture while scrubbing. */
export function editProp(ids: string[], name: string, value: PropValue, final: boolean) {
  const ops: Op[] = autoKeyOps(ids, name, value) ?? ids.map((id) => propOps(id, { [name]: value }));
  if (!final) {
    if (!store.inGesture) store.beginGesture();
    store.previewGesture(ops);
    return;
  }
  if (store.inGesture) {
    store.previewGesture(ops);
    store.commitGesture(`Edit ${name}`);
  } else store.apply(ops, `Edit ${name}`);
}

function endScrub(name: string) {
  if (store.inGesture) store.commitGesture(`Edit ${name}`);
}

function overriddenProps(id: string): Set<string> {
  const d = store.state.doc!;
  const r = splitRef(id);
  if (r.instanceRoot) return new Set(Object.keys(d.nodes[r.instanceRoot]?.instance?.overrides[r.overrideKey!] ?? {}));
  const n = d.nodes[id];
  if (n?.instance) return new Set(Object.keys(n.props));
  return new Set();
}

function resetOverride(id: string, prop: string) {
  const d = store.state.doc!;
  const r = splitRef(id);
  if (r.instanceRoot) store.apply([{ type: "override", instanceId: r.instanceRoot, key: r.overrideKey!, props: { [prop]: null } }], `Reset ${prop}`);
  else if (d.nodes[id]?.instance) store.apply([{ type: "update", id, props: { [prop]: null } }], `Reset ${prop}`);
}

/** Generic rows for a set of nodes sharing a class (or common props). */
function PropRows({ nodes, defs }: { nodes: ResolvedNode[]; defs: PropDef[] }) {
  const ids = nodes.map((n) => n.id);
  const doc = useEditor((s) => s.doc)!;
  const overridden = nodes.length === 1 ? overriddenProps(ids[0]) : new Set<string>();
  const stored = nodes.length === 1 && A.isStored(ids[0]) ? doc.nodes[ids[0]] : null;
  return (
    <>
      {defs.map((def) => {
        const values = nodes.map((n) => propOf(n, def.name));
        const mixed = values.some((v) => !equal(v, values[0]));
        const tokenId = stored?.tokens?.[def.name];
        const isOver = overridden.has(def.name);
        const bindToken = stored && def.type === "color"
          ? (tid: string | null) => {
              const tokens = { ...(stored.tokens ?? {}) };
              const ops: Op[] = [];
              if (tid) tokens[def.name] = tid;
              else {
                delete tokens[def.name];
                // keep the current look when detaching
                ops.push({ type: "update", id: stored.id, props: { [def.name]: propOf(nodes[0], def.name) } });
              }
              ops.push({ type: "update", id: stored.id, fields: { tokens: Object.keys(tokens).length ? tokens : null } });
              store.apply(ops, tid ? "Bind token" : "Detach token");
            }
          : undefined;
        return (
          <PropRow
            key={def.name}
            label={pretty(def.name)}
            className={isOver ? "overridden" : tokenId ? "bound" : ""}
            title={isOver ? `${def.name} — overridden in this instance. Click to reset to the main component.` : `${def.name}${def.description ? ` — ${def.description}` : ""}`}
            onLabelPointerDown={isOver ? () => resetOverride(ids[0], def.name) : undefined}
          >
            <PropEditor
              def={def}
              value={values[0]}
              mixed={mixed}
              tokenId={tokenId}
              onBindToken={bindToken}
              onChange={(v, final) => editProp(ids, def.name, v, final)}
              onScrubEnd={() => endScrub(def.name)}
            />
          </PropRow>
        );
      })}
    </>
  );
}

function pretty(name: string) {
  return name
    .replace(/^_/, "")
    .replace(/Transparency$/, " Transp.")
    .replace(/^Background/, "Bg ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/Color3$/, "Color")
    .replace(/ Color 3$/, " Color");
}

function Section({ title, children, actions, defaultOpen = true }: { title: ReactNode; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <div className="section-title">
        <span style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }} onClick={() => setOpen(!open)}>
          {open ? <Icon.chevronDown size={12} /> : <Icon.chevronRight size={12} />} {title}
        </span>
        <div className="actions">{actions}</div>
      </div>
      {open && children}
    </div>
  );
}

export function PropertiesPanel() {
  const doc = useEditor((s) => s.doc)!;
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.fontsVersion);
  const nodes = selection.map((id) => A.resolvedOf(id)).filter((n): n is ResolvedNode => !!n);

  if (selection.length === 1 && selection[0].startsWith("ref:")) return <ReferenceProps id={selection[0].slice(4)} />;
  if (!nodes.length) return <DocumentProps />;

  const classes = [...new Set(nodes.map((n) => n.className))];
  const first = nodes[0];
  const stored = A.isStored(first.id) ? doc.nodes[first.id] : null;
  // Common props across all selected classes.
  const commonDefs = CLASSES[classes[0]].props.filter((p) => !HIDDEN.has(p.name) && classes.every((c) => CLASSES[c].props.some((q) => q.name === p.name)));
  const isTop = stored && !stored.parent;
  const box = A.boxOf(first.id);
  const laidOut = !!box?.laidOut;
  const kind = CLASSES[first.className].kind;

  const groups = new Map<PropGroup, PropDef[]>();
  for (const d of commonDefs) {
    if (isTop && d.name === "Position") continue;
    if (laidOut && d.name === "Position") continue;
    if (isDesignProp(d.name) && d.name !== "_CurrentPage") continue;
    groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
  }
  const modifierKids = nodes.length === 1 ? first.children.filter((c) => CLASSES[c.className].kind !== "gui") : [];
  const ids = nodes.map((n) => n.id);

  return (
    <div>
      <Header nodes={nodes} />
      {nodes.length === 1 && first.className === "ScreenGui" && isTop && <ScreenSize id={first.id} />}
      {GROUP_ORDER.filter((g) => groups.has(g)).map((g) => (
        <Section
          key={g}
          title={kind === "gui" || kind === "root" ? GROUP_LABEL[g] : first.className}
          actions={g === "Transform" && kind === "gui" && !isTop ? <UnitsMenu ids={ids} /> : undefined}
        >
          {g === "Transform" && laidOut && <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 6 }}>Position is controlled by the parent's layout. Drag on the canvas to reorder, or change LayoutOrder.</div>}
          {g === "Text" && stored && <TextStylePicker id={stored.id} />}
          <PropRows nodes={nodes} defs={groups.get(g)!} />
        </Section>
      ))}
      {kind === "gui" && nodes.length === 1 && <ModifiersSection node={first} modifiers={modifierKids} />}
      {stored && <NotesSection id={stored.id} notes={stored.notes ?? ""} />}
    </div>
  );
}

function Header({ nodes }: { nodes: ResolvedNode[] }) {
  const doc = useEditor((s) => s.doc)!;
  const n = nodes[0];
  const stored = A.isStored(n.id) ? doc.nodes[n.id] : null;
  const Ico = classIcon(n.className, { instance: !!n.instanceOf, master: !!n.masterOf });
  if (nodes.length > 1) {
    return (
      <div className="inspector-header">
        <div style={{ fontWeight: 600 }}>{nodes.length} selected</div>
        <div className="cls">{[...new Set(nodes.map((x) => x.className))].join(", ")}</div>
      </div>
    );
  }
  const comp = n.instanceOf ? doc.components[n.instanceOf] : n.masterOf ? doc.components[n.masterOf] : null;
  return (
    <div className="inspector-header">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: comp || n.instanceRoot ? "var(--component)" : "var(--text-3)" }}><Ico /></span>
        {stored ? (
          <div className="field" style={{ flex: 1 }}>
            <input key={n.id + n.name} defaultValue={n.name} onBlur={(e) => e.target.value !== n.name && A.renameNode(n.id, e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} style={{ fontWeight: 600 }} />
          </div>
        ) : (
          <span style={{ fontWeight: 600 }}>{n.name}</span>
        )}
      </div>
      <div className="cls">
        <span className="pill">{n.className}</span>
        {n.instanceOf && <span className="pill component">◇ {comp?.name ?? "missing component"}</span>}
        {n.masterOf && <span className="pill component">◆ Main component</span>}
        {n.instanceRoot && <span className="pill component">inside instance — edits are overrides</span>}
        {stored?.locked && <span className="pill">locked</span>}
      </div>
      {n.instanceOf && stored && (
        <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
          <button className="btn small" onClick={() => A.goToMaster(n.instanceOf!)}>Go to main</button>
          <button className="btn small" onClick={() => A.resetOverrides(stored.id)}>Reset overrides</button>
          <button className="btn small" onClick={A.detachSelection}>Detach</button>
          <VariantSwap id={stored.id} componentId={n.instanceOf} />
        </div>
      )}
      {n.masterOf && comp && (
        <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
          <div className="field" style={{ flex: 1 }}>
            <input key={comp.id + comp.name} defaultValue={comp.name} title="Component name" onBlur={(e) => e.target.value.trim() && e.target.value !== comp.name && store.apply([{ type: "setComponent", id: comp.id, def: { ...comp, name: e.target.value.trim() } }], "Rename component")} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          </div>
          <button className="btn small" onClick={() => A.insertComponent(comp.id)}>Insert</button>
        </div>
      )}
    </div>
  );
}

function VariantSwap({ id, componentId }: { id: string; componentId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const c = doc.components[componentId];
  if (!c?.variantOf) return null;
  const variants = Object.values(doc.components).filter((x) => x.variantOf?.setName === c.variantOf!.setName);
  return (
    <div style={{ flex: 1, minWidth: 120 }}>
      <Select
        value={componentId}
        options={variants.map((v) => ({ value: v.id, label: Object.entries(v.variantOf!.values).map(([k, val]) => `${k}=${val}`).join(", ") }))}
        onChange={(cid) => {
          const inst = doc.nodes[id].instance!;
          store.apply([{ type: "update", id, fields: { instance: { componentId: cid, overrides: inst.overrides } } }], "Swap variant", { silent: true }) ||
            store.apply([{ type: "update", id, fields: { instance: { componentId: cid, overrides: {} } } }], "Swap variant");
        }}
      />
    </div>
  );
}

function UnitsMenu({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button className="icon-btn" data-tip="Convert Scale ⇄ Offset" onClick={() => setOpen(!open)}><Icon.dots /></button>
      {open && (
        <div className="popover" style={{ right: 0, top: 26, padding: 4, width: 190 }} onMouseLeave={() => setOpen(false)}>
          {(["Size", "Position"] as const).flatMap((p) =>
            (["scale", "offset"] as const).map((to) => (
              <div key={p + to} className="menu-item" onClick={() => { A.convertUnits(ids, p, to); setOpen(false); }}>
                {p} → {to === "scale" ? "Scale (responsive)" : "Offset (pixels)"}
              </div>
            )),
          )}
        </div>
      )}
    </div>
  );
}

function TextStylePicker({ id }: { id: string }) {
  const doc = useEditor((s) => s.doc)!;
  const n = doc.nodes[id];
  const styles = doc.tokens.textStyles;
  const cur = n.tokens?.["$textStyle"];
  if (!styles.length) return null;
  return (
    <PropRow label="Text style" className={cur ? "bound" : ""}>
      <Select
        value={cur ?? ""}
        options={[{ value: "", label: "— none —" }, ...styles.map((s) => ({ value: s.id, label: `${s.name} · ${s.size}` }))]}
        onChange={(v) => {
          const tokens = { ...(n.tokens ?? {}) };
          if (v) tokens["$textStyle"] = v;
          else delete tokens["$textStyle"];
          const ops: Op[] = [{ type: "update", id, fields: { tokens: Object.keys(tokens).length ? tokens : null } }];
          if (!v && cur) {
            const ts = styles.find((s) => s.id === cur);
            if (ts) ops.unshift({ type: "update", id, props: { FontFace: ts.font, TextSize: ts.size } });
          }
          store.apply(ops, "Text style");
        }}
      />
    </PropRow>
  );
}

function ModifiersSection({ node, modifiers }: { node: ResolvedNode; modifiers: ResolvedNode[] }) {
  const [adding, setAdding] = useState(false);
  const canEdit = A.isStored(node.id) && !node.instanceOf;
  const existing = new Set(modifiers.map((m) => m.className));
  return (
    <Section
      title={<>Modifiers & layout <span className="muted">{modifiers.length || ""}</span></>}
      actions={
        canEdit && (
          <div style={{ position: "relative" }}>
            <button className="icon-btn" data-tip="Add UICorner, UIStroke, UIListLayout…" onClick={() => setAdding(!adding)}><Icon.plus /></button>
            {adding && (
              <div className="popover" style={{ right: 0, top: 26, padding: 4, width: 220 }} onMouseLeave={() => setAdding(false)}>
                {MODIFIER_CLASSES.map((c) => (
                  <div key={c} className={`menu-item${CLASSES[c].onePerParent && existing.has(c) ? " disabled" : ""}`} onClick={() => { A.addModifier(node.id, c); setAdding(false); }}>
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      }
    >
      {!modifiers.length && <div style={{ color: "var(--text-3)", fontSize: 11 }}>{canEdit ? "Rounded corners, outlines, gradients, padding, list/grid layouts and constraints are Roblox modifier objects. Add them with +." : "Edit modifiers on the main component."}</div>}
      {modifiers.map((m) => (
        <div key={m.id} className="modifier-card">
          <div className="head">
            <span style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => store.select([m.id])}>{m.className}</span>
            {A.isStored(m.id) && (
              <button className="icon-btn" data-tip="Remove" onClick={() => store.apply([{ type: "remove", id: m.id }], `Remove ${m.className}`)}><Icon.minus /></button>
            )}
          </div>
          <PropRows nodes={[m]} defs={CLASSES[m.className].props.filter((p) => !isDesignProp(p.name) || p.name === "_CurrentPage")} />
        </div>
      ))}
    </Section>
  );
}

function NotesSection({ id, notes }: { id: string; notes: string }) {
  return (
    <Section title="Notes" defaultOpen={!!notes}>
      <TextArea value={notes} onChange={(v) => A.setFields(id, { notes: v || null }, "Edit notes")} />
      <div style={{ color: "var(--text-3)", fontSize: 10.5, marginTop: 4 }}>Design notes for you and Claude. Not exported.</div>
    </Section>
  );
}

function ScreenSize({ id }: { id: string }) {
  const doc = useEditor((s) => s.doc)!;
  const n = doc.nodes[id];
  const c = n.canvas ?? { x: 0, y: 0, w: 1920, h: 1080 };
  const set = (patch: Partial<typeof c>) => store.apply([{ type: "update", id, fields: { canvas: { ...c, ...patch } } }], "Screen size");
  const dev = findDevice(c.device);
  return (
    <Section title="Device">
      <PropRow label="Preset">
        <Select value={dev?.id ?? ""} options={[{ value: "", label: "Custom" }, ...DEVICES.map((d) => ({ value: d.id, label: d.name }))]} onChange={(v) => {
          const d = findDevice(v);
          if (d) set({ w: d.width, h: d.height, device: d.id });
        }} />
      </PropRow>
      <PropRow label="Size">
        <div className="fields">
          <NumberField tag="W" value={c.w ?? 1920} digits={0} min={100} onChange={(w, f) => f && set({ w, device: undefined })} />
          <NumberField tag="H" value={c.h ?? 1080} digits={0} min={100} onChange={(h, f) => f && set({ h, device: undefined })} />
          <button className="icon-btn" data-tip="Rotate" onClick={() => set({ w: c.h, h: c.w, device: undefined })}><Icon.rotate /></button>
        </div>
      </PropRow>
      <div style={{ color: "var(--text-3)", fontSize: 10.5, marginTop: 6 }}>The canvas simulates this screen size. Use Preview (P) to compare devices.</div>
    </Section>
  );
}

function ReferenceProps({ id }: { id: string }) {
  const doc = useEditor((s) => s.doc)!;
  const pageId = useEditor((s) => s.pageId);
  const page = doc.pages.find((p) => p.id === pageId)!;
  const r = page.references?.find((x) => x.id === id);
  if (!r) return <DocumentProps />;
  const set = (patch: Partial<typeof r>, final: boolean) => {
    const ops: Op[] = [{ type: "updatePage", id: page.id, references: page.references!.map((x) => (x.id === id ? { ...x, ...patch } : x)) }];
    if (!final) {
      if (!store.inGesture) store.beginGesture();
      store.previewGesture(ops);
    } else if (store.inGesture) {
      store.previewGesture(ops);
      store.commitGesture("Edit reference");
    } else store.apply(ops, "Edit reference");
  };
  return (
    <div>
      <div className="inspector-header"><div style={{ fontWeight: 600 }}>Reference image</div><div className="cls"><span className="pill accent">canvas only · never exported</span></div></div>
      <Section title="Reference">
        <PropRow label="Opacity"><NumberField value={r.opacity} min={0.05} max={1} step={0.05} onChange={(v, f) => set({ opacity: v }, f)} onScrubEnd={() => store.inGesture && store.commitGesture("Edit reference")} /></PropRow>
        <PropRow label="Position"><div className="fields"><NumberField tag="X" value={r.x} digits={0} onChange={(x, f) => f && set({ x }, true)} /><NumberField tag="Y" value={r.y} digits={0} onChange={(y, f) => f && set({ y }, true)} /></div></PropRow>
        <PropRow label="Width"><NumberField value={r.w} digits={0} min={10} onChange={(w, f) => f && set({ w, h: Math.round(w * (r.h / r.w)) }, true)} /></PropRow>
        <PropRow label="Locked"><label className="toggle"><input type="checkbox" checked={!!r.locked} onChange={(e) => set({ locked: e.target.checked }, true)} /> prevent moving</label></PropRow>
      </Section>
    </div>
  );
}

function DocumentProps() {
  const doc = useEditor((s) => s.doc)!;
  const issues = useEditor((s) => s.issues);
  return (
    <div>
      <div className="inspector-header">
        <div style={{ fontWeight: 600 }}>{doc.name}</div>
        <div className="cls">{doc.pages.length} page(s) · {Object.keys(doc.nodes).length} objects · {Object.keys(doc.components).length} components · rev {doc.revision}</div>
      </div>
      <Section title="Description">
        <TextArea value={doc.meta.description ?? ""} onChange={(v) => store.apply([{ type: "setDoc", meta: { ...doc.meta, description: v } }], "Edit description")} />
        <div style={{ color: "var(--text-3)", fontSize: 10.5, marginTop: 4 }}>What is this UI for? Claude reads this when it inspects the document.</div>
      </Section>
      <Section title="Quick start">
        <div style={{ color: "var(--text-2)", fontSize: 11.5, lineHeight: 1.6 }}>
          <div>• <b>F</b> frame, <b>T</b> text, <b>B</b> button, <b>I</b> image, <b>S</b> scrolling frame — drag inside a screen.</div>
          <div>• Library tab: drop in ready-made buttons, cards, bars, popups.</div>
          <div>• Select something to edit Roblox properties here.</div>
          <div>• <b>P</b> preview on devices · <b>E</b> export to Roblox Studio.</div>
        </div>
      </Section>
      {issues.length > 0 && (
        <Section title={`Issues (${issues.length})`}>
          <div style={{ color: "var(--text-3)", fontSize: 11 }}>Open the ⚠ button in the toolbar for the full list.</div>
        </Section>
      )}
    </div>
  );
}
