# Canvas System

## Coordinates
World coordinates are pixels at zoom 1. Each top-level node has `canvas.{x,y}`; ScreenGuis also have `canvas.{w,h}` (simulated device). Screen = world × zoom + pan. The world is a single transformed `div`; the overlay (selection, handles, guides) is drawn in screen space for crisp lines.

## Rendering
`src/editor/scene.ts` resolves each root (components expanded, tokens applied, animation sample applied) and runs the **core layout engine** with a browser text measurer (canvas `measureText` on the bundled fonts). `render/Renderer.tsx` paints the result with absolutely positioned DOM, so layout is never delegated to CSS. Scenes are cached by document identity.

## Interaction
| Action | Behaviour |
|---|---|
| Click | Selects the top-most child of the screen under the cursor; keeps the current selection depth (siblings). |
| Ctrl/⌘+click | Deepest element. |
| Double-click | One level deeper; on a selected text object, inline text edit. |
| Shift+click | Toggle in selection. |
| Drag empty area | Marquee (inside a screen: its direct children; outside: artboards). |
| Drag selection | Move (Position offset; scale part kept). Shift locks the axis. Snaps to parent/sibling edges and centres (Ctrl/⌘ disables). Shows distances to the parent's content box. |
| Drag item inside a list/grid layout | Reorders (child order) instead of moving. |
| Handles | Resize, keeping each axis' mode (Scale stays scale, Offset stays offset). Shift = keep aspect, Alt = from centre. |
| Drag artboard label | Move the screen on the canvas. |
| Alt + hover | Measure distance between the selection and the hovered element. |
| Wheel / Shift+wheel | Pan. Ctrl/⌘+wheel or pinch: zoom at the cursor. Space+drag / middle-drag: pan. |
| Drop | Presets, components and assets from panels; image files from the OS (uploaded then inserted); reference assets are placed as canvas references. |

Grid snapping (magnet button) rounds positions to 8 px.

## Hit testing
`canvas/hit.ts` walks the resolved tree in reverse paint order (ZIndex, then order), honours `Visible`, `editorHidden` and clipping (ClipsDescendants / ScrollingFrame). Rotation is ignored for hit testing (axis-aligned boxes) and documented in [[KNOWN_ISSUES]].

## Undo/redo
Every committed interaction is one op batch with inverses on the editor stack (300 steps). Gestures preview without history and commit once.
