import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STRUCTURE_POS,
  STRUCTURE_COLLIDERS,
  LINK_COLLIDERS,
  OBSTACLES,
  PATHS,
  FLAT_ZONES,
  WALK_START,
  ROVER_HOME,
  SOLAR_SERVICE_POINT,
} from "../src/data/layout.js";

const NEW_IDS = ["habitatB", "yard", "isru", "fieldlab"];
const WALKER_DIAMETER = 1.6; // walk/movement.js radius 0.8

function distToSegment(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
function distToPaths(x, z) {
  let d = Infinity;
  for (const path of PATHS) for (let i = 0; i < path.length - 1; i++) d = Math.min(d, distToSegment(x, z, path[i], path[i + 1]));
  return d;
}
const own = new Set(NEW_IDS.flatMap((id) => STRUCTURE_COLLIDERS[id]));
const links = new Set(LINK_COLLIDERS);
const legacy = OBSTACLES.filter((o) => !own.has(o) && !links.has(o));

test("every expansion structure has a position, colliders and sits inside the levelled core", () => {
  const core = FLAT_ZONES[0];
  for (const id of NEW_IDS) {
    assert.ok(STRUCTURE_POS[id], `missing STRUCTURE_POS.${id}`);
    assert.ok(STRUCTURE_COLLIDERS[id]?.length > 0, `missing colliders for ${id}`);
    const p = STRUCTURE_POS[id];
    assert.ok(Math.hypot(p.x - core.x, p.z - core.z) < core.r, `${id} outside the flat core`);
    for (const c of STRUCTURE_COLLIDERS[id]) assert.ok(OBSTACLES.includes(c), `${id} collider not registered in OBSTACLES`);
  }
});

test("expansion structures keep at least 8 m from every road, and their colliders stay off the roads", () => {
  for (const id of NEW_IDS) {
    const p = STRUCTURE_POS[id];
    assert.ok(distToPaths(p.x, p.z) >= 8, `${id} centre is ${distToPaths(p.x, p.z).toFixed(1)} m from a road`);
    for (const c of STRUCTURE_COLLIDERS[id]) {
      const clear = distToPaths(c.x, c.z) - c.r;
      assert.ok(clear >= 3, `${id} collider at (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) is ${clear.toFixed(1)} m from a road`);
    }
  }
  for (const c of LINK_COLLIDERS) assert.ok(distToPaths(c.x, c.z) - c.r >= 3, "tunnel crosses a road");
});

test("expansion colliders leave a walkable gap to every other structure", () => {
  for (const id of NEW_IDS) {
    const mine = STRUCTURE_COLLIDERS[id];
    const others = [...legacy, ...NEW_IDS.filter((o) => o !== id).flatMap((o) => STRUCTURE_COLLIDERS[o])];
    for (const a of mine) {
      for (const b of others) {
        const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
        assert.ok(gap >= WALKER_DIAMETER, `${id} collider (${a.x.toFixed(1)}, ${a.z.toFixed(1)}) is ${gap.toFixed(2)} m from (${b.x}, ${b.z})`);
      }
    }
  }
});

test("the Habitat B tunnel joins the two habitats and touches nothing else", () => {
  const hab = OBSTACLES[0];
  const habB = STRUCTURE_COLLIDERS.habitatB[0];
  const first = LINK_COLLIDERS[0];
  const last = LINK_COLLIDERS[LINK_COLLIDERS.length - 1];
  assert.ok(Math.hypot(first.x - hab.x, first.z - hab.z) < hab.r + first.r, "tunnel does not reach the main habitat");
  assert.ok(Math.hypot(last.x - habB.x, last.z - habB.z) < habB.r + last.r, "tunnel does not reach Habitat B");
  for (let i = 1; i < LINK_COLLIDERS.length; i++) {
    const a = LINK_COLLIDERS[i - 1];
    const b = LINK_COLLIDERS[i];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r, "gap in the tunnel collider chain");
  }
  const others = [...legacy.slice(1), ...NEW_IDS.filter((o) => o !== "habitatB").flatMap((o) => STRUCTURE_COLLIDERS[o])];
  for (const c of LINK_COLLIDERS) {
    for (const o of others) assert.ok(Math.hypot(c.x - o.x, c.z - o.z) - c.r - o.r >= WALKER_DIAMETER, "tunnel blocks a walkway");
  }
});

test("walk start, rover home and the solar service point stay clear of every collider", () => {
  for (const [name, p] of Object.entries({ WALK_START, ROVER_HOME, SOLAR_SERVICE_POINT })) {
    for (const o of OBSTACLES) {
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      assert.ok(d > o.r + 1, `${name} is inside an obstacle at (${o.x}, ${o.z})`);
    }
  }
});
