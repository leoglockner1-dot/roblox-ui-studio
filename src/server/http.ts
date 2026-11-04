/**
 * HTTP server: REST API for the editor, the tool API (same tools as MCP),
 * Server-Sent Events for live updates, asset files, export downloads,
 * headless rendering and static hosting of the built editor.
 */
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, promises as fs, watch } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { OpError, type Op } from "../core/ops";
import { exportDocument, exportSingleScript, exportZip, makeContext } from "../core/export";
import { validateDocument } from "../core/validate";
import { migrate } from "../core/migrate";
import { newId } from "../core/document";
import { Store, StoreError } from "./store";
import { runTool, TOOLS, type ToolContext } from "./tools";
import { createRenderer, type Renderer } from "./render";

export interface ServerOptions {
  port: number;
  host?: string;
  store: Store;
  /** Directory with the built editor (dist/editor). */
  staticDir?: string;
  quiet?: boolean;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".ico": "image/x-icon",
};

async function readBody(req: IncomingMessage, limit = 25 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new StoreError("request body too large", 413);
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const b = await readBody(req);
  if (!b.length) return {};
  try {
    return JSON.parse(b.toString("utf8"));
  } catch {
    throw new StoreError("invalid JSON body");
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    res.writeHead(status, headers);
    res.end(body);
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(json);
}

export function startServer(opts: ServerOptions) {
  const { store } = opts;
  const clients = new Set<ServerResponse>();
  const lastRevision = new Map<string, number>();
  let renderer: Renderer | null = null;
  const baseUrl = () => `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const broadcast = (event: Record<string, unknown>) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of clients) c.write(data);
  };
  const noteChange = (documentId: string, revision: number, clientId: string | null) => {
    lastRevision.set(documentId, revision);
    broadcast({ type: "changed", documentId, revision, clientId });
  };

  // Changes from other processes (MCP) arrive through the file system.
  const pending = new Map<string, NodeJS.Timeout>();
  const watcher = watch(store.docsDir, (_ev, file) => {
    if (!file || !file.endsWith(".json") || file.endsWith(".history.json") || file.includes(".tmp")) return;
    const id = file.slice(0, -5);
    clearTimeout(pending.get(id));
    pending.set(id, setTimeout(async () => {
      pending.delete(id);
      try {
        const doc = await store.getDocument(id);
        if ((lastRevision.get(id) ?? -1) < doc.revision) noteChange(id, doc.revision, null);
      } catch {
        if (!(await store.exists(id).catch(() => false))) broadcast({ type: "deleted", documentId: id });
      }
    }, 40));
  });

  const toolCtx = (): ToolContext => ({
    store,
    source: "api",
    notify: (e) => broadcast(e),
    render: async (o) => {
      renderer ??= await createRenderer(baseUrl());
      return renderer.render(o);
    },
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname;
    const m = (re: RegExp) => re.exec(p);
    try {
      if (!p.startsWith("/api/")) return await serveStatic(res, p);
      // --- events
      if (p === "/api/events" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 20000);
        req.on("close", () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }
      if (p === "/api/events" && req.method === "POST") {
        const e = (await readJson(req)) as Record<string, unknown>;
        if (!e || typeof e.type !== "string") throw new StoreError("event needs a type");
        broadcast(e);
        return send(res, 200, { ok: true });
      }
      if (p === "/api/health") return send(res, 200, { ok: true, app: "roblox-ui-studio", workspace: store.root, tools: TOOLS.length });

      // --- tools
      if (p === "/api/tools" && req.method === "GET")
        return send(res, 200, { ok: true, tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, readOnly: !!t.readOnly, inputSchema: z.toJSONSchema(z.object(t.input), { unrepresentable: "any" }) })) });
      let mm = m(/^\/api\/tools\/([\w-]+)$/);
      if (mm && req.method === "POST") {
        const input = await readJson(req);
        const r = await runTool(mm[1], input, toolCtx());
        const out = { ...r };
        // Images are returned base64 inline over HTTP.
        if (r.ok !== false) {
          const docIdIn = (input as { documentId?: string })?.documentId;
          if (docIdIn && typeof r.revision === "number") noteChange(docIdIn, r.revision, null);
        }
        return send(res, r.ok === false ? 400 : 200, out);
      }

      // --- documents
      if (p === "/api/documents" && req.method === "GET") return send(res, 200, { ok: true, documents: await store.listDocuments() });
      if (p === "/api/documents" && req.method === "POST") {
        const body = (await readJson(req)) as { name?: string; withScreen?: boolean };
        const r = await runTool("create_document", { name: body.name || "Untitled", ...(body.withScreen === false ? { screenName: "" } : {}) }, { ...toolCtx(), source: "editor" });
        if (r.ok === false) return send(res, 400, r);
        return send(res, 200, { ok: true, document: await store.getDocument((r.document as { id: string }).id) });
      }
      if (p === "/api/documents/import" && req.method === "POST") {
        const raw = await readJson(req);
        let doc;
        try {
          doc = migrate(raw);
        } catch (e) {
          throw new StoreError((e as Error).message);
        }
        const issues = validateDocument(doc).filter((i) => i.severity === "error" && ["orphan", "unknown-class", "invalid-prop"].includes(i.code));
        if (issues.length) throw new StoreError(`document is invalid: ${issues.slice(0, 5).map((i) => i.message).join("; ")}`);
        const copy = await store.createDocument(doc.name, { ...doc, id: newId("doc") });
        return send(res, 200, { ok: true, document: copy });
      }
      mm = m(/^\/api\/documents\/([\w-]+)$/);
      if (mm && req.method === "GET") return send(res, 200, { ok: true, document: await store.getDocument(mm[1]) });
      if (mm && req.method === "DELETE") {
        await store.getDocument(mm[1]);
        await store.deleteDocument(mm[1]);
        broadcast({ type: "deleted", documentId: mm[1] });
        return send(res, 200, { ok: true });
      }
      mm = m(/^\/api\/documents\/([\w-]+)\/ops$/);
      if (mm && req.method === "POST") {
        const body = (await readJson(req)) as { ops?: Op[]; label?: string; clientId?: string };
        if (!Array.isArray(body.ops)) throw new StoreError("ops must be an array");
        try {
          const r = await store.applyOps(mm[1], body.ops, { source: "editor", label: body.label });
          noteChange(mm[1], r.doc.revision, body.clientId ?? null);
          return send(res, 200, { ok: true, revision: r.doc.revision });
        } catch (e) {
          if (e instanceof OpError) return send(res, 409, { ok: false, error: e.message, opIndex: e.opIndex });
          throw e;
        }
      }
      mm = m(/^\/api\/documents\/([\w-]+)\/(undo|redo)$/);
      if (mm && req.method === "POST") {
        const source = url.searchParams.get("source") ?? undefined;
        const r = mm[2] === "undo" ? await store.undo(mm[1], source) : await store.redo(mm[1], source);
        noteChange(mm[1], r.doc.revision, null);
        return send(res, 200, { ok: true, revision: r.doc.revision, label: r.entry.label });
      }
      mm = m(/^\/api\/documents\/([\w-]+)\/history$/);
      if (mm) {
        const h = await store.getHistory(mm[1]);
        return send(res, 200, { ok: true, undo: h.undo.map(({ id, at, source, label, revision }) => ({ id, at, source, label, revision })), redo: h.redo.length });
      }
      mm = m(/^\/api\/documents\/([\w-]+)\/validate$/);
      if (mm) return send(res, 200, { ok: true, issues: validateDocument(await store.getDocument(mm[1]), await store.listAssets()) });
      mm = m(/^\/api\/documents\/([\w-]+)\/export$/);
      if (mm) {
        const doc = await store.getDocument(mm[1]);
        const assets = await store.listAssets();
        const roots = url.searchParams.get("roots")?.split(",").filter(Boolean);
        const format = url.searchParams.get("format") ?? "json";
        const safe = doc.name.replace(/[^\w-]+/g, "_");
        if (format === "single") {
          const root = roots?.[0] ?? doc.pages.flatMap((pg) => pg.children).find((id) => doc.nodes[id]?.className === "ScreenGui");
          if (!root) throw new StoreError("no screen to export");
          const ctxE = makeContext(doc, assets);
          return send(res, 200, { ok: true, source: exportSingleScript(ctxE, root), diagnostics: ctxE.diagnostics });
        }
        const b = exportDocument(doc, assets, { rootIds: roots });
        if (format === "zip") return send(res, 200, exportZip(b), { "content-type": "application/zip", "content-disposition": `attachment; filename="${safe}.zip"` });
        if (format === "gui") return send(res, 200, Buffer.from(b.guiModel), { "content-type": "application/xml", "content-disposition": `attachment; filename="${b.packageName}.gui.rbxmx"` });
        if (format === "code") return send(res, 200, Buffer.from(b.codeModel), { "content-type": "application/xml", "content-disposition": `attachment; filename="${b.packageName}.code.rbxmx"` });
        if (format === "document") return send(res, 200, Buffer.from(JSON.stringify(doc, null, 1)), { "content-type": "application/json", "content-disposition": `attachment; filename="${safe}.ruis.json"` });
        return send(res, 200, { ok: true, ...b });
      }

      // --- assets
      if (p === "/api/assets" && req.method === "GET") return send(res, 200, { ok: true, assets: await store.listAssets() });
      if (p === "/api/assets" && req.method === "POST") {
        const data = await readBody(req);
        const rec = await store.addAsset(data, {
          name: url.searchParams.get("name") ?? "image",
          folder: url.searchParams.get("folder") ?? "",
          mime: req.headers["content-type"],
          reference: url.searchParams.get("reference") === "true",
        });
        broadcast({ type: "assets" });
        return send(res, 200, { ok: true, asset: rec });
      }
      mm = m(/^\/api\/assets\/([\w-]+)\/file$/);
      if (mm) {
        const { rec, data } = await store.assetFile(mm[1]);
        return send(res, 200, data, { "content-type": rec.mime, "cache-control": "max-age=31536000, immutable" });
      }
      mm = m(/^\/api\/assets\/([\w-]+)$/);
      if (mm && req.method === "PATCH") {
        const rec = await store.updateAsset(mm[1], (await readJson(req)) as never);
        broadcast({ type: "assets" });
        return send(res, 200, { ok: true, asset: rec });
      }
      if (mm && req.method === "DELETE") {
        await store.deleteAsset(mm[1]);
        broadcast({ type: "assets" });
        return send(res, 200, { ok: true });
      }

      // --- render
      if (p === "/api/render") {
        const q = url.searchParams;
        renderer ??= await createRenderer(baseUrl());
        const png = await renderer.render({
          documentId: q.get("doc") ?? "", rootId: q.get("root") ?? "", device: q.get("device") ?? undefined,
          width: q.get("w") ? Number(q.get("w")) : undefined, height: q.get("h") ? Number(q.get("h")) : undefined,
          animationId: q.get("anim") ?? undefined, time: q.get("t") ? Number(q.get("t")) : undefined,
        });
        return send(res, 200, png, { "content-type": "image/png" });
      }
      return send(res, 404, { ok: false, error: `no route ${req.method} ${p}` });
    } catch (e) {
      const status = e instanceof StoreError ? e.status : 500;
      if (status === 500 && !opts.quiet) console.error(e);
      return send(res, status, { ok: false, error: (e as Error).message });
    }
  });

  async function serveStatic(res: ServerResponse, p: string) {
    const dir = opts.staticDir;
    if (!dir || !existsSync(dir)) return send(res, 404, "Editor not built. Run `npm run build`, or use `npm run dev`.", { "content-type": "text/plain" });
    const clean = path.normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, "");
    let file = path.join(dir, clean);
    if (!file.startsWith(dir) || !existsSync(file) || (await fs.stat(file)).isDirectory()) file = path.join(dir, "index.html");
    const data = await fs.readFile(file);
    const ext = path.extname(file);
    return send(res, 200, data, { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": ext === ".html" ? "no-store" : "max-age=3600" });
  }

  server.listen(opts.port, opts.host ?? "127.0.0.1");
  return {
    server,
    broadcast,
    close: async () => {
      watcher.close();
      for (const c of clients) c.end();
      await renderer?.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
