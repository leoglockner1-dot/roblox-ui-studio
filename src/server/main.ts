/** Entry point: `npm start` (built) or `npm run dev` (via scripts/dev.mjs). */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./http";
import { Store, defaultWorkspace } from "./store";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.RUIS_PORT ?? 5178);
// dist/server.mjs -> install dir is the parent of dist/
const store = new Store(defaultWorkspace(path.resolve(here, "..")));
const staticDir = process.env.RUIS_STATIC ?? path.resolve(here, "editor");

startServer({ port, store, staticDir });
console.log(`Roblox UI Studio running at http://127.0.0.1:${port}  (workspace: ${store.root})`);
