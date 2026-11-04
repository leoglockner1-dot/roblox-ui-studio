/**
 * Headless rendering of designs to PNG using the editor's own render page
 * (`/#/render?...`), so images match the preview exactly. Uses Playwright if
 * it is installed (optional dependency); otherwise rendering reports a clear
 * error and everything else keeps working.
 */
import { createRequire } from "node:module";
import { findDevice } from "../core/devices";
import { StoreError } from "./store";

export interface RenderRequest {
  documentId: string;
  rootId: string;
  device?: string;
  width?: number;
  height?: number;
  animationId?: string;
  time?: number;
}

export interface Renderer {
  render(r: RenderRequest): Promise<Buffer>;
  close(): Promise<void>;
}

export async function createRenderer(baseUrl: string): Promise<Renderer> {
  let pw: PlaywrightLike;
  try {
    // CommonJS resolution so a globally installed Playwright (NODE_PATH) also works.
    pw = createRequire(import.meta.url)("playwright") as PlaywrightLike;
  } catch {
    throw new StoreError("rendering needs Playwright: run `npm i -D playwright && npx playwright install chromium`", 501);
  }
  const execPath = process.env.RUIS_CHROMIUM;
  const browser = await pw.chromium.launch(execPath ? { executablePath: execPath } : {});
  return {
    async render(r) {
      const dev = findDevice(r.device);
      const params = new URLSearchParams({ doc: r.documentId, root: r.rootId });
      if (dev) params.set("device", dev.id);
      if (r.width) params.set("w", String(r.width));
      if (r.height) params.set("h", String(r.height));
      if (r.animationId) params.set("anim", r.animationId);
      if (r.time !== undefined) params.set("t", String(r.time));
      const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 2600, height: 1600 } });
      try {
        await page.goto(`${baseUrl}/#/render?${params}`);
        await page.waitForFunction(() => (window as unknown as { __RUIS_RENDER__?: string }).__RUIS_RENDER__, null, { timeout: 15000 });
        const status = await page.evaluate(() => (window as unknown as { __RUIS_RENDER__?: string }).__RUIS_RENDER__);
        if (status !== "ready") throw new StoreError(`render failed: ${status}`, 400);
        const el = await page.$("#render-target");
        if (!el) throw new StoreError("render target missing", 500);
        return (await el.screenshot({ type: "png" })) as Buffer;
      } finally {
        await page.close();
      }
    },
    close: () => browser.close(),
  };
}

/** The small part of Playwright's API we use (Playwright is an optional dependency). */
interface PlaywrightLike {
  chromium: {
    launch(o?: { executablePath?: string }): Promise<{
      newPage(o: { deviceScaleFactor: number; viewport: { width: number; height: number } }): Promise<{
        goto(url: string): Promise<unknown>;
        waitForFunction(fn: () => unknown, arg: null, o: { timeout: number }): Promise<unknown>;
        evaluate<T>(fn: () => T): Promise<T>;
        $(sel: string): Promise<{ screenshot(o: { type: "png" }): Promise<Buffer> } | null>;
        close(): Promise<void>;
      }>;
      close(): Promise<void>;
    }>;
  };
}
