# Development Roadmap

Status legend: ✅ done & tested · 🟡 partial · ⬜ not started

## Stage 1 — Foundation ✅
Project setup ✅ · layout & chrome ✅ · canvas ✅ · selection ✅ · drag/resize ✅ · layers ✅ · properties ✅ · undo/redo ✅ · saving/loading ✅

## Stage 2 — Design functionality ✅
Roblox elements (20 classes) ✅ · component library/presets ✅ · nesting ✅ · layouts ✅ · tokens ✅ · asset management ✅

## Stage 3 — Preview & export ✅
Responsive previews ✅ · Roblox rendering ✅ · Luau export ✅ · rbxmx export ✅ · validation ✅

## Stage 4 — Claude integration ✅
Structured format ✅ · tool API ✅ · MCP server ✅ · docs ✅ · integration tests ✅ (real stdio client)

## Stage 5 — Advanced 🟡
Animation timeline ✅ · component variants ✅ (create/swap; no variant *properties* panel yet) · design variations ✅ · advanced assets 🟡 (folders/search/ids; no sprite-sheet slicing or bulk Roblox upload) · reference recreation 🟡 (references on canvas + `view_asset` for Claude; no automatic palette extraction)

Roadmap change (documented in [[DECISIONS]]): the core layout engine, export and the MCP tool API were built **before** the editor UI. They are the parts everything else depends on, and they can be tested headlessly.

## Next steps (priority order)
1. **Verify exports in Roblox Studio.** Import `.gui.rbxmx` and `.code.rbxmx` from the demo; run the LocalScript; record findings in [[KNOWN_ISSUES]]. Not possible in the build environment (no Studio).
2. **Responsive helpers**: "auto-scale to reference resolution" (UIScale + small controller script), and make the templates phone-friendly (the Inventory template overflows on 852×393).
3. **Component properties panel**: expose variant properties as dropdowns, and named text/image slots for instances.
4. **Auto-layout UX**: inline padding/gap controls on frames with a UIListLayout (Figma-style), "Wrap in list layout" command.
5. **Roblox Studio plugin (investigation)**: a Studio plugin polling `http://127.0.0.1:5178` to pull exports directly (Studio's HttpService can reach localhost from plugins). Keep the file export as the reliable path.
6. **Asset upload helper**: optional Open Cloud Assets API upload with the user's API key → fills `robloxAssetId` automatically.
7. **Rich text styling**: `stroke`, `mark`; text stroke per character in preview.
8. **Performance**: virtualise the layers list; incremental layout for very large documents (> 3k nodes).

## Continuation guide (for the next Claude session)
1. `git clone` the repo, `npm install`, `npm test` (unit + integration), `npm run test:e2e` (needs Chromium/Playwright).
2. Read [[ARCHITECTURE]], [[DECISIONS]], [[KNOWN_ISSUES]] and the latest `development_logs/` entry.
3. Core rules: every mutation is an op (`src/core/ops.ts`); new Roblox properties go in `src/core/classes.ts` only; tools live in `src/server/tools.ts` (MCP + HTTP share them) — after changing tools run `npm run docs:api`.
4. Run the app: `npm run build && npm start` (or `npm run dev`).
5. After the session: update [[CHANGELOG]], this roadmap, [[KNOWN_ISSUES]], add a log in `development_logs/`.
