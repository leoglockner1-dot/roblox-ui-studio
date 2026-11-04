/** Thin client for the Roblox UI Studio HTTP API. */
import type { Op } from "../core/ops";
import type { AssetRecord, DesignDocument } from "../core/types";
import type { Issue } from "../core/validate";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown, raw = false): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined && !(body instanceof Blob) ? { "content-type": "application/json" } : undefined,
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
  });
  if (raw) {
    if (!res.ok) throw new ApiError(res.statusText, res.status);
    return res as unknown as T;
  }
  const json = await res.json().catch(() => ({ ok: false, error: res.statusText }));
  if (!res.ok || json.ok === false) throw new ApiError(json.error ?? res.statusText, res.status);
  return json as T;
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

export const api = {
  listDocuments: () => req<{ documents: DocSummary[] }>("GET", "/api/documents").then((r) => r.documents),
  createDocument: (name: string) => req<{ document: DesignDocument }>("POST", "/api/documents", { name }).then((r) => r.document),
  importDocument: (doc: unknown) => req<{ document: DesignDocument }>("POST", "/api/documents/import", doc).then((r) => r.document),
  getDocument: (id: string) => req<{ document: DesignDocument }>("GET", `/api/documents/${id}`).then((r) => r.document),
  deleteDocument: (id: string) => req("DELETE", `/api/documents/${id}`),
  postOps: (id: string, ops: Op[], label: string, clientId: string) =>
    req<{ revision: number }>("POST", `/api/documents/${id}/ops`, { ops, label, clientId }),
  validate: (id: string) => req<{ issues: Issue[] }>("GET", `/api/documents/${id}/validate`).then((r) => r.issues),
  tool: <T = Record<string, unknown>>(name: string, input: Record<string, unknown>) => req<T>("POST", `/api/tools/${name}`, input),
  listAssets: () => req<{ assets: AssetRecord[] }>("GET", "/api/assets").then((r) => r.assets),
  uploadAsset: (file: File, folder = "", reference = false) =>
    req<{ asset: AssetRecord }>("POST", `/api/assets?${new URLSearchParams({ name: file.name, folder, reference: String(reference) })}`, file).then((r) => r.asset),
  updateAsset: (id: string, patch: Partial<AssetRecord>) => req<{ asset: AssetRecord }>("PATCH", `/api/assets/${id}`, patch).then((r) => r.asset),
  deleteAsset: (id: string) => req("DELETE", `/api/assets/${id}`),
  assetUrl: (id: string) => `/api/assets/${id}/file`,
  exportUrl: (id: string, format: string, roots?: string[]) =>
    `/api/documents/${id}/export?${new URLSearchParams({ format, ...(roots?.length ? { roots: roots.join(",") } : {}) })}`,
};

export type ServerEvent =
  | { type: "hello" }
  | { type: "changed"; documentId: string; revision: number; clientId: string | null }
  | { type: "deleted"; documentId: string }
  | { type: "open"; documentId: string }
  | { type: "playAnimation"; documentId: string; animationId: string }
  | { type: "assets" };

/** Subscribe to server events; reconnects automatically. */
export function subscribe(onEvent: (e: ServerEvent) => void, onStatus: (connected: boolean) => void): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    es = new EventSource("/api/events");
    es.onopen = () => onStatus(true);
    es.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore malformed */
      }
    };
    es.onerror = () => {
      onStatus(false);
      es?.close();
      if (!closed) retry = setTimeout(connect, 1500);
    };
  };
  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    es?.close();
  };
}
