/** Small inline SVG icon set (16px, currentColor). */
import type { ReactElement } from "react";

const P = (d: string | ReactElement, vb = "0 0 16 16") => (props: { size?: number }) => (
  <svg width={props.size ?? 16} height={props.size ?? 16} viewBox={vb} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {typeof d === "string" ? <path d={d} /> : d}
  </svg>
);

export const Icon = {
  select: P("M3 2l9 5-4 1-1.5 4L3 2z"),
  hand: P("M5 8V3.5a1 1 0 012 0V7m0-1V2.5a1 1 0 012 0V7m0-.5V3.5a1 1 0 012 0V9c0 3-2 5-4.5 5S3.5 12.5 3 11l-1-2.5a1 1 0 011.7-1L5 9"),
  frame: P("M4 1v14M12 1v14M1 4h14M1 12h14"),
  text: P("M3 3h10M8 3v10M6 13h4"),
  button: P(<><rect x="1.5" y="4.5" width="13" height="7" rx="3" /><path d="M5.5 8h5" /></>),
  image: P(<><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" /><circle cx="5.5" cy="6" r="1.2" /><path d="M14 11l-4-4-6 6" /></>),
  scroll: P(<><rect x="1.5" y="1.5" width="13" height="13" rx="1.5" /><path d="M12 4v4" strokeWidth={2} /></>),
  screen: P(<><rect x="1.5" y="2.5" width="13" height="9" rx="1" /><path d="M5.5 14h5M8 11.5V14" /></>),
  component: P("M8 1.5l3 3-3 3-3-3 3-3zM8 8.5l3 3-3 3-3-3 3-3zM4.5 5l3 3-3 3-3-3 3-3zM11.5 5l3 3-3 3-3-3 3-3z"),
  instance: P("M8 1.5l6.5 6.5L8 14.5 1.5 8 8 1.5z"),
  modifier: P(<><circle cx="8" cy="8" r="2" /><path d="M8 2v2M8 12v2M2 8h2M12 8h2" /></>),
  layout: P("M2 3h12M2 8h12M2 13h12"),
  grid: P(<><rect x="2" y="2" width="5" height="5" /><rect x="9" y="2" width="5" height="5" /><rect x="2" y="9" width="5" height="5" /><rect x="9" y="9" width="5" height="5" /></>),
  eye: P(<><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" /><circle cx="8" cy="8" r="2" /></>),
  eyeOff: P("M2 2l12 12M6.5 3.3A7 7 0 018 3c4.5 0 7 5 7 5a12 12 0 01-2 2.6M4 4.5C2.2 5.8 1 8 1 8s2.5 5 7 5a6.6 6.6 0 003-.7"),
  lock: P(<><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 016 0v2" /></>),
  unlock: P(<><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 015.8-1" /></>),
  chevronRight: P("M6 4l4 4-4 4"),
  chevronDown: P("M4 6l4 4 4-4"),
  plus: P("M8 3v10M3 8h10"),
  minus: P("M3 8h10"),
  trash: P("M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5"),
  undo: P("M4 6h6a3.5 3.5 0 010 7H7M4 6l3-3M4 6l3 3"),
  redo: P("M12 6H6a3.5 3.5 0 000 7h3M12 6L9 3M12 6L9 9"),
  play: P("M4 2.5l9 5.5-9 5.5v-11z"),
  pause: P("M5 3v10M11 3v10"),
  stop: P(<rect x="3.5" y="3.5" width="9" height="9" rx="1" />),
  export: P("M8 10V2M5 5l3-3 3 3M2.5 10v3.5h11V10"),
  preview: P(<><path d="M2 3.5h12v9H2z" /><path d="M6.5 6v4l3.5-2-3.5-2z" /></>),
  warn: P("M8 2l6.5 11.5h-13L8 2zM8 6.5v3M8 11.5v.2"),
  timeline: P("M2 4h6M2 8h10M2 12h4M10 2v4M14 6v4M8 10v4"),
  home: P("M2 7.5L8 2l6 5.5V14H2V7.5zM6 14v-4h4v4"),
  link: P("M7 9a3 3 0 004.2 0l2-2A3 3 0 009 2.8L8 3.8M9 7a3 3 0 00-4.2 0l-2 2A3 3 0 007 13.2l1-1"),
  copy: P(<><rect x="5" y="5" width="9" height="9" rx="1.5" /><path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2" /></>),
  key: P("M10 2l4 4-1.5 1.5-4-4L10 2zM8.5 3.5l-6 6V14H7l6-6"),
  upload: P("M8 11V2M5 5l3-3 3 3M2.5 11v2.5h11V11"),
  folder: P("M1.5 3.5h5l1.5 2h6.5v8h-13v-10z"),
  diamond: P("M8 2l6 6-6 6-6-6 6-6z"),
  device: P(<><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" /><path d="M7 12.5h2" /></>),
  rotate: P("M13 8a5 5 0 11-1.5-3.5M13 2.5v3h-3"),
  close: P("M4 4l8 8M12 4l-8 8"),
  check: P("M3 8.5l3 3 7-7"),
  dots: P(<><circle cx="3.5" cy="8" r=".8" fill="currentColor" /><circle cx="8" cy="8" r=".8" fill="currentColor" /><circle cx="12.5" cy="8" r=".8" fill="currentColor" /></>),
  token: P(<><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" fill="currentColor" /></>),
  wand: P("M2 14l8-8M10 2v2M12.5 3.5L11 5M14 6h-2M11 8l1.5 1.5"),
  magnet: P("M3 2v6a5 5 0 0010 0V2h-3v6a2 2 0 01-4 0V2H3zM3 5h3M10 5h3"),
};

export function classIcon(className: string, opts: { instance?: boolean; master?: boolean } = {}) {
  if (opts.master) return Icon.component;
  if (opts.instance) return Icon.instance;
  switch (className) {
    case "ScreenGui": return Icon.screen;
    case "Frame": case "CanvasGroup": return Icon.frame;
    case "TextLabel": case "TextBox": return Icon.text;
    case "TextButton": return Icon.button;
    case "ImageLabel": case "ImageButton": return Icon.image;
    case "ScrollingFrame": return Icon.scroll;
    case "ViewportFrame": return Icon.screen;
    case "UIListLayout": case "UIPageLayout": return Icon.layout;
    case "UIGridLayout": return Icon.grid;
    default: return Icon.modifier;
  }
}
