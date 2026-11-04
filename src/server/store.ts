/**
 * Workspace store: documents, history and assets on disk.
 *
 * Shared by the HTTP server and the MCP server (separate processes), so every
 * read-modify-write happens under a per-document lock (atomic mkdir) and every
 * write is atomic (tmp file + rename). Layout:
 *
 *   <workspace>/documents/<id>.json           the design document
 *   <workspace>/documents/<id>.history.json   undo/redo history (inverse ops)
 *   <workspace>/assets/index.json             asset records
 *   <workspace>/assets/files/<id>.<ext>       asset files
 */
import { promises as fs, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { applyOps, type Op } from "../core/ops";
import { createDocument, newId, nowIso } from "../core/document";
import { migrate } from "../core/migrate";
import type { AssetRecord, DesignDocument } from "../core/types";

export interface HistoryEntry {
  id: string;
  at: string;
  source: string;
  label: string;
  revision: number;
  ops: Op[];
  inverse: Op[];
}

export interface History {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

export interface DocSummary {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  pages: number;
  nodes: number;
  components: number;
}

const HISTORY_LIMIT = 200;
const LOCK_STALE_MS = 15_000;

export class StoreError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "StoreError";
  }
}

async function atomicWrite(file: string, data: string | Uint8Array) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

/**
 * Workspace directory: $RUIS_WORKSPACE, else `<installDir>/workspace`.
 * Never depends on the current directory (MCP clients start servers anywhere).
 */
export function defaultWorkspace(installDir: string): string {
  if (process.env.RUIS_WORKSPACE) return path.resolve(process.env.RUIS_WORKSPACE);
  return path.resolve(installDir, "workspace");
}

export class Store {
  readonly docsDir: string;
  readonly assetsDir: string;
  readonly filesDir: string;

  constructor(readonly root: string) {
    this.docsDir = path.join(root, "documents");
    this.assetsDir = path.join(root, "assets");
    this.filesDir = path.join(this.assetsDir, "files");
    for (const d of [this.docsDir, this.assetsDir, this.filesDir]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }

  private docPath(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new StoreError(`invalid document id "${id}"`);
    return path.join(this.docsDir, `${id}.json`);
  }
  private histPath(id: string) {
    return path.join(this.docsDir, `${id}.history.json`);
  }

  /** Run `fn` while holding the lock named `name`. */
  async withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const lock = path.join(this.root, `.${name}.lock`);
    const start = Date.now();
    for (;;) {
      try {
        await fs.mkdir(lock);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        try {
          const st = await fs.stat(lock);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            await fs.rm(lock, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() - start > LOCK_STALE_MS * 2) throw new StoreError(`timed out waiting for lock ${name}`, 503);
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 30));
      }
    }
    try {
      return await fn();
    } finally {
      await fs.rm(lock, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ------------------------------------------------------------ documents

  async listDocuments(): Promise<DocSummary[]> {
    const files = (await fs.readdir(this.docsDir)).filter((f) => f.endsWith(".json") && !f.endsWith(".history.json"));
    const out: DocSummary[] = [];
    for (const f of files) {
      try {
        const d = JSON.parse(await fs.readFile(path.join(this.docsDir, f), "utf8")) as DesignDocument;
        out.push({
          id: d.id, name: d.name, revision: d.revision, updatedAt: d.updatedAt,
          pages: d.pages.length, nodes: Object.keys(d.nodes).length, components: Object.keys(d.components).length,
        });
      } catch {
        /* skip unreadable */
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async exists(id: string) {
    return existsSync(this.docPath(id));
  }

  async getDocument(id: string): Promise<DesignDocument> {
    let raw: string;
    try {
      raw = await fs.readFile(this.docPath(id), "utf8");
    } catch {
      throw new StoreError(`document "${id}" not found`, 404);
    }
    return migrate(JSON.parse(raw));
  }

  async putDocument(doc: DesignDocument) {
    await atomicWrite(this.docPath(doc.id), JSON.stringify(doc, null, 1));
  }

  async createDocument(name: string, from?: DesignDocument): Promise<DesignDocument> {
    const doc = from ? { ...structuredClone(from), id: newId("doc"), name, revision: 0, createdAt: nowIso(), updatedAt: nowIso() } : createDocument(name);
    await this.putDocument(doc);
    await this.putHistory(doc.id, { undo: [], redo: [] });
    return doc;
  }

  async deleteDocument(id: string) {
    await this.withLock(id, async () => {
      await fs.rm(this.docPath(id), { force: true });
      await fs.rm(this.histPath(id), { force: true });
    });
  }

  async getHistory(id: string): Promise<History> {
    try {
      return JSON.parse(await fs.readFile(this.histPath(id), "utf8"));
    } catch {
      return { undo: [], redo: [] };
    }
  }

  private async putHistory(id: string, h: History) {
    await atomicWrite(this.histPath(id), JSON.stringify(h));
  }

  /**
   * Apply ops atomically under the document lock. Records history (unless
   * `record` is false) and bumps the revision. Throws OpError on invalid ops.
   */
  async applyOps(id: string, ops: Op[], meta: { source: string; label?: string; record?: boolean; clearRedo?: boolean } = { source: "api" }) {
    return this.withLock(id, async () => {
      const doc = await this.getDocument(id);
      const r = applyOps(doc, ops);
      const next: DesignDocument = { ...r.doc, revision: doc.revision + 1, updatedAt: nowIso() };
      await this.putDocument(next);
      let entry: HistoryEntry | undefined;
      if (meta.record !== false) {
        const h = await this.getHistory(id);
        entry = { id: newId("h"), at: next.updatedAt, source: meta.source, label: meta.label ?? describeOps(ops), revision: next.revision, ops, inverse: r.inverse };
        h.undo.push(entry);
        if (h.undo.length > HISTORY_LIMIT) h.undo.splice(0, h.undo.length - HISTORY_LIMIT);
        if (meta.clearRedo !== false) h.redo = h.redo.filter((x) => x.source !== meta.source);
        await this.putHistory(id, h);
      }
      return { doc: next, inverse: r.inverse, entry };
    });
  }

  /** Undo the most recent change (optionally only changes from `source`). */
  async undo(id: string, source?: string) {
    return this.withLock(id, async () => {
      const h = await this.getHistory(id);
      const idx = findLastIndex(h.undo, (e) => !source || e.source === source);
      if (idx < 0) throw new StoreError("nothing to undo", 409);
      const entry = h.undo[idx];
      const doc = await this.getDocument(id);
      let r;
      try {
        r = applyOps(doc, entry.inverse);
      } catch (e) {
        throw new StoreError(`cannot undo "${entry.label}": later changes conflict (${(e as Error).message})`, 409);
      }
      const next = { ...r.doc, revision: doc.revision + 1, updatedAt: nowIso() };
      await this.putDocument(next);
      h.undo.splice(idx, 1);
      h.redo.push({ ...entry, revision: next.revision });
      await this.putHistory(id, h);
      return { doc: next, entry };
    });
  }

  async redo(id: string, source?: string) {
    return this.withLock(id, async () => {
      const h = await this.getHistory(id);
      const idx = findLastIndex(h.redo, (e) => !source || e.source === source);
      if (idx < 0) throw new StoreError("nothing to redo", 409);
      const entry = h.redo[idx];
      const doc = await this.getDocument(id);
      let r;
      try {
        r = applyOps(doc, entry.ops);
      } catch (e) {
        throw new StoreError(`cannot redo "${entry.label}": ${(e as Error).message}`, 409);
      }
      const next = { ...r.doc, revision: doc.revision + 1, updatedAt: nowIso() };
      await this.putDocument(next);
      h.redo.splice(idx, 1);
      h.undo.push({ ...entry, inverse: r.inverse, revision: next.revision });
      await this.putHistory(id, h);
      return { doc: next, entry };
    });
  }

  // ------------------------------------------------------------ assets

  async listAssets(): Promise<AssetRecord[]> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.assetsDir, "index.json"), "utf8"));
    } catch {
      return [];
    }
  }

  private async putAssets(list: AssetRecord[]) {
    await atomicWrite(path.join(this.assetsDir, "index.json"), JSON.stringify(list, null, 1));
  }

  async addAsset(data: Uint8Array, meta: { name: string; mime?: string; folder?: string; robloxAssetId?: string; reference?: boolean; tags?: string[] }): Promise<AssetRecord> {
    const info = sniffImage(data, meta.mime, meta.name);
    if (!info) throw new StoreError(`unsupported image format for "${meta.name}" (use PNG, JPEG, GIF, WebP, BMP or SVG)`);
    if (data.length > 20 * 1024 * 1024) throw new StoreError("asset larger than 20 MB");
    const id = newId("a");
    const fileName = `${id}.${info.ext}`;
    await atomicWrite(path.join(this.filesDir, fileName), data);
    const rec: AssetRecord = {
      id, name: meta.name, folder: normalizeFolder(meta.folder ?? ""), mime: info.mime, fileName,
      width: info.width, height: info.height, bytes: data.length, tags: meta.tags ?? [], createdAt: nowIso(),
      ...(meta.robloxAssetId ? { robloxAssetId: cleanRobloxId(meta.robloxAssetId) } : {}),
      ...(meta.reference ? { reference: true } : {}),
    };
    await this.withLock("assets", async () => {
      const list = await this.listAssets();
      list.push(rec);
      await this.putAssets(list);
    });
    return rec;
  }

  async updateAsset(id: string, patch: Partial<Pick<AssetRecord, "name" | "folder" | "robloxAssetId" | "reference" | "tags">>): Promise<AssetRecord> {
    return this.withLock("assets", async () => {
      const list = await this.listAssets();
      const a = list.find((x) => x.id === id);
      if (!a) throw new StoreError(`asset "${id}" not found`, 404);
      if (patch.name !== undefined) {
        if (!patch.name.trim()) throw new StoreError("asset name must not be empty");
        a.name = patch.name.trim();
      }
      if (patch.folder !== undefined) a.folder = normalizeFolder(patch.folder);
      if (patch.robloxAssetId !== undefined) {
        if (patch.robloxAssetId) a.robloxAssetId = cleanRobloxId(patch.robloxAssetId);
        else delete a.robloxAssetId;
      }
      if (patch.reference !== undefined) {
        if (patch.reference) a.reference = true;
        else delete a.reference;
      }
      if (patch.tags !== undefined) a.tags = patch.tags;
      await this.putAssets(list);
      return a;
    });
  }

  async deleteAsset(id: string) {
    await this.withLock("assets", async () => {
      const list = await this.listAssets();
      const a = list.find((x) => x.id === id);
      if (!a) throw new StoreError(`asset "${id}" not found`, 404);
      await fs.rm(path.join(this.filesDir, a.fileName), { force: true });
      await this.putAssets(list.filter((x) => x.id !== id));
    });
  }

  async assetFile(id: string): Promise<{ rec: AssetRecord; data: Buffer }> {
    const a = (await this.listAssets()).find((x) => x.id === id);
    if (!a) throw new StoreError(`asset "${id}" not found`, 404);
    return { rec: a, data: await fs.readFile(path.join(this.filesDir, a.fileName)) };
  }
}

function findLastIndex<T>(arr: T[], pred: (x: T) => boolean) {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

function normalizeFolder(f: string) {
  return f.split("/").map((s) => s.trim()).filter(Boolean).join("/");
}

function cleanRobloxId(v: string): string {
  const m = /(\d{3,})/.exec(String(v));
  if (!m) throw new StoreError(`"${v}" is not a Roblox asset id (expected digits, e.g. 1234567890 or rbxassetid://1234567890)`);
  return m[1];
}

export function describeOps(ops: Op[]): string {
  if (!ops.length) return "No change";
  const kinds = [...new Set(ops.map((o) => o.type))];
  return kinds.length === 1 ? `${kinds[0]} ×${ops.length}` : kinds.join(", ");
}

/** Identify image type + dimensions from file bytes. */
export function sniffImage(d: Uint8Array, mime?: string, name = ""): { mime: string; ext: string; width?: number; height?: number } | null {
  const b = Buffer.from(d.buffer, d.byteOffset, d.byteLength);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { mime: "image/png", ext: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { mime: "image/jpeg", ext: "jpg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (b.length > 10 && b.toString("ascii", 0, 3) === "GIF") return { mime: "image/gif", ext: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const fmt = b.toString("ascii", 12, 16);
    if (fmt === "VP8X") return { mime: "image/webp", ext: "webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (fmt === "VP8 ") return { mime: "image/webp", ext: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (fmt === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { mime: "image/webp", ext: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return { mime: "image/webp", ext: "webp" };
  }
  if (b.length > 26 && b.toString("ascii", 0, 2) === "BM") return { mime: "image/bmp", ext: "bmp", width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)) };
  const head = b.toString("utf8", 0, Math.min(b.length, 2048));
  if (/<svg[\s>]/i.test(head) || mime === "image/svg+xml" || name.toLowerCase().endsWith(".svg")) {
    if (!/<svg[\s>]/i.test(head)) return null;
    const w = /\bwidth="([\d.]+)/.exec(head);
    const h = /\bheight="([\d.]+)/.exec(head);
    const vb = /viewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)"/.exec(head);
    return {
      mime: "image/svg+xml", ext: "svg",
      width: w ? Math.round(+w[1]) : vb ? Math.round(+vb[1]) : undefined,
      height: h ? Math.round(+h[1]) : vb ? Math.round(+vb[2]) : undefined,
    };
  }
  return null;
}
