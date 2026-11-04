// Bundles the Node entry points (server + MCP) into dist/*.mjs with esbuild.
import { build } from "esbuild";

export async function buildNode(outdir = "dist", { sourcemap = false } = {}) {
  await build({
    entryPoints: { server: "src/server/main.ts", mcp: "src/mcp/main.ts" },
    outdir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    packages: "external",
    sourcemap,
    logLevel: "warning",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildNode();
  console.log("built dist/server.mjs and dist/mcp.mjs");
}
