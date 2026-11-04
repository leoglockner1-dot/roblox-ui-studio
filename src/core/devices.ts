/**
 * Device presets for previews and new screens.
 *
 * Sizes are in Roblox GUI pixels (on phones/tablets Roblox uses logical
 * points, not physical pixels). Safe insets approximate notches/rounded
 * corners in landscape. Values are approximations; see ROBLOX_PREVIEW.md.
 */
import type { SafeInsets } from "./layout";

export interface DevicePreset {
  id: string;
  name: string;
  kind: "desktop" | "laptop" | "tablet" | "phone" | "console";
  width: number;
  height: number;
  safe: SafeInsets;
}

const none = { top: 0, bottom: 0, left: 0, right: 0 };

export const DEVICES: DevicePreset[] = [
  { id: "desktop-1080p", name: "Desktop 1920×1080", kind: "desktop", width: 1920, height: 1080, safe: none },
  { id: "desktop-1440p", name: "Desktop 2560×1440", kind: "desktop", width: 2560, height: 1440, safe: none },
  { id: "laptop-768", name: "Laptop 1366×768", kind: "laptop", width: 1366, height: 768, safe: none },
  { id: "laptop-mac", name: "MacBook 1440×900", kind: "laptop", width: 1440, height: 900, safe: none },
  { id: "desktop-720p", name: "Small 1280×720", kind: "desktop", width: 1280, height: 720, safe: none },
  { id: "ipad", name: "iPad 1024×768", kind: "tablet", width: 1024, height: 768, safe: { top: 0, bottom: 20, left: 0, right: 0 } },
  { id: "ipad-pro", name: "iPad Pro 1366×1024", kind: "tablet", width: 1366, height: 1024, safe: { top: 0, bottom: 20, left: 0, right: 0 } },
  { id: "iphone-15", name: "iPhone 15 852×393", kind: "phone", width: 852, height: 393, safe: { top: 0, bottom: 21, left: 59, right: 59 } },
  { id: "iphone-se", name: "iPhone SE 667×375", kind: "phone", width: 667, height: 375, safe: none },
  { id: "android", name: "Android 800×360", kind: "phone", width: 800, height: 360, safe: { top: 0, bottom: 0, left: 32, right: 0 } },
  { id: "android-small", name: "Small Android 640×360", kind: "phone", width: 640, height: 360, safe: none },
  { id: "console", name: "Console / TV 1920×1080", kind: "console", width: 1920, height: 1080, safe: { top: 54, bottom: 54, left: 96, right: 96 } },
];

export function findDevice(id: string | undefined): DevicePreset | undefined {
  if (!id) return undefined;
  return DEVICES.find((d) => d.id === id || d.name.toLowerCase() === id.toLowerCase());
}
