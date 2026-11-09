// Visual check: landmarks and canyon from the walker's eye, plus the orbit overview with landmarks.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const url = process.argv[2] ?? "http://localhost:4173/";
const out = process.argv[3] ?? new URL("../smoke-output/walk/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const landscape = process.env.QC_LANDSCAPE === "1";
const device = landscape ? { ...devices["iPhone 15 Pro"], viewport: { width: 852, height: 393 } } : devices["iPhone 15 Pro"];
const ctx = await browser.newContext({ ...device, hasTouch: true });
ctx.setDefaultTimeout(180000);
const quality = process.env.QC_QUALITY ?? "balanced";
await ctx.addInitScript((q) => localStorage.setItem("mars-frontier:settings:v1", JSON.stringify({ quality: q, reduceMotion: true })), quality);
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await page.goto(url, { waitUntil: "load" });
await page.waitForSelector("#btn-enter", { state: "visible" });
await page.click("#btn-enter");
await wait(800);
await wait(600);
const shot = async (name, pose) => {
  await page.evaluate((p) => {
    const a = window.__frontier;
    a.sheet.close();
    if (!a.walker.active) a.setMode("walk");
    Object.assign(a.walker.state, p);
    a.walker.state.speed = 0;
  }, pose);
  await wait(2600);
  await page.screenshot({ path: `${out}${name}.png`, timeout: 180000 });
  console.log("shot", name);
};
if (landscape) {
  await page.evaluate(() => window.__frontier.setMode("walk"));
  await wait(1200);
  await page.screenshot({ path: `${out}v0-landscape.png`, timeout: 180000 });
  console.log("shot v0-landscape");
}
await shot("v1-start-habitat", { x: 24, z: 30, yaw: Math.atan2(-24, -30), pitch: -0.08 });
await shot("v2-spire", { x: 500, z: -380, yaw: Math.atan2(60, -40), pitch: 0.02 });
await shot("v3-arch", { x: -600, z: -380, yaw: Math.atan2(-40, -40), pitch: 0.0 });
await page.evaluate(() => window.__frontier.setMode("orbit"));
await wait(2500);
await page.evaluate(() => {
  const a = window.__frontier;
  a.rig.setMode("aerial", a.rover, { duration: 0.01 });
});
await wait(2000);
await page.screenshot({ path: `${out}v4-aerial-canyon.png`, timeout: 180000 });
console.log("shot v4-aerial-canyon");
const perf = await page.evaluate(() => {
  const a = window.__frontier;
  return { quality: a.quality.key, calls: a.renderer.info.render.calls, triangles: a.renderer.info.render.triangles, dpr: a.governor.dpr, textures: a.renderer.info.memory.textures, geometries: a.renderer.info.memory.geometries };
});
console.log("PERF", JSON.stringify(perf));
console.log(errs.length ? "CONSOLE:\n" + [...new Set(errs)].slice(0, 6).join("\n") : "no console errors");
await browser.close();
