# Known Issues

| # | Issue | Impact | Workaround / plan |
|---|---|---|---|
| 1 | Exports not yet verified inside Roblox Studio (no Studio in the build environment) | rbxmx import or rare enum values could need adjustment | Verify with the demo document; report in this note. Unit tests cover syntax/structure. |
| 2 | Text metrics differ slightly from Roblox (font approximations for Builder Sans/Gotham) | TextScaled sizes and AutomaticSize text widths can differ by a few px | Leave small slack in text boxes. |
| 3 | Rotated elements: hit testing and selection boxes use unrotated bounds; resize handles are axis-aligned | Selecting rotated items can feel off | Select via layers. |
| 4 | Multi-select resize not supported (handles appear for single selection only) | — | Resize individually or group first. |
| 5 | Dragging on the canvas cannot reparent into another frame | — | Use the layers panel (drag & drop) or cut/paste. |
| 6 | Reordering in a UIListLayout with SortOrder=LayoutOrder: the visual order follows LayoutOrder, so reordering by drag only changes child order | Items with distinct LayoutOrder values won't visually move | Edit LayoutOrder, or give equal LayoutOrders. |
| 7 | The Inventory template overflows on small phones | Template only | Roadmap: responsive helpers + template update. |
| 8 | Layers panel is not virtualised | Slow for > 3k visible rows | Collapse groups; roadmap item. |
| 9 | UIGradient `Offset`, UIStroke join modes, ZIndexBehavior Global approximated | Preview fidelity | See [[ROBLOX_PREVIEW]]. |
| 10 | Undo across editor/MCP: the editor's undo stack is per session; undoing a change that Claude has since modified may fail with a message | — | Use `undo` on the MCP side for Claude's changes. |
