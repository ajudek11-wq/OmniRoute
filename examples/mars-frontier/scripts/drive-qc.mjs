// Functional + visual check of manual rover driving in an iPhone-sized browser.
// Usage: npx vite build --outDir <dir> && npx vite preview --outDir <dir> --port 4183 &
//        node scripts/drive-qc.mjs [url] [outDir]
// Set QC_SHOTS=0 to skip the (slow, software-rendered) screenshots.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const url = process.argv[2] ?? "http://localhost:4183/";
const out = process.argv[3] ?? new URL("../smoke-output/drive/", import.meta.url).pathname;
const shots = process.env.QC_SHOTS !== "0";
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"], hasTouch: true });
ctx.setDefaultTimeout(180000);
await ctx.addInitScript(() => localStorage.setItem("mars-frontier:settings:v1", JSON.stringify({ quality: "low", reduceMotion: false })));
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => ["error", "warning"].includes(m.type()) && errors.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
const results = {};
const check = (name, ok, extra = "") => {
  results[name] = ok;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
};
const rover = () => page.evaluate(() => {
  const a = window.__frontier;
  return { x: a.rover.pos.x, z: a.rover.pos.z, h: a.rover.heading, v: a.rover.speed, manual: a.rover.manual, task: a.rover.task };
});
// Push the floating joystick from (x0,y0) by (dx,dy) px and hold.
async function stick(x0, y0, dx, dy, holdMs) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x0 + (dx * i) / 12, y0 + (dy * i) / 12);
    await wait(30);
  }
  await wait(holdMs);
  await page.mouse.up();
}

await page.goto(url, { waitUntil: "load" });
await page.waitForSelector("#btn-enter", { state: "visible" });
await page.click("#btn-enter");
await wait(1500);
await page.click("#btn-skip");
await wait(800);
check("intro skipped", await page.evaluate(() => !window.__frontier.introActive));

// Walk, then stand beside the rover.
await page.click('.view-btn[data-mode="walk"]');
await wait(1500);
check("walking mode active", await page.evaluate(() => window.__frontier.walker.active));
await page.evaluate(() => {
  const a = window.__frontier;
  const r = a.rover;
  a.walker.state.x = r.pos.x - Math.cos(r.heading) * 3.6;
  a.walker.state.z = r.pos.z + Math.sin(r.heading) * 3.6;
  a.walker.state.yaw = Math.atan2(r.pos.x - a.walker.state.x, r.pos.z - a.walker.state.z);
});
await page.waitForFunction(() => document.getElementById("act-label").textContent.includes("Drive rover"), null, { timeout: 15000 }).catch(() => {});
const label = await page.textContent("#act-label");
check("drive rover offered beside the rover", (await page.isVisible("#btn-act")) && label.includes("Drive rover"), `"${label}"`);
await page.click("#btn-act");
await wait(900);
const s0 = await page.evaluate(() => ({ driving: window.__frontier.driving, manual: window.__frontier.rover.manual, walker: window.__frontier.walker.active, orbit: window.__frontier.rig.controls.enabled }));
check("drive mode active", s0.driving && s0.manual && !s0.walker, JSON.stringify(s0));
check("orbit controls disabled while driving", !s0.orbit);
check("exit button offered", (await page.textContent("#act-label")).includes("Exit rover"));
check("speed readout shown", await page.isVisible("#drive-hud"));
check("compass and location shown", (await page.isVisible("#compass")) && (await page.textContent("#loc")).length > 0, await page.textContent("#loc"));

// Throttle: joystick up in the left half for ~2 s.
// Let the first chase-camera frames (and any shader compiles) settle before timing the drive.
await wait(1500);
const f0 = await page.evaluate(() => window.__frontier.frame);
const r0 = await rover();
await stick(110, 470, 0, -60, 2600);
await wait(200);
const r1 = await rover();
console.log(`  (${(await page.evaluate(() => window.__frontier.frame)) - f0} frames during the throttle test)`);
const moved = Math.hypot(r1.x - r0.x, r1.z - r0.z);
const along = (r1.x - r0.x) * Math.sin(r0.h) + (r1.z - r0.z) * Math.cos(r0.h);
check("joystick up drives the rover forward", moved > 2.5 && along > 2.4, `moved ${moved.toFixed(1)} m, along heading ${along.toFixed(1)} m`);
check("speed readout updates", Number(await page.textContent("#drive-speed")) > 0.5, `${await page.textContent("#drive-speed")} m/s ${await page.textContent("#drive-gear")}`);
const camBehind = await page.evaluate(() => {
  const a = window.__frontier;
  const r = a.rover;
  const c = a.world.camera.position;
  const fx = Math.sin(r.heading);
  const fz = Math.cos(r.heading);
  const back = -((c.x - r.pos.x) * fx + (c.z - r.pos.z) * fz);
  return { back, up: c.y - r.pos.y, dist: Math.hypot(c.x - r.pos.x, c.z - r.pos.z) };
});
check("chase camera is behind and above the rover", camBehind.back > 5 && camBehind.up > 1.5 && camBehind.dist < 16, JSON.stringify(Object.fromEntries(Object.entries(camBehind).map(([k, v]) => [k, +v.toFixed(1)]))));

// Steering: stick up-right turns right (heading decreases).
const h0 = (await rover()).h;
await stick(110, 470, 50, -40, 1600);
await wait(200);
const h1 = (await rover()).h;
const dh = Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0));
check("joystick right steers right", dh < -0.3, `heading change ${dh.toFixed(2)} rad`);

// Look-around drag on the right orbits the chase camera, and it eases back.
const yawOff0 = await page.evaluate(() => window.__frontier.driveCam.yawOff);
await page.mouse.move(300, 400);
await page.mouse.down();
for (let i = 0; i < 12; i++) {
  await page.mouse.move(300 - (i + 1) * 10, 400);
  await wait(30);
}
await page.mouse.up();
const yawOff1 = await page.evaluate(() => window.__frontier.driveCam.yawOff);
check("right-side drag orbits the chase camera", Math.abs(yawOff1 - yawOff0) > 0.3, `yawOff ${yawOff1.toFixed(2)}`);
await wait(600);
const framed = await page.evaluate(async () => {
  const a = window.__frontier;
  const p = a.rover.pos.clone();
  p.y += 1.2;
  p.project(a.world.camera);
  return { x: p.x, y: p.y };
});
check("rover stays framed while orbiting", Math.abs(framed.x) < 0.35 && framed.y > -0.9 && framed.y < 0.5, `ndc ${framed.x.toFixed(2)}, ${framed.y.toFixed(2)}`);

// Dust while driving forward + a screenshot of the chase camera.
await page.mouse.move(110, 470);
await page.mouse.down();
await page.mouse.move(110, 410, { steps: 8 });
await wait(2600);
const dust = await page.evaluate(() => window.__frontier.rover.dust.live);
check("dust puffs kicked up while driving", dust > 5, `${dust} live particles`);
const susp = await page.evaluate(() => Math.max(...window.__frontier.rover.wheels.map((w) => Math.abs(w.susp))));
check("wheels ride the ground (suspension active)", susp > 0.005, `max offset ${susp.toFixed(3)} m`);
if (shots) {
  await page.screenshot({ path: `${out}drive-1-chase.png`, timeout: 180000 });
  console.log("shot drive-1-chase");
}
await page.mouse.up();

// Keyboard: reverse with S / ArrowDown.
await wait(2500);
const rk0 = await rover();
await page.keyboard.down("ArrowDown");
await wait(2500);
await page.keyboard.up("ArrowDown");
const rk1 = await rover();
check("arrow-down brakes then reverses", rk1.v < 0 || Math.hypot(rk1.x - rk0.x, rk1.z - rk0.z) > 0.5, `speed ${rk1.v.toFixed(2)}`);
await wait(1500);

// Exit: walker stands ~3.5 m beside the rover, clear of it.
await page.click("#btn-act");
await wait(2500);
const ex = await page.evaluate(() => {
  const a = window.__frontier;
  return { walking: a.walker.active, driving: a.driving, manual: a.rover.manual, d: Math.hypot(a.walker.state.x - a.rover.pos.x, a.walker.state.z - a.rover.pos.z), v: a.rover.speed };
});
check("exit rover returns to walking", ex.walking && !ex.driving && !ex.manual, JSON.stringify(ex));
check("walker stands beside the rover", ex.d > 2.9 && ex.d < 6, `${ex.d.toFixed(2)} m`);
check("rover parked after exit", Math.abs(ex.v) < 0.01);
check("drive offered again on foot", (await page.textContent("#act-label")).includes("Drive rover"));

// Into the rover again, then straight back to orbit through setMode (view bar / menu route).
await page.click("#btn-act");
await wait(800);
check("re-enter drive", await page.evaluate(() => window.__frontier.driving));
// Menu → view bar → Orbit, the way a player leaves.
await page.click("#btn-menu");
await wait(500);
check("menu shows the view bar while driving", await page.isVisible('.view-btn[data-mode="orbit"]'));
await page.click('.view-btn[data-mode="orbit"]');
// The fly-out transition runs on a slow software renderer here: wait for it to finish (up to 20 s).
for (let i = 0; i < 40 && (await page.evaluate(() => !!window.__frontier.rig.transition)); i++) await wait(500);
const orb = await page.evaluate(() => ({ driving: window.__frontier.driving, walking: window.__frontier.walker.active, mode: window.__frontier.rig.mode, enabled: window.__frontier.rig.controls.enabled, manual: window.__frontier.rover.manual }));
check("returns to orbit from drive", !orb.driving && !orb.walking && orb.mode === "orbit" && orb.enabled && !orb.manual, JSON.stringify(orb));
check("dashboard back in orbit", (await page.isVisible(".views")) && !(await page.isVisible("#walk-ui")));

// Rover view offers "Drive manually"; it takes the wheel directly.
await page.click('.view-btn[data-mode="rover"]');
await wait(2200);
check("drive button in rover view", await page.isVisible("#btn-drive"));
await page.click("#btn-drive");
await wait(2200);
check("drive from rover view", await page.evaluate(() => window.__frontier.driving && !window.__frontier.walker.active));
if (shots) {
  await stick(110, 470, -10, -60, 1800);
  await page.screenshot({ path: `${out}drive-2-chase-rover-view.png`, timeout: 180000 });
  console.log("shot drive-2-chase-rover-view");
}
await page.evaluate(() => window.__frontier.setMode("orbit"));
await wait(2000);
check("orbit after rover-view drive", await page.evaluate(() => !window.__frontier.driving && window.__frontier.rig.mode === "orbit"));

const real = errors.filter((e) => !/GPU stall|swiftshader|Automatic fallback|KHR_parallel/i.test(e));
console.log(real.length ? "CONSOLE:\n" + [...new Set(real)].slice(0, 12).join("\n") : "no console errors");
const failed = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
console.log(failed.length ? `DRIVE QC FAILED: ${failed.join(", ")}` : "DRIVE QC PASSED");
await browser.close();
process.exit(failed.length ? 1 : 0);
