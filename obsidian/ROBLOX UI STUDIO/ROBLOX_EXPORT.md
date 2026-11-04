# Roblox Export

Everything is generated from one **IR** (`src/core/export/ir.ts`): the resolved tree with Roblox-ready values (assets resolved to `rbxassetid://`, design props removed, defaults dropped except where the Roblox default is uncertain, in which case the value is always written).

## Outputs
| Output | What it is | Use |
|---|---|---|
| `<Pkg>.gui.rbxmx` | The ScreenGui(s) as real instances | Studio: right-click **StarterGui** → **Insert from File…** |
| `<Pkg>.code.rbxmx` | Folder of ModuleScripts (below) | Studio: right-click **ReplicatedStorage** → **Insert from File…** |
| Luau modules | Same files on disk (Rojo layout) | `export_luau` with `outputDir`, or the ZIP |
| Single script | One LocalScript for one screen | Paste into StarterPlayerScripts for quick tests |
| ZIP | Modules + both rbxmx + README | Download |
| `.ruis.json` | The design document | Backup / sharing / import |

## Module structure
```
UI<DocName>/
  Util.luau                 make / find / apply / instance / playTracks (TweenService)
  Theme.luau                Colors, Numbers, TextStyles from tokens
  Components/<Name>.luau    one per component: Name.create(): <Class>
  Screens/<Name>.luau       one per screen/top-level frame: Name.create()
  Animations/<Name>.luau    functions per animation + bind(gui)
```
Hierarchy is written declaratively so the code reads like the layer tree:
```lua
make("Frame", {
    Name = "ShopPanel",
    AnchorPoint = Vector2.new(0.5, 0.5),
    Position = UDim2.fromScale(0.5, 0.5),
    Size = UDim2.fromScale(0.7, 0.75),
    BackgroundColor3 = Color3.fromRGB(22, 26, 36),
    BorderSizePixel = 0,
}, {
    make("UICorner", { Name = "UICorner", CornerRadius = UDim.new(0, 20) }),
    Util.instance(ShopCard, { Name = "Card2", LayoutOrder = 1 }, {
        ["Title"] = { Text = "Shield" },
    }),
})
```
Instances only contain the **differences** from their component.

## Integration workflow
1. Export → download `…code.rbxmx` (and/or `…gui.rbxmx`).
2. Studio: insert the code package into **ReplicatedStorage**.
3. Add a LocalScript in StarterPlayer › StarterPlayerScripts (the Export dialog shows it with your names):
```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")
local UI = ReplicatedStorage:WaitForChild("UIDemoShop")
local gui = require(UI.Screens.MainMenu).create()
gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
require(UI.Animations.MainMenu).bind(gui)
```
4. Connect game logic by finding elements by name, e.g. `gui.MainFrame.Close.Activated:Connect(...)`.
5. Re-export after design changes. Keep your game logic in separate scripts so regenerated modules can be replaced.

**Rojo**: unzip `UI<Doc>/` into your project's `src/shared` (folders become Folders, `.luau` files become ModuleScripts).

## Validation of generated code
- Unit tests check Luau syntax for every export (tokenizer + block/bracket checker in `tests/unit/luauCheck.ts`) and the exact value formatting of every property type.
- rbxmx is parsed back and compared to the hierarchy (referents unique, typed property tags, ModuleScript sources equal to the Luau files).
- **Requires verification in Roblox Studio** (no Studio in CI): rbxmx import, enum token numbers for rarely used enums (ScreenInsets, ResamplerMode), `Font` serialisation, and runtime behaviour of `Util.playTracks`. Record results in [[KNOWN_ISSUES]].

## Direct Studio integration (later)
Investigated: a Studio plugin could poll the local server (`/api/documents/:id/export?format=json`) and build instances directly. Deferred because plugins need manual installation and HTTP permission; the file workflow is reliable and works today.
