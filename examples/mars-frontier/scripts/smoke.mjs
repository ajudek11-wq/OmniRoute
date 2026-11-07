// Headless smoke test: boots the app at iPhone and desktop sizes, enters the settlement,
// exercises the main interactions and records console errors + screenshots.
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/smoke.mjs [url]
import { createRequire } from "node:module";
// Playwright is resolved from the local install or a global one (no project dependency needed).
const { chromium, devices } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:4173/";
const out = new URL("../smoke-output/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

async function run(name, contextOpts) {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("#btn-enter", { state: "visible", timeout: 90000 });
  await page.screenshot({ path: `${out}${name}-0-loading.png` });
  await page.click("#btn-enter");
  await wait(7000);
  await page.screenshot({ path: `${out}${name}-1-orbit.png` });

  const checks = await page.evaluate(() => {
    const a = window.__frontier;
    return {
      calls: a.renderer.info.render.calls,
      triangles: a.renderer.info.render.triangles,
      sol: a.sim.t,
      autonomy: a.summary.autonomy,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  console.log(name, JSON.stringify(checks));
  if (checks.overflowX) {
    failures++;
    console.log("FAIL horizontal overflow");
  }

  // Tap the habitat label → inspector opens
  await page.evaluate(() => window.__frontier.select("structure", "habitat"));
  await wait(1800);
  const sheetOpen = await page.evaluate(() => document.getElementById("sheet").classList.contains("open"));
  if (!sheetOpen) {
    failures++;
    console.log("FAIL sheet did not open");
  }
  await page.screenshot({ path: `${out}${name}-2-habitat.png` });

  // Canvas tap on the centre of the screen should hit something or deselect without errors
  const box = await page.locator("#scene").boundingBox();
  await page.mouse.click(box.width / 2, box.height / 2);
  await wait(400);

  // Systems tab
  await page.click('.dock-btn[data-tab="systems"]');
  await wait(900);
  await page.screenshot({ path: `${out}${name}-3-systems.png` });

  // Rover mode + survey dispatch
  await page.click("#sheet-close");
  await wait(500);
  await page.click('.view-btn[data-mode="rover"]');
  await wait(2200);
  await page.evaluate(() => window.__frontier.dispatchSurvey("gamma"));
  await wait(5000);
  const rover = await page.evaluate(() => ({ odo: window.__frontier.rover.odometer, task: window.__frontier.rover.task }));
  console.log(name, "rover", JSON.stringify(rover));
  if (rover.odo < 1) {
    failures++;
    console.log("FAIL rover did not move");
  }
  await page.screenshot({ path: `${out}${name}-4-rover.png` });

  // Surface + aerial views, then night
  await page.click('.view-btn[data-mode="surface"]');
  await wait(2500);
  await page.screenshot({ path: `${out}${name}-5-surface.png` });
  await page.click('.view-btn[data-mode="aerial"]');
  await wait(2500);
  await page.screenshot({ path: `${out}${name}-6-aerial.png` });
  await page.evaluate(() => {
    const a = window.__frontier;
    a.sim.t += 88775 * 0.55; // jump to evening/night
  });
  await page.click('.view-btn[data-mode="orbit"]');
  await wait(2500);
  await page.screenshot({ path: `${out}${name}-7-night.png` });
  await page.click('.dock-btn[data-tab="scenario"]');
  await wait(800);
  await page.screenshot({ path: `${out}${name}-8-scenario.png` });

  const real = errors.filter((e) => !/GPU stall|WebGL.*performance|swiftshader|Automatic fallback/i.test(e));
  if (real.length) {
    failures += real.length;
    console.log(name, "console:\n  " + real.join("\n  "));
  }
  await browser.close();
}

await run("iphone", { ...devices["iPhone 15 Pro"] });
await run("desktop", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
console.log(failures ? `SMOKE FAILED (${failures})` : "SMOKE PASSED");
process.exit(failures ? 1 : 0);
