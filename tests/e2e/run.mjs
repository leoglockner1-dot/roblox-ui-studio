// End-to-end test: builds the app, starts it on a temp workspace and drives the
// editor with Playwright (Chromium). Run: npm run test:e2e
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ws = mkdtempSync(path.join(tmpdir(), "ruis-e2e-"));
const port = 5300 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const shots = process.env.E2E_SHOTS;

if (!process.env.E2E_SKIP_BUILD) execSync("npx vite build && node scripts/build-node.mjs", { cwd: root, stdio: "ignore" });
const server = spawn(process.execPath, ["dist/server.mjs"], { cwd: root, env: { ...process.env, RUIS_WORKSPACE: ws, RUIS_PORT: String(port) }, stdio: "ignore" });
const tool = async (name, input) => {
  const r = await (await fetch(`${base}/api/tools/${name}`, { method: "POST", body: JSON.stringify(input) })).json();
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r;
};
const getDoc = async (id) => (await (await fetch(`${base}/api/documents/${id}`)).json()).document;
const byName = (d, name) => Object.values(d.nodes).find((n) => n.name === name);

let browser;
let passed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.log(`  ✗ ${name}\n    ${e.stack ?? e}`);
    process.exitCode = 1;
    throw e;
  }
};

try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const created = await tool("create_document", { name: "E2E", screenName: "Main" });
  const docId = created.document.id;
  await tool("create_element", { documentId: docId, parentId: "Main", spec: { className: "Frame", name: "Box", props: { Position: [0, 200, 0, 200], Size: [0, 300, 0, 200], BackgroundColor3: "#3355FF" } } });

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${base}/#/doc/${docId}`);
  await page.waitForSelector('[data-testid="canvas"] [data-root]');
  await page.waitForTimeout(400);
  console.log("e2e:");

  const boxCenter = async () => {
    const el = await page.$('[data-testid="canvas"] [data-node]');
    const b = await el.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
  };

  await step("click selects the frame and shows its properties", async () => {
    const c = await boxCenter();
    await page.mouse.click(c.x, c.y);
    await page.waitForSelector(".sel-box");
    const header = await page.textContent('[data-testid="properties"] .inspector-header');
    assert.match(header, /Frame/);
  });

  await step("drag moves the frame (Position offset changes) and persists", async () => {
    const c = await boxCenter();
    const zoom = parseFloat((await page.textContent(".zoom-label")).replace("%", "")) / 100;
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 50, c.y + 30, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const d = await getDoc(docId);
    const pos = byName(d, "Box").props.Position;
    assert.ok(Math.abs(pos.xo - (200 + 50 / zoom)) <= 8, `xo=${pos.xo}`);
    assert.ok(Math.abs(pos.yo - (200 + 30 / zoom)) <= 8, `yo=${pos.yo}`);
  });

  await step("undo restores the original position", async () => {
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(600);
    const d = await getDoc(docId);
    assert.deepEqual(byName(d, "Box").props.Position, { xs: 0, xo: 200, ys: 0, yo: 200 });
  });

  await step("resize handle changes Size", async () => {
    const c = await boxCenter();
    await page.mouse.click(c.x, c.y);
    const h = await page.$('.handle[data-handle="se"]');
    const hb = await h.boundingBox();
    await page.mouse.move(hb.x + 4, hb.y + 4);
    await page.mouse.down();
    await page.mouse.move(hb.x + 44, hb.y + 24, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const s = byName(await getDoc(docId), "Box").props.Size;
    assert.ok(s.xo > 300 && s.yo > 200, JSON.stringify(s));
  });

  await step("property panel edit updates the document", async () => {
    const input = page.locator('[data-testid="properties"] .prop-row:has(.prop-label[title^="Rotation"]) input').first();
    await input.fill("15");
    await input.press("Enter");
    await page.waitForTimeout(600);
    assert.equal(byName(await getDoc(docId), "Box").props.Rotation, 15);
  });

  await step("text tool draws a TextLabel inside the screen and opens inline editing", async () => {
    await page.click('[data-testid="tool-text"]');
    const art = await (await page.$('[data-testid="canvas"] [data-root]')).boundingBox();
    await page.mouse.move(art.x + art.width * 0.7, art.y + art.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(art.x + art.width * 0.85, art.y + art.height * 0.28, { steps: 4 });
    await page.mouse.up();
    await page.waitForSelector(".text-editor");
    await page.keyboard.type("Hello Roblox");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);
    const d = await getDoc(docId);
    const label = Object.values(d.nodes).find((n) => n.className === "TextLabel");
    assert.ok(label, "TextLabel created");
    assert.equal(label.props.Text, "Hello Roblox");
    assert.equal(d.nodes[label.parent].className, "ScreenGui");
  });

  await step("edits from Claude (tool API) appear live in the editor", async () => {
    await tool("create_element", { documentId: docId, parentId: "Main", preset: "currency-display" });
    await page.waitForFunction(() => [...document.querySelectorAll(".layer .name")].some((e) => e.textContent === "CurrencyDisplay"), null, { timeout: 5000 });
  });

  await step("library preset insert + duplicate + delete via keyboard", async () => {
    await page.click('button.tab:has-text("Library")');
    await page.click('.lib-item:has-text("Progress Bar")');
    await page.waitForTimeout(400);
    let d = await getDoc(docId);
    assert.ok(byName(d, "ProgressBar"));
    await page.locator('[data-testid="canvas"]').focus();
    await page.keyboard.press("Control+d");
    await page.waitForTimeout(500);
    d = await getDoc(docId);
    assert.equal(Object.values(d.nodes).filter((n) => n.name === "ProgressBar").length, 2);
    await page.keyboard.press("Delete");
    await page.waitForTimeout(500);
    d = await getDoc(docId);
    assert.equal(Object.values(d.nodes).filter((n) => n.name === "ProgressBar").length, 1);
  });

  await step("component: create + insert instance from the Components panel", async () => {
    await page.click('button.tab:has-text("Layers")');
    await page.click('.layer:has-text("Box")');
    await page.keyboard.press("Control+Alt+k");
    await page.waitForTimeout(400);
    await page.click('button.tab:has-text("Components")');
    await page.click(".lib-item");
    await page.waitForTimeout(600);
    const d = await getDoc(docId);
    assert.equal(Object.keys(d.components).length, 1);
    assert.equal(Object.values(d.nodes).filter((n) => n.instance).length, 1);
  });

  if (shots) await page.screenshot({ path: path.join(shots, "e2e-editor.png") });

  await step("preview opens, renders the screen and closes", async () => {
    await page.click('[data-testid="preview-btn"]');
    await page.waitForSelector('[data-testid="preview"] #render-target [data-node]');
    if (shots) await page.screenshot({ path: path.join(shots, "e2e-preview.png") });
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-testid="preview"]', { state: "detached" });
  });

  await step("export dialog shows modules and downloads rbxmx", async () => {
    await page.click('[data-testid="export-btn"]');
    await page.click('button.tab:has-text("Luau modules")');
    await page.waitForSelector('.file-list button:has-text("Screens/Main.luau")');
    const code = await page.textContent(".code");
    assert.match(code, /function Main\.create\(\): ScreenGui/);
    if (shots) await page.screenshot({ path: path.join(shots, "e2e-export.png") });
    await page.keyboard.press("Escape");
  });

  await step("headless render endpoint returns a PNG", async () => {
    const d = await getDoc(docId);
    const res = await fetch(`${base}/api/render?doc=${docId}&root=${d.pages[0].children[0]}&device=iphone-15`);
    assert.equal(res.status, 200, await res.clone().text());
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.readUInt32BE(0), 0x89504e47);
    assert.equal(buf.readUInt32BE(16), 852);
  });

  await step("no console errors", async () => {
    assert.deepEqual(errors.filter((e) => !/favicon/.test(e)), []);
  });
  console.log(`${passed} e2e checks passed`);
} catch {
  console.log(`failed after ${passed} passing checks`);
} finally {
  await browser?.close();
  server.kill();
  rmSync(ws, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
