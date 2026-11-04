/**
 * MCP server (stdio) exposing the Roblox UI Studio tool registry.
 *
 * Works on the workspace files directly, so it does not need the editor to
 * be running. If the editor server is running (RUIS_URL, default
 * http://127.0.0.1:5178) open editors update live, and render_preview /
 * preview_animation can return images.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Store, defaultWorkspace } from "../server/store";
import { runTool, TOOLS, type ToolContext } from "../server/tools";

const here = path.dirname(fileURLToPath(import.meta.url));
const store = new Store(defaultWorkspace(path.resolve(here, "..")));
const studioUrl = (process.env.RUIS_URL ?? `http://127.0.0.1:${process.env.RUIS_PORT ?? 5178}`).replace(/\/$/, "");

async function post(pathname: string, body: unknown, timeoutMs = 800) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    await fetch(studioUrl + pathname, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, signal: ctl.signal });
  } catch {
    /* editor not running: fine */
  } finally {
    clearTimeout(t);
  }
}

const ctx: ToolContext = {
  store,
  source: "mcp",
  notify: (e) => post("/api/events", e),
  render: async (o) => {
    const q = new URLSearchParams({ doc: o.documentId, root: o.rootId });
    if (o.device) q.set("device", o.device);
    if (o.width) q.set("w", String(o.width));
    if (o.height) q.set("h", String(o.height));
    if (o.animationId) q.set("anim", o.animationId);
    if (o.time !== undefined) q.set("t", String(o.time));
    let res: Response;
    try {
      res = await fetch(`${studioUrl}/api/render?${q}`);
    } catch {
      throw new Error(`Roblox UI Studio is not running at ${studioUrl}; start it with \`npm start\` to enable rendering`);
    }
    if (!res.ok) throw new Error(`render failed: ${(await res.json().catch(() => ({ error: res.statusText }))).error}`);
    return Buffer.from(await res.arrayBuffer());
  },
};

const server = new McpServer(
  { name: "roblox-ui-studio", version: "0.1.0" },
  {
    instructions:
      "Roblox UI Studio: build Roblox game UI as editable designs. Start with get_design_guide, then list_documents/create_document and inspect_design. " +
      "Build with create_element (nested NodeSpecs), reuse with components, check with render_preview and validate_design, export with export_luau.",
  },
);

for (const t of TOOLS) {
  server.registerTool(
    t.name,
    { title: t.title, description: t.description, inputSchema: t.input, annotations: { readOnlyHint: !!t.readOnly, title: t.title } },
    async (args: unknown) => {
      const r = await runTool(t.name, args, ctx);
      const { _images, ...rest } = r;
      // Let open editors refresh immediately (the file watcher would also catch it).
      const docId = (args as { documentId?: string })?.documentId;
      if (r.ok !== false && docId && typeof r.revision === "number") void post("/api/events", { type: "changed", documentId: docId, revision: r.revision, clientId: null });
      const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
        { type: "text", text: JSON.stringify(rest, null, 1) },
      ];
      for (const img of _images ?? []) content.push({ type: "image", data: img.data, mimeType: img.mimeType });
      return { content, isError: r.ok === false };
    },
  );
}

await server.connect(new StdioServerTransport());
