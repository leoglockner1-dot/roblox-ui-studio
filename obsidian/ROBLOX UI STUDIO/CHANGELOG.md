# Changelog

## 0.1.0 — 2026-11-04 (first development session)
- Core: versioned document model, Roblox class registry (20 classes), value coercion/validation, ops engine with inverses, resolved tree (components + tokens), Roblox layout engine, animation evaluation, validation, presets (21), NodeSpec builder, migrations.
- Export: IR, Luau modules (Util/Theme/Components/Screens/Animations), single script, rbxmx (GUI + code package), zip.
- Server: workspace store with locks/atomic writes/history, HTTP API, SSE + file watching, assets, export downloads, headless render (Playwright).
- Tools: 49 tools shared by MCP and HTTP; MCP stdio server; design guide.
- Editor: canvas (select/move/resize/snap/measure/marquee/draw/drop/text edit/reorder), layers & pages, library, components (variants), assets (references), styles (tokens), inspector, timeline (auto-key), preview (devices, compare, interactive), export dialog, home, shortcuts.
- Tests: unit, integration (real MCP client), e2e (Playwright).
- Fixes during the session: ScrollingFrame canvas smaller than window broke grids; list layouts ignored AutomaticSize; gradient presets used dark bases (Roblox multiplies); gradient buttons tinted their own text (moved label to a child); presets inserted into text objects (containerFor now picks frame-like containers).
