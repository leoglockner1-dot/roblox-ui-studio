/** Pages list + layer tree with drag-and-drop reparenting, visibility, lock and rename. */
import { useEffect, useMemo, useState } from "react";
import { CLASSES, canParent } from "../../core/classes";
import { newId, propOf, type ResolvedNode } from "../../core/document";
import * as A from "../actions";
import { store, useEditor } from "../store";
import { Icon, classIcon } from "../ui/icons";
import { ContextMenu, type MenuState } from "../canvas/ContextMenu";

export function PagesList() {
  const doc = useEditor((s) => s.doc)!;
  const pageId = useEditor((s) => s.pageId);
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <div className="pages">
      <div className="section-title" style={{ padding: "2px 6px 4px", marginBottom: 0 }}>
        <span>Pages</span>
        <button className="icon-btn" data-tip="Add page" onClick={() => {
          const id = newId("pg");
          store.apply([{ type: "addPage", page: { id, name: `Page ${doc.pages.length + 1}`, children: [] } }], "Add page");
          store.setPage(id);
          setRenaming(id);
        }}>
          <Icon.plus />
        </button>
      </div>
      {doc.pages.map((p) => (
        <div key={p.id} className={`page-row${p.id === pageId ? " active" : ""}`} onClick={() => p.id !== pageId && store.setPage(p.id)} onDoubleClick={() => setRenaming(p.id)}>
          {renaming === p.id ? (
            <input
              autoFocus
              defaultValue={p.name}
              style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--accent)", borderRadius: 3, padding: "1px 4px", outline: "none" }}
              onBlur={(e) => {
                setRenaming(null);
                if (e.target.value.trim() && e.target.value !== p.name) store.apply([{ type: "updatePage", id: p.id, name: e.target.value }], "Rename page");
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <span style={{ flex: 1 }}>{p.name}</span>
          )}
          <span style={{ color: "var(--text-3)", fontSize: 10 }}>{p.children.length}</span>
          {doc.pages.length > 1 && p.id === pageId && (
            <button className="icon-btn" style={{ width: 18, height: 18 }} data-tip="Delete page" onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete page "${p.name}" and everything on it? (Undo is available)`)) store.apply([{ type: "removePage", id: p.id }], "Delete page");
            }}>
              <Icon.trash size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

type DropPos = "before" | "after" | "inside";

export function LayersPanel() {
  const doc = useEditor((s) => s.doc)!;
  const pageId = useEditor((s) => s.pageId);
  const selection = useEditor((s) => s.selection);
  const hover = useEditor((s) => s.hover);
  const showModifiers = useEditor((s) => s.showModifiers);
  useEditor((s) => s.fontsVersion);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const roots = store.scene();

  // Reveal the selection: expand its ancestors.
  useEffect(() => {
    if (!selection.length) return;
    const need: string[] = [];
    for (const id of selection) {
      let p = A.parentOf(id);
      while (p) {
        if (collapsed.has(p)) need.push(p);
        p = A.parentOf(p);
      }
    }
    if (need.length) setCollapsed((c) => new Set([...c].filter((x) => !need.includes(x))));
    // scroll into view
    requestAnimationFrame(() => document.querySelector(`[data-layer="${CSS.escape(selection[0])}"]`)?.scrollIntoView({ block: "nearest" }));
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default: collapse component instances' internals.
  const rows = useMemo(() => {
    const out: { n: ResolvedNode; depth: number; modifier: boolean; derived: boolean }[] = [];
    const walk = (n: ResolvedNode, depth: number) => {
      const modifier = CLASSES[n.className]?.kind === "modifier" || CLASSES[n.className]?.kind === "layout";
      if (modifier && !showModifiers) return;
      out.push({ n, depth, modifier, derived: !!n.instanceRoot });
      const isCollapsed = collapsed.has(n.id) || (n.instanceOf && !collapsed.has(`open:${n.id}`));
      if (isCollapsed) return;
      // modifiers first, then GUI children (matches Roblox Explorer sorting closely enough)
      const kids = [...n.children].sort((a, b) => Number(CLASSES[b.className]?.kind !== "gui") - Number(CLASSES[a.className]?.kind !== "gui"));
      for (const c of kids) walk(c, depth + 1);
    };
    for (const r of roots) walk(r.tree, 0);
    return out;
  }, [roots, collapsed, showModifiers]);

  const toggle = (n: ResolvedNode) => {
    setCollapsed((c) => {
      const s = new Set(c);
      if (n.instanceOf) {
        const k = `open:${n.id}`;
        s.has(k) ? s.delete(k) : s.add(k);
      } else s.has(n.id) ? s.delete(n.id) : s.add(n.id);
      return s;
    });
  };

  const onDragOver = (e: React.DragEvent, n: ResolvedNode) => {
    if (!e.dataTransfer.types.includes("application/x-ruis-layer")) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - rect.top) / rect.height;
    const container = A.isStored(n.id) && !doc.nodes[n.id]?.instance && (CLASSES[n.className].kind === "gui" || n.className === "ScreenGui");
    const pos: DropPos = f < 0.28 ? "before" : f > 0.72 && !(container && !collapsed.has(n.id) && n.children.length) ? "after" : container ? "inside" : f < 0.5 ? "before" : "after";
    setDrop({ id: n.id, pos });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("application/x-ruis-layer");
    const d = drop;
    setDrop(null);
    if (!id || !d || id === d.id || !A.isStored(d.id)) return;
    const target = doc.nodes[d.id];
    if (!target) return;
    const moving = doc.nodes[id];
    if (d.pos === "inside") {
      if (!canParent(target.className, moving.className)) return store.toast(`${moving.className} can't go inside ${target.className}`, "error");
      return A.moveNodeTo(id, target.id, target.children.length);
    }
    const parent = target.parent;
    if (parent ? !canParent(doc.nodes[parent].className, moving.className) : !canParent(null, moving.className)) return store.toast(`${moving.className} can't be placed there`, "error");
    const sibs = parent ? doc.nodes[parent].children : doc.pages.find((p) => p.id === pageId)!.children;
    let idx = sibs.indexOf(target.id) + (d.pos === "after" ? 1 : 0);
    const cur = sibs.indexOf(id);
    if (cur >= 0 && cur < idx) idx--;
    A.moveNodeTo(id, parent, idx);
  };

  if (!roots.length) return <div className="empty">This page is empty.<br />Add a screen with the toolbar, or ask Claude to build one.</div>;

  return (
    <div className="panel-scroll" onDragLeave={() => setDrop(null)}>
      <div className="section-title" style={{ padding: "8px 12px 4px", marginBottom: 0 }}>
        <span>Layers</span>
        <div className="actions">
          <button className={`icon-btn${showModifiers ? " on" : ""}`} data-tip={showModifiers ? "Hide modifiers (UICorner, UIStroke…)" : "Show modifiers"} onClick={() => store.set({ showModifiers: !showModifiers })}>
            <Icon.modifier />
          </button>
        </div>
      </div>
      {rows.map(({ n, depth, modifier, derived }) => {
        const selected = selection.includes(n.id);
        const kids = n.children.filter((c) => showModifiers || CLASSES[c.className]?.kind === "gui");
        const isCollapsed = collapsed.has(n.id) || (n.instanceOf && !collapsed.has(`open:${n.id}`));
        const visible = CLASSES[n.className]?.kind !== "gui" || propOf<boolean>(n, "Visible") !== false;
        const Ico = classIcon(n.className, { instance: !!n.instanceOf, master: !!n.masterOf });
        const stored = A.isStored(n.id) ? doc.nodes[n.id] : null;
        const cls = ["layer", selected && "selected", (n.instanceOf || n.masterOf || derived) && "component", n.instanceOf && "instance", modifier && "modifier", derived && "derived", hover === n.id && "hovered", !visible && "dim", drop?.id === n.id && `drop-${drop.pos}`].filter(Boolean).join(" ");
        return (
          <div
            key={n.id}
            data-layer={n.id}
            className={cls}
            style={{ paddingLeft: 6 + depth * 14 }}
            draggable={!!stored && renaming !== n.id}
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-ruis-layer", n.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => onDragOver(e, n)}
            onDrop={onDrop}
            onMouseEnter={() => store.set({ hover: n.id })}
            onMouseLeave={() => store.state.hover === n.id && store.set({ hover: null })}
            onClick={(e) => store.select([n.id], e.shiftKey || e.metaKey || e.ctrlKey ? "toggle" : "replace")}
            onDoubleClick={() => stored && setRenaming(n.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!selection.includes(n.id)) store.select([n.id]);
              setMenu({ x: e.clientX, y: e.clientY });
            }}
          >
            <span className="twisty" onClick={(e) => { e.stopPropagation(); toggle(n); }}>
              {kids.length ? isCollapsed ? <Icon.chevronRight size={12} /> : <Icon.chevronDown size={12} /> : null}
            </span>
            <span className="ico"><Ico size={14} /></span>
            <span className="name">
              {renaming === n.id ? (
                <input
                  autoFocus
                  defaultValue={n.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    setRenaming(null);
                    if (e.target.value !== n.name) A.renameNode(n.id, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                n.name
              )}
            </span>
            <span className="row-actions">
              {stored?.locked && <span className="on"><button className="icon-btn on" onClick={(e) => { e.stopPropagation(); A.toggleLock(n.id); }}><Icon.lock size={12} /></button></span>}
              {!stored?.locked && stored && (
                <button className="icon-btn" data-tip="Lock" onClick={(e) => { e.stopPropagation(); A.toggleLock(n.id); }}>
                  <Icon.unlock size={12} />
                </button>
              )}
              {CLASSES[n.className]?.kind === "gui" && (
                <span className={visible ? "" : "on"}>
                  <button className={`icon-btn${visible ? "" : " on"}`} data-tip="Visible" onClick={(e) => { e.stopPropagation(); A.toggleVisible(n.id); }}>
                    {visible ? <Icon.eye size={12} /> : <Icon.eyeOff size={12} />}
                  </button>
                </span>
              )}
            </span>
          </div>
        );
      })}
      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
