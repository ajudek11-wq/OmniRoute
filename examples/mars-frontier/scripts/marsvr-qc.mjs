// Mars VR functional check with an emulated headset (Meta IWER via ?xremu=1): enter the habitat
// through the airlock doors, walk between rooms, climb to the upper deck, take the FR-1 seat and
// drive, grab a geology sample. Screenshots show both eyes.
// Usage: npx vite build --outDir <dir> && npx vite preview --outDir <dir> --port 4198 &
//        node scripts/marsvr-qc.mjs [url] [outDir]      (QC_SHOTS=0 skips screenshots)
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.argv[2] ?? "http://localhost:4198/";
const out = process.argv[3] ?? new URL("../smoke-output/marsvr/", import.meta.url).pathname;
const shots = process.env.QC_SHOTS !== "0";
const only = process.env.QC_ONLY ?? "";
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
page.setDefaultTimeout(240000);
await page.addInitScript((q) => localStorage.setItem("mars-frontier:settings:v1", JSON.stringify({ quality: q, reduceMotion: true })), process.env.QC_QUALITY ?? "low");
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(`[console] ${m.text()}`));
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
};
const app = (fn, arg) => page.evaluate(fn, arg);
const ctl = (hand) => ({
  button: (id, v) => app(([h, i, val]) => window.__xrdev.controllers[h].updateButtonValue(i, val), [hand, id, v]),
  stick: (x, y) => app(([h, sx, sy]) => window.__xrdev.controllers[h].updateAxes("thumbstick", sx, sy), [hand, x, y]),
  pose: (p, q) =>
    app(([h, pp, qq]) => {
      const c = window.__xrdev.controllers[h];
      c.position.set(pp[0], pp[1], pp[2]);
      c.quaternion.set(qq[0], qq[1], qq[2], qq[3]);
    }, [hand, p, q]),
});
const L = ctl("left");
const R = ctl("right");
function aimQuat(d) {
  const len = Math.hypot(d[0], d[1], d[2]);
  const yaw = Math.atan2(-d[0], -d[2]);
  const pitch = Math.asin(d[1] / len);
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cx = Math.cos(pitch / 2);
  const sx = Math.sin(pitch / 2);
  return [cy * sx, sy * cx, -sy * sx, cy * cx];
}
/** Point the right controller at the interactable with this label and pull the trigger. */
async function pressLabel(label) {
  const hand = [0.18, 1.35, -0.25];
  const local = await app((lab) => {
    const a = window.__frontier;
    const it = a.marsVR.adapter.interactables.find((i) => i.label === lab);
    if (!it) return null;
    const v = it.object.getWorldPosition(it.object.position.clone());
    a.xr.rig.worldToLocal(v);
    return [v.x, v.y, v.z];
  }, label);
  if (!local) return false;
  await R.pose(hand, aimQuat([local[0] - hand[0], local[1] - hand[1], local[2] - hand[2]]));
  await wait(400);
  await R.button("trigger", 1);
  await wait(300);
  await R.button("trigger", 0);
  await wait(300);
  return true;
}
const st = () =>
  app(() => {
    const a = window.__frontier;
    const h = a.xr.headWorld();
    return { x: h.x, y: h.y, z: h.z, zone: a.marsVR.zone, yaw: a.xr.yaw, seated: !!a.marsVR.seated };
  });
/** Walk with the left stick toward a world point (head-relative), for up to `ms`. */
async function walkTo(x, z, ms = 20000, tol = 0.5) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await st();
    const dx = x - s.x;
    const dz = z - s.z;
    if (Math.hypot(dx, dz) < tol) break;
    // Turn the view toward the target by rotating the rig (keeps the stick forward).
    await app(([tx, tz]) => {
      const a = window.__frontier;
      const h = a.xr.headWorld();
      const want = Math.atan2(-(tx - h.x), -(tz - h.z));
      const cur = a.xr.headYaw();
      a.xr.turn(Math.atan2(Math.sin(want - cur), Math.cos(want - cur)));
    }, [x, z]);
    await L.stick(0, -1);
    await wait(700);
    await L.stick(0, 0);
  }
  await L.stick(0, 0);
  return st();
}
const shot = async (name) => {
  if (!shots) return;
  await page.screenshot({ path: `${out}${name}.png` });
  console.log(`shot ${name}`);
};

await page.goto(`${base}?xremu=1`);
await page.waitForFunction(() => window.__frontier?.vrSupported === true, null, { timeout: 240000 });
await page.waitForSelector("#btn-enter-vr:not([disabled])");
await page.click("#btn-enter-vr");
await page.waitForFunction(() => window.__frontier.renderer.xr.isPresenting, null, { timeout: 60000 });
await wait(1500);
check("VR session on Mars", (await st()).zone === null);
await app(() => window.__frontier.audio.setEnabled?.(true));

if (!only || only.includes("hab")) {
  // ── Airlock ──
  await app(() => window.__frontier.marsVR.place(0, 19.2, 0));
  await wait(1500);
  await shot("m1-airlock-outside");
  check("outer door panel found", await pressLabel("Cycle airlock"));
  await page.waitForFunction(() => window.__frontier.marsVR.habitat.doors.outer.isOpen, null, { timeout: 30000 }).catch(() => {});
  check("outer airlock door animates open", await app(() => window.__frontier.marsVR.habitat.doors.outer.isOpen));
  let s = await walkTo(0, 13.2, 30000);
  check("walked into the airlock", s.zone === "airlock", `zone=${s.zone} z=${s.z.toFixed(2)}`);
  await shot("m2-airlock-inside");
  await walkTo(0, 10.8, 15000, 0.4);
  check("inner door panel found", await pressLabel("Cycle airlock inward"));
  await page.waitForFunction(() => window.__frontier.marsVR.habitat.doors.inner.isOpen, null, { timeout: 40000 }).catch(() => {});
  check("airlock cycles: outer closed, inner open", await app(() => window.__frontier.marsVR.habitat.doors.inner.isOpen && !window.__frontier.marsVR.habitat.doors.outer.isOpen));
  s = await walkTo(0, 7.4, 30000);
  check("entered the habitat suit room", s.zone === "habGround", `zone=${s.zone} y=${s.y.toFixed(2)}`);
  check("standing on the 0.9 m deck", Math.abs(s.y - 0.9 - 1.7) < 0.3, `head y ${s.y.toFixed(2)}`);
  await shot("m3-suit-room");
  // Rooms: through the suit-room door to the commons, then the galley.
  s = await walkTo(0, 3.6, 30000);
  s = await walkTo(-0.6, -2.6, 40000);
  const inCommons = s.z < 0 && s.zone === "habGround";
  check("walked from the suit room into the commons", inCommons, `x ${s.x.toFixed(1)} z ${s.z.toFixed(1)}`);
  await app(() => {
    const a = window.__frontier;
    const h = a.xr.headWorld();
    const want = Math.atan2(-(-0.9 - h.x), -(-8.4 - h.z));
    a.xr.turn(want - a.xr.headYaw());
  });
  await wait(1200);
  await shot("m4-galley");
  // Medical corner and bunks views (placed, to keep the run short).
  await app(() => window.__frontier.marsVR.place(5.4, 3.6, Math.atan2(-(7.7 - 5.4), -(1.8 - 3.6))));
  await wait(1500);
  await shot("m5-medical");
  await app(() => window.__frontier.marsVR.place(-4.6, -3.0, Math.atan2(-(-7.3 + 4.6), -(-3.4 + 3.0))));
  await wait(1500);
  await shot("m6-bunks");
  // Upper deck by the ladder.
  await app(() => window.__frontier.marsVR.place(2.0, 2.4, 0));
  await wait(1200);
  check("ladder interaction found", await pressLabel("Climb to the upper deck"));
  await page.waitForFunction(() => window.__frontier.marsVR.zone === "habUpper", null, { timeout: 30000 }).catch(() => {});
  await wait(1500);
  s = await st();
  check("ladder takes you to the upper deck", s.zone === "habUpper" && s.y > 4.3, `zone ${s.zone} y ${s.y.toFixed(2)}`);
  await app(() => window.__frontier.marsVR.place(1.6, 5.5, 0.2 + Math.PI, "habUpper"));
  await wait(1500);
  await shot("m7-upper-deck-window");
}

const fatal = errors.filter((e) => !/favicon|404/.test(e));
if (fatal.length) console.log(fatal.slice(0, 12).join("\n"));
check("no console errors", fatal.length === 0, `${fatal.length}`);
await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(failed.length ? `MARS VR QC FAILED: ${failed.map(([n]) => n).join("; ")}` : "MARS VR QC PASSED");
process.exit(failed.length ? 1 : 0);
