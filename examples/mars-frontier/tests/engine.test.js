import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  step,
  summarize,
  project,
  sunVector,
  computePower,
  setSystem,
  cleanPanels,
  applyConfig,
  opticalDepth,
  LOAD_PRIORITY,
} from "../src/sim/engine.js";
import { p, SOL_SECONDS } from "../src/sim/constants.js";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("sun is overhead-ish at noon and below the horizon at midnight", () => {
  const noon = sunVector(0.5, 40.2, 0);
  const midnight = sunVector(0, 40.2, 0);
  near(noon.y, Math.cos((40.2 * Math.PI) / 180), 1e-9); // max elevation = 90° − latitude
  assert.ok(midnight.y < 0);
  const morning = sunVector(0.3, 40.2, 0);
  assert.ok(morning.x > 0, "sun rises in the east (+x)");
});

test("solar output is zero at night, fission is constant", () => {
  const s = createState("outpost");
  s.startFrac = 0; // midnight
  const pw = computePower(s);
  assert.equal(pw.solarKW, 0);
  assert.equal(pw.fissionKW, s.config.fissionUnits * p("fissionUnitKW"));
});

test("crew oxygen use with no production matches the BVAD rate over one sol", () => {
  const s = createState("outpost");
  s.config.isruUnits = 0;
  s.config.greenhouseArea = 0;
  const before = s.stores.o2;
  step(s, SOL_SECONDS);
  const expected = s.config.crew * p("o2PerCrew") + p("o2Leak");
  near(before - s.stores.o2, expected, 1e-6);
});

test("battery stays within [0, capacity] through a dust storm", () => {
  const s = createState("storm");
  for (let i = 0; i < 24 * 30; i++) {
    step(s, 3600);
    assert.ok(s.stores.battery >= 0);
    assert.ok(s.stores.battery <= s.config.batteryKWh + 1e-9);
  }
});

test("loads are shed in priority order and life support is never shed", () => {
  const s = createState("solar");
  s.config.solarArea = 0;
  s.stores.battery = 0;
  step(s, 600);
  const shed = Object.keys(s.shed);
  assert.ok(shed.length > 0);
  // Every shed key must come before any non-shed key in the priority list.
  const lastShed = Math.max(...shed.map((k) => LOAD_PRIORITY.indexOf(k)));
  for (let i = 0; i < lastShed; i++) {
    const key = LOAD_PRIORITY[i];
    if (s.flows.demand[key] > 0) assert.ok(s.shed[key], `${key} should be shed before others`);
  }
  assert.ok(!("habitat" in s.shed));
  assert.ok(s.flows.loads.habitat > 0);
});

test("water recovery dramatically reduces net water loss", () => {
  const a = createState("outpost");
  const b = createState("outpost");
  a.systems.waterExtraction = false;
  b.systems.waterExtraction = false;
  setSystem(b, "recycler", false);
  const wa = a.stores.water;
  const wb = b.stores.water;
  step(a, SOL_SECONDS);
  step(b, SOL_SECONDS);
  const lossA = wa - a.stores.water;
  const lossB = wb - b.stores.water;
  assert.ok(lossA < lossB / 10, `recycling loss ${lossA} vs open loop ${lossB}`);
});

test("autonomy and closures are bounded in [0, 1]", () => {
  for (const id of ["outpost", "expansion", "storm", "solar"]) {
    const s = createState(id);
    step(s, SOL_SECONDS * 3);
    const sum = summarize(s);
    assert.ok(sum.autonomy >= 0 && sum.autonomy <= 1);
    for (const v of Object.values(sum.closures)) assert.ok(v >= 0 && v <= 1);
  }
});

test("projection is deterministic and does not mutate the live state", () => {
  const s = createState("outpost");
  step(s, 3600 * 5);
  const snapshot = JSON.stringify(s);
  const a = project(s, 200);
  const b = project(s, 200);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(s), snapshot);
});

test("dust accumulates and cleaning restores the arrays", () => {
  const s = createState("solar");
  step(s, SOL_SECONDS * 50);
  near(s.dust, 1 - 50 * p("dustLossPerSol"), 1e-6);
  cleanPanels(s);
  assert.equal(s.dust, 1);
});

test("storm optical depth ramps up inside the storm window", () => {
  const cfg = { tau: 0.5, storm: { startSol: 2, endSol: 70, tau: 4.5 } };
  near(opticalDepth(cfg, 0), 0.5, 1e-9); // sol 1
  near(opticalDepth(cfg, 30), 4.5, 1e-9);
  near(opticalDepth(cfg, 100), 0.5, 1e-9);
});

test("shrinking the battery clamps the stored charge", () => {
  const s = createState("outpost");
  applyConfig(s, { batteryKWh: 100 });
  assert.ok(s.stores.battery <= 100);
});

test("a starving settlement fails with the right limiting resource", () => {
  const s = createState("outpost");
  s.stores.food = 1000;
  s.config.greenhouseArea = 0;
  const pr = project(s, 50);
  assert.equal(pr.survives, false);
  assert.equal(pr.limiting, "Food");
  assert.ok(pr.sols < 1);
});
