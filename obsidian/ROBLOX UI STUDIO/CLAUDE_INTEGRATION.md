# Claude Integration

Roblox UI Studio exposes its full editing API to Claude through an **MCP server**
(Model Context Protocol). Any Claude client that supports local MCP servers can
create, inspect, edit, validate, preview and export designs. **Claude Desktop**
and **Claude Code** are the main ones. You open a normal chat and say *"Build a
fantasy shop in Roblox UI Studio"*, and the design shows up live in the editor,
fully editable.

The same tools are also available over HTTP (`POST /api/tools/<name>`), which is
useful for scripts and for clients without MCP.

---

## 1. Setup

### Prerequisites
- Node.js ≥ 20
- The project installed and built:
  ```bash
  cd roblox-ui-studio
  npm install
  npm run build
  ```

### Start the editor (optional but recommended)
```bash
npm start            # http://127.0.0.1:5178
```
The MCP server works **without** the editor running: it reads and writes the
workspace files directly. When the editor *is* running:
- open editors update live while Claude works,
- `render_preview` / `preview_animation(render: true)` can return PNG images, so
  Claude can *look at* its work,
- `open_document` / `create_document` switch the open editor to that document.

### Claude Desktop
Settings → Developer → **Edit Config** opens `claude_desktop_config.json`. Add:

```json
{
  "mcpServers": {
    "roblox-ui-studio": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/roblox-ui-studio/dist/mcp.mjs"]
    }
  }
}
```

Restart Claude Desktop. The tools appear in the tools menu as
`roblox-ui-studio`. The editor's Home screen shows this snippet with your
real path filled in.

On Windows use forward slashes or escaped backslashes, e.g.
`"C:/Users/leo/roblox-ui-studio/dist/mcp.mjs"`.

### Claude Code
```bash
claude mcp add roblox-ui-studio -- node /ABSOLUTE/PATH/TO/roblox-ui-studio/dist/mcp.mjs
```

### Environment variables (optional)
| Variable | Default | Purpose |
|---|---|---|
| `RUIS_WORKSPACE` | `<install>/workspace` | Where documents/assets are stored. Must be the same for the editor and MCP. |
| `RUIS_URL` | `http://127.0.0.1:5178` | Where the MCP server finds the running editor (live updates, rendering). |
| `RUIS_PORT` | `5178` | Editor server port. |
| `RUIS_CHROMIUM` | – | Custom Chromium path for rendering. |

Pass env vars in the MCP config with `"env": { "RUIS_WORKSPACE": "D:/RobloxUI" }`.

### Rendering requirement
`render_preview` uses Playwright (Chromium) inside the editor server. If it's
missing:
```bash
npm i -D playwright && npx playwright install chromium
```
Everything else works without it.

---

## 2. How Claude should work (recommended prompt)

The server sends these instructions automatically. Claude can also call
`get_design_guide` for the full workflow and design-quality rules.

1. `get_design_guide` (once per chat).
2. `list_documents` → `open_document`, or `create_document`.
3. `inspect_design` before editing anything existing.
4. `set_design_tokens`: palette, spacing, text styles first.
5. `create_element` with **nested NodeSpecs**, one call per panel.
6. Repeated items → `create_component` once, then `insert_component` with overrides.
7. `render_preview` at `desktop-1080p` and `iphone-15`, then fix what looks off.
8. `validate_design` → fix errors/warnings.
9. `export_luau` when the user asks.

A good opening message from you:

> Use Roblox UI Studio. Create a document "Pet Shop" and build a shop screen:
> header with title and close button, a scrollable 3-column grid of pet cards
> (component with icon, name, rarity, price button), and a currency display
> top-right. Dark UI, saturated rarity colours, Luckiest Guy for the title.
> Check it on desktop and phone, then validate.

---

## 3. The data model in 60 seconds

- A **document** has **pages**. A page holds top-level nodes, usually
  **ScreenGui artboards** (each with a simulated device size).
- Every node is one **Roblox Instance** with Roblox property names
  (`Size`, `Position`, `AnchorPoint`, `BackgroundColor3`, `TextSize`…).
- **Modifiers are children**, exactly as in Roblox: `UICorner`, `UIStroke`,
  `UIGradient`, `UIPadding`, `UIListLayout`, `UIGridLayout`, `UIPageLayout`,
  `UIScale`, `UIAspectRatioConstraint`, `UISizeConstraint`, `UITextSizeConstraint`.
- **Components**: any GUI node can become a component main ("master").
  **Instances** reference it and store only **overrides**, keyed by the child's
  name path (`"Header/Title"`).
- **Tokens**: colours, numbers (spacing/radius) and text styles. Properties can
  be bound to tokens, and changing a token updates every bound element.
- **Animations**: tracks of keyframes on node properties, exported as TweenService code.

See `DOCUMENT_FORMAT.md` for the full schema.

### Value formats (forgiving input)
| Type | Accepted input |
|---|---|
| UDim2 | `[xs, xo, ys, yo]` or `{xs, xo, ys, yo}` or `{x:{s,o}, y:{s,o}}` |
| UDim | `[s, o]`, `{s, o}`, or a number (= offset) |
| Vector2 | `[x, y]` or `{x, y}` |
| Color3 | `"#RRGGBB"`, `"#RGB"`, `"rgb(r,g,b)"`, `[r,g,b]` (0–255) |
| FontFace | `{family:"GothamSSm", weight:"Bold", style:"Normal"}` or `"GothamSSm"` |
| Enum | the item name: `"Center"`, `"Vertical"` (also `"Enum.X.Center"`) |
| ColorSequence | `[{t:0,color:"#FFF"},{t:1,color:"#000"}]` |
| NumberSequence | `[{t:0,value:0},{t:1,value:1}]` |
| Content (Image) | `"asset://<libraryAssetId>"`, `"rbxassetid://123"` or `123` |

Unknown properties, wrong types and invalid enum values are **rejected with a
precise message**. Nothing is applied on error.

### Node references
Tools accept any of:
- an id: `"n_k3j9x0a1bc"`
- a name path from a top-level node: `"MainMenu/ShopPanel/Title"`
- a unique name: `"Title"` (ambiguous names are rejected with candidate ids)
- an id path inside a component instance: `"n_inst/n_child"` (from `inspect_design`)

---

## 4. NodeSpec, the main building block

`create_element` takes a NodeSpec. Modifier **shorthands** keep calls small:

```json
{
  "className": "Frame",
  "name": "PetCard",
  "props": { "Size": [0, 180, 0, 240], "BackgroundColor3": "#202636" },
  "corner": 14,
  "stroke": { "Color": "#B45CFF", "Thickness": 2, "ApplyStrokeMode": "Border" },
  "padding": 10,
  "list": { "Padding": 8, "HorizontalAlignment": "Center" },
  "children": [
    { "className": "ImageLabel", "name": "Icon", "props": { "Size": [1, 0, 0, 140], "LayoutOrder": 1 } },
    { "className": "TextLabel", "name": "PetName", "props": { "Text": "Shadow Fox", "Size": [1, 0, 0, 24], "LayoutOrder": 2 },
      "tokens": { "$textStyle": "Heading", "TextColor3": "Text" } }
  ]
}
```

| Shorthand | Becomes |
|---|---|
| `corner: 12` or `{CornerRadius:[0.5,0]}` | UICorner |
| `stroke: 2` or `{Color, Thickness, …}` | UIStroke |
| `gradient: ["#FFF", "#888"]` (vertical) or full props | UIGradient |
| `padding: 12` / `[v, h]` / `[t, r, b, l]` / props | UIPadding |
| `list: true` / props | UIListLayout |
| `grid: {CellSize, CellPadding, …}` | UIGridLayout |
| `pages: true` / props | UIPageLayout |
| `aspect: 1.5` / props | UIAspectRatioConstraint |
| `scale: 0.8` | UIScale |
| `sizeConstraint: {MinSize, MaxSize}` | UISizeConstraint |
| `textSizeConstraint: {MaxTextSize}` | UITextSizeConstraint |

Other fields: `tokens` (bind props to tokens by name or id; `"$textStyle"` binds
a text style), `component` + `overrides` (create an instance), `notes`,
`raw: true` (skip the designer defaults, see below).

**Designer defaults.** New objects start with sensible values unless `raw: true`:
no border, white frames, transparent label backgrounds, Gotham Bold 18 px white
text, `TextButton` 160×48. Set any property explicitly to override them.

---

## 5. Tool overview

The full parameter reference is in `API_REFERENCE.md` (generated from the code).

| Area | Tools |
|---|---|
| Documents | `list_documents`, `create_document`, `open_document`, `duplicate_document`, `rename_document`, `delete_document` |
| Inspect | `inspect_design` (outline/json/spec), `find_elements`, `get_schema`, `get_design_guide`, `get_history` |
| Pages & screens | `create_page`, `rename_page`, `delete_page`, `create_screen`, `set_screen_size` |
| Elements | `create_element`, `update_element`, `update_elements`, `delete_element`, `duplicate_element`, `move_element`, `resize_element`, `group_elements`, `ungroup_element` |
| Components | `create_component`, `list_components`, `insert_component`, `update_component`, `set_instance_override`, `detach_instance`, `create_component_variant`, `swap_component` |
| Design system | `set_design_tokens`, `create_variation` |
| Assets | `import_asset`, `list_assets`, `update_asset`, `view_asset` |
| Animation | `create_animation`, `update_animation`, `delete_animation`, `preview_animation` |
| Output | `validate_design`, `render_preview`, `export_luau`, `export_component` |
| Safety | `undo`, `redo` |

### Results and errors
- Success: `{ "ok": true, ... }`. Mutating tools return the new `revision` and
  ids (`create_element` returns `ids`, a name → id map of everything created).
- Failure: `{ "ok": false, "error": "...", "hint": "..." }`, with `isError: true`
  in MCP. Nothing changes on failure: each tool call is one atomic batch.

### Reversibility
Each mutating tool call is **one undo step**, recorded with source `mcp`.
`undo` reverts the most recent change *made through MCP* and never the user's
own edits (`source: "any"` to include them). `get_history` lists recent changes
by source. `duplicate_document` / `create_variation` are the safe way to explore
alternatives.

### Inspect output example
`inspect_design` returns an outline with ids, explicitly set properties and
computed absolute boxes (x,y relative to the screen; w×h in px):

```
Page "Page 1" [pg_x]
  # root @canvas(0,0) screen 1920×1080 desktop-1080p
  ScreenGui "MainMenu" [n_a] ResetOnSpawn=false IgnoreGuiInset=true …
    Frame "ShopPanel" [n_b] Size={0.7,0,0.75,0} Position={0.5,0,0.5,0} AnchorPoint=(0.5,0.5) … → 288,135 1344×810
      UICorner [n_c] CornerRadius={0,20}
      TextLabel "Title" [n_d] Text="SHOP" TextSize=36 … → 312,159 1296×48
```

---

## 6. Worked examples

**Create a screen with a panel**
```json
{ "tool": "create_document", "arguments": { "name": "Shop", "device": "desktop-1080p" } }
{ "tool": "create_element", "arguments": {
  "documentId": "doc_…", "parentId": "MainScreen",
  "spec": { "className": "Frame", "name": "Panel",
            "props": { "Size": [0.6,0,0.7,0], "Position": [0.5,0,0.5,0], "AnchorPoint": [0.5,0.5], "BackgroundColor3": "#161A24" },
            "corner": 20, "padding": 24, "sizeConstraint": { "MaxSize": [1100, 720] } } } }
```

**Start from a preset**
```json
{ "tool": "create_element", "arguments": { "documentId": "doc_…", "parentId": "Panel", "preset": "shop-card", "spec": { "name": "FeaturedOffer" } } }
```

**Component + instances**
```json
{ "tool": "create_component", "arguments": { "documentId": "doc_…", "nodeId": "FeaturedOffer", "name": "OfferCard" } }
{ "tool": "insert_component", "arguments": { "documentId": "doc_…", "component": "OfferCard", "parentId": "Grid",
  "name": "Offer2", "overrides": { "Title": { "Text": "Mega Pack" }, "Buy/Label": { "Text": "R$ 499" } } } }
```

**Edit inside an instance** (becomes an override automatically)
```json
{ "tool": "update_element", "arguments": { "documentId": "doc_…", "nodeId": "MainScreen/Panel/Grid/Offer2/Subtitle", "props": { "Text": "Best value" } } }
```

**Tokens**
```json
{ "tool": "set_design_tokens", "arguments": { "documentId": "doc_…",
  "colors": [{ "name": "Primary", "value": "#7C5CFF" }],
  "textStyles": [{ "name": "Title", "font": { "family": "LuckiestGuy", "weight": "Regular" }, "size": 40 }] } }
{ "tool": "update_element", "arguments": { "documentId": "doc_…", "nodeId": "Title", "tokens": { "$textStyle": "Title" } } }
```

**Entry animation**
```json
{ "tool": "create_animation", "arguments": { "documentId": "doc_…", "name": "Open", "trigger": "onShow",
  "tracks": [
    { "nodeId": "Panel", "property": "Position", "keyframes": [ { "time": 0, "value": [0.5,0,0.58,0] }, { "time": 0.35, "value": [0.5,0,0.5,0], "easingStyle": "Back", "easingDirection": "Out" } ] },
    { "nodeId": "Panel", "property": "GroupTransparency", "keyframes": [ { "time": 0, "value": 1 }, { "time": 0.25, "value": 0 } ] }
  ] } }
```
(`GroupTransparency` needs the panel to be a `CanvasGroup`. For a Frame, animate
`BackgroundTransparency`, or a `UIScale` child's `Scale`.)

**Reference images**
```json
{ "tool": "import_asset", "arguments": { "path": "C:/Users/leo/Pictures/ref-shop.png", "reference": true } }
{ "tool": "view_asset", "arguments": { "assetId": "a_…" } }
```
Claude sees the image, extracts palette, hierarchy and shapes, and rebuilds them
with editable elements. Reference images are never exported.

**Look at the result**
```json
{ "tool": "render_preview", "arguments": { "documentId": "doc_…", "rootId": "MainScreen", "device": "iphone-15" } }
```

**Export**
```json
{ "tool": "export_luau", "arguments": { "documentId": "doc_…", "outputDir": "C:/Users/leo/Desktop/ShopExport" } }
```
This writes `UIShop/…` Luau modules (Rojo layout) and `UIShop.gui.rbxmx` /
`UIShop.code.rbxmx` for Studio's *Insert from File*.

---

## 7. Limitations (current)
- Claude cannot upload images to Roblox. Local images export as empty `Image`
  until you set their Roblox asset id (Assets panel or `update_asset`).
- `rbxassetid://` images can't be fetched for preview; they show a labelled placeholder.
- Rendering needs the editor server + Playwright.
- No direct Roblox Studio plugin yet: use the `.rbxmx` / Luau export (see `ROBLOX_EXPORT.md`).
- ViewportFrame contents (3D) are not designed here.
- Text metrics are approximate in the MCP outline (the editor uses real font
  metrics). `render_preview` is exact to the editor.
- Rich text supports `b i u s br font(color,size,weight) uc sc`, not `stroke`/`mark` styling.

## 8. Troubleshooting
| Symptom | Fix |
|---|---|
| Tools don't appear in Claude Desktop | Check the absolute path to `dist/mcp.mjs`, run `npm run build`, restart Claude Desktop. Logs: Settings → Developer. |
| Claude's changes don't show in the editor | The editor and MCP must use the same `RUIS_WORKSPACE`. Reload the page. |
| `render_preview` says not running | Start the editor (`npm start`); set `RUIS_URL` if you changed the port. |
| `render_preview` says Playwright missing | `npm i -D playwright && npx playwright install chromium` |
| "node not found" | Use the full path to node in `command`, e.g. `C:/Program Files/nodejs/node.exe`. |
