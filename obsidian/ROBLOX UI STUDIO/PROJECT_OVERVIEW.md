# Project Overview

## Vision
A permanent, professional tool for designing Roblox game UI: Figma's usability with Roblox semantics built in. It works fully without AI, and normal Claude chats can operate it to build complete menus, shops, inventories and HUDs that you then inspect, adjust, preview and export.

## What works today (v0.1)
- **Editor**: infinite canvas with pan/zoom, ScreenGui artboards at device sizes, select (Figma-style depth), multi-select, marquee, drag-move with smart guides and spacing measurements, resize handles (Shift = aspect, Alt = from centre), drawing tools (Frame, Text, Button, Image, ScrollingFrame), inline text editing, layout-aware reordering inside list/grid layouts, copy/paste (also as JSON NodeSpecs), duplicate, group/ungroup, z-order, lock, visibility, context menus, keyboard shortcuts, undo/redo, autosave.
- **Panels**: pages, layers tree (drag-and-drop reparent, rename, eye/lock), Library (20 presets incl. two full templates), Components (variants grouped), Assets (import, folders, search, Roblox ids, reference images), Styles (colour/number/text-style tokens), Properties (every Roblox property by group, Mixed values, token binding, override indicators with reset, Scale⇄Offset conversion, modifier cards).
- **Roblox model**: 20 classes (all GuiObjects + modifiers + layouts) with Roblox property names, enums and parenting rules; layout engine implementing UDim2, AnchorPoint, UIPadding, UIScale, UIAspectRatioConstraint, UISizeConstraint, UITextSizeConstraint, UIListLayout (incl. Wraps), UIGridLayout, UIPageLayout, ScrollingFrame canvas, AutomaticSize, TextScaled, top-bar inset and safe areas.
- **Components**: main/instance model, overrides by child path (nested instances supported), detach, reset, variants and swapping.
- **Animation**: timeline with tracks/keyframes, drag keys, scrubbing, playback, triggers (onShow/onHide/onHover/onClick/loop/manual), repeat/reverses, auto-key from the inspector, TweenService export.
- **Preview**: device presets, rotation, compare 4 devices, Roblox top-bar mock, safe areas, interactive scrolling/buttons/animation triggers.
- **Export**: Luau modules (Util/Theme/Components/Screens/Animations, Rojo-compatible), single LocalScript, `.gui.rbxmx` (instances), `.code.rbxmx` (ModuleScripts), ZIP, design JSON.
- **Validation**: structure, export readiness (assets, animations), design quality (contrast, tap targets, text size, responsiveness, unconstrained TextScaled).
- **Claude**: MCP server with 49 tools, same tools over HTTP, live editor updates, PNG rendering, undo scoped to Claude's changes, design guide.

## Not yet
See [[DEVELOPMENT_ROADMAP]] and [[KNOWN_ISSUES]].
