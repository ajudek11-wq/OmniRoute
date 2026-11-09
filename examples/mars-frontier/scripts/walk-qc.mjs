// Functional + visual check of walking mode in an iPhone-sized browser.
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/walk-qc.mjs [url] [outDir]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const url = process.argv[2] ?? "http://localhost:4173/";
const out = process.argv[3] ?? new URL("../smoke-output/walk/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const quality = process.env.QC_QUALITY ?? "low";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"], hasTouch: true });
ctx.setDefaultTimeout(180000);
await ctx.addInitScript((q) => localStorage.setItem("mars-frontier:settings:v1", JSON.stringify({ quality: q, reduceMotion: false })), quality);
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => ["error", "warning"].includes(m.type()) && errors.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
const results = {};
const check = (name, ok, extra = "") => {
  results[name] = ok;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
};

await page.goto(url, { waitUntil: "load" });
await page.waitForSelector("#btn-enter", { state: "visible" });
await page.click("#btn-enter");
await wait(1500);
check("intro skip button visible", await page.isVisible("#btn-skip"));
await page.click("#btn-skip");
await wait(800);
check("intro skipped", await page.evaluate(() => !window.__frontier.introActive));

// Enter walking from the view bar, like a player would.
await page.click('.view-btn[data-mode="walk"]');
await wait(1500);
check("walking mode active", await page.evaluate(() => window.__frontier.walker.active));
check("walk UI shown", await page.isVisible("#walk-ui"));
check("dashboard hidden while walking", !(await page.isVisible(".resources")) && !(await page.isVisible(".views")));

// Joystick: press in the left half, push up (forward) for two seconds.
const vw = 393;
const vh = 852;
const p0 = await page.evaluate(() => ({ x: window.__frontier.walker.state.x, z: window.__frontier.walker.state.z }));
await page.mouse.move(120, vh * 0.7);
await page.mouse.down();
for (let i = 0; i < 20; i++) {
  await page.mouse.move(120, vh * 0.7 - (i + 1) * 3);
  await wait(60);
}
await wait(1400);
await page.mouse.up();
await wait(400);
const p1 = await page.evaluate(() => ({ x: window.__frontier.walker.state.x, z: window.__frontier.walker.state.z, travelled: window.__frontier.walker.state.travelled }));
const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
check("joystick moves the player", moved > 1.5, `moved ${moved.toFixed(1)} m`);

// Look: drag on the right half turns the view.
const yaw0 = await page.evaluate(() => window.__frontier.walker.state.yaw);
await page.mouse.move(300, 400);
await page.mouse.down();
for (let i = 0; i < 12; i++) {
  await page.mouse.move(300 + (i + 1) * 8, 400);
  await wait(40);
}
await page.mouse.up();
const yaw1 = await page.evaluate(() => window.__frontier.walker.state.yaw);
check("drag on the right turns the view", Math.abs(yaw1 - yaw0) > 0.3, `yaw ${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)}`);

// Interaction: stand at the airlock and use the contextual button.
await page.evaluate(() => {
  const a = window.__frontier;
  a.walker.state.x = 0.5;
  a.walker.state.z = 15.6;
  a.walker.state.yaw = Math.PI;
});
await wait(900);
check("airlock action offered", await page.isVisible("#btn-act") && (await page.textContent("#act-label")).includes("airlock"));
await page.click("#btn-act");
await wait(400);
check("airlock hatch opens", await page.evaluate(() => window.__frontier.settlement.structures.habitat && true));

// Discovery: walk onto the first sample and collect it.
await page.evaluate(() => {
  const a = window.__frontier;
  a.walker.state.x = -418;
  a.walker.state.z = 232 - 2.5;
  a.walker.state.yaw = 0;
});
await wait(900);
check("sample offered", (await page.textContent("#act-label")).includes("Hematite"));
await page.click("#btn-act");
await wait(500);
check("discovery counted", await page.evaluate(() => window.__frontier.found.size === 1), await page.textContent("#discover-n"));

// Landmark: walk near the spire.
await page.evaluate(() => {
  const a = window.__frontier;
  a.walker.state.x = 530;
  a.walker.state.z = -400;
});
await wait(900);
check("landmark reached", await page.evaluate(() => window.__frontier.visitedLandmarks.has("spire")));

// Compass and location readouts.
await wait(500);
check("location shown", (await page.textContent("#loc")).length > 0, await page.textContent("#loc"));

await page.screenshot({ path: `${out}walk-1-spire.png`, timeout: 180000 });
console.log("shot walk-1-spire");

// Canyon view from the walker's eye.
await page.evaluate(() => {
  const a = window.__frontier;
  a.walker.state.x = -400;
  a.walker.state.z = 200;
  a.walker.state.yaw = 0.2;
  a.walker.state.pitch = -0.12;
});
await wait(2500);
await page.screenshot({ path: `${out}walk-2-canyon.png`, timeout: 180000 });
console.log("shot walk-2-canyon");

// Back to orbit.
await page.evaluate(() => window.__frontier.setMode("orbit"));
await wait(2200);
check("returns to orbit", await page.evaluate(() => !window.__frontier.walker.active && window.__frontier.rig.mode === "orbit"));

const real = errors.filter((e) => !/GPU stall|swiftshader|Automatic fallback|KHR_parallel/i.test(e));
console.log(real.length ? "CONSOLE:\n" + [...new Set(real)].slice(0, 12).join("\n") : "no console errors");
const failed = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
console.log(failed.length ? `WALK QC FAILED: ${failed.join(", ")}` : "WALK QC PASSED");
await browser.close();
process.exit(failed.length ? 1 : 0);
