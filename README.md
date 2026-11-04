# Roblox UI Studio

A visual design studio for **Roblox game interfaces**: an infinite canvas with
Roblox-accurate layout, components, design tokens, an animation timeline, device
previews, and export to **Luau** and **Roblox Studio models (.rbxmx)**. It also
includes an **MCP server**, so a normal Claude chat can build and edit designs
for you.

- Works fully without AI. Claude integration is an extra.
- Designs are versioned JSON files you own (`workspace/`).
- Every property uses Roblox names (`UDim2`, `AnchorPoint`, `UIListLayout`, …).

## Quick start
```bash
npm install
npm run build
npm start          # → http://127.0.0.1:5178
```
Development (hot reload): `npm run dev` → http://localhost:5173

## Connect Claude
Claude Desktop → Settings → Developer → Edit Config:
```json
{ "mcpServers": { "roblox-ui-studio": { "command": "node", "args": ["/ABSOLUTE/PATH/roblox-ui-studio/dist/mcp.mjs"] } } }
```
Claude Code:
```bash
claude mcp add roblox-ui-studio -- node /ABSOLUTE/PATH/roblox-ui-studio/dist/mcp.mjs
```
Then ask: *"Use Roblox UI Studio to build a pet shop screen with a 3-column grid of pet cards."*
Full guide: [`obsidian/ROBLOX UI STUDIO/CLAUDE_INTEGRATION.md`](obsidian/ROBLOX%20UI%20STUDIO/CLAUDE_INTEGRATION.md).

## Export to Roblox Studio
Click **Export** in the editor:
- `*.gui.rbxmx` → right-click StarterGui → *Insert from File…* (instances, no code)
- `*.code.rbxmx` → right-click ReplicatedStorage → *Insert from File…* (ModuleScripts), plus the shown LocalScript
- or the ZIP (Rojo-ready folder)

Local images need a Roblox asset id (Assets panel) before they export. Details:
[`ROBLOX_EXPORT.md`](obsidian/ROBLOX%20UI%20STUDIO/ROBLOX_EXPORT.md).

## Tests
```bash
npm test            # unit + integration (incl. a real MCP client)
npm run test:e2e    # drives the editor in Chromium (needs Playwright)
```

## Documentation
Everything lives in [`obsidian/ROBLOX UI STUDIO/`](obsidian/ROBLOX%20UI%20STUDIO/README.md)
(designed to be copied or symlinked into an Obsidian vault): architecture, document format,
canvas, components, animation, assets, preview fidelity, export, API reference, roadmap,
decisions, known issues and development logs.

## Requirements
Node.js ≥ 20. Rendering for Claude (`render_preview`) needs Playwright with
Chromium: `npm i -D playwright && npx playwright install chromium`.
