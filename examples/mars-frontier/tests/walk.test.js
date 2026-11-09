import { test } from "node:test";
import assert from "node:assert/strict";
import { stepPlayer, resolveCircles, WALK, headBob } from "../src/walk/movement.js";
import { SAMPLES, collect, nearestWithin, sampleById } from "../src/game/discoveries.js";

const flat = () => 0;
const newState = (over = {}) => ({ x: 0, z: 0, yaw: 0, speed: 0, moving: false, blocked: false, ...over });

test("forward input moves along yaw; yaw=0 is +z (north in the rover convention)", () => {
  const s = newState();
  for (let i = 0; i < 60; i++) stepPlayer(s, { mx: 0, mz: 1 }, 1 / 60, flat, []);
  assert.ok(s.z > 1.5 && Math.abs(s.x) < 1e-6, `z=${s.z} x=${s.x}`);
});

test("turning 90 degrees makes forward move along +x", () => {
  const s = newState({ yaw: Math.PI / 2 });
  for (let i = 0; i < 60; i++) stepPlayer(s, { mx: 0, mz: 1 }, 1 / 60, flat, []);
  assert.ok(s.x > 1.5 && Math.abs(s.z) < 1e-6);
});

test("sprint is faster than walking", () => {
  const a = newState();
  const b = newState();
  for (let i = 0; i < 120; i++) {
    stepPlayer(a, { mx: 0, mz: 1, sprint: false }, 1 / 60, flat, []);
    stepPlayer(b, { mx: 0, mz: 1, sprint: true }, 1 / 60, flat, []);
  }
  assert.ok(b.z > a.z * 1.8);
  assert.ok(b.z / 2 < WALK.sprint * 2);
});

test("a player cannot walk through a building collider", () => {
  const wall = [{ x: 5, z: 0, r: 3 }];
  const s = newState({ x: 0, z: 0, yaw: Math.PI / 2 });
  for (let i = 0; i < 600; i++) stepPlayer(s, { mx: 0, mz: 1 }, 1 / 60, flat, wall);
  const d = Math.hypot(s.x - 5, s.z);
  assert.ok(d >= 3 + WALK.radius - 1e-6, `distance to collider ${d}`);
});

test("resolveCircles pushes a point out of overlap and leaves free points alone", () => {
  const out = resolveCircles(1, 0, 0.5, [{ x: 0, z: 0, r: 2 }]);
  assert.ok(Math.hypot(out.x, out.z) >= 2.5 - 1e-9);
  const free = resolveCircles(10, 10, 0.5, [{ x: 0, z: 0, r: 2 }]);
  assert.deepEqual(free, { x: 10, z: 10 });
});

test("cliffs steeper than the climb limit block movement", () => {
  const cliff = (x) => (x > 1 ? 5 : 0);
  const s = newState({ x: 0.5, z: 0, yaw: Math.PI / 2 });
  for (let i = 0; i < 120; i++) stepPlayer(s, { mx: 0, mz: 1 }, 1 / 60, cliff, []);
  assert.ok(s.x < 1.0 + 1e-6 && s.blocked);
});

test("head bob stays small", () => {
  for (let d = 0; d < 50; d += 0.37) {
    const b = headBob(d);
    assert.ok(Math.abs(b.y) <= 0.035 + 1e-9 && Math.abs(b.roll) <= 0.004 + 1e-9);
  }
});

test("discoveries: collect is idempotent and only accepts known samples", () => {
  let found = new Set();
  const first = collect(found, SAMPLES[0].id);
  assert.equal(first.added, true);
  assert.equal(collect(first.found, SAMPLES[0].id).added, false);
  assert.equal(collect(first.found, "not-a-sample").added, false);
  assert.equal(sampleById("layers").name, "Layered basalt");
});

test("nearestWithin respects the radius and returns the closest item", () => {
  const list = [{ id: "a", x: 0, z: 0 }, { id: "b", x: 3, z: 0 }];
  assert.equal(nearestWithin(list, 2.8, 0, 5).id, "b");
  assert.equal(nearestWithin(list, 50, 50, 5), null);
});

test("every sample has a unique id and a name", () => {
  const ids = new Set(SAMPLES.map((s) => s.id));
  assert.equal(ids.size, SAMPLES.length);
  for (const s of SAMPLES) assert.ok(s.name.length > 0);
});
