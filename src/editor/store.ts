/**
 * Editor state and actions.
 *
 * - The document is changed only through core ops (applyOps), applied locally
 *   first (instant UI) and queued to the server, which persists them.
 * - Undo/redo stacks hold inverse ops for this editor session.
 * - Gestures (drag/resize) preview ops from a base document every frame and
 *   commit a single undo step on release.
 * - Server events (e.g. edits by Claude over MCP) reload the document; local
 *   ops not yet acknowledged are re-applied on top (rebase).
 */
import { useSyncExternalStore } from "react";
import { applyOps, OpError, type Op } from "../core/ops";
import { sampleAnimation, totalPlayTime, cycleDuration } from "../core/animation";
import type { AssetRecord, DesignDocument } from "../core/types";
import type { Issue } from "../core/validate";
import { api, subscribe, type ServerEvent } from "./api";
import { pageScene, type Sample, type SceneRoot } from "./scene";
import { clearMeasureCache } from "./render/measure";
import { newId } from "../core/document";
import type { NodeSpec } from "../core/spec";

export type Tool = "select" | "hand" | "frame" | "text" | "button" | "image" | "scroll";
export type LeftTab = "layers" | "assets" | "components" | "library" | "styles";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

export interface EditorState {
  route: { name: "home" } | { name: "editor"; docId: string } | { name: "render" };
  doc: DesignDocument | null;
  pageId: string;
  selection: string[];
  hover: string | null;
  tool: Tool;
  viewport: Viewport;
  leftTab: LeftTab;
  timelineOpen: boolean;
  previewOpen: boolean;
  exportOpen: boolean;
  issuesOpen: boolean;
  editingTextId: string | null;
  anim: { id: string | null; time: number; playing: boolean };
  sync: "saved" | "saving" | "error" | "offline";
  connected: boolean;
  assets: AssetRecord[];
  issues: Issue[];
  snapToGrid: boolean;
  gridSize: number;
  showModifiers: boolean;
  fontsVersion: number;
  toasts: Toast[];
  canUndo: boolean;
  canRedo: boolean;
}

interface HistoryItem {
  ops: Op[];
  inverse: Op[];
  label: string;
  selection: string[];
}

interface Pending {
  ops: Op[];
  label: string;
}

let toastId = 0;

export class EditorStore {
  state: EditorState = {
    route: { name: "home" },
    doc: null,
    pageId: "",
    selection: [],
    hover: null,
    tool: "select",
    viewport: { x: 80, y: 80, zoom: 0.5 },
    leftTab: "layers",
    timelineOpen: false,
    previewOpen: false,
    exportOpen: false,
    issuesOpen: false,
    editingTextId: null,
    anim: { id: null, time: 0, playing: false },
    sync: "saved",
    connected: false,
    assets: [],
    issues: [],
    snapToGrid: false,
    gridSize: 8,
    showModifiers: false,
    fontsVersion: 0,
    toasts: [],
    canUndo: false,
    canRedo: false,
  };

  readonly clientId = newId("cl");
  private listeners = new Set<() => void>();
  private undoStack: HistoryItem[] = [];
  private redoStack: HistoryItem[] = [];
  private queue: Pending[] = [];
  private flushing = false;
  private serverRevision = 0;
  private needsReload = false;
  private gestureBase: DesignDocument | null = null;
  private gestureOps: Op[] = [];
  private unsub: (() => void) | null = null;
  private raf = 0;
  private validateTimer: ReturnType<typeof setTimeout> | undefined;
  clipboard: { specs: NodeSpec[]; sourceParent: string | null } | null = null;

  // ------------------------------------------------------------ store plumbing

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  toast(text: string, kind: Toast["kind"] = "info") {
    const t = { id: ++toastId, text, kind };
    this.set({ toasts: [...this.state.toasts, t] });
    setTimeout(() => this.set({ toasts: this.state.toasts.filter((x) => x.id !== t.id) }), kind === "error" ? 6000 : 2800);
  }

  // ------------------------------------------------------------ lifecycle

  start() {
    this.unsub = subscribe(
      (e) => this.onServerEvent(e),
      (connected) => {
        this.set({ connected, ...(connected ? {} : { sync: "offline" as const }) });
        if (connected && this.state.sync === "offline") {
          this.set({ sync: this.queue.length ? "saving" : "saved" });
          void this.flush();
        }
      },
    );
    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.addEventListener("loadingdone", () => {
        clearMeasureCache();
        this.set({ fontsVersion: this.state.fontsVersion + 1 });
      });
      void document.fonts.ready.then(() => {
        clearMeasureCache();
        this.set({ fontsVersion: this.state.fontsVersion + 1 });
      });
    }
    void this.loadAssets();
  }

  stop() {
    this.unsub?.();
  }

  async loadAssets() {
    try {
      this.set({ assets: await api.listAssets() });
    } catch {
      /* offline */
    }
  }

  async openDocument(id: string) {
    try {
      const doc = await api.getDocument(id);
      this.undoStack = [];
      this.redoStack = [];
      this.queue = [];
      this.serverRevision = doc.revision;
      this.set({
        doc, route: { name: "editor", docId: id }, pageId: doc.pages[0].id, selection: [], hover: null,
        anim: { id: null, time: 0, playing: false }, editingTextId: null, canUndo: false, canRedo: false, sync: "saved",
      });
      if (location.hash !== `#/doc/${id}`) history.replaceState(null, "", `#/doc/${id}`);
      this.fitAll();
      this.scheduleValidate();
    } catch (e) {
      this.toast(`Could not open document: ${(e as Error).message}`, "error");
      this.goHome();
    }
  }

  goHome() {
    this.set({ route: { name: "home" }, doc: null, selection: [] });
    if (location.hash) history.replaceState(null, "", "#/");
  }

  // ------------------------------------------------------------ ops

  /** Apply ops locally, record an undo step, queue for the server. Returns false if invalid. */
  apply(ops: Op[], label: string, opts: { selection?: string[]; silent?: boolean } = {}): boolean {
    const doc = this.state.doc;
    if (!doc || !ops.length) return false;
    try {
      const r = applyOps(doc, ops);
      this.undoStack.push({ ops, inverse: r.inverse, label, selection: this.state.selection });
      if (this.undoStack.length > 300) this.undoStack.shift();
      this.redoStack = [];
      this.commitLocal(r.doc, ops, label, opts.selection);
      return true;
    } catch (e) {
      if (!opts.silent) this.toast(e instanceof OpError ? e.message : String(e), "error");
      return false;
    }
  }

  private commitLocal(doc: DesignDocument, ops: Op[], label: string, selection?: string[]) {
    const sel = (selection ?? this.state.selection).filter((id) => this.existsIn(doc, id));
    const pageId = doc.pages.some((p) => p.id === this.state.pageId) ? this.state.pageId : doc.pages[0].id;
    this.set({ doc, selection: sel, pageId, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 });
    this.queue.push({ ops, label });
    void this.flush();
    this.scheduleValidate();
  }

  existsIn(doc: DesignDocument, effId: string) {
    return !!doc.nodes[effId.split("/")[0]];
  }

  undo() {
    const item = this.undoStack.pop();
    if (!item || !this.state.doc) return;
    try {
      const r = applyOps(this.state.doc, item.inverse);
      this.redoStack.push({ ...item, inverse: r.inverse });
      this.commitLocal(r.doc, item.inverse, `Undo ${item.label}`, item.selection);
    } catch (e) {
      this.toast(`Can't undo "${item.label}": it was changed elsewhere (${(e as Error).message})`, "error");
      this.set({ canUndo: this.undoStack.length > 0 });
    }
  }

  redo() {
    const item = this.redoStack.pop();
    if (!item || !this.state.doc) return;
    try {
      const r = applyOps(this.state.doc, item.ops);
      this.undoStack.push({ ...item, inverse: r.inverse });
      this.commitLocal(r.doc, item.ops, `Redo ${item.label}`);
    } catch (e) {
      this.toast(`Can't redo "${item.label}": ${(e as Error).message}`, "error");
      this.set({ canRedo: this.redoStack.length > 0 });
    }
  }

  // gestures: preview without history, commit once
  beginGesture() {
    this.gestureBase = this.state.doc;
    this.gestureOps = [];
  }
  get inGesture() {
    return !!this.gestureBase;
  }
  previewGesture(ops: Op[]) {
    if (!this.gestureBase) return;
    try {
      const r = applyOps(this.gestureBase, ops);
      this.gestureOps = ops;
      this.set({ doc: r.doc });
    } catch {
      /* ignore invalid intermediate states */
    }
  }
  commitGesture(label: string) {
    const base = this.gestureBase;
    this.gestureBase = null;
    if (!base) return;
    const ops = this.gestureOps;
    this.gestureOps = [];
    if (!ops.length) {
      this.set({ doc: base });
      return;
    }
    this.state = { ...this.state, doc: base };
    this.apply(ops, label);
  }
  cancelGesture() {
    if (this.gestureBase) this.set({ doc: this.gestureBase });
    this.gestureBase = null;
    this.gestureOps = [];
  }

  // ------------------------------------------------------------ sync

  private async flush() {
    if (this.flushing || !this.state.doc) return;
    this.flushing = true;
    const docId = this.state.doc.id;
    try {
      while (this.queue.length && this.state.doc?.id === docId) {
        this.set({ sync: "saving" });
        const item = this.queue[0];
        try {
          const r = await api.postOps(docId, item.ops, item.label, this.clientId);
          this.queue.shift();
          const expected = this.serverRevision + 1;
          this.serverRevision = r.revision;
          if (r.revision !== expected) this.needsReload = true; // someone else changed it in between
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (status === 409 || status === 400) {
            // Our change no longer applies on the server: drop it and reload the truth.
            this.queue.shift();
            this.toast(`A change could not be saved and was reverted: ${(e as Error).message}`, "error");
            this.needsReload = true;
          } else {
            this.set({ sync: "offline" });
            setTimeout(() => {
              this.flushing = false;
              void this.flush();
            }, 2000);
            return;
          }
        }
      }
      if (this.needsReload && !this.queue.length) await this.reload();
      this.set({ sync: "saved" });
    } finally {
      this.flushing = false;
    }
  }

  /** Reload the document from the server, re-applying unsent local ops. */
  async reload() {
    const cur = this.state.doc;
    if (!cur) return;
    this.needsReload = false;
    const fresh = await api.getDocument(cur.id).catch(() => null);
    if (!fresh) return;
    this.serverRevision = fresh.revision;
    let doc = fresh;
    for (const p of this.queue) {
      try {
        doc = applyOps(doc, p.ops).doc;
      } catch {
        /* dropped on flush */
      }
    }
    if (this.gestureBase) {
      this.gestureBase = doc;
      try {
        doc = applyOps(doc, this.gestureOps).doc;
      } catch {
        /* ignore */
      }
    }
    this.set({ doc, selection: this.state.selection.filter((id) => this.existsIn(doc, id)) });
    this.scheduleValidate();
  }

  private onServerEvent(e: ServerEvent) {
    const doc = this.state.doc;
    switch (e.type) {
      case "changed":
        if (!doc || e.documentId !== doc.id || e.clientId === this.clientId) return;
        if (e.revision <= this.serverRevision) return;
        if (this.flushing || this.queue.length) this.needsReload = true;
        else void this.reload();
        return;
      case "deleted":
        if (doc && e.documentId === doc.id) {
          this.toast("This document was deleted elsewhere", "error");
          this.goHome();
        }
        return;
      case "open":
        if (doc?.id !== e.documentId) {
          this.toast("Opening document requested by Claude");
          void this.openDocument(e.documentId);
        }
        return;
      case "playAnimation":
        if (doc?.id === e.documentId) {
          this.set({ timelineOpen: true });
          this.playAnimation(e.animationId);
        }
        return;
      case "assets":
        void this.loadAssets();
        return;
    }
  }

  private scheduleValidate() {
    clearTimeout(this.validateTimer);
    this.validateTimer = setTimeout(async () => {
      const doc = this.state.doc;
      if (!doc) return;
      const { validateDocument } = await import("../core/validate");
      if (this.state.doc === doc) this.set({ issues: validateDocument(doc, this.state.assets) });
    }, 600);
  }

  // ------------------------------------------------------------ selection / view

  select(ids: string[], mode: "replace" | "toggle" | "add" = "replace") {
    if (this.gestureBase) this.commitGesture("Edit");
    let sel: string[];
    if (mode === "replace") sel = ids;
    else if (mode === "add") sel = [...new Set([...this.state.selection, ...ids])];
    else {
      const s = new Set(this.state.selection);
      for (const id of ids) {
        if (s.has(id)) s.delete(id);
        else s.add(id);
      }
      sel = [...s];
    }
    this.set({ selection: sel, editingTextId: null });
  }

  setPage(pageId: string) {
    this.set({ pageId, selection: [], hover: null });
    this.fitAll();
  }

  scene(): SceneRoot[] {
    const { doc, pageId, fontsVersion } = this.state;
    if (!doc) return [];
    return pageScene(doc, pageId, this.currentSample(), fontsVersion);
  }

  currentSample(): Sample | null {
    const { anim, doc, timelineOpen } = this.state;
    if (!doc || !anim.id || (!timelineOpen && !anim.playing)) return null;
    const a = doc.animations[anim.id];
    if (!a) return null;
    return sampleAnimation(a, anim.time);
  }

  canvasSize = { w: 1200, h: 800 };

  fitRect(r: { x: number; y: number; w: number; h: number }, pad = 80) {
    const { w, h } = this.canvasSize;
    const zoom = Math.max(0.02, Math.min(4, Math.min((w - pad * 2) / Math.max(1, r.w), (h - pad * 2) / Math.max(1, r.h))));
    this.set({ viewport: { zoom, x: w / 2 - (r.x + r.w / 2) * zoom, y: h / 2 - (r.y + r.h / 2) * zoom } });
  }

  fitAll() {
    const roots = this.scene();
    if (!roots.length) {
      this.set({ viewport: { x: 80, y: 80, zoom: 0.5 } });
      return;
    }
    const minX = Math.min(...roots.map((r) => r.rect.x));
    const minY = Math.min(...roots.map((r) => r.rect.y));
    const maxX = Math.max(...roots.map((r) => r.rect.x + r.rect.w));
    const maxY = Math.max(...roots.map((r) => r.rect.y + r.rect.h));
    this.fitRect({ x: minX, y: minY - 30, w: maxX - minX, h: maxY - minY + 30 });
  }

  zoomTo(zoom: number, center?: { x: number; y: number }) {
    const v = this.state.viewport;
    const c = center ?? { x: this.canvasSize.w / 2, y: this.canvasSize.h / 2 };
    const z = Math.max(0.02, Math.min(32, zoom));
    const wx = (c.x - v.x) / v.zoom;
    const wy = (c.y - v.y) / v.zoom;
    this.set({ viewport: { zoom: z, x: c.x - wx * z, y: c.y - wy * z } });
  }

  // ------------------------------------------------------------ animation playback

  playAnimation(id?: string) {
    const doc = this.state.doc;
    const animId = id ?? this.state.anim.id;
    if (!doc || !animId || !doc.animations[animId]) return;
    cancelAnimationFrame(this.raf);
    const a = doc.animations[animId];
    const total = totalPlayTime(a);
    const limit = Number.isFinite(total) ? total : cycleDuration(a) * 1000;
    const start = performance.now() - (this.state.anim.playing || this.state.anim.time >= limit ? 0 : this.state.anim.time * 1000);
    this.set({ anim: { id: animId, time: 0, playing: true } });
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      if (t >= limit) {
        this.set({ anim: { id: animId, time: Number.isFinite(total) ? limit : 0, playing: false } });
        return;
      }
      this.set({ anim: { id: animId, time: t, playing: true } });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopAnimation(reset = true) {
    cancelAnimationFrame(this.raf);
    this.set({ anim: { ...this.state.anim, playing: false, time: reset ? 0 : this.state.anim.time } });
  }

  setAnimTime(t: number) {
    cancelAnimationFrame(this.raf);
    this.set({ anim: { ...this.state.anim, playing: false, time: Math.max(0, t) } });
  }
}

export const store = new EditorStore();

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.state));
}
