# Decisions

Format: date · decision · why · alternatives considered.

1. **2026-11-04 · TypeScript + React 19 + Vite; Node HTTP server; no UI framework or canvas library.** The editor needs exact Roblox layout semantics and real text rendering, so a DOM painter over our own layout engine beats Konva/Fabric (canvas text, no CSS gradients/strokes) and lets the preview, thumbnails and headless renders share one renderer. Considered: Konva, PixiJS, tldraw.
2. **Plain CSS with design tokens instead of Tailwind.** A dense pro-tool UI with a few hundred rules is clearer as one stylesheet; no build plugins. Considered: Tailwind.
3. **Modifiers as child nodes.** Mirrors Roblox exactly, so export and mental model are 1:1. The inspector presents them as cards. Considered: modifiers as node properties.
4. **Ops with inverses as the only mutation path.** Undo/redo, atomic tool calls, safe failure and op-level sync from one mechanism. Considered: snapshot diffs, CRDT (overkill for a local single-user app).
5. **File workspace + locks shared by two processes.** MCP works with the editor closed; no database; files are inspectable and versionable. Considered: MCP proxying to the server only (breaks when the editor isn't running); SQLite.
6. **One tool registry for MCP and HTTP.** One implementation and one test suite; the HTTP route also serves non-MCP clients.
7. **Name-path overrides in exported Luau, id-path overrides in the document.** IDs are stable for editing; names are what Roblox code can address. The exporter warns on ambiguous names.
8. **Roadmap order changed**: core/layout/export/tools before the editor, because they carry the risk and can be tested headlessly.
9. **Designer defaults for new objects** (no borders, white frames, transparent labels) instead of Roblox's raw defaults, which look dated; export writes explicit values so behaviour never depends on assumed defaults.
10. **58 px top-bar inset** (2024+ Roblox top bar).
11. **Repo `leoglockner1-dot/roblox-ui-studio`; docs in `obsidian/ROBLOX UI STUDIO/`** because the Obsidian vault is not reachable from the cloud build environment; copy/symlink into the vault.
12. **Playwright is optional** (rendering only), loaded with `createRequire` so a global install works too.
