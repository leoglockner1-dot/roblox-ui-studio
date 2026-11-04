# Animation System

## Model
An animation is a set of **tracks** (node + property) with **keyframes** (`time`, `value`, `easingStyle`, `easingDirection`). The easing on a keyframe applies to the segment arriving at it. Settings: `trigger` (manual, onShow, onHide, onHover, onClick, loop), `triggerNodeId`, `repeat` (0 once, -1 forever, n extra), `reverses`.

Tweenable properties are flagged in the class registry: Position, Size, AnchorPoint, Rotation, colours, transparencies, TextSize, GroupTransparency/GroupColor3, UICorner.CornerRadius, UIStroke Color/Thickness/Transparency, UIGradient Rotation/Offset, UIScale.Scale.

## Evaluation (`src/core/animation.ts`)
TweenService easing curves (Linear, Sine, Quad, Cubic, Quart, Quint, Exponential, Circular, Back, Elastic, Bounce × In/Out/InOut), interpolation for numbers, UDim, UDim2, Vector2 and Color3 (non-numeric values switch at the keyframe). `sampleAnimation(anim, t)` handles repeat/reverses and is used by the timeline, preview, headless render and `preview_animation`.

## Editor
Timeline (`'` or toolbar): select/create/rename animations, set the trigger/repeat/reverses, add a track for the selected element (dropdown of tweenable props), drag keyframes (snap 0.05 s, Shift = free), scrub the ruler, play/pause/stop, **Key** at the playhead, keyframe editor (time, value, easing). **Auto-key**: while the timeline is open, editing a tracked property in the inspector writes a keyframe at the playhead instead of the base value.

Preview runs onShow/loop animations on open and onHover/onClick on interaction.

## Export
`Animations/<Screen>.luau` contains one function per animation returning a stop function, built on `Util.playTracks` (TweenService tweens scheduled per segment; reverse legs flip the easing direction like `TweenInfo.Reverses`). `Animations.bind(gui)` wires onShow/loop/onHover/onClick. onHide animations are exposed as functions to call before hiding.

## Limitations
- Tracks target one property each; no motion paths or spring physics.
- Tweens are scheduled with `task.delay`. Frame-exact sync between tracks in Roblox can differ by a frame from the editor preview.
- Hover-out (MouseLeave) reverse is not generated automatically (create an onHover animation with `reverses`, or call manually).
