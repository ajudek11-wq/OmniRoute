// VR functional check with an emulated headset (Meta IWER runtime, loaded via ?xremu=1).
// It drives a real WebXR session: stereo views, head pose, both controllers, sticks, buttons and triggers.
// It cannot prove PS VR2 / SteamVR behaviour — that needs the real headset (see README → VR).
// Usage: npx vite build && npx vite preview --port 4183 &   then   node scripts/vr-qc.mjs [url] [outDir]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.argv[2] ?? "http://localhost:4183/";
const out = process.argv[3] ?? new URL("../smoke-output/vr/", import.meta.url).pathname;
const shots = process.env.QC_SHOTS !== "0";
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
await page.addInitScript(() => localStorage.setItem("mars-frontier:settings:v1", JSON.stringify({ quality: "low", reduceMotion: true })));
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(`[console] ${m.text()}`));
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
};
const app = (fn, arg) => page.evaluate(fn, arg);

// Controller helpers (IWER device API)
const ctl = (hand) => ({
  async button(id, v) {
    await app(([h, i, val]) => window.__xrdev.controllers[h].updateButtonValue(i, val), [hand, id, v]);
  },
  async stick(x, y) {
    await app(([h, sx, sy]) => window.__xrdev.controllers[h].updateAxes("thumbstick", sx, sy), [hand, x, y]);
  },
  async pose(p, q) {
    await app(([h, pp, qq]) => {
      const c = window.__xrdev.controllers[h];
      c.position.set(pp[0], pp[1], pp[2]);
      c.quaternion.set(qq[0], qq[1], qq[2], qq[3]);
    }, [hand, p, q]);
  },
});
const L = ctl("left");
const R = ctl("right");
// Quaternion that turns −Z toward direction d (yaw about Y, then pitch about X).
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
// Aim the right controller (from a fixed hand position in play space) at a world point and pull the trigger.
async function pointAndClick(fn, hold = 250) {
  const hand = [0.18, 1.35, -0.25];
  const local = await page.evaluate(`(() => {
    const app = window.__frontier;
    const p = (${fn.toString()})(app);
    if (!p) return null;
    const v = p.clone();
    app.xr.rig.worldToLocal(v);
    return [v.x, v.y, v.z];
  })()`);
  if (!local) return false;
  await R.pose(hand, aimQuat([local[0] - hand[0], local[1] - hand[1], local[2] - hand[2]]));
  await wait(300);
  await R.button("trigger", 1);
  await wait(hold);
  await R.button("trigger", 0);
  await wait(300);
  return true;
}
const state = () =>
  app(() => {
    const a = window.__frontier;
    const h = a.xr.headWorld();
    return {
      presenting: a.renderer.xr.isPresenting,
      views: a.renderer.xr.getCamera().cameras.length,
      hands: Object.keys(a.xr.hands).sort(),
      gloves: Object.values(a.xr.hands).every((s) => s.glove?.root.visible),
      dest: a.cosmos.active ? a.cosmos.id : "mars",
      rig: { x: a.xr.rig.position.x, y: a.xr.rig.position.y, z: a.xr.rig.position.z, yaw: a.xr.yaw },
      head: { x: h.x, y: h.y, z: h.z },
      menu: a.xr.menu.mesh.visible,
      fade: a.xr.fade.value,
    };
  });
const shot = async (name) => {
  if (!shots) return;
  await page.screenshot({ path: `${out}${name}.png` });
  console.log(`shot ${name}`);
};

await page.goto(`${base}?xremu=1`);
await page.waitForFunction(() => window.__frontier?.vrSupported === true, null, { timeout: 240000 });
check("WebXR immersive-vr reported as supported", true);
await page.waitForSelector("#btn-enter-vr:not([disabled])");
await page.click("#btn-enter-vr");
await page.waitForFunction(() => window.__frontier.renderer.xr.isPresenting, null, { timeout: 60000 });
await wait(1500);
let s = await state();
check("VR session presenting", s.presenting);
check("stereo rendering: two eye views", s.views === 2, `views=${s.views}`);
check("both controllers tracked", s.hands.join() === "left,right", s.hands.join());
check("gloves shown on both hands", s.gloves);
check("starts on Mars in VR", s.dest === "mars");
const ground = await app(() => {
  const a = window.__frontier;
  const h = a.xr.headWorld();
  return a.marsVR.adapter.groundAt(h.x, h.z);
});
check("head at standing height above the Mars terrain", Math.abs(s.head.y - ground - 1.7) < 0.25, `head ${s.head.y.toFixed(2)} ground ${ground.toFixed(2)}`);
await shot("vr-1-mars");

// Smooth locomotion (left stick forward)
const p0 = s.head;
await L.stick(0, -1);
await wait(5000); // the software renderer runs at a few frames per second here
await L.stick(0, 0);
await wait(200);
s = await state();
const moved = Math.hypot(s.head.x - p0.x, s.head.z - p0.z);
check("left stick moves the player smoothly", moved > 0.5, `moved ${moved.toFixed(2)} m`);

// Snap turn (right stick flick)
const yaw0 = s.rig.yaw;
await R.stick(1, 0);
await wait(250);
await R.stick(0, 0);
await wait(250);
s = await state();
const turned = ((yaw0 - s.rig.yaw) * 180) / Math.PI;
check("right stick flick snap-turns 30°", Math.abs(turned - 30) < 0.5, `${turned.toFixed(1)}°`);

// Teleport (right stick forward, aim down-forward, release) from an open patch of ground
await app(() => window.__frontier.marsVR.place(-14, 64, 0.4));
await wait(800);
await R.pose([0.18, 1.3, -0.2], aimQuat([0, -0.35, -1]));
const before = (await state()).head;
await R.stick(0, -1);
await wait(500);
const arcShown = await app(() => window.__frontier.xr.arc.visible);
check("teleport arc shown while aiming", arcShown);
await R.stick(0, 0);
await wait(3500); // fade-out, move, fade-in at a few frames per second
s = await state();
const jumped = Math.hypot(s.head.x - before.x, s.head.z - before.z);
check("teleport moves the player to the arc target", jumped > 1.5, `jumped ${jumped.toFixed(2)} m`);

// Interact on Mars: walk to the airlock and point at it
await app(() => {
  const a = window.__frontier;
  a.marsVR.place(0, 21, 0);
});
await wait(800);
const hatchOpened = await (async () => {
  await pointAndClick((app) => {
    const t = app.marsVR.adapter.interactables.find((i) => i.label === "Cycle airlock");
    return t ? t.object.getWorldPosition(t.object.position.clone()) : null;
  });
  return app(() => window.__frontier.settlement.structures.habitat.hatchOpen ?? null);
})();
const toastSeen = await app(() => [...document.querySelectorAll(".toast b")].some((b) => b.textContent.includes("Airlock")) || window.__frontier.xr.toastPanel.mesh.visible);
check("pointing + trigger operates the airlock", toastSeen || hatchOpened === true);
await shot("vr-2-airlock");

// Wrist menu (left Y / Triangle) → star map
await L.button("y-button", 1);
await wait(200);
await L.button("y-button", 0);
await wait(400);
s = await state();
check("left face button opens the wrist menu", s.menu);
await shot("vr-3-menu");
const buttonPoint = (panelFn, id) => `(app) => {
  const p = (${panelFn})(app); if (!p) return null; const b = p.buttons.find((b) => b.id === "${id}"); if (!b) return null;
  const u = (b.x + b.w / 2) / p.w, v = 1 - (b.y + b.h / 2) / p.h; const g = p.mesh.geometry.parameters;
  return p.mesh.localToWorld(p.mesh.position.clone().set((u - 0.5) * g.width, (v - 0.5) * g.height, 0));
}`;
await pointAndClick(buttonPoint("(app) => app.xr.menu", "hub"));
await page.waitForFunction(() => window.__frontier.cosmos.id === "hub" && !window.__frontier.cosmos.busy, null, { timeout: 120000 });
await wait(1500);
s = await state();
check("menu → star map loads the hub", s.dest === "hub");
check("player stands on the hub deck", Math.abs(s.head.y - 1.7) < 0.25, `head y ${s.head.y.toFixed(2)}`);
await shot("vr-4-hub");

// Select a world on the holographic map: pick one with a clear line of sight from the hand, then launch it directly
const target = await app(() => {
  const a = window.__frontier;
  const w = a.cosmos.world;
  const R = a.xr.hands.right;
  const from = R.ray.getWorldPosition(R.ray.position.clone());
  const objs = w.interactables.map((i) => i.object);
  for (const name of ["Mars", "Venus", "The Moon", "Earth Orbit", "Jupiter", "Saturn"]) {
    const it = w.interactables.find((i) => i.label === name);
    const p = it.object.getWorldPosition(it.object.position.clone());
    const dir = p.clone().sub(from).normalize();
    a.xr.raycaster.set(from, dir);
    let o = a.xr.raycaster.intersectObjects(objs, true)[0]?.object;
    while (o && !o.userData.interact) o = o.parent;
    if (o?.userData.interact === it) return name;
  }
  return null;
});
await pointAndClick(`(app) => { const m = app.cosmos.world.interactables.find((i) => i.label === "${target}"); return m ? m.object.getWorldPosition(m.object.position.clone()) : null; }`);
const cardOpen = await app((name) => window.__frontier.cosmos.world.interactables.some((i) => i.panel && i.panel.content.title === name && i.panel.mesh.visible), target);
check("pointing at a hologram opens its mission card", cardOpen, target ?? "no clear target");
await shot("vr-5-card");
await pointAndClick(buttonPoint(`(app) => app.cosmos.world.interactables.find((i) => i.panel && i.panel.content.title === "${target}")?.panel`, "jump"));
const targetId = { Mars: "mars", Venus: "venus", "The Moon": "moon", "Earth Orbit": "orbit", Jupiter: "jupiter", Saturn: "saturn" }[target];
await page.waitForFunction((id) => window.__frontier.cosmos.id === id && !window.__frontier.cosmos.busy, targetId, { timeout: 180000 });
await wait(1500);
check("mission card launches the destination", (await state()).dest === targetId, targetId);
await shot("vr-6-destination");

// Back to Mars through the director, still in VR
await app(() => window.__frontier.cosmos.go("mars"));
await page.waitForFunction(() => !window.__frontier.cosmos.busy && !window.__frontier.cosmos.active, null, { timeout: 120000 });
await wait(800);
s = await state();
check("return to Mars keeps the VR session", s.presenting && s.dest === "mars");

// Exit VR
await app(() => window.__frontier.xr.exit());
await page.waitForFunction(() => !window.__frontier.renderer.xr.isPresenting, null, { timeout: 30000 });
check("exit VR returns to the desktop view", true);

const fatal = errors.filter((e) => !/favicon|404/.test(e));
if (fatal.length) console.log(fatal.slice(0, 12).join("\n"));
check("no console errors", fatal.length === 0, `${fatal.length}`);
await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(failed.length ? `VR QC FAILED: ${failed.map(([n]) => n).join("; ")}` : "VR QC PASSED");
process.exit(failed.length ? 1 : 0);
