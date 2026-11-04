/**
 * Preset library: production-quality building blocks for game UI.
 *
 * Every preset is a NodeSpec, so inserting one creates ordinary, fully
 * editable nodes (it can then be turned into a component). Design rules
 * (see DESIGN_SYSTEM.md): two type families (Gotham for display/numbers,
 * Builder Sans for body), an 4/8 px spacing grid, neutral chrome with
 * saturated content colour, fixed semantic + rarity colours, and strokes
 * only where text may sit over the 3D world.
 */
import type { NodeSpec } from "./spec";

export interface Preset {
  id: string;
  name: string;
  category: "Buttons" | "Currency & Stats" | "Inventory & Items" | "Feedback" | "Panels" | "Navigation" | "Templates";
  description: string;
  spec: NodeSpec;
}

const DISPLAY = (weight: "Bold" | "ExtraBold" | "Heavy" = "Heavy") => ({ family: "GothamSSm", weight, style: "Normal" });
const BODY = (weight: "Regular" | "Medium" | "SemiBold" | "Bold" = "Medium") => ({ family: "BuilderSans", weight, style: "Normal" });

export const RARITY = {
  Common: "#B4BCC8",
  Uncommon: "#5BD16E",
  Rare: "#3FA1FF",
  Epic: "#B45CFF",
  Legendary: "#FFB52E",
  Mythic: "#FF4D6D",
} as const;

const C = {
  surface: "#161A24",
  surface2: "#202636",
  surface3: "#2A3247",
  line: "#3A4560",
  text: "#F4F6FB",
  muted: "#9AA3B8",
  primary: "#4F7CFF",
  primaryDark: "#2F56D9",
  accent: "#FFC23D",
  success: "#3DDC84",
  danger: "#FF5A5F",
  gold: "#FFD54A",
  gem: "#3FE0FF",
};

const label = (name: string, text: string, props: Record<string, unknown> = {}, extra: Partial<NodeSpec> = {}): NodeSpec => ({
  className: "TextLabel",
  name,
  props: { Text: text, BackgroundTransparency: 1, TextColor3: C.text, FontFace: BODY(), TextSize: 16, ...props },
  ...extra,
});

const icon = (name: string, props: Record<string, unknown> = {}, extra: Partial<NodeSpec> = {}): NodeSpec => ({
  className: "ImageLabel",
  name,
  props: { BackgroundTransparency: 1, ScaleType: "Fit", ...props },
  ...extra,
});

function primaryButton(text = "PLAY", w = 200, h = 56, from = "#6B95FF", to = C.primaryDark): NodeSpec {
  return {
    className: "TextButton",
    name: "PrimaryButton",
    props: {
      Text: text, Size: [0, w, 0, h], BackgroundColor3: "#FFFFFF", AutoButtonColor: true,
      FontFace: DISPLAY(), TextSize: 22, TextColor3: "#FFFFFF",
    },
    tokens: {},
    corner: 12,
    gradient: { Color: [{ t: 0, color: from }, { t: 1, color: to }], Rotation: 90 },
    stroke: { Color: "#0B1230", Thickness: 2, Transparency: 0.35, ApplyStrokeMode: "Border" },
  };
}

export const PRESETS: Preset[] = [
  // ------------------------------------------------------------ buttons
  {
    id: "button-primary",
    name: "Primary Button",
    category: "Buttons",
    description: "High-emphasis call to action with gradient fill and soft border.",
    spec: primaryButton(),
  },
  {
    id: "button-secondary",
    name: "Secondary Button",
    category: "Buttons",
    description: "Outlined, lower-emphasis action.",
    spec: {
      className: "TextButton", name: "SecondaryButton",
      props: { Text: "Cancel", Size: [0, 180, 0, 52], BackgroundColor3: C.surface2, BackgroundTransparency: 0, FontFace: DISPLAY("Bold"), TextSize: 18, TextColor3: C.text },
      corner: 12, stroke: { Color: C.line, Thickness: 2, ApplyStrokeMode: "Border" },
    },
  },
  {
    id: "button-buy",
    name: "Buy Button (Robux)",
    category: "Buttons",
    description: "Green purchase button with price label.",
    spec: {
      ...primaryButton("R$ 99", 160, 52, "#55E89A", "#1FA862"),
      name: "BuyButton",
    },
  },
  {
    id: "button-icon",
    name: "Icon Button (Close)",
    category: "Buttons",
    description: "Square icon button, sized for touch (48 px).",
    spec: {
      className: "TextButton", name: "CloseButton",
      props: { Text: "✕", Size: [0, 48, 0, 48], BackgroundColor3: C.danger, FontFace: DISPLAY(), TextSize: 22, TextColor3: "#FFFFFF" },
      corner: 12, stroke: { Color: "#5A0E12", Thickness: 2, Transparency: 0.3, ApplyStrokeMode: "Border" },
    },
  },
  // ------------------------------------------------------------ currency & stats
  {
    id: "currency-display",
    name: "Currency Display",
    category: "Currency & Stats",
    description: "Pill with coin icon, amount and a + (buy more) button.",
    spec: {
      className: "Frame", name: "CurrencyDisplay",
      props: { Size: [0, 180, 0, 44], BackgroundColor3: C.surface, BackgroundTransparency: 0.15 },
      corner: { CornerRadius: { s: 1, o: 0 } }, stroke: { Color: "#000000", Thickness: 2, Transparency: 0.6 },
      padding: [4, 4, 4, 6],
      list: { FillDirection: "Horizontal", VerticalAlignment: "Center", Padding: 8 },
      children: [
        {
          className: "Frame", name: "Coin", props: { Size: [0, 32, 0, 32], BackgroundColor3: C.gold, LayoutOrder: 1 },
          corner: { CornerRadius: { s: 1, o: 0 } }, stroke: { Color: "#B07A00", Thickness: 2 },
          children: [label("Glyph", "$", { Size: [1, 0, 1, 0], FontFace: DISPLAY(), TextSize: 18, TextColor3: "#8A5A00" })],
        },
        label("Amount", "12,450", { Size: [0, 0, 1, 0], AutomaticSize: "X", FontFace: DISPLAY(), TextSize: 20, TextXAlignment: "Left", LayoutOrder: 2 }),
        {
          className: "TextButton", name: "Add", props: { Text: "+", Size: [0, 32, 0, 32], BackgroundColor3: C.success, FontFace: DISPLAY(), TextSize: 22, TextColor3: "#0B3A1F", LayoutOrder: 3 },
          corner: { CornerRadius: { s: 1, o: 0 } },
        },
      ],
    },
  },
  {
    id: "progress-bar",
    name: "Progress Bar",
    category: "Currency & Stats",
    description: "Track + gradient fill (set Fill.Size X scale for progress) + centred label.",
    spec: {
      className: "Frame", name: "ProgressBar",
      props: { Size: [0, 320, 0, 28], BackgroundColor3: "#0E1118", BackgroundTransparency: 0.1, ClipsDescendants: true },
      corner: { CornerRadius: { s: 1, o: 0 } }, stroke: { Color: "#000000", Thickness: 2, Transparency: 0.5 },
      children: [
        {
          className: "Frame", name: "Fill", props: { Size: [0.62, 0, 1, 0], BackgroundColor3: "#FFFFFF" },
          corner: { CornerRadius: { s: 1, o: 0 } }, gradient: { Color: [{ t: 0, color: "#FFD54A" }, { t: 1, color: "#FF9F1C" }] },
        },
        label("Label", "620 / 1000 XP", { Size: [1, 0, 1, 0], FontFace: DISPLAY("Bold"), TextSize: 14, TextStrokeTransparency: 0.5, ZIndex: 2 }),
      ],
    },
  },
  {
    id: "health-bar",
    name: "Health Bar",
    category: "Currency & Stats",
    description: "HUD health bar with heart badge and numeric value.",
    spec: {
      className: "Frame", name: "HealthBar",
      props: { Size: [0, 280, 0, 40], BackgroundTransparency: 1 },
      children: [
        {
          className: "Frame", name: "Track", props: { Size: [1, -24, 0, 22], Position: [0, 24, 0.5, 0], AnchorPoint: [0, 0.5], BackgroundColor3: "#2A0E12", ClipsDescendants: true },
          corner: 8, stroke: { Color: "#000000", Thickness: 2, Transparency: 0.4 },
          children: [
            { className: "Frame", name: "Fill", props: { Size: [0.85, 0, 1, 0], BackgroundColor3: "#FFFFFF" }, corner: 8, gradient: { Color: [{ t: 0, color: "#FF6B6B" }, { t: 1, color: "#E5383B" }], Rotation: 90 } },
            label("Value", "85 / 100", { Size: [1, -16, 1, 0], Position: [0, 28, 0, 0], FontFace: DISPLAY("Bold"), TextSize: 14, TextXAlignment: "Left", TextStrokeTransparency: 0.4, ZIndex: 2 }),
          ],
        },
        {
          className: "Frame", name: "Badge", props: { Size: [0, 40, 0, 40], BackgroundColor3: C.danger, ZIndex: 3 },
          corner: { CornerRadius: { s: 1, o: 0 } }, stroke: { Color: "#FFFFFF", Thickness: 3 },
          children: [label("Heart", "♥", { Size: [1, 0, 1, 0], FontFace: DISPLAY(), TextSize: 22, ZIndex: 3 })],
        },
      ],
    },
  },
  {
    id: "player-card",
    name: "Player Card",
    category: "Currency & Stats",
    description: "Avatar, display name, level badge.",
    spec: {
      className: "Frame", name: "PlayerCard",
      props: { Size: [0, 260, 0, 72], BackgroundColor3: C.surface, BackgroundTransparency: 0.1 },
      corner: 14, stroke: { Color: C.line, Thickness: 1.5, Transparency: 0.3 }, padding: 12,
      children: [
        { className: "ImageLabel", name: "Avatar", props: { Size: [0, 48, 0, 48], Position: [0, 0, 0.5, 0], AnchorPoint: [0, 0.5], BackgroundColor3: C.surface3, BackgroundTransparency: 0 }, corner: { CornerRadius: { s: 1, o: 0 } }, stroke: { Color: C.primary, Thickness: 2 } },
        label("DisplayName", "BuilderMan", { Size: [1, -64, 0, 24], Position: [0, 60, 0, 2], FontFace: DISPLAY("Bold"), TextSize: 18, TextXAlignment: "Left", TextTruncate: "AtEnd" }),
        label("Username", "@builderman", { Size: [1, -64, 0, 18], Position: [0, 60, 0, 26], TextSize: 13, TextColor3: C.muted, TextXAlignment: "Left" }),
        {
          className: "Frame", name: "Level", props: { Size: [0, 0, 0, 22], AutomaticSize: "X", Position: [1, 0, 0, 0], AnchorPoint: [1, 0], BackgroundColor3: C.accent },
          corner: 6, padding: [0, 8],
          children: [label("Text", "LV 42", { Size: [0, 0, 1, 0], AutomaticSize: "X", FontFace: DISPLAY(), TextSize: 12, TextColor3: "#3A2600" })],
        },
      ],
    },
  },
  // ------------------------------------------------------------ inventory
  {
    id: "inventory-slot",
    name: "Inventory Slot",
    category: "Inventory & Items",
    description: "Square slot with rarity border, icon area and stack count.",
    spec: {
      className: "ImageButton", name: "InventorySlot",
      props: { Size: [0, 88, 0, 88], BackgroundColor3: C.surface2, BackgroundTransparency: 0, AutoButtonColor: true },
      corner: 12, stroke: { Color: RARITY.Rare, Thickness: 2.5, ApplyStrokeMode: "Border" },
      gradient: { Color: [{ t: 0, color: "#FFFFFF" }, { t: 1, color: "#9FB4FF" }], Rotation: 90, Transparency: [{ t: 0, value: 0 }, { t: 1, value: 0 }] },
      children: [
        icon("Icon", { Size: [0.7, 0, 0.7, 0], Position: [0.5, 0, 0.5, 0], AnchorPoint: [0.5, 0.5] }),
        label("Count", "x3", { Size: [0, 40, 0, 20], Position: [1, -6, 1, -4], AnchorPoint: [1, 1], FontFace: DISPLAY(), TextSize: 14, TextXAlignment: "Right", TextStrokeTransparency: 0.3 }),
      ],
    },
  },
  {
    id: "item-card",
    name: "Item Card",
    category: "Inventory & Items",
    description: "Item preview with rarity strip, name and rarity label.",
    spec: {
      className: "Frame", name: "ItemCard",
      props: { Size: [0, 148, 0, 188], BackgroundColor3: C.surface2 },
      corner: 14, stroke: { Color: RARITY.Epic, Thickness: 2, Transparency: 0.1, ApplyStrokeMode: "Border" },
      children: [
        {
          className: "Frame", name: "Art", props: { Size: [1, -16, 0, 112], Position: [0, 8, 0, 8], BackgroundColor3: "#2B1F45" },
          corner: 10, gradient: { Color: [{ t: 0, color: "#5B3A9A" }, { t: 1, color: "#20163A" }], Rotation: 90 },
          children: [icon("Icon", { Size: [0.8, 0, 0.8, 0], Position: [0.5, 0, 0.5, 0], AnchorPoint: [0.5, 0.5] })],
        },
        label("ItemName", "Void Blade", { Size: [1, -16, 0, 22], Position: [0, 8, 0, 126], FontFace: DISPLAY("Bold"), TextSize: 16, TextXAlignment: "Left", TextTruncate: "AtEnd" }),
        label("Rarity", "EPIC", { Size: [1, -16, 0, 16], Position: [0, 8, 0, 150], FontFace: DISPLAY(), TextSize: 12, TextColor3: RARITY.Epic, TextXAlignment: "Left" }),
      ],
    },
  },
  {
    id: "shop-card",
    name: "Shop Card",
    category: "Inventory & Items",
    description: "Featured shop offer: badge, art, title and buy button.",
    spec: {
      className: "Frame", name: "ShopCard",
      props: { Size: [0, 200, 0, 268], BackgroundColor3: C.surface2 },
      corner: 16, stroke: { Color: C.accent, Thickness: 2, Transparency: 0.2, ApplyStrokeMode: "Border" },
      children: [
        {
          className: "Frame", name: "Art", props: { Size: [1, -16, 0, 140], Position: [0, 8, 0, 8], BackgroundColor3: "#3A2A10" },
          corner: 12, gradient: { Color: [{ t: 0, color: "#FFB52E" }, { t: 1, color: "#7A3E00" }], Rotation: 90 },
          children: [icon("Icon", { Size: [0.75, 0, 0.75, 0], Position: [0.5, 0, 0.5, 0], AnchorPoint: [0.5, 0.5] })],
        },
        {
          className: "Frame", name: "Badge", props: { Size: [0, 0, 0, 22], AutomaticSize: "X", Position: [0, 16, 0, 16], BackgroundColor3: C.danger, Rotation: -4, ZIndex: 2 },
          corner: 6, padding: [0, 8],
          children: [label("Text", "-50%", { Size: [0, 0, 1, 0], AutomaticSize: "X", FontFace: DISPLAY(), TextSize: 13, ZIndex: 2 })],
        },
        label("Title", "Starter Pack", { Size: [1, -16, 0, 24], Position: [0, 8, 0, 156], FontFace: DISPLAY("Bold"), TextSize: 18 }),
        label("Subtitle", "5,000 coins + pet", { Size: [1, -16, 0, 18], Position: [0, 8, 0, 180], TextSize: 13, TextColor3: C.muted }),
        { ...primaryButton("R$ 199", 0, 44, "#55E89A", "#1FA862"), name: "Buy", props: { ...primaryButton().props, Text: "R$ 199", Size: [1, -16, 0, 44], Position: [0, 8, 1, -8], AnchorPoint: [0, 1], TextSize: 18 } },
      ],
    },
  },
  {
    id: "rarity-tag",
    name: "Rarity Tag",
    category: "Inventory & Items",
    description: "Pill label in a rarity colour (Common → Mythic).",
    spec: {
      className: "Frame", name: "RarityTag",
      props: { Size: [0, 0, 0, 24], AutomaticSize: "X", BackgroundColor3: RARITY.Legendary },
      corner: { CornerRadius: { s: 1, o: 0 } }, padding: [0, 12],
      children: [label("Text", "LEGENDARY", { Size: [0, 0, 1, 0], AutomaticSize: "X", FontFace: DISPLAY(), TextSize: 13, TextColor3: "#3A2600" })],
    },
  },
  // ------------------------------------------------------------ feedback
  {
    id: "notification",
    name: "Notification Toast",
    category: "Feedback",
    description: "Toast with accent bar, icon, title and message.",
    spec: {
      className: "Frame", name: "Notification",
      props: { Size: [0, 340, 0, 76], BackgroundColor3: C.surface, BackgroundTransparency: 0.05, ClipsDescendants: true },
      corner: 12, stroke: { Color: C.line, Thickness: 1.5, Transparency: 0.4 },
      children: [
        { className: "Frame", name: "Accent", props: { Size: [0, 6, 1, 0], BackgroundColor3: C.success } },
        {
          className: "Frame", name: "IconBg", props: { Size: [0, 40, 0, 40], Position: [0, 22, 0.5, 0], AnchorPoint: [0, 0.5], BackgroundColor3: C.success, BackgroundTransparency: 0.8 },
          corner: 10, children: [label("Glyph", "✓", { Size: [1, 0, 1, 0], FontFace: DISPLAY(), TextSize: 20, TextColor3: C.success })],
        },
        label("Title", "Quest complete!", { Size: [1, -90, 0, 22], Position: [0, 74, 0, 14], FontFace: DISPLAY("Bold"), TextSize: 16, TextXAlignment: "Left" }),
        label("Message", "You earned 250 coins.", { Size: [1, -90, 0, 20], Position: [0, 74, 0, 38], TextSize: 14, TextColor3: C.muted, TextXAlignment: "Left", TextTruncate: "AtEnd" }),
      ],
    },
  },
  {
    id: "reward-display",
    name: "Reward Display",
    category: "Feedback",
    description: "Celebratory reward reveal: glow, icon tile and amount.",
    spec: {
      className: "Frame", name: "RewardDisplay",
      props: { Size: [0, 220, 0, 240], BackgroundTransparency: 1 },
      children: [
        {
          className: "Frame", name: "Glow", props: { Size: [0, 220, 0, 220], Position: [0.5, 0, 0, 0], AnchorPoint: [0.5, 0], BackgroundColor3: "#FFFFFF" },
          corner: { CornerRadius: { s: 1, o: 0 } },
          gradient: { Color: [{ t: 0, color: "#FFE28A" }, { t: 1, color: "#FFB52E" }], Transparency: [{ t: 0, value: 0.55 }, { t: 1, value: 1 }] },
        },
        {
          className: "Frame", name: "Tile", props: { Size: [0, 120, 0, 120], Position: [0.5, 0, 0, 50], AnchorPoint: [0.5, 0], BackgroundColor3: C.surface2, Rotation: 0 },
          corner: 20, stroke: { Color: RARITY.Legendary, Thickness: 3, ApplyStrokeMode: "Border" },
          children: [icon("Icon", { Size: [0.75, 0, 0.75, 0], Position: [0.5, 0, 0.5, 0], AnchorPoint: [0.5, 0.5] })],
        },
        label("Amount", "+250", { Size: [1, 0, 0, 40], Position: [0, 0, 1, 0], AnchorPoint: [0, 1], FontFace: DISPLAY(), TextSize: 34, TextColor3: C.gold }, { stroke: { Color: "#5A3A00", Thickness: 3 } }),
      ],
    },
  },
  {
    id: "tooltip",
    name: "Tooltip",
    category: "Feedback",
    description: "Compact dark tooltip with title and description; auto-sizes to text.",
    spec: {
      className: "Frame", name: "Tooltip",
      props: { Size: [0, 220, 0, 0], AutomaticSize: "Y", BackgroundColor3: "#0B0E14", BackgroundTransparency: 0.05 },
      corner: 8, stroke: { Color: C.line, Thickness: 1, Transparency: 0.3 }, padding: [10, 12],
      list: { Padding: 4 },
      children: [
        label("Title", "Fire Sword", { Size: [1, 0, 0, 20], FontFace: DISPLAY("Bold"), TextSize: 15, TextXAlignment: "Left", LayoutOrder: 1 }),
        label("Body", "Deals 40 burn damage over 4 seconds.", { Size: [1, 0, 0, 0], AutomaticSize: "Y", TextSize: 13, TextColor3: C.muted, TextXAlignment: "Left", TextWrapped: true, LayoutOrder: 2 }),
      ],
    },
  },
  // ------------------------------------------------------------ panels
  {
    id: "popup",
    name: "Popup / Modal",
    category: "Panels",
    description: "Dimmed overlay + centred dialog with title, body and two actions.",
    spec: {
      className: "Frame", name: "Popup",
      props: { Size: [1, 0, 1, 0], BackgroundColor3: "#000000", BackgroundTransparency: 0.45, Active: true },
      children: [
        {
          className: "Frame", name: "Dialog", props: { Size: [0, 420, 0, 240], Position: [0.5, 0, 0.5, 0], AnchorPoint: [0.5, 0.5], BackgroundColor3: C.surface },
          corner: 18, stroke: { Color: C.line, Thickness: 2, Transparency: 0.2 }, padding: 24,
          sizeConstraint: { MaxSize: [1e9, 1e9], MinSize: [0, 0] },
          children: [
            label("Title", "Are you sure?", { Size: [1, 0, 0, 32], FontFace: DISPLAY(), TextSize: 26, TextXAlignment: "Left" }),
            label("Body", "Selling this item gives you 120 coins. This can't be undone.", { Size: [1, 0, 0, 48], Position: [0, 0, 0, 44], TextSize: 16, TextColor3: C.muted, TextXAlignment: "Left", TextYAlignment: "Top", TextWrapped: true }),
            {
              className: "Frame", name: "Actions", props: { Size: [1, 0, 0, 52], Position: [0, 0, 1, 0], AnchorPoint: [0, 1], BackgroundTransparency: 1 },
              list: { FillDirection: "Horizontal", HorizontalAlignment: "Right", Padding: 12 },
              children: [
                { className: "TextButton", name: "Cancel", props: { Text: "Cancel", Size: [0, 140, 1, 0], BackgroundColor3: C.surface2, FontFace: DISPLAY("Bold"), TextSize: 18, TextColor3: C.text, LayoutOrder: 1 }, corner: 12, stroke: { Color: C.line, Thickness: 2, ApplyStrokeMode: "Border" } },
                { ...primaryButton("Sell", 140, 52, "#FF7A7F", "#D63A40"), name: "Confirm", props: { ...primaryButton().props, Text: "Sell", Size: [0, 140, 1, 0], LayoutOrder: 2, TextSize: 18 } },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    id: "settings-panel",
    name: "Settings Panel",
    category: "Panels",
    description: "Titled panel with toggle rows (list layout; duplicate rows to extend).",
    spec: {
      className: "Frame", name: "SettingsPanel",
      props: { Size: [0, 420, 0, 0], AutomaticSize: "Y", BackgroundColor3: C.surface },
      corner: 18, stroke: { Color: C.line, Thickness: 2, Transparency: 0.2 }, padding: 20,
      list: { Padding: 12 },
      children: [
        label("Title", "Settings", { Size: [1, 0, 0, 32], FontFace: DISPLAY(), TextSize: 24, TextXAlignment: "Left", LayoutOrder: 0 }),
        ...["Music", "Sound effects", "Show damage numbers"].map((t, i) => ({
          className: "Frame", name: `Row${i + 1}`, props: { Size: [1, 0, 0, 52], BackgroundColor3: C.surface2, LayoutOrder: i + 1 },
          corner: 12, padding: [0, 14],
          children: [
            label("Label", t, { Size: [1, -70, 1, 0], TextSize: 16, TextXAlignment: "Left" }),
            {
              className: "TextButton", name: "Toggle", props: { Text: "", Size: [0, 52, 0, 28], Position: [1, 0, 0.5, 0], AnchorPoint: [1, 0.5], BackgroundColor3: i === 2 ? C.surface3 : C.success, AutoButtonColor: false },
              corner: { CornerRadius: { s: 1, o: 0 } },
              children: [{ className: "Frame", name: "Knob", props: { Size: [0, 22, 0, 22], Position: i === 2 ? [0, 3, 0.5, 0] : [1, -3, 0.5, 0], AnchorPoint: i === 2 ? [0, 0.5] : [1, 0.5], BackgroundColor3: "#FFFFFF" }, corner: { CornerRadius: { s: 1, o: 0 } } }],
            },
          ],
        }) as NodeSpec),
      ],
    },
  },
  // ------------------------------------------------------------ navigation
  {
    id: "tabs",
    name: "Tabs",
    category: "Navigation",
    description: "Segmented tab bar; the selected tab uses the primary colour.",
    spec: {
      className: "Frame", name: "Tabs",
      props: { Size: [0, 0, 0, 48], AutomaticSize: "X", BackgroundColor3: C.surface },
      corner: 12, padding: 4,
      list: { FillDirection: "Horizontal", Padding: 4 },
      children: ["Weapons", "Pets", "Boosts"].map((t, i) => ({
        className: "TextButton", name: `Tab${t}`,
        props: { Text: t, Size: [0, 120, 1, 0], BackgroundColor3: i === 0 ? C.primary : C.surface, BackgroundTransparency: i === 0 ? 0 : 1, FontFace: DISPLAY("Bold"), TextSize: 16, TextColor3: i === 0 ? "#FFFFFF" : C.muted, LayoutOrder: i },
        corner: 9,
      })),
    },
  },
  {
    id: "section-header",
    name: "Section Header",
    category: "Navigation",
    description: "Title with an accent underline.",
    spec: {
      className: "Frame", name: "SectionHeader",
      props: { Size: [0, 360, 0, 44], BackgroundTransparency: 1 },
      children: [
        label("Title", "DAILY REWARDS", { Size: [1, 0, 0, 32], FontFace: DISPLAY(), TextSize: 26, TextXAlignment: "Left" }),
        { className: "Frame", name: "Underline", props: { Size: [0, 56, 0, 4], Position: [0, 0, 1, 0], AnchorPoint: [0, 1], BackgroundColor3: C.accent }, corner: 2 },
      ],
    },
  },
  // ------------------------------------------------------------ templates
  {
    id: "template-inventory",
    name: "Inventory Screen",
    category: "Templates",
    description: "Full inventory: header, tabs, scrolling slot grid, item details. Scales with screen size.",
    spec: {
      className: "Frame", name: "Inventory",
      props: { Size: [0.8, 0, 0.8, 0], Position: [0.5, 0, 0.5, 0], AnchorPoint: [0.5, 0.5], BackgroundColor3: C.surface },
      corner: 20, stroke: { Color: C.line, Thickness: 2, Transparency: 0.2 }, padding: 24,
      sizeConstraint: { MaxSize: [1100, 720], MinSize: [0, 0] },
      children: [
        label("Title", "INVENTORY", { Size: [0.5, 0, 0, 40], FontFace: DISPLAY(), TextSize: 32, TextXAlignment: "Left" }),
        {
          className: "TextButton", name: "Close", props: { Text: "✕", Size: [0, 44, 0, 44], Position: [1, 0, 0, 0], AnchorPoint: [1, 0], BackgroundColor3: C.danger, FontFace: DISPLAY(), TextSize: 20, TextColor3: "#FFFFFF" },
          corner: 12,
        },
        {
          className: "ScrollingFrame", name: "Grid", props: { Size: [0.62, 0, 1, -64], Position: [0, 0, 0, 64] },
          padding: 4,
          grid: { CellSize: [0, 88, 0, 88], CellPadding: [0, 10, 0, 10] },
          children: Array.from({ length: 12 }, (_, i) => ({
            className: "ImageButton", name: `Slot${i + 1}`,
            props: { Size: [0, 88, 0, 88], BackgroundColor3: C.surface2, LayoutOrder: i },
            corner: 12,
            stroke: { Color: Object.values(RARITY)[i % 5], Thickness: 2, Transparency: i % 5 === 0 ? 0.6 : 0, ApplyStrokeMode: "Border" },
          }) as NodeSpec),
        },
        {
          className: "Frame", name: "Details", props: { Size: [0.38, -16, 1, -64], Position: [1, 0, 0, 64], AnchorPoint: [1, 0], BackgroundColor3: C.surface2 },
          corner: 16, padding: 16, list: { Padding: 10, HorizontalAlignment: "Center" },
          children: [
            { className: "Frame", name: "Preview", props: { Size: [1, 0, 0, 160], BackgroundColor3: "#2B1F45", LayoutOrder: 1 }, corner: 12, gradient: { Color: [{ t: 0, color: "#5B3A9A" }, { t: 1, color: "#20163A" }], Rotation: 90 } },
            label("ItemName", "Void Blade", { Size: [1, 0, 0, 28], FontFace: DISPLAY(), TextSize: 22, TextXAlignment: "Left", LayoutOrder: 2 }),
            label("Rarity", "EPIC", { Size: [1, 0, 0, 16], FontFace: DISPLAY(), TextSize: 13, TextColor3: RARITY.Epic, TextXAlignment: "Left", LayoutOrder: 3 }),
            label("Description", "A blade forged in the void. +40 damage, +10% crit chance.", { Size: [1, 0, 0, 0], AutomaticSize: "Y", TextSize: 14, TextColor3: C.muted, TextXAlignment: "Left", TextWrapped: true, LayoutOrder: 4 }),
            { ...primaryButton("EQUIP", 0, 52), name: "Equip", props: { ...primaryButton().props, Text: "EQUIP", Size: [1, 0, 0, 52], LayoutOrder: 5 } },
          ],
        },
      ],
    },
  },
  {
    id: "template-hud",
    name: "Gameplay HUD",
    category: "Templates",
    description: "Corner-anchored HUD: currencies top-right, player card top-left, action buttons bottom-right.",
    spec: {
      className: "Frame", name: "HUD",
      props: { Size: [1, 0, 1, 0], BackgroundTransparency: 1 },
      padding: 16,
      children: [
        {
          className: "Frame", name: "Currencies", props: { Size: [0, 0, 0, 44], AutomaticSize: "X", Position: [1, 0, 0, 0], AnchorPoint: [1, 0], BackgroundTransparency: 1 },
          list: { FillDirection: "Horizontal", Padding: 10, HorizontalAlignment: "Right" },
          children: [
            {
              className: "Frame", name: "Coins", props: { Size: [0, 160, 0, 44], BackgroundColor3: C.surface, BackgroundTransparency: 0.15, LayoutOrder: 1 },
              corner: { CornerRadius: { s: 1, o: 0 } }, padding: [4, 14, 4, 4],
              list: { FillDirection: "Horizontal", Padding: 8, VerticalAlignment: "Center" },
              children: [
                { className: "Frame", name: "Icon", props: { Size: [0, 34, 0, 34], BackgroundColor3: C.gold, LayoutOrder: 1 }, corner: { CornerRadius: { s: 1, o: 0 } }, stroke: { Color: "#B07A00", Thickness: 2 } },
                label("Amount", "12,450", { Size: [0, 0, 1, 0], AutomaticSize: "X", FontFace: DISPLAY(), TextSize: 20, LayoutOrder: 2 }),
              ],
            },
            {
              className: "Frame", name: "Gems", props: { Size: [0, 130, 0, 44], BackgroundColor3: C.surface, BackgroundTransparency: 0.15, LayoutOrder: 2 },
              corner: { CornerRadius: { s: 1, o: 0 } }, padding: [4, 14, 4, 4],
              list: { FillDirection: "Horizontal", Padding: 8, VerticalAlignment: "Center" },
              children: [
                { className: "Frame", name: "Icon", props: { Size: [0, 34, 0, 34], BackgroundColor3: C.gem, Rotation: 45, LayoutOrder: 1 }, corner: 8 },
                label("Amount", "320", { Size: [0, 0, 1, 0], AutomaticSize: "X", FontFace: DISPLAY(), TextSize: 20, LayoutOrder: 2 }),
              ],
            },
          ],
        },
        {
          className: "Frame", name: "Actions", props: { Size: [0, 0, 0, 72], AutomaticSize: "X", Position: [1, 0, 1, 0], AnchorPoint: [1, 1], BackgroundTransparency: 1 },
          list: { FillDirection: "Horizontal", Padding: 12, HorizontalAlignment: "Right", VerticalAlignment: "Bottom" },
          children: ["Shop", "Pets", "Quests"].map((t, i) => ({
            className: "TextButton", name: t,
            props: { Text: t.toUpperCase(), Size: [0, 72, 0, 72], BackgroundColor3: [C.accent, C.primary, C.success][i], FontFace: DISPLAY(), TextSize: 13, TextColor3: "#FFFFFF", TextYAlignment: "Bottom", LayoutOrder: i },
            corner: 16, stroke: { Color: "#000000", Thickness: 2.5, Transparency: 0.5, ApplyStrokeMode: "Border" }, padding: [0, 0, 8, 0],
          }) as NodeSpec),
        },
      ],
    },
  },
];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id || p.name.toLowerCase() === id.toLowerCase());
}
