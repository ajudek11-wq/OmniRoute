import { test } from "node:test";
import assert from "node:assert/strict";
import { tileableFbm, stormFront, screenReadouts, STORM_PERIOD } from "../src/scene/ambient.js";
import { createState, step } from "../src/sim/engine.js";

test("tileableFbm is normalised to [0,1] and wraps seamlessly", () => {
  const W = 64;
  const H = 32;
  const f = tileableFbm(W, H, 3, [4, 8, 16]);
  assert.equal(f.length, W * H);
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of f) {
    mn = Math.min(mn, v);
    mx = Math.max(mx, v);
  }
  assert.ok(Math.abs(mn) < 1e-6 && Math.abs(mx - 1) < 1e-6, `${mn}..${mx}`);
  // Opposite edges are neighbours on the lattice: the jump across the seam is as small as inside.
  let seam = 0;
  let inner = 0;
  for (let y = 0; y < H; y++) {
    seam = Math.max(seam, Math.abs(f[y * W + W - 1] - f[y * W]));
    inner = Math.max(inner, Math.abs(f[y * W + 1] - f[y * W]));
  }
  assert.ok(seam < Math.max(0.12, inner * 2), `seam ${seam} vs inner ${inner}`);
});

test("dust front builds, holds and fades, and is quiet at cycle boundaries", () => {
  assert.equal(stormFront(0).amount, 0);
  assert.ok(stormFront(STORM_PERIOD * 0.45).amount > 0.45);
  assert.ok(stormFront(STORM_PERIOD * 0.95).amount < 1e-6);
  assert.equal(stormFront(STORM_PERIOD * 1.2).cycle, 1);
  // A dustier sky makes a denser front.
  assert.ok(stormFront(STORM_PERIOD * 0.45, 3).amount > stormFront(STORM_PERIOD * 0.45, 0.5).amount);
  for (let t = 0; t < STORM_PERIOD * 2; t += 7) {
    const a = stormFront(t, 5).amount;
    assert.ok(a >= 0 && a <= 1);
  }
});

test("screen readouts come straight from the simulation", () => {
  const sim = createState("outpost");
  step(sim, 600);
  const r = screenReadouts(sim);
  assert.match(r.clock, /^\d\d:\d\d$/);
  assert.equal(r.sol, 1);
  assert.equal(r.life.length, 3);
  for (const row of r.life) assert.ok(row.frac >= 0 && row.frac <= 1 && typeof row.value === "string");
  assert.ok(Math.abs(r.soc - sim.stores.battery / sim.config.batteryKWh) < 1e-9);
  assert.equal(r.tau, sim.flows.tau);
  assert.equal(r.ledsOn, true);
  sim.systems.greenhouseLights = false;
  step(sim, 60);
  assert.equal(screenReadouts(sim).ledsOn, false);
});
