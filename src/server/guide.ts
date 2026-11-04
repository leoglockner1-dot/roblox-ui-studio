/** Concise operating + design guide returned by the `get_design_guide` tool. */
export const DESIGN_GUIDE = `# Roblox UI Studio — guide for Claude

## Workflow
1. list_documents → open_document (or create_document). Call inspect_design before editing.
2. Set the visual identity first: set_design_tokens (palette, spacing, text styles).
3. Build top-down with create_element: one call per panel using nested NodeSpecs
   (children + modifier shorthands corner/stroke/gradient/padding/list/grid).
   Use presets (get_schema → presets) as starting points and adjust them.
4. Repeated things (slots, cards, rows) → make one, create_component, then insert_component
   with overrides ({"Title": {"Text": "Sword"}}). Prefer UIGridLayout/UIListLayout over manual positions.
5. render_preview (if available) to look at the result at several devices
   (desktop-1080p, iphone-15, ipad). Fix what looks wrong.
6. validate_design; fix errors and warnings. Then export_luau when asked.
7. Every tool call is one undo step; undo reverts only your own changes.

## Roblox layout rules
- Size/Position are UDim2 {xs,xo,ys,yo}: scale is a fraction of the parent's content box, offset is pixels.
- AnchorPoint [0.5,0.5] + Position [0.5,0,0.5,0] centres. Right-align: AnchorPoint [1,0], Position [1,-16,0,16].
- UIPadding shrinks the area children use. UIListLayout/UIGridLayout ignore child Position.
- Text: TextScaled + UITextSizeConstraint for responsive labels; otherwise fixed TextSize.
- AutomaticSize X/Y grows a frame/label to fit content (great for pills, tooltips, lists).
- ScrollingFrame: CanvasSize {0,0,0,0} + AutomaticCanvasSize "Y" + a layout child.
- Screens: design at 1920×1080, then check phones (852×393). Big panels: Scale sizes or UISizeConstraint.
- ZIndex orders siblings; later siblings draw on top when ZIndex is equal.

## Design quality (avoid generic "AI" UI)
- One clear focal point per screen; the primary action must survive the squint test.
- ≤ 2 font families: a display face for titles/numbers (GothamSSm Heavy/Bold, LuckiestGuy, FredokaOne)
  and BuilderSans for body. 4–5 text sizes total.
- Spacing on a 4/8 px grid; equal inner padding in cards; consistent corner radii (e.g. 8 / 12 / 20).
- Neutral, dark-ish chrome; saturate content (items, currencies, rarity). One accent colour for actions.
- Semantic colours never change meaning: success green, danger red, gold coins, rarity tiers
  (Common #B4BCC8, Uncommon #5BD16E, Rare #3FA1FF, Epic #B45CFF, Legendary #FFB52E, Mythic #FF4D6D).
- Depth through subtle UIStroke (Border mode, 1.5–3 px, partially transparent) and vertical UIGradients,
  not drop shadows everywhere. Text strokes only where text sits over the 3D world.
- Touch targets ≥ 44 px; text ≥ 12 px on phones; contrast ≥ 4.5:1 for body text.
- Motion: entry 0.25–0.4 s Back/Out or Quad/Out; exits faster (0.15–0.2 s, In); hover 0.1 s.
  Animate UIScale.Scale for pops, Position for slides, transparency for fades.
- Use reference images (view_asset) for inspiration: extract palette, hierarchy, shapes — never copy.

## Images
- Library images are "asset://<id>". They preview locally but export as empty until the asset has a
  robloxAssetId (the user uploads to Roblox and sets the id). Never invent Roblox asset ids.
`;
