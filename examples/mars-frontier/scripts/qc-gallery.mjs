// Visual QC: renders key views + lighting presets at iPhone size and collects console errors.
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/qc-gallery.mjs [url] [outDir]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const url = process.argv[2] ?? "http://localhost:4173/";
const out = process.argv[3] ?? new URL("../smoke-output/qc/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const device = process.env.QC_DESKTOP ? { viewport: { width: 1440, height: 900 } } : devices["iPhone 15 Pro"];
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext(device);
await ctx.addInitScript(() => {
  localStorage.setItem("mars-frontier:settings:v1", JSON.stringify({ reduceMotion: true, quality: localStorage.getItem("qcq") || "balanced" }));
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => ["error", "warning"].includes(m.type()) && errors.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url + (process.env.QC_QUERY ?? ""), { waitUntil: "load" });
await page.waitForSelector("#btn-enter", { state: "visible", timeout: 120000 });
await page.click("#btn-enter");
await wait(2500);
const setTime = (frac) =>
  page.evaluate((f) => {
    const a = window.__frontier;
    const now = (a.sim.t / 88775.244 + a.sim.startFrac) % 1;
    a.sim.t += (((f - now) % 1) + 1) % 1 * 88775.244;
    a.paused = true;
  }, frac);
const shot = async (name, settle = 2500) => {
  await wait(settle);
  await page.screenshot({ path: `${out}${name}.png` });
  console.log("shot", name);
};
const mode = (m) => page.evaluate((x) => { window.__frontier.sheet.close(); window.__frontier.setMode(x); }, m);

await setTime(0.42);
await mode("surface");
await shot("01-surface-midday");
await mode("habitat");
await shot("02-habitat");
await mode("roverInspect");
await shot("03-rover-inspect");
await mode("mastcam");
await shot("04-mastcam");
await mode("aerial");
await shot("05-aerial");
for (const [f, n] of [[0.272, "06-sunrise"], [0.727, "07-sunset"], [0.762, "08-bluehour"], [0.9, "09-night"]]) {
  await setTime(f);
  await mode("surface");
  await shot(n, 3200);
}
await setTime(0.45);
await mode("orbit");
await shot("10-orbit");
await page.evaluate(() => window.__frontier.select("structure", "greenhouse"));
await shot("11-greenhouse-sheet");
await page.evaluate(() => { window.__frontier.sheet.close(); window.__frontier.toggleCinematic(true); });
await shot("12-cinematic", 4000);
const info = await page.evaluate(() => ({ calls: window.__frontier.renderer.info.render.calls, tris: window.__frontier.renderer.info.render.triangles, tex: window.__frontier.renderer.info.memory.textures, geo: window.__frontier.renderer.info.memory.geometries, q: window.__frontier.quality.key }));
console.log("renderer", JSON.stringify(info));
const real = errors.filter((e) => !/GPU stall|performance|swiftshader|Automatic fallback|ReadPixels/i.test(e));
console.log(real.length ? "CONSOLE:\n" + [...new Set(real)].slice(0, 20).join("\n") : "no console errors");
await browser.close();
