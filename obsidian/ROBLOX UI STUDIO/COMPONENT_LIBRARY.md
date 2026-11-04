# Component Library

## Roblox classes
GuiObjects: Frame, CanvasGroup, TextLabel, TextButton, TextBox, ImageLabel, ImageButton, ScrollingFrame, ViewportFrame.
Modifiers: UICorner, UIStroke, UIGradient, UIPadding, UIScale, UIAspectRatioConstraint, UISizeConstraint, UITextSizeConstraint.
Layouts: UIListLayout, UIGridLayout, UIPageLayout. Root: ScreenGui.
All properties and enums are defined once in `src/core/classes.ts`; `get_schema` returns them.

## Presets (Library tab, `create_element` with `preset`)
| id | Category | Notes |
|---|---|---|
| button-primary | Buttons | Gradient TextButton + child label (gradient-safe) |
| button-secondary | Buttons | Outlined |
| button-buy | Buttons | Green purchase button |
| button-icon | Buttons | 48 px close button |
| currency-display | Currency & Stats | Pill, coin, amount (AutomaticSize X), + button |
| progress-bar | Currency & Stats | Track + gradient fill (Fill.Size X scale = progress) |
| health-bar | Currency & Stats | Heart badge, bar, value |
| player-card | Currency & Stats | Avatar, names, level badge |
| inventory-slot | Inventory & Items | Rarity stroke, icon, count |
| item-card | Inventory & Items | Art panel, name, rarity |
| shop-card | Inventory & Items | Badge, art, title, buy button |
| rarity-tag | Inventory & Items | Auto-sized pill |
| notification | Feedback | Accent bar, icon, title, message |
| reward-display | Feedback | Glow, tile, amount |
| tooltip | Feedback | Auto-sized (Y) list |
| popup | Panels | Dim overlay + dialog + actions |
| settings-panel | Panels | Toggle rows (list, auto height) |
| tabs | Navigation | Segmented tab bar |
| section-header | Navigation | Title + accent underline |
| template-inventory | Templates | Full inventory screen (scale-sized, max size) |
| template-hud | Templates | Corner-anchored HUD |

Presets insert ordinary editable nodes. Turn any of them into a component with Ctrl/⌘+Alt+K.

## Components
- **Create**: select a GUI object → Ctrl/⌘+Alt+K. It becomes the main component and stays where it is.
- **Instances**: insert from the Components tab or `insert_component`. Edit the main component and every instance updates.
- **Overrides**: any property edit inside an instance becomes an override (purple labels; click a purple label to reset). Structure (adding/removing children, renaming) is only edited on the main component. **Detach** turns an instance into plain nodes.
- **Variants**: `create_component_variant` creates a sibling main component in a set (e.g. State=Hover). Swap via the inspector dropdown or `swap_component`; overrides whose paths still exist are kept.
- **Export**: each component becomes `Components/<Name>.luau` with `create()`. Instances become `Util.instance(Component, propDiffs, overrideDiffs)`.
- Override paths in exported code use **names**. Keep sibling names unique inside components (the exporter warns otherwise).
