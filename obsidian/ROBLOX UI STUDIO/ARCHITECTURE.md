# Architecture

```
┌──────────────────────── Browser ────────────────────────┐      ┌──────── Claude Desktop / Code ────────┐
│  Editor (React)                                          │      │  MCP client                            │
│  canvas · layers · inspector · timeline · preview · export│      └───────────────┬───────────────────────┘
│        │ ops (optimistic)             ▲ SSE "changed"     │                      │ stdio (JSON-RPC)
└────────┼──────────────────────────────┼──────────────────┘      ┌───────────────▼───────────────────────┐
         ▼                              │                         │  MCP server  (dist/mcp.mjs)           │
┌──────────────────────── Node: HTTP server (dist/server.mjs) ─┐  │  registers the tool registry           │
│  REST /api/documents/:id/ops · /api/tools/:name · /api/assets │  └───────────────┬───────────────────────┘
│  SSE /api/events · /api/render (Playwright) · static editor  │                  │
│  fs.watch(workspace) → SSE for edits made by other processes │◄── POST /api/events (live notify, render)
└──────────────┬────────────────────────────────────────────────┘                  │
               │                    both use the same                             │
               ▼                                                                  ▼
        ┌──────────────── Store (src/server/store.ts) ──────────────────────────────┐
        │ workspace/documents/<id>.json + .history.json · assets/index.json + files │
        │ per-document lock (atomic mkdir) · atomic writes (tmp + rename)            │
        └────────────────────────────────┬───────────────────────────────────────────┘
                                         ▼
        ┌──────────────── Core (src/core, pure TypeScript, no DOM/Node APIs) ───────┐
        │ types · classes (Roblox registry) · schema (validation/coercion) · ops    │
        │ document (resolved tree, components, tokens) · layout (Roblox rules)      │
        │ spec (NodeSpec builder) · edit (group/detach/…) · presets · animation     │
        │ validate · export/{ir, luau, rbxmx, zip} · devices · fonts · migrate      │
        └────────────────────────────────────────────────────────────────────────────┘
```

## Modules and responsibilities

| Concern | Location | Notes |
|---|---|---|
| Document model | `src/core/types.ts`, `document.ts`, `migrate.ts` | Versioned JSON, flat node map, resolved tree. |
| Roblox knowledge | `src/core/classes.ts`, `fonts.ts`, `devices.ts` | Single registry of classes, props, enums and defaults used everywhere. |
| Mutations | `src/core/ops.ts`, `spec.ts`, `edit.ts` | All changes are ops with exact inverses. Atomic batches. |
| Layout | `src/core/layout.ts` | UDim2/AnchorPoint, padding, UIScale, constraints, list/grid/page layouts, scrolling canvases, AutomaticSize, TextScaled, top-bar inset. Text measurer is injected. |
| Components | `document.ts` (`resolveTree`) | Instances expanded at resolve time; overrides keyed by child path. |
| Design system | `types.ts` tokens, `document.ts` `applyTokens` | Token bindings resolved at resolve time. |
| Animation | `src/core/animation.ts` | TweenService easing, interpolation, sampling. |
| Validation | `src/core/validate.ts` | Structure, export readiness, design quality. |
| Export | `src/core/export/*` | One IR, three writers (Luau modules, single script, rbxmx) + zip. |
| Persistence | `src/server/store.ts` | Locking, atomic writes, history (undo/redo by source), assets. |
| HTTP API | `src/server/http.ts` | Editor sync, tool API, SSE, assets, export downloads, render. |
| Tool API | `src/server/tools.ts`, `refs.ts`, `guide.ts` | One implementation for MCP and HTTP. |
| MCP | `src/mcp/main.ts` | Thin adapter: zod schemas → MCP tools; images as MCP image content. |
| Editor shell | `src/editor/App.tsx`, `store.ts`, `actions.ts`, `shortcuts.ts` | State, sync queue, commands. |
| Canvas | `src/editor/canvas/*` | Pan/zoom, hit testing, selection depth, move/resize, snapping, marquee, drawing, drop, text editing. |
| Rendering | `src/editor/render/*` | DOM renderer shared by canvas, preview, thumbnails and headless render. |
| Panels | `src/editor/panels/*` | Layers/pages, library, components, assets, styles, properties, timeline. |

## Key decisions (summary, see DECISIONS.md)
1. **DOM renderer, own layout engine.** Rects come from the Roblox layout
   engine in core, never from CSS layout, so canvas, preview, MCP outline,
   validation and export all agree. CSS only paints.
2. **Modifiers are child nodes**, mirroring Roblox, so export is 1:1.
3. **Ops with inverses** are the only mutation path. That gives undo/redo,
   atomic MCP calls and safe failure.
4. **File-based workspace shared by two processes** (server + MCP) with locks.
   MCP works without the editor, and the editor sees MCP edits via fs.watch → SSE.
5. **Optimistic editor sync.** The editor applies ops locally, queues them to
   the server, and reloads + rebases unsent ops when someone else changed the
   document.
6. **One tool registry for MCP and HTTP**, tested once.

## Data flow: an edit in the editor
1. A user gesture produces ops (e.g. `update Position`). During drags,
   `previewGesture` re-applies ops to the gesture's base document every frame.
2. On release, `store.apply` commits one undo step and queues the ops.
3. The queue POSTs `/api/documents/:id/ops` with the client id. The server
   applies them under the lock, writes the file, bumps the revision and records
   history (source `editor`).
4. The server broadcasts `changed{revision, clientId}`. Other tabs reload; the
   origin ignores its own events.

## Data flow: Claude edits via MCP
1. A tool call → `runTool` validates input with zod → the tool builds ops →
   `store.applyOps` (lock, write, history source `mcp`).
2. The MCP process POSTs `/api/events` (best effort). The server's fs.watch
   would also detect the change.
3. The editor receives `changed` and reloads the document, re-applying any
   unsent local ops on top.

## Build & run
- `npm run dev`: Vite (5173, proxies `/api`) + auto-rebuilt API server (5178).
- `npm run build`: typecheck, Vite build to `dist/editor`, esbuild bundles
  `dist/server.mjs` and `dist/mcp.mjs` (`packages: external`, so `node_modules` is needed).
- `npm start`: serves the built editor and API on 5178.
