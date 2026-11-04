/**
 * Preview: renders a screen at a simulated device size with safe areas, the
 * Roblox top bar, interactive scrolling/buttons and live animation triggers.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { propOf, findResolved } from "../core/document";
import { DEVICES, findDevice, type DevicePreset } from "../core/devices";
import { ROBLOX_TOPBAR_INSET } from "../core/layout";
import { sampleAnimation, totalPlayTime } from "../core/animation";
import type { Animation, DesignDocument, Vector2 } from "../core/types";
import { api } from "./api";
import { BUTTON_CSS, RootRenderer } from "./render/Renderer";
import { buildRoot, type Sample } from "./scene";
import { store, useEditor } from "./store";
import { Select, Toggle } from "./ui/fields";
import { Icon } from "./ui/icons";

interface Running {
  id: string;
  start: number;
}

/** Merge samples of running animations at `now`. */
function sampleRunning(doc: DesignDocument, running: Running[], now: number): Sample {
  const out: Sample = new Map();
  for (const r of running) {
    const a = doc.animations[r.id];
    if (!a) continue;
    for (const [id, props] of sampleAnimation(a, (now - r.start) / 1000)) out.set(id, { ...(out.get(id) ?? {}), ...props });
  }
  return out;
}

export function PreviewScreen({ doc, rootId, device, landscape = true, interactive = true, showTopbar = true, showSafe = false, maxW, maxH, autoplay = true, staticSample }: {
  doc: DesignDocument; rootId: string; device: DevicePreset; landscape?: boolean; interactive?: boolean; showTopbar?: boolean; showSafe?: boolean;
  maxW: number; maxH: number; autoplay?: boolean; staticSample?: Sample | null;
}) {
  const w = landscape ? Math.max(device.width, device.height) : Math.min(device.width, device.height);
  const h = landscape ? Math.min(device.width, device.height) : Math.max(device.width, device.height);
  const safe = landscape ? device.safe : { top: device.safe.left, bottom: device.safe.right, left: 0, right: 0 };
  const [scroll, setScroll] = useState<Sample>(new Map());
  const [running, setRunning] = useState<Running[]>([]);
  const [now, setNow] = useState(performance.now());
  const raf = useRef(0);
  const anims = useMemo(() => Object.values(doc.animations), [doc.animations]);

  const play = (filter: (a: Animation) => boolean) => {
    const t = performance.now();
    setRunning((r) => [...r.filter((x) => !filter(doc.animations[x.id])), ...anims.filter(filter).map((a) => ({ id: a.id, start: t }))]);
  };

  useEffect(() => {
    if (autoplay) play((a) => a.trigger === "onShow" || a.trigger === "loop");
    else setRunning([]);
  }, [rootId, autoplay, device.id, landscape]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running.length) return;
    const tick = () => {
      const t = performance.now();
      setNow(t);
      const alive = running.filter((r) => {
        const a = doc.animations[r.id];
        return a && (t - r.start) / 1000 < totalPlayTime(a) + 0.05;
      });
      if (alive.length !== running.length) setRunning(alive);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [running, doc.animations]);

  const sample = staticSample ?? (running.length ? sampleRunning(doc, running, now) : null);
  const scene = useMemo(() => buildRoot(doc, rootId, { size: { w, h }, safe, overrides: scroll, sample }), [doc, rootId, w, h, safe, scroll, sample, store.state.fontsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!scene) return null;
  const isScreen = scene.tree.className === "ScreenGui";
  const scale = Math.min(maxW / w, maxH / h, 2);

  const onScroll = (id: string, dx: number, dy: number) => {
    const n = findResolved(scene.tree, id);
    const box = scene.layout.get(id);
    if (!n || !box?.canvas) return;
    const dir = propOf<string>(n, "ScrollingDirection");
    const cur = (scroll.get(id)?.CanvasPosition as Vector2 | undefined) ?? propOf<Vector2>(n, "CanvasPosition");
    const maxX = Math.max(0, box.canvas.w - box.w);
    const maxY = Math.max(0, box.canvas.h - box.h);
    const next = { x: dir === "Y" ? cur.x : Math.max(0, Math.min(maxX, cur.x + dx)), y: dir === "X" ? cur.y : Math.max(0, Math.min(maxY, cur.y + dy)) };
    setScroll((s) => new Map(s).set(id, { CanvasPosition: next }));
  };
  const trig = (kind: "onClick" | "onHover") => (id: string, entering = true) => {
    if (!entering) return;
    play((a) => a.trigger === kind && (a.triggerNodeId ?? a.tracks[0]?.nodeId) === id);
  };

  const opts = {
    assetUrl: api.assetUrl,
    assetSize: (id: string) => {
      const a = store.state.assets.find((x) => x.id === id);
      return a?.width && a?.height ? { w: a.width, h: a.height } : undefined;
    },
    interactive,
    onScroll,
    onActivate: trig("onClick"),
    onHover: trig("onHover"),
  };

  return (
    <div className={`device-frame ${device.kind}`} style={{ width: w * scale, height: h * scale }}>
      <style>{BUTTON_CSS}</style>
      <div id="render-target" style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "0 0", position: "relative", overflow: "hidden", background: "radial-gradient(ellipse at 30% 20%, #3b4a5e 0%, #232a35 55%, #171b22 100%)" }}>
        {isScreen ? (
          <RootRenderer tree={scene.tree} layout={scene.layout} opts={opts} />
        ) : (
          <div style={{ position: "absolute", left: (w - scene.rect.w) / 2, top: (h - scene.rect.h) / 2 }}>
            <RootRenderer tree={scene.tree} layout={scene.layout} opts={opts} />
          </div>
        )}
        {showTopbar && <TopBar />}
        {showSafe && <div className="safe-area" style={{ left: safe.left, top: safe.top, right: safe.right, bottom: safe.bottom }} />}
      </div>
    </div>
  );
}

/** Approximation of Roblox's top bar (core UI drawn above the game's UI). */
function TopBar() {
  const btn = (x: number, label: string) => (
    <div style={{ position: "absolute", left: x, top: 12, width: 44, height: 44, borderRadius: 22, background: "rgba(18,18,21,0.75)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 16, fontWeight: 700 }}>{label}</div>
  );
  return (
    <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: ROBLOX_TOPBAR_INSET, pointerEvents: "none" }}>
      {btn(12, "≡")}
      {btn(64, "💬")}
    </div>
  );
}

export function PreviewModal() {
  const doc = useEditor((s) => s.doc)!;
  const pageId = useEditor((s) => s.pageId);
  const selection = useEditor((s) => s.selection);
  const page = doc.pages.find((p) => p.id === pageId)!;
  const roots = doc.pages.flatMap((p) => p.children).filter((id) => doc.nodes[id] && !doc.nodes[id].componentId);
  const initialRoot = (() => {
    for (const id of selection) {
      let cur = doc.nodes[id.split("/")[0]];
      while (cur?.parent) cur = doc.nodes[cur.parent];
      if (cur && roots.includes(cur.id)) return cur.id;
    }
    return page.children.find((id) => doc.nodes[id]?.className === "ScreenGui") ?? roots[0];
  })();
  const [rootId, setRootId] = useState(initialRoot);
  const stored = doc.nodes[rootId];
  const [deviceId, setDeviceId] = useState(findDevice(stored?.canvas?.device)?.id ?? DEVICES[0].id);
  const [landscape, setLandscape] = useState(true);
  const [compare, setCompare] = useState(false);
  const [topbar, setTopbar] = useState(true);
  const [safe, setSafe] = useState(true);
  const [key, setKey] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 1000, h: 600 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const device = findDevice(deviceId) ?? DEVICES[0];
  if (!rootId || !stored) {
    return (
      <div className="modal-back" onClick={() => store.set({ previewOpen: false })}>
        <div className="modal"><div className="modal-body">Nothing to preview. Add a screen first.</div></div>
      </div>
    );
  }
  const compareSet = ["desktop-1080p", "laptop-768", "ipad", "iphone-15"].map((id) => findDevice(id)!);
  return (
    <div className="modal-back">
      <div className="modal" style={{ width: "calc(100vw - 48px)", height: "calc(100vh - 48px)" }} data-testid="preview">
        <div className="modal-head">
          <Icon.preview /> Preview
          <div style={{ width: 200 }}><Select value={rootId} options={roots.map((id) => ({ value: id, label: doc.nodes[id].name }))} onChange={setRootId} /></div>
          {!compare && (
            <>
              <div style={{ width: 210 }}><Select value={deviceId} options={DEVICES.map((d) => ({ value: d.id, label: d.name }))} onChange={setDeviceId} /></div>
              <button className="icon-btn" data-tip="Rotate device" onClick={() => setLandscape(!landscape)}><Icon.rotate /></button>
            </>
          )}
          <Toggle value={compare} onChange={setCompare} label="Compare devices" />
          <Toggle value={topbar} onChange={setTopbar} label="Roblox top bar" />
          <Toggle value={safe} onChange={setSafe} label="Safe area" />
          <span className="spacer" />
          <button className="btn small" onClick={() => setKey((k) => k + 1)}><Icon.play size={12} /> Replay animations</button>
          <button className="icon-btn" onClick={() => store.set({ previewOpen: false })}><Icon.close /></button>
        </div>
        <div className="preview-stage" ref={stageRef}>
          {compare ? (
            <div className="compare-grid">
              {compareSet.map((d) => (
                <div key={d.id} className="compare-cell">
                  <PreviewScreen key={`${key}-${d.id}`} doc={doc} rootId={rootId} device={d} showTopbar={topbar} showSafe={safe} maxW={stage.w / 2 - 70} maxH={stage.h / 2 - 70} />
                  <span>{d.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <PreviewScreen key={key} doc={doc} rootId={rootId} device={device} landscape={landscape} showTopbar={topbar} showSafe={safe} maxW={stage.w - 60} maxH={stage.h - 60} />
          )}
        </div>
        <div style={{ padding: "8px 16px", color: "var(--text-3)", fontSize: 11, borderTop: "1px solid var(--line)" }}>
          Interactive: scroll ScrollingFrames, hover/click buttons to fire onHover/onClick animations. Fonts marked ≈ are approximations; see ROBLOX_PREVIEW.md for known differences.
        </div>
      </div>
    </div>
  );
}

/** Headless render page used by render_preview (`#/render?doc=…&root=…`). */
export function RenderPage() {
  const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const [doc, setDoc] = useState<DesignDocument | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const d = await api.getDocument(params.get("doc") ?? "");
        store.set({ assets: await api.listAssets() });
        await document.fonts.ready;
        setDoc(d);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (err) (window as unknown as { __RUIS_RENDER__: string }).__RUIS_RENDER__ = err;
  }, [err]);
  useEffect(() => {
    if (!doc) return;
    // wait for images, then signal readiness
    const t = setTimeout(async () => {
      await document.fonts.ready;
      const imgs = [...document.querySelectorAll("img")];
      await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
      (window as unknown as { __RUIS_RENDER__: string }).__RUIS_RENDER__ = "ready";
    }, 50);
    return () => clearTimeout(t);
  }, [doc]);
  if (err) return <div style={{ color: "red" }}>{err}</div>;
  if (!doc) return null;
  const rootId = params.get("root") ?? "";
  if (!doc.nodes[rootId]) {
    (window as unknown as { __RUIS_RENDER__: string }).__RUIS_RENDER__ = `root ${rootId} not found`;
    return null;
  }
  const stored = doc.nodes[rootId];
  const dev = findDevice(params.get("device") ?? undefined) ?? findDevice(stored.canvas?.device);
  const w = Number(params.get("w")) || dev?.width || stored.canvas?.w || 1920;
  const h = Number(params.get("h")) || dev?.height || stored.canvas?.h || 1080;
  const device: DevicePreset = { id: "render", name: "render", kind: "desktop", width: w, height: h, safe: dev?.safe ?? { top: 0, bottom: 0, left: 0, right: 0 } };
  const anim = params.get("anim") ? doc.animations[params.get("anim")!] : undefined;
  const sample = anim ? sampleAnimation(anim, Number(params.get("t") ?? 0)) : null;
  const isScreen = stored.className === "ScreenGui";
  if (!isScreen) {
    // Loose frames: render at their own size.
    const scene = buildRoot(doc, rootId, { sample });
    if (!scene) return null;
    return (
      <div id="render-target" style={{ width: scene.rect.w, height: scene.rect.h, position: "relative", background: "transparent" }}>
        <RootRenderer tree={scene.tree} layout={scene.layout} opts={{ assetUrl: api.assetUrl }} />
      </div>
    );
  }
  return (
    <div style={{ display: "inline-block" }}>
      <PreviewScreen doc={doc} rootId={rootId} device={device} interactive={false} showTopbar={false} maxW={w} maxH={h} autoplay={false} staticSample={sample} />
    </div>
  );
}
