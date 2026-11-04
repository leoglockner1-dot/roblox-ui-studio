/** Animation timeline: tracks of keyframes on node properties, TweenService-compatible. */
import { useRef, useState } from "react";
import { CLASSES, getPropDef } from "../../core/classes";
import { animationDuration, cycleDuration, EASING_DIRECTIONS, EASING_STYLES, sampleTrack } from "../../core/animation";
import { newId, propOf } from "../../core/document";
import type { Animation, AnimationTrack, EasingDirection, EasingStyle, Keyframe, PropValue } from "../../core/types";
import * as A from "../actions";
import { store, useEditor } from "../store";
import { NumberField, PropEditor, Select, TextField, Toggle } from "../ui/fields";
import { Icon } from "../ui/icons";

const PX_PER_SEC = 220;

function saveAnim(anim: Animation, label: string) {
  store.apply([{ type: "setAnimation", id: anim.id, anim }], label);
}

export function Timeline() {
  const doc = useEditor((s) => s.doc)!;
  const anim = useEditor((s) => s.anim);
  const selection = useEditor((s) => s.selection);
  const [selKey, setSelKey] = useState<{ track: string; index: number } | null>(null);
  const [scale, setScale] = useState(1);
  const lanesRef = useRef<HTMLDivElement>(null);
  const anims = Object.values(doc.animations);
  const current = anim.id ? doc.animations[anim.id] : undefined;
  const pps = PX_PER_SEC * scale;

  const createAnim = () => {
    const id = newId("an");
    const target = selection[0];
    const a: Animation = { id, name: `Animation ${anims.length + 1}`, trigger: "onShow", repeat: 0, reverses: false, tracks: [] };
    store.apply([{ type: "setAnimation", id, anim: a }], "Create animation");
    store.set({ anim: { id, time: 0, playing: false } });
    if (target) addTrack(a, target, "Position");
  };

  const addTrack = (a: Animation, nodeId: string, property: string) => {
    const r = A.baseResolvedOf(nodeId);
    if (!r) return;
    const v = propOf(r, property);
    const t = store.state.anim.time;
    const kfs: Keyframe[] = [{ time: 0, value: v, easingStyle: "Quad", easingDirection: "Out" }];
    if (t > 0) kfs.push({ time: t, value: v, easingStyle: "Quad", easingDirection: "Out" });
    else kfs.push({ time: 0.3, value: v, easingStyle: "Quad", easingDirection: "Out" });
    const track: AnimationTrack = { id: newId("tr"), nodeId, property, keyframes: kfs };
    saveAnim({ ...a, tracks: [...a.tracks, track] }, "Add track");
    setSelKey({ track: track.id, index: 1 });
  };

  if (!anims.length || !current) {
    return (
      <div className="timeline">
        <div className="timeline-head">
          <b style={{ marginRight: 8 }}>Animations</b>
          {anims.length > 0 && <Select value="" options={[{ value: "", label: "Choose…" }, ...anims.map((a) => ({ value: a.id, label: a.name }))]} onChange={(id) => id && store.set({ anim: { id, time: 0, playing: false } })} />}
          <button className="btn small primary" onClick={createAnim}><Icon.plus size={12} /> New animation</button>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="icon-btn" onClick={() => store.set({ timelineOpen: false })}><Icon.close /></button>
        </div>
        <div className="empty">Animations tween properties (Position, Size, Rotation, transparency, colours, UIScale…) and export as TweenService code. {selection.length ? "Create one to animate the selected element." : "Select an element, then create an animation."}</div>
      </div>
    );
  }

  const dur = Math.max(1, animationDuration(current) + 0.5);
  const width = Math.max(dur * pps, 600);
  const sel = selKey ? current.tracks.find((t) => t.id === selKey.track) : undefined;
  const selKf = sel ? [...sel.keyframes].sort((a, b) => a.time - b.time)[selKey!.index] : undefined;
  const selNode = selection[0] ? A.resolvedOf(selection[0]) : null;
  const tweenable = selNode ? CLASSES[selNode.className].props.filter((p) => p.tweenable) : [];

  const updateTrack = (trackId: string, fn: (t: AnimationTrack) => AnimationTrack, label: string) =>
    saveAnim({ ...current, tracks: current.tracks.map((t) => (t.id === trackId ? fn(t) : t)) }, label);

  const keyAtPlayhead = () => {
    // Add/replace a keyframe at the playhead on every track of the selected node(s) with their current (base) values.
    const t = Math.round(anim.time * 100) / 100;
    const ids = new Set(selection);
    let touched = 0;
    const tracks = current.tracks.map((tr) => {
      if (!ids.has(tr.nodeId) && sel?.id !== tr.id) return tr;
      const node = A.baseResolvedOf(tr.nodeId);
      if (!node) return tr;
      touched++;
      const value = sampleTrack(tr, t) ?? propOf(node, tr.property);
      const rest = tr.keyframes.filter((k) => Math.abs(k.time - t) > 0.005);
      return { ...tr, keyframes: [...rest, { time: t, value, easingStyle: "Quad" as EasingStyle, easingDirection: "Out" as EasingDirection }].sort((a, b) => a.time - b.time) };
    });
    if (touched) saveAnim({ ...current, tracks }, "Add keyframe");
    else store.toast("Select a track or an animated element first");
  };

  const scrubTo = (clientX: number) => {
    const r = lanesRef.current!.getBoundingClientRect();
    store.setAnimTime(Math.max(0, (clientX - r.left) / pps));
  };

  const startRulerDrag = (e: React.PointerEvent) => {
    scrubTo(e.clientX);
    const move = (ev: PointerEvent) => scrubTo(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startKeyDrag = (e: React.PointerEvent, track: AnimationTrack, index: number) => {
    e.stopPropagation();
    setSelKey({ track: track.id, index });
    const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
    const startX = e.clientX;
    const t0 = sorted[index].time;
    store.beginGesture();
    let last = t0;
    const move = (ev: PointerEvent) => {
      let t = Math.max(0, t0 + (ev.clientX - startX) / pps);
      t = ev.shiftKey ? t : Math.round(t * 20) / 20; // snap to 0.05 s
      last = t;
      const kfs = sorted.map((k, i) => (i === index ? { ...k, time: t } : k));
      store.previewGesture([{ type: "setAnimation", id: current.id, anim: { ...current, tracks: current.tracks.map((x) => (x.id === track.id ? { ...x, keyframes: kfs } : x)) } }]);
      store.setAnimTime(t);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (last !== t0) store.commitGesture("Move keyframe");
      else store.cancelGesture();
      // keep selection on the moved key after re-sorting
      const kfs = (store.state.doc!.animations[current.id]?.tracks.find((x) => x.id === track.id)?.keyframes ?? []).slice().sort((a, b) => a.time - b.time);
      const ni = kfs.findIndex((k) => Math.abs(k.time - last) < 1e-6);
      if (ni >= 0) setSelKey({ track: track.id, index: ni });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ticks: number[] = [];
  const step = scale < 0.6 ? 0.5 : scale > 2 ? 0.05 : 0.1;
  for (let t = 0; t <= width / pps + 1e-6; t += step) ticks.push(Math.round(t * 1000) / 1000);

  return (
    <div className="timeline" data-testid="timeline">
      <div className="timeline-head">
        <Select value={current.id} options={anims.map((a) => ({ value: a.id, label: a.name }))} onChange={(id) => { store.set({ anim: { id, time: 0, playing: false } }); setSelKey(null); }} />
        <button className="icon-btn" data-tip="New animation" onClick={createAnim}><Icon.plus /></button>
        <div style={{ width: 130 }}><TextField value={current.name} onChange={(name) => name.trim() && saveAnim({ ...current, name: name.trim() }, "Rename animation")} /></div>
        <div className="sep" style={{ width: 1, height: 20, background: "var(--line-2)" }} />
        <button className="icon-btn" data-tip={anim.playing ? "Pause" : "Play"} onClick={() => (anim.playing ? store.stopAnimation(false) : store.playAnimation(current.id))}>{anim.playing ? <Icon.pause /> : <Icon.play />}</button>
        <button className="icon-btn" data-tip="Stop (back to 0)" onClick={() => store.stopAnimation(true)}><Icon.stop /></button>
        <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-2)", minWidth: 80 }}>{anim.time.toFixed(2)}s / {cycleDuration(current).toFixed(2)}s</span>
        <button className="btn small" onClick={keyAtPlayhead} data-tip="Keyframe the selected tracks at the playhead"><Icon.diamond size={12} /> Key</button>
        <div className="sep" style={{ width: 1, height: 20, background: "var(--line-2)" }} />
        <span style={{ color: "var(--text-3)" }}>Trigger</span>
        <Select value={current.trigger} options={["manual", "onShow", "onHide", "onHover", "onClick", "loop"]} onChange={(trigger) => saveAnim({ ...current, trigger: trigger as Animation["trigger"], ...(trigger === "loop" && current.repeat === 0 ? { repeat: -1 } : {}), ...((trigger === "onHover" || trigger === "onClick") && selection[0] ? { triggerNodeId: selection[0] } : {}) }, "Animation trigger")} />
        {(current.trigger === "onHover" || current.trigger === "onClick") && (
          <button className="btn small" data-tip="Use the selected element as the trigger" onClick={() => selection[0] && saveAnim({ ...current, triggerNodeId: selection[0] }, "Trigger element")}>
            on: {current.triggerNodeId ? A.resolvedOf(current.triggerNodeId)?.name ?? "?" : "first track"}
          </button>
        )}
        <span style={{ color: "var(--text-3)" }}>Repeat</span>
        <div style={{ width: 54 }}><NumberField value={current.repeat} digits={0} min={-1} onChange={(repeat, f) => f && saveAnim({ ...current, repeat }, "Repeat")} /></div>
        <Toggle value={current.reverses} label="Reverses" onChange={(reverses) => saveAnim({ ...current, reverses }, "Reverses")} />
        <span style={{ flex: 1 }} />
        <button className="icon-btn" data-tip="Zoom out" onClick={() => setScale(Math.max(0.25, scale / 1.5))}><Icon.minus /></button>
        <button className="icon-btn" data-tip="Zoom in" onClick={() => setScale(Math.min(6, scale * 1.5))}><Icon.plus /></button>
        <button className="icon-btn" data-tip="Delete animation" onClick={() => { if (confirm(`Delete animation "${current.name}"?`)) { store.apply([{ type: "setAnimation", id: current.id, anim: null }], "Delete animation"); store.set({ anim: { id: null, time: 0, playing: false } }); } }}><Icon.trash /></button>
        <button className="icon-btn" onClick={() => store.set({ timelineOpen: false })}><Icon.close /></button>
      </div>
      <div className="timeline-body">
        <div className="track-names">
          <div className="track-name ruler-spacer">
            {selNode && tweenable.length > 0 ? (
              <Select value="" options={[{ value: "", label: `+ Track for ${selNode.name}` }, ...tweenable.map((p) => ({ value: p.name, label: p.name }))]} onChange={(p) => p && addTrack(current, selNode.id, p)} />
            ) : (
              <span style={{ color: "var(--text-3)", fontSize: 11 }}>Select an element to add tracks</span>
            )}
          </div>
          {current.tracks.map((t) => {
            const n = A.resolvedOf(t.nodeId);
            return (
              <div key={t.id} className="track-name" style={sel?.id === t.id ? { background: "var(--accent-bg)" } : undefined} onClick={() => { if (n) store.select([t.nodeId]); setSelKey({ track: t.id, index: 0 }); }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{n ? n.name : <i style={{ color: "var(--error)" }}>missing</i>} <span className="prop">· {t.property}</span></span>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); saveAnim({ ...current, tracks: current.tracks.filter((x) => x.id !== t.id) }, "Remove track"); setSelKey(null); }}><Icon.minus size={12} /></button>
              </div>
            );
          })}
        </div>
        <div style={{ overflowX: "auto", position: "relative" }}>
          <div className="track-lanes" ref={lanesRef} style={{ width }}>
            <div className="ruler" onPointerDown={startRulerDrag}>
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: t * pps, borderLeftColor: Math.abs(t - Math.round(t)) < 1e-6 ? "var(--text-3)" : undefined }}>
                  {Math.abs(t * 10 - Math.round(t * 10)) < 1e-6 && (scale >= 0.6 || Math.abs(t - Math.round(t * 2) / 2) < 1e-6) ? `${t}s` : ""}
                </div>
              ))}
            </div>
            {current.tracks.map((t) => {
              const ks = [...t.keyframes].sort((a, b) => a.time - b.time);
              return (
                <div key={t.id} className="lane" onPointerDown={(e) => { if (e.target === e.currentTarget) startRulerDrag(e); }}>
                  {ks.slice(1).map((k, i) => (
                    <div key={i} className="segment" style={{ left: ks[i].time * pps, width: Math.max(0, (k.time - ks[i].time) * pps) }} title={`${k.easingStyle} ${k.easingDirection}`} />
                  ))}
                  {ks.map((k, i) => (
                    <div key={i} className={`keyframe${selKey?.track === t.id && selKey.index === i ? " selected" : ""}`} style={{ left: k.time * pps }} title={`${k.time.toFixed(2)}s · ${k.easingStyle}/${k.easingDirection}`} onPointerDown={(e) => startKeyDrag(e, t, i)} />
                  ))}
                </div>
              );
            })}
            <div className="playhead" style={{ left: anim.time * pps }} />
          </div>
        </div>
      </div>
      {sel && selKf && <KeyframeEditor anim={current} track={sel} index={selKey!.index} kf={selKf} onChange={(kfs, label) => updateTrack(sel.id, (t) => ({ ...t, keyframes: kfs }), label)} onDelete={() => {
        const kfs = [...sel.keyframes].sort((a, b) => a.time - b.time).filter((_, i) => i !== selKey!.index);
        updateTrack(sel.id, (t) => ({ ...t, keyframes: kfs }), "Delete keyframe");
        setSelKey(null);
      }} />}
    </div>
  );
}

function KeyframeEditor({ track, index, kf, onChange, onDelete }: { anim: Animation; track: AnimationTrack; index: number; kf: Keyframe; onChange: (kfs: Keyframe[], label: string) => void; onDelete: () => void }) {
  const node = A.baseResolvedOf(track.nodeId);
  const def = node ? getPropDef(node.className, track.property) : undefined;
  const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
  const set = (patch: Partial<Keyframe>, label: string) => onChange(sorted.map((k, i) => (i === index ? { ...k, ...patch } : k)).sort((a, b) => a.time - b.time), label);
  return (
    <div style={{ position: "absolute", right: 12, bottom: 12, width: 300, background: "#23272f", border: "1px solid var(--line-2)", borderRadius: 8, padding: 10, boxShadow: "0 10px 30px rgba(0,0,0,.5)", zIndex: 5 }}>
      <div className="section-title"><span>Keyframe · {track.property}</span><button className="icon-btn" data-tip="Delete keyframe" onClick={onDelete} disabled={sorted.length <= 1}><Icon.trash /></button></div>
      <div className="prop-row"><span className="prop-label">Time (s)</span><NumberField value={kf.time} min={0} step={0.05} digits={3} onChange={(time, f) => f && set({ time }, "Keyframe time")} /></div>
      {def && <div className="prop-row"><span className="prop-label">Value</span><PropEditor def={def} value={kf.value} onChange={(value: PropValue, f) => f && set({ value }, "Keyframe value")} /></div>}
      {index > 0 ? (
        <div className="prop-row">
          <span className="prop-label">Easing</span>
          <div className="fields">
            <Select value={kf.easingStyle} options={EASING_STYLES} onChange={(v) => set({ easingStyle: v as EasingStyle }, "Easing")} />
            <Select value={kf.easingDirection} options={EASING_DIRECTIONS} onChange={(v) => set({ easingDirection: v as EasingDirection }, "Easing")} />
          </div>
        </div>
      ) : (
        <div style={{ color: "var(--text-3)", fontSize: 11 }}>First keyframe: the start value. Easing applies to the segment arriving at each later keyframe.</div>
      )}
      {node && def && <button className="btn small" style={{ marginTop: 6 }} onClick={() => set({ value: propOf(node, track.property) }, "Keyframe from element")}>Use element's base value</button>}
    </div>
  );
}
