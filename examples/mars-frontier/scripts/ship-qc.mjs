// Pathfinder shuttle QC: screenshots of the cockpit, cruise and arrivals in the desktop preview.
// Usage: node scripts/ship-qc.mjs <url> <dest> <outDir>
//   SHOTS='[{"name":"cockpit"},{"name":"cruise","phase":"cruise","s":0.6,"yaw":0,"pitch":0}]'
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const [url = "http://localhost:4197/", dest = "moon", out = "/tmp/claude-0/ship-shots/"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const shots = JSON.parse(process.env.SHOTS ?? '[{"name":"cockpit"}]');
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +(process.env.W ?? 1280), height: +(process.env.H ?? 720) } });
page.setDefaultTimeout(300000);
await page.addInitScript((q) => localStorage.setItem("mars-frontier:settings:v1", JSON.stringify({ quality: q, reduceMotion: true })), process.env.QUALITY ?? "balanced");
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${url}?go=hub`);
await page.waitForFunction(() => window.__frontier?.cosmos?.id === "hub" && !window.__frontier.cosmos.busy, null, { timeout: 300000 });
await page.evaluate((d) => window.__frontier.cosmos.go("ship", { to: d, from: "hub" }), dest);
await page.waitForFunction(() => window.__frontier.cosmos.id === "ship" && !window.__frontier.cosmos.busy && window.__frontier.cosmos.world?.debug, null, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 2000));
for (const v of shots) {
  await page.evaluate((v) => {
    const a = window.__frontier;
    const w = a.cosmos.world;
    if (v.phase) w.debug.jump(v.phase, v.s ?? 0, v.auto ?? true);
    if (v.press) w.debug.press(v.press);
    a.xr.yaw = v.yaw ?? 0;
    a.xr.pitch = v.pitch ?? 0;
    if (v.eval) (0, eval)(v.eval);
  }, v);
  await new Promise((r) => setTimeout(r, v.wait ?? 3000));
  const info = await page.evaluate(() => {
    const a = window.__frontier;
    const r = a.renderer.info.render;
    const m = a.cosmos.world?.debug?.mission;
    return { calls: r.calls, tris: r.triangles, phase: m?.phase, s: m?.s?.toFixed(3), id: a.cosmos.id };
  });
  await page.screenshot({ path: `${out}${v.name}.png` });
  console.log(`shot ${v.name} ${JSON.stringify(info)}`);
}
console.log(errors.length ? `ERRORS:\n${[...new Set(errors)].slice(0, 12).join("\n")}` : "no console errors");
await browser.close();
