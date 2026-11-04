import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildNode } from "../../scripts/build-node.mjs";
import { startServer } from "../../src/server/http";
import { Store } from "../../src/server/store";

let dir: string;
let distDir: string;
let srv: ReturnType<typeof startServer>;
let base: string;
let client: Client;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ruis-int-"));
  // Inside the repo so the bundle's external packages resolve from node_modules.
  distDir = path.resolve(".test-dist");
  await buildNode(distDir);
  srv = startServer({ port: 0, store: new Store(path.join(dir, "ws")), quiet: true });
  await new Promise((r) => srv.server.once("listening", r));
  base = `http://127.0.0.1:${(srv.server.address() as { port: number }).port}`;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(distDir, "mcp.mjs")],
    env: { ...process.env, RUIS_WORKSPACE: path.join(dir, "ws"), RUIS_URL: base } as Record<string, string>,
    cwd: path.resolve("."),
  });
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
}, 60000);

afterAll(async () => {
  await client?.close();
  await srv?.close();
  rmSync(dir, { recursive: true, force: true });
});

const parse = (r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((r.content as { type: string; text: string }[])[0].text);

describe("MCP server (stdio)", () => {
  it("lists tools with schemas", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["create_document", "create_element", "inspect_design", "export_luau", "create_animation", "import_asset", "validate_design", "undo"]) expect(names).toContain(n);
    const ce = tools.find((t) => t.name === "create_element")!;
    expect(ce.inputSchema.properties).toHaveProperty("spec");
    expect(tools.find((t) => t.name === "inspect_design")!.annotations?.readOnlyHint).toBe(true);
  });

  it("edits made over MCP reach the editor's event stream", async () => {
    const events: Record<string, unknown>[] = [];
    const ctl = new AbortController();
    const sse = fetch(`${base}/api/events`, { signal: ctl.signal }).then(async (res) => {
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        for (const part of buf.split("\n\n").slice(0, -1)) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (line) events.push(JSON.parse(line.slice(6)));
        }
        buf = buf.split("\n\n").pop()!;
      }
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    const created = parse(await client.callTool({ name: "create_document", arguments: { name: "Via MCP" } }));
    expect(created.ok).toBe(true);
    const docId = created.document.id;
    const el = parse(await client.callTool({ name: "create_element", arguments: { documentId: docId, parentId: "MainScreen", preset: "currency-display" } }));
    expect(el.ids.CurrencyDisplay).toBeTruthy();
    // wait for events
    for (let i = 0; i < 40 && !events.some((e) => e.type === "changed" && e.documentId === docId && (e.revision as number) >= 2); i++) await new Promise((r) => setTimeout(r, 50));
    ctl.abort();
    await sse;
    expect(events.some((e) => e.type === "open" && e.documentId === docId)).toBe(true);
    expect(events.some((e) => e.type === "changed" && e.documentId === docId && (e.revision as number) >= 2)).toBe(true);
    // The HTTP API sees the same document.
    const res = await (await fetch(`${base}/api/documents/${docId}`)).json();
    expect(Object.values(res.document.nodes).some((n) => (n as { name: string }).name === "CurrencyDisplay")).toBe(true);
  });

  it("returns isError with a message for invalid calls", async () => {
    const r = await client.callTool({ name: "inspect_design", arguments: { documentId: "doc_missing" } });
    expect(r.isError).toBe(true);
    expect(parse(r).error).toMatch(/not found/);
  });
});

describe("HTTP API", () => {
  it("editor ops endpoint applies atomically and reports conflicts", async () => {
    const created = await (await fetch(`${base}/api/documents`, { method: "POST", body: JSON.stringify({ name: "HTTP" }) })).json();
    const doc = created.document;
    const screen = doc.pages[0].children[0];
    const ok = await (await fetch(`${base}/api/documents/${doc.id}/ops`, { method: "POST", body: JSON.stringify({ ops: [{ type: "update", id: screen, fields: { name: "Renamed" } }] }) })).json();
    expect(ok).toMatchObject({ ok: true, revision: doc.revision + 1 });
    const bad = await fetch(`${base}/api/documents/${doc.id}/ops`, { method: "POST", body: JSON.stringify({ ops: [{ type: "remove", id: "n_nope" }] }) });
    expect(bad.status).toBe(409);
    const undo = await (await fetch(`${base}/api/documents/${doc.id}/undo?source=editor`, { method: "POST" })).json();
    expect(undo.ok).toBe(true);
    const after = (await (await fetch(`${base}/api/documents/${doc.id}`)).json()).document;
    expect(after.nodes[screen].name).toBe("MainScreen");
  });

  it("tool endpoint + exports + assets", async () => {
    const list = await (await fetch(`${base}/api/tools`)).json();
    expect(list.tools.length).toBeGreaterThan(30);
    const r = await (await fetch(`${base}/api/tools/create_document`, { method: "POST", body: JSON.stringify({ name: "Tooled" }) })).json();
    const zip = await fetch(`${base}/api/documents/${r.document.id}/export?format=zip`);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    expect((await zip.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    const gui = await (await fetch(`${base}/api/documents/${r.document.id}/export?format=gui`)).text();
    expect(gui).toContain('<Item class="ScreenGui"');
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const up = await (await fetch(`${base}/api/assets?name=dot.png&folder=UI`, { method: "POST", body: png, headers: { "content-type": "image/png" } })).json();
    expect(up.asset.width).toBe(1);
    const file = await fetch(`${base}/api/assets/${up.asset.id}/file`);
    expect(file.headers.get("content-type")).toBe("image/png");
    const patched = await (await fetch(`${base}/api/assets/${up.asset.id}`, { method: "PATCH", body: JSON.stringify({ robloxAssetId: "123456" }) })).json();
    expect(patched.asset.robloxAssetId).toBe("123456");
  });

  it("import validates documents", async () => {
    const bad = await fetch(`${base}/api/documents/import`, { method: "POST", body: JSON.stringify({ format: "other" }) });
    expect(bad.status).toBe(400);
  });
});
