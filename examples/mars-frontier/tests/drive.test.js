import { test } from "node:test";
import assert from "node:assert/strict";
import { stepRover, driveState, exitSpot, DRIVE } from "../src/walk/drive.js";
import { resolveCircles } from "../src/walk/movement.js";

const flat = () => 0;
const run = (s, input, seconds, ground = flat, circles = []) => {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) stepRover(s, input, 1 / 60, ground, circles);
  return s;
};

test("full throttle drives forward along the heading (heading 0 = +z)", () => {
  const s = run(driveState(), { throttle: 1, steer: 0 }, 3);
  assert.ok(s.z > 6 && Math.abs(s.x) < 1e-6, `z=${s.z} x=${s.x}`);
  assert.ok(s.speed > 0 && s.speed <= DRIVE.maxSpeed);
  const e = run(driveState(0, 0, Math.PI / 2), { throttle: 1, steer: 0 }, 3);
  assert.ok(e.x > 6 && Math.abs(e.z) < 1e-6, "heading π/2 drives east (+x)");
});

test("top speed is capped and reached within a few seconds", () => {
  const s = run(driveState(), { throttle: 1, steer: 0 }, 8);
  assert.ok(Math.abs(s.speed - DRIVE.maxSpeed) < 0.05, `speed ${s.speed}`);
});

test("steering right turns clockwise (heading decreases) and left the other way", () => {
  const r = run(driveState(), { throttle: 1, steer: 1 }, 2);
  const l = run(driveState(), { throttle: 1, steer: -1 }, 2);
  assert.ok(r.heading < -0.5, `right heading ${r.heading}`);
  assert.ok(l.heading > 0.5, `left heading ${l.heading}`);
  // Facing +z, the rover's right-hand side is −x.
  assert.ok(r.x < -0.5 && l.x > 0.5);
});

test("the rover can point-turn on the spot", () => {
  const s = run(driveState(), { throttle: 0, steer: 1 }, 2);
  assert.ok(Math.abs(s.heading) > 0.6, `heading ${s.heading}`);
  assert.ok(Math.hypot(s.x, s.z) < 1e-6, "no translation in a point turn");
});

test("reverse is slower than forward and backs along −heading", () => {
  const s = run(driveState(), { throttle: -1, steer: 0 }, 6);
  assert.ok(s.z < -4, `z=${s.z}`);
  assert.ok(s.speed < 0 && -s.speed <= DRIVE.maxReverse + 1e-9);
  assert.ok(DRIVE.maxReverse < DRIVE.maxSpeed);
});

test("pulling back while rolling forward brakes before reversing", () => {
  const s = run(driveState(), { throttle: 1, steer: 0 }, 4);
  const v = s.speed;
  stepRover(s, { throttle: -1, steer: 0 }, 1 / 60, flat, []);
  assert.ok(s.speed < v && s.speed > 0, "first frame only brakes");
  run(s, { throttle: -1, steer: 0 }, 4);
  assert.ok(s.speed < 0, "then reverses");
});

test("releasing the stick brings the rover to a stop without rolling backwards", () => {
  const s = run(driveState(), { throttle: 1, steer: 0 }, 4);
  run(s, { throttle: 0, steer: 0 }, 6);
  assert.equal(s.speed, 0);
  const z = s.z;
  run(s, { throttle: 0, steer: 0 }, 1);
  assert.equal(s.z, z);
  assert.equal(s.moving, false);
});

test("brake input stops the rover quickly", () => {
  const s = run(driveState(), { throttle: 1, steer: 0 }, 5);
  run(s, { throttle: 1, steer: 0, brake: true }, 1.5);
  assert.equal(s.speed, 0);
});

test("the rover cannot drive through a collider", () => {
  const wall = [{ x: 0, z: 12, r: 4 }];
  const s = run(driveState(), { throttle: 1, steer: 0 }, 10, flat, wall);
  const d = Math.hypot(s.x - 0, s.z - 12);
  assert.ok(d >= 4 + DRIVE.radius - 1e-6, `distance ${d}`);
  assert.ok(Math.abs(s.speed) < 1, "hitting a wall head-on bleeds speed");
});

test("cliffs steeper than the slope limit stop the rover", () => {
  const cliff = (x, z) => (z > 10 ? 8 : 0);
  const s = run(driveState(), { throttle: 1, steer: 0 }, 6, cliff);
  assert.ok(s.z <= 10 + 1e-6, `z=${s.z}`);
  const gentle = (x, z) => z * 0.2;
  const g = run(driveState(), { throttle: 1, steer: 0 }, 6, gentle);
  assert.ok(g.z > 15, "a 20% grade is climbable");
});

test("climbing is slower than driving on the flat", () => {
  const hill = (x, z) => z * 0.4;
  const a = run(driveState(), { throttle: 1, steer: 0 }, 6);
  const b = run(driveState(), { throttle: 1, steer: 0 }, 6, hill);
  assert.ok(b.z < a.z * 0.9, `flat ${a.z} hill ${b.z}`);
});

test("exitSpot picks a clear point beside the rover", () => {
  const p = exitSpot(0, 0, 0, [], flat);
  assert.ok(Math.abs(Math.hypot(p.x, p.z) - 3.6) < 1e-9);
  assert.ok(p.x < 0, "prefers the right-hand side (−x when facing +z)");
  const blocked = [{ x: -3.6, z: 0, r: 2 }];
  const q = exitSpot(0, 0, 0, blocked, flat);
  const still = resolveCircles(q.x, q.z, 0.8, blocked);
  assert.ok(Math.hypot(still.x - q.x, still.z - q.z) < 1e-6, "not inside a collider");
  assert.ok(q.x > 0, "falls back to the left side");
});
