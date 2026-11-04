# Testing

| Command | What |
|---|---|
| `npm test` | Vitest: unit + integration (≈ 90 tests, ~10 s) |
| `npm run test:e2e` | Builds, starts the server on a temp workspace, drives the editor in Chromium (13 checks) |
| `npm run typecheck` | TypeScript strict |

## Coverage by area
| Area | Tests |
|---|---|
| Ops & undo, atomicity, parenting rules, pages | `tests/unit/ops.test.ts` |
| Components, overrides (name paths, nested instances), master propagation | `ops.test.ts` |
| Layout engine (UDim2, anchor, inset, padding, UIScale, constraints, list/grid/page, AutomaticSize, TextScaled, scrolling) | `layout.test.ts` |
| Luau export (modules, diffs, escaping, assets, animations, single script, every value type), rbxmx (well-formed, hierarchy, typed props, ModuleScript sources), zip | `export.test.ts` |
| Validation (contrast, off-screen, broken animations) | `export.test.ts` |
| Every preset builds, validates and exports valid Luau | `presets.test.ts` |
| Tool API: full Claude workflow (create → tokens → components → overrides → animation → validate → export → undo/redo → variants → group/ungroup → variation → assets → history), concurrency (20 parallel writers) | `tools.test.ts` |
| Real MCP stdio client (tool list, calls, errors), edits reaching the editor's event stream, HTTP ops/conflicts/undo, exports, assets, import validation | `mcp-http.test.ts` |
| Editor: select, drag-move, undo, resize, inspector edit, text tool + inline edit, live MCP-style edits, library insert, duplicate/delete, components, preview, export dialog, headless PNG render, no console errors | `tests/e2e/run.mjs` |

## Manual checks still needed
- Import of exported `.rbxmx` and running generated Luau in **Roblox Studio** (see [[ROBLOX_EXPORT]]).
- Claude Desktop end-to-end on the user's machine (the MCP protocol itself is tested with the official SDK client).
