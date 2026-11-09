// Screenshot a destination in the desktop preview (same camera the VR player gets, one eye).
// Usage: node scripts/world-shot.mjs <url> <worldId> [outDir]
//   VIEWS='[{"name":"spawn"},{"name":"crater","x":120,"z":-40,"yaw":1.2,"pitch":-0.1}]'  (yaw 0 looks toward −Z)
//   QUALITY=low|balanced|high (default balanced)  W/H viewport (default 1280×720)
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const [url = "http://localhost:4183/", id = "hub", outArg] = process.argv.slice(2);
const out = outArg ?? new URL(`../smoke-output/worlds/${id}/`, import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const views = JSON.parse(process.env.VIEWS ?? '[{"name":"spawn"}]');
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +(process.env.W ?? 1280), height: +(process.env.H ?? 720) } });
page.setDefaultTimeout(300000);
await page.addInitScript((q) => localStorage.setItem("mars-frontier:settings:v1", JSON.stringify({ quality: q, reduceMotion: true })), process.env.QUALITY ?? "balanced");
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${url}?go=${id}`);
await page.waitForFunction((w) => window.__frontier?.cosmos?.id === w && !window.__frontier.cosmos.busy && window.__frontier.cosmos.active, id, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 2500));
for (const v of views) {
  await page.evaluate((v) => {
    const a = window.__frontier;
    const x = a.xr;
    if (v.x !== undefined) x.place(v.x, v.z, v.yaw ?? 0, v.y ?? null);
    if (v.yaw !== undefined) x.yaw = v.yaw;
    x.pitch = v.pitch ?? 0;
    if (v.eval) (0, eval)(v.eval);
  }, v);
  await new Promise((r) => setTimeout(r, v.wait ?? 2500));
  const info = await page.evaluate(() => {
    const r = window.__frontier.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  });
  await page.screenshot({ path: `${out}${v.name}.png` });
  console.log(`shot ${v.name} calls=${info.calls} tris=${info.triangles}`);
}
console.log(errors.length ? `ERRORS:\n${errors.slice(0, 10).join("\n")}` : "no console errors");
await browser.close();
