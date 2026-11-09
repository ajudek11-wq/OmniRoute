import { test } from "node:test";
import assert from "node:assert/strict";
import { readPad, deadzone, flick } from "../src/xr/input.js";
import { headWorld, turnAboutHead, moveDelta, pushOut, teleportArc, validTarget, seatedOffset, vignetteFor } from "../src/xr/locomotion.js";
import { recommendVrTier, VrGovernor, VR_TIERS } from "../src/xr/vrQuality.js";

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const pad = (buttons = [], axes = [0, 0, 0, 0]) => ({ buttons: buttons.map((v) => (typeof v === "object" ? v : { value: v, pressed: v > 0.5, touched: v > 0 })), axes });

test("xr-standard mapping: trigger, grip, face buttons and the thumbstick on axes 2/3", () => {
  const s = readPad(pad([1, 0.8, 0, 0, 1, 0], [0, 0, 0.5, -1]));
  assert.equal(s.triggerDown, true);
  assert.equal(s.gripDown, true);
  assert.equal(s.a, true);
  assert.equal(s.b, false);
  assert.ok(s.stick.y > 0.85, "pushing the stick forward (axis −1) is +y");
  assert.ok(s.stick.x > 0.3);
});

test("thumbstick falls back to axes 0/1 when the runtime reports only two axes", () => {
  const s = readPad(pad([0, 0], [1, 0]));
  assert.ok(s.stick.x > 0.95);
});

test("edge flags fire once per press", () => {
  const a = readPad(pad([1]));
  assert.equal(a.triggerDownPressed, true);
  const b = readPad(pad([1]), a);
  assert.equal(b.triggerDownPressed, false);
  const c = readPad(pad([0]), b);
  assert.equal(c.triggerDownReleased, true);
});

test("radial deadzone swallows drift and rescales to full range", () => {
  assert.deepEqual(deadzone(0.1, 0.05), { x: 0, y: 0, m: 0 });
  const d = deadzone(1, 0);
  assert.ok(near(d.x, 1) && near(d.m, 1));
});

test("snap-turn flick needs the stick to return to centre before firing again", () => {
  let st = flick(0.9, true);
  assert.equal(st.fire, 1);
  st = flick(0.9, st.armed);
  assert.equal(st.fire, 0);
  st = flick(0.1, st.armed);
  assert.equal(st.armed, true);
});

test("turning about the head keeps the head in place", () => {
  const rig = { x: 2, z: -1, yaw: 0.3 };
  const before = headWorld(rig, 0.4, -0.2);
  const after = turnAboutHead(rig, 0.4, -0.2, Math.PI / 6);
  const h = headWorld(after, 0.4, -0.2);
  assert.ok(near(before.x, h.x) && near(before.z, h.z));
  assert.ok(near(after.yaw, 0.3 + Math.PI / 6));
});

test("smooth movement follows where the head looks", () => {
  const f = moveDelta(0, 0, 1, 2, 0.5); // yaw 0 looks toward −Z
  assert.ok(near(f.dx, 0) && near(f.dz, -1));
  const r = moveDelta(0, 1, 0, 2, 0.5); // strafe right → +X
  assert.ok(near(r.dx, 1) && near(r.dz, 0));
});

test("collision push-out keeps the player outside walls", () => {
  const p = pushOut(0.1, 0, 0.3, [{ x: 0, z: 0, r: 1 }]);
  assert.ok(Math.hypot(p.x, p.z) >= 1.3 - 1e-6);
});

test("teleport arc lands on the ground in front of the controller", () => {
  const flat = () => 0;
  const res = teleportArc({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 0.5, z: -1 }, flat);
  assert.ok(res.hit, "arc should land");
  assert.ok(res.hit.z < -2, "lands ahead");
  assert.ok(near(res.hit.y, 0));
});

test("teleport targets: blocked by walls, steep slopes and the edge of the world", () => {
  const flat = () => 0;
  assert.equal(validTarget({ x: 0, y: 0, z: -3 }, flat, []), true);
  assert.equal(validTarget({ x: 0, y: 0, z: -3 }, flat, [{ x: 0, z: -3, r: 1 }]), false);
  const cliff = (x) => x * 2;
  assert.equal(validTarget({ x: 1, y: 2, z: 0 }, cliff, []), false);
  assert.equal(validTarget({ x: 50, y: 0, z: 0 }, flat, [], { bounds: { x: 0, z: 0, r: 10 } }), false);
  assert.equal(validTarget(null, flat, []), false);
});

test("teleport arc ignores places with no floor (null)", () => {
  const deck = (x, z) => (Math.hypot(x, z) < 2 ? 0 : null);
  const res = teleportArc({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 0.6, z: -1 }, deck);
  assert.equal(res.hit, null);
});

test("seated mode lifts a low head to standing eye height, within limits", () => {
  assert.ok(near(seatedOffset(1.2), 0.45));
  assert.equal(seatedOffset(1.9), 0);
  assert.equal(seatedOffset(0), 1.2);
});

test("comfort vignette only reacts to artificial motion above walking speed", () => {
  assert.equal(vignetteFor(0.3, 0.2), 0);
  assert.ok(vignetteFor(3, 0) > 0.3);
  assert.ok(vignetteFor(50, 50) <= 0.85);
});

test("GPU recommendation maps common cards to VR tiers", () => {
  assert.equal(recommendVrTier("ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0)").tier, "ultra");
  assert.equal(recommendVrTier("NVIDIA GeForce RTX 3080").tier, "high");
  assert.equal(recommendVrTier("NVIDIA GeForce RTX 4060").tier, "high");
  assert.equal(recommendVrTier("NVIDIA GeForce RTX 3060").tier, "balanced");
  assert.equal(recommendVrTier("NVIDIA GeForce RTX 2070").tier, "balanced");
  assert.equal(recommendVrTier("AMD Radeon RX 7900 XTX").tier, "ultra");
  assert.equal(recommendVrTier("AMD Radeon RX 6700 XT").tier, "high");
  assert.equal(recommendVrTier("Intel(R) UHD Graphics 630").tier, "low");
  assert.equal(recommendVrTier("Google SwiftShader").tier, "low");
  assert.equal(recommendVrTier("").tier, "low");
  for (const t of Object.values(VR_TIERS)) assert.ok(t.framebufferScale > 0 && t.hz >= 72);
});

test("VR governor steps down only after sustained missed frames", () => {
  const steps = [];
  const g = new VrGovernor((l) => steps.push(l));
  g.reset(90);
  for (let i = 0; i < 90 * 4; i++) g.sample(1 / 90);
  assert.deepEqual(steps, [], "on-budget frames never degrade");
  for (let i = 0; i < 60 * 6; i++) g.sample(1 / 60);
  assert.ok(steps.length >= 1 && steps[0] === 1);
});
