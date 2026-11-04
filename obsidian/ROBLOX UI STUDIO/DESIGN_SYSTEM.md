# Design System

## Tokens
Each document has three token sets (Styles tab, `set_design_tokens` tool):
- **Colours**: roles like Primary, Accent, Surface, Surface Raised, Text, Text Muted, Success, Danger (defaults included).
- **Numbers**: spacing (4/8/16/24/32) and radii (6/12/20). Bindable to number props or UDim offsets (CornerRadius, Padding…).
- **Text styles**: font + size (+ line height). Bind with the "Text style" picker or `tokens: {"$textStyle": "Title"}`.

Bindings live on the node (`node.tokens`) and are resolved when the tree is built, so changing a token updates every bound element in the editor, preview and export. Detaching keeps the current value. Export writes **resolved values** plus a `Theme` module with all tokens.

## House rules (the presets and the Claude guide follow these)
Distilled from the Roblox Design Academy notes (UI/UX, recipes R01–R14):
- ≤ 2 type families: display (Gotham Heavy/Bold, Luckiest Guy, Fredoka) for titles and numbers; Builder Sans for body. 4–5 sizes.
- 4/8 px spacing grid; equal internal padding in cards; consistent radii.
- Neutral chrome, saturated content; one accent for primary actions.
- Fixed semantic colours: success green, danger red, gold currency; rarity tiers Common `#B4BCC8`, Uncommon `#5BD16E`, Rare `#3FA1FF`, Epic `#B45CFF`, Legendary `#FFB52E`, Mythic `#FF4D6D`.
- Depth via subtle UIStroke (Border, 1.5–3 px, partially transparent) and vertical gradients; text strokes only over the 3D world.
- Touch targets ≥ 44 px, text ≥ 12 px on phones, contrast ≥ 4.5:1 (validator checks contrast, tap targets and small text).
- Squint test: the primary action must remain the most visible element.

## Gradient rule (Roblox behaviour)
UIGradient **multiplies** its parent's colours, so gradient fills need a **white** `BackgroundColor3`. On text objects it tints the text too, which is why gradient buttons use a child TextLabel for the label (see the Primary Button preset).

## Auto layout
Roblox auto layout = UIListLayout / UIGridLayout / UIPageLayout + UIPadding + AutomaticSize. The editor computes these exactly like Roblox (see [[CANVAS_SYSTEM]]). Items in a layout are reordered by dragging; their Position is controlled by the layout.
