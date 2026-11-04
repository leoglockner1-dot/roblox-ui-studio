# Roblox Preview

The canvas, the Preview window and headless renders all use the same pipeline: resolved tree → **core layout engine** (Roblox rules) → DOM painter.

## Devices
Desktop 1080p/1440p, laptops (1366×768, 1440×900), 1280×720, iPad (1024×768), iPad Pro, iPhone 15 (852×393), iPhone SE, Android (800×360, 640×360), console/TV (1920×1080 with TV-safe margins). Sizes are Roblox GUI pixels (logical points on mobile). Rotate for portrait. **Compare devices** shows four at once.

## Simulated Roblox behaviour
- Top-bar inset (58 px, the 2024+ top bar) when `IgnoreGuiInset = false`; the top bar mock is drawn on top like CoreGui.
- `ScreenInsets`: None ignores safe areas; the other modes respect the device safe-area insets.
- UDim2/AnchorPoint/Rotation (around centre, inherited), ZIndex in Sibling mode, Visible, ClipsDescendants.
- UIPadding, UIScale (scales size around the anchor and descendant offsets/text), UIAspectRatioConstraint (FitWithinMaxSize, ScaleWithParentSize), UISizeConstraint, UITextSizeConstraint.
- UIListLayout (direction, padding, alignments, SortOrder, Wraps), UIGridLayout (cell size/padding, FillDirection, max cells, StartCorner, alignment), UIPageLayout (shows `_CurrentPage`).
- ScrollingFrame: CanvasSize (never smaller than the window), CanvasPosition, AutomaticCanvasSize, scrollbar; wheel scrolling in Preview.
- AutomaticSize X/Y/XY for frames (content) and text (text bounds), including inside layouts.
- TextScaled (largest fitting size, ≤ 100), TextWrapped, alignment, truncation, LineHeight, RichText subset, TextStroke.
- UICorner (scale relative to the smaller side), UIStroke (Border/Contextual), UIGradient (multiplies colour and transparency; Rotation; Offset approximated), CanvasGroup transparency.
- Images: Stretch, Fit, Crop, Tile (TileSize), Slice (SliceCenter + SliceScale via border-image), ImageRectOffset/Size, ImageColor3 tint (multiply, masked), ResamplerMode.Pixelated.
- AutoButtonColor hover/press darkening in Preview.

## Known differences from Roblox (unavoidable or not yet done)
| Area | Difference |
|---|---|
| Fonts | Builder Sans ≈ Inter, Gotham SSm ≈ Montserrat (proprietary fonts). Others are the same typefaces. Glyph metrics differ slightly, so TextScaled sizes can be off by ~1–2 px. |
| Text stroke | `TextStrokeTransparency` is drawn as a 1 px shadow outline; UIStroke on text uses `-webkit-text-stroke` (close, not identical at large thickness). |
| UIStroke | Drawn outside the box with `box-shadow`; Roblox's join modes (Round/Bevel/Miter) are not distinguished. |
| UIGradient Offset | Approximated by shifting stops along the gradient axis. |
| ZIndexBehavior Global | Rendered as Sibling. |
| Rotation + ClipsDescendants | The browser clips rotated frames; Roblox does not clip rotated GUIs. The renderer disables clipping on rotated frames to match. Hit testing ignores rotation. |
| rbxassetid images | Not fetchable; a placeholder is shown. Use library assets for previews. |
| ViewportFrame | 3D content is not rendered (placeholder). |
| Flex (UIFlexItem), UITableLayout | Not implemented. |
| Device safe areas | Approximate values; real devices vary. |
