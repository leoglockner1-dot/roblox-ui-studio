# Asset Management

## Library
Workspace-level (shared by all documents): `workspace/assets/index.json` + `files/<id>.<ext>`. Formats: PNG, JPEG, GIF, WebP, BMP, SVG (dimensions read from file headers). Max 20 MB per file.

Record: `id, name, folder ("Icons/Currency"), mime, fileName, width, height, bytes, robloxAssetId?, reference?, tags[], createdAt`.

Designs reference library images as `Image = "asset://<id>"`, so references stay stable when files are renamed or moved between folders.

## Local vs Roblox assets (important)
A local file **cannot** be used by Roblox directly. The workflow:
1. Import the image (Assets tab, drag & drop, or `import_asset`). It previews immediately and is marked **Local**.
2. Upload the same file to Roblox (Creator Hub → Creations → Development Items → Images/Decals, or Studio's Asset Manager / bulk import).
3. Copy its **asset id** into the asset's *Roblox ID* field (`update_asset`). It is marked **Roblox ✓**.
4. Export writes `rbxassetid://<id>`. Until then the validator warns and the export leaves `Image` empty.

Note: Roblox decal ids and image ids differ. Use the **image asset id** (the one that works in `ImageLabel.Image`).

Direct `rbxassetid://` values can be typed into any Image field. They export as is, but the preview shows a labelled placeholder because Roblox images can't be fetched locally.

## Reference images
Mark an asset as **Reference** (import in the References filter, or `reference: true`). References can be dragged onto the canvas as page-level overlays (move, resize from the corner, opacity, lock), are visible to Claude via `view_asset`, and are **never exported** (the validator warns if a reference is used in an Image).

## Organisation
Folders (any depth, `a/b/c`), search over name/folder/tags, filters (All / UI images / References), rename, delete.
