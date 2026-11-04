# Document Format (v1)

A design is one JSON file: `workspace/documents/<id>.json`. It is independent of
the editor, readable by people and Claude, and every change to it goes through
validated ops (`src/core/ops.ts`).

```jsonc
{
  "format": "roblox-ui-studio",   // identifies the file type
  "version": 1,                   // format version (see Migrations)
  "id": "doc_x1y2…", "name": "Pet Shop",
  "createdAt": "…", "updatedAt": "…",
  "revision": 42,                 // +1 per saved change (sync/conflict detection)
  "pages": [ { "id": "pg_…", "name": "Page 1", "children": ["n_screen"], "references": [ … ] } ],
  "nodes": { "n_screen": { … }, "n_panel": { … } },   // flat map, parent/children links
  "components": { "cmp_…": { "id", "name", "description?", "rootId", "variantOf?", "createdAt" } },
  "tokens": { "colors": [ … ], "numbers": [ … ], "textStyles": [ … ] },
  "animations": { "an_…": { … } },
  "meta": { "description": "…" }
}
```

## Node
```jsonc
{
  "id": "n_k3j9x0a1bc",          // never contains "/"
  "className": "Frame",          // a class from core/classes.ts
  "name": "ShopPanel",           // Roblox Name (avoid "/")
  "parent": "n_screen",          // null for top-level nodes on a page
  "children": ["n_corner", "n_title"],
  "props": {                     // Roblox properties; absent = class default
    "Size": { "xs": 0.7, "xo": 0, "ys": 0.75, "yo": 0 },
    "AnchorPoint": { "x": 0.5, "y": 0.5 },
    "BackgroundColor3": "#161A24"
  },
  "canvas": { "x": 0, "y": 0, "w": 1920, "h": 1080, "device": "desktop-1080p" }, // top-level only
  "tokens": { "BackgroundColor3": "c_surface", "$textStyle": "t_title" },       // optional bindings
  "componentId": "cmp_…",        // set on a component's main node
  "instance": { "componentId": "cmp_…", "overrides": { "n_title": { "Text": "Sword" } } }, // instances only
  "locked": true, "editorHidden": true, "notes": "…"                           // design-time only
}
```

### Value encodings
| Roblox type | JSON |
|---|---|
| UDim2 | `{ "xs", "xo", "ys", "yo" }` |
| UDim | `{ "s", "o" }` |
| Vector2 | `{ "x", "y" }` |
| Color3 | `"#RRGGBB"` (transparency is always a separate property) |
| FontFace | `{ "family": "GothamSSm", "weight": "Bold", "style": "Normal" }` |
| Enum | item name string, e.g. `"Center"` |
| ColorSequence | `[{ "t": 0, "color": "#FFFFFF" }, …, { "t": 1, … }]` |
| NumberSequence | `[{ "t": 0, "value": 0 }, …]` |
| Rect | `{ "minX", "minY", "maxX", "maxY" }` |
| Content | `"asset://<assetId>"` (library), `"rbxassetid://<n>"` or `""` |
| math.huge | `1000000000` (JSON has no Infinity; exported as `math.huge`) |

Properties starting with `_` are design-time only and never exported
(e.g. `UIPageLayout._CurrentPage`).

### Modifiers are children
`UICorner`, `UIStroke`, `UIGradient`, `UIPadding`, `UIScale`,
`UIAspectRatioConstraint`, `UISizeConstraint`, `UITextSizeConstraint`,
`UIListLayout`, `UIGridLayout` and `UIPageLayout` are ordinary child nodes, as
in Roblox. Parent rules are enforced: modifiers need a GUI parent, layouts can
also sit under a ScreenGui, and ScreenGui is top-level only.

## Components and overrides
- The main component is a normal node with `componentId`; the definition in
  `components` points back with `rootId`.
- An instance is a node with `instance` and **no stored children**. Its own
  `props` override the main node's root properties.
- `overrides` keys are **child id paths from the main node**: `"n_title"`,
  `"n_header/n_title"`, and through nested instances
  `"n_nestedInstance/n_childOfItsMain"`.
- In the resolved tree, nodes inside an instance get the effective id
  `<instanceId>/<path>`.
- Variants: components with the same `variantOf.setName` form a set;
  `variantOf.values` holds e.g. `{ "State": "Hover" }`.

## Tokens
```jsonc
"tokens": {
  "colors":     [{ "id": "c_primary", "name": "Primary", "value": "#4F7CFF" }],
  "numbers":    [{ "id": "s_md", "name": "Space MD", "value": 16 }],
  "textStyles": [{ "id": "t_title", "name": "Title", "font": { … }, "size": 28, "lineHeight": 1.1 }]
}
```
Bindings (`node.tokens`) map a property to a token id. Colour tokens bind
colour props, number tokens bind number props or a UDim's offset, and
`"$textStyle"` sets FontFace + TextSize (+ LineHeight).

## Animations
```jsonc
{
  "id": "an_…", "name": "Open", "trigger": "onShow",   // manual|onShow|onHide|onHover|onClick|loop
  "triggerNodeId": "n_button",                          // for onHover/onClick
  "repeat": 0,                                          // 0 once, -1 forever, n extra times
  "reverses": false,
  "tracks": [{
    "id": "tr_…", "nodeId": "n_panel", "property": "Position",
    "keyframes": [
      { "time": 0,   "value": { … }, "easingStyle": "Linear", "easingDirection": "Out" },
      { "time": 0.4, "value": { … }, "easingStyle": "Back",   "easingDirection": "Out" }
    ]
  }]
}
```
The easing on a keyframe applies to the segment *arriving* at it. `nodeId` may
be an effective id inside an instance.

## Page references
`page.references: [{ id, assetId, x, y, w, h, opacity, locked? }]` are reference
images placed on the canvas. They are design-time only.

## History file
`<id>.history.json` holds `{ undo: Entry[], redo: Entry[] }` with
`{ id, at, source, label, revision, ops, inverse }`, capped at 200 entries.
Undo can be filtered by `source` (`editor`, `mcp`, `api`).

## Migrations
`src/core/migrate.ts`: when the format changes, bump `FORMAT_VERSION` and add
`MIGRATIONS[n]` (n → n+1). Documents are migrated on load. A newer version
than the app supports is rejected with a clear message. **Never change the
format without a migration.**
