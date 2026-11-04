// Development: rebuilds + restarts the API server on change and runs Vite (http://localhost:5173).
import { context } from "esbuild";
import { spawn } from "node:child_process";

let server;
const restart = () => {
  server?.kill();
  server = spawn(process.execPath, ["dist/server.mjs"], { stdio: "inherit", env: { ...process.env } });
};
const ctx = await context({
  entryPoints: { server: "src/server/main.ts", mcp: "src/mcp/main.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  sourcemap: true,
  logLevel: "warning",
  plugins: [{ name: "restart", setup(b) { b.onEnd((r) => { if (!r.errors.length) restart(); }); } }],
});
await ctx.watch();
const vite = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vite"], { stdio: "inherit", shell: process.platform === "win32" });
const stop = () => { server?.kill(); vite.kill(); ctx.dispose(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
