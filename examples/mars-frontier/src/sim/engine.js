/**
 * Settlement resource simulation. Pure data in, pure data out — no rendering, no DOM.
 * All rates are expressed per sol (kg/sol, kcal/sol) and power in kW.
 */
import { p, SOL_SECONDS } from "./constants.js";
import { getScenario } from "./scenarios.js";

const MAX_SUBSTEP = 600; // seconds
const DEG = Math.PI / 180;

/** Shed first → shed last. Habitat life support and comms are never shed. */
export const LOAD_PRIORITY = ["greenhouseLights", "waterExtraction", "isruO2", "lab", "recycler"];

export const LOAD_LABELS = {
  habitat: "Habitat life support",
  comms: "Communications",
  recycler: "Water recycler",
  lab: "Science lab",
  isruO2: "O₂ production (ISRU)",
  waterExtraction: "Ice extraction",
  greenhouseLights: "Greenhouse lighting",
};

export function createState(scenarioId = "outpost") {
  const sc = getScenario(scenarioId);
  const config = structuredCloneSafe(sc.config);
  return {
    version: 2,
    scenarioId: sc.id,
    t: 0,
    startFrac: 0.3, // sol 1 begins at ~07:12 local
    config,
    initialStores: { ...sc.stores },
    stores: { ...sc.stores, battery: config.batteryKWh * 0.8 },
    systems: {
      greenhouseLights: true,
      isruO2: true,
      waterExtraction: true,
      recycler: true,
      conservation: false,
    },
    dust: 1,
    flows: null,
    avg: null,
    shed: {},
    powerDeficit: false,
    deficitHours: 0,
    nominalSeconds: 0,
    failed: null,
    events: [],
    wasShedding: false,
    wasStorm: false,
  };
}

function structuredCloneSafe(o) {
  return JSON.parse(JSON.stringify(o));
}

// ── Time & sun ───────────────────────────────────────────────

export function solFraction(state) {
  return state.t / SOL_SECONDS + state.startFrac;
}
export function solNumber(state) {
  return Math.floor(solFraction(state)) + 1;
}
export function localTime(state) {
  const f = solFraction(state);
  return f - Math.floor(f);
}
/** Local time as "HH:MM" on a 24 Mars-hour clock (LMST-style). */
export function clockString(state) {
  const minutes = Math.floor(localTime(state) * 24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Sun direction in world space for a time-of-day fraction (0 = midnight).
 * World axes: +x east, +y up, −z north.
 */
export function sunVector(timeFrac, latDeg = p("latitude"), decDeg = p("declination")) {
  const H = (timeFrac - 0.5) * 2 * Math.PI;
  const lat = latDeg * DEG;
  const dec = decDeg * DEG;
  const east = -Math.cos(dec) * Math.sin(H);
  const north = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H);
  const up = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(H);
  return { x: east, y: up, z: -north };
}

/** Atmospheric dust optical depth; storms ramp in and out over 3 sols. */
export function opticalDepth(config, fracSol) {
  const s = config.storm;
  if (!s) return config.tau;
  const sol = fracSol + 1;
  const ramp =
    Math.min(1, Math.max(0, (sol - s.startSol) / 3)) *
    Math.min(1, Math.max(0, (s.endSol - sol) / 3));
  return config.tau + (s.tau - config.tau) * ramp;
}

// ── Flows ────────────────────────────────────────────────────

export function computePower(state) {
  const c = state.config;
  const s = state.systems;
  const frac = solFraction(state);
  const sun = sunVector(frac - Math.floor(frac));
  const tau = opticalDepth(c, frac);
  const transmission = Math.exp(-p("atmosphericK") * tau);
  const solarKW =
    c.solarArea *
    p("solarConstant") *
    transmission *
    p("panelEfficiency") *
    state.dust *
    p("trackingGain") *
    Math.max(0, sun.y);
  const fissionKW = c.fissionUnits * p("fissionUnitKW");
  const cons = s.conservation ? p("conservationFactor") : 1;
  const demand = {
    habitat: (p("habitatBaseKW") + p("habitatPerCrewKW") * c.crew) * cons,
    comms: p("commsKW"),
    recycler: s.recycler ? p("recyclerBaseKW") + p("recyclerPerCrewKW") * c.crew : 0,
    lab: s.conservation ? 0 : p("labKW"),
    isruO2: s.isruO2 ? c.isruUnits * p("isruO2KW") : 0,
    waterExtraction: s.waterExtraction ? p("waterExtractorKW") : 0,
    greenhouseLights: s.greenhouseLights ? c.greenhouseArea * p("greenhouseLightKW") : 0,
  };
  return { sun, tau, transmission, solarKW, fissionKW, genKW: solarKW + fissionKW, demand };
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

/** Advance by dt seconds without substepping. */
function advance(state, dt) {
  const dtH = dt / 3600;
  const dtSol = dt / SOL_SECONDS;
  const c = state.config;
  const st = state.stores;
  const pw = computePower(state);
  const demandKW = sum(pw.demand);

  // ── Power dispatch with priority load shedding ──
  const loads = { ...pw.demand };
  const shed = {};
  let loadKW = demandKW;
  for (const key of LOAD_PRIORITY) {
    if ((loadKW - pw.genKW) * dtH <= st.battery) break;
    if (loads[key] > 0) {
      shed[key] = true;
      loadKW -= loads[key];
      loads[key] = 0;
    }
  }
  const netKW = pw.genKW - loadKW;
  let curtailedKW = 0;
  let powerDeficit = false;
  if (netKW >= 0) {
    const room = c.batteryKWh - st.battery;
    const charge = netKW * dtH * p("batteryEfficiency");
    if (charge > room) curtailedKW = (charge - room) / dtH / p("batteryEfficiency");
    st.battery = Math.min(c.batteryKWh, st.battery + charge);
  } else {
    const need = -netKW * dtH;
    if (need <= st.battery) {
      st.battery -= need;
    } else {
      st.battery = 0;
      powerDeficit = true;
    }
  }
  st.battery = Math.min(Math.max(st.battery, 0), c.batteryKWh);

  const active = (k) => pw.demand[k] > 0 && !shed[k];
  const lightFactor = active("greenhouseLights") ? 1 : p("naturalLightFactor");
  const gh = c.greenhouseArea;

  // ── Resource flows (per sol) ──
  const o2Prod =
    (active("isruO2") ? c.isruUnits * p("isruO2Rate") : 0) + gh * p("greenhouseO2") * lightFactor;
  const o2Use = c.crew * p("o2PerCrew") + p("o2Leak");
  const waterGross = c.crew * p("waterPerCrew") + gh * p("greenhouseWaterLoss");
  const waterRecovered = active("recycler") ? c.crew * p("waterPerCrew") * c.waterRecovery : 0;
  const waterExtracted = active("waterExtraction") ? p("waterExtractorRate") : 0;
  const foodProd = gh * p("greenhouseYield") * lightFactor;
  const foodUse = c.crew * p("foodPerCrew");

  st.o2 = clamp(st.o2 + (o2Prod - o2Use) * dtSol, 0, p("o2Capacity"));
  st.water = clamp(st.water + (waterRecovered + waterExtracted - waterGross) * dtSol, 0, p("waterCapacity"));
  st.food = Math.max(0, st.food + (foodProd - foodUse) * dtSol);
  state.dust = Math.max(0.3, state.dust - p("dustLossPerSol") * dtSol);

  const flows = {
    sunY: pw.sun.y,
    tau: pw.tau,
    transmission: pw.transmission,
    solarKW: pw.solarKW,
    fissionKW: pw.fissionKW,
    genKW: pw.genKW,
    demandKW,
    servedKW: loadKW,
    netKW,
    curtailedKW,
    loads,
    demand: pw.demand,
    o2Prod,
    o2Use,
    waterGross,
    waterRecovered,
    waterExtracted,
    foodProd,
    foodUse,
    lightFactor,
  };
  state.flows = flows;
  state.shed = shed;
  state.powerDeficit = powerDeficit;

  // Sol-scale exponential moving averages for closure metrics.
  const keys = ["genKW", "demandKW", "o2Prod", "o2Use", "waterGross", "waterRecovered", "waterExtracted", "foodProd", "foodUse"];
  if (!state.avg) {
    state.avg = {};
    for (const k of keys) state.avg[k] = flows[k];
    // Seed power with a sol-average estimate so day 1 doesn't read as 0% or 300%.
    state.avg.genKW = pw.fissionKW + estimateMeanSolarKW(state);
  } else {
    const a = 1 - Math.exp(-dtSol);
    for (const k of keys) state.avg[k] += (flows[k] - state.avg[k]) * a;
  }

  // ── Survival bookkeeping ──
  state.deficitHours = powerDeficit ? state.deficitHours + dtH : 0;
  const anyShed = Object.keys(shed).length > 0;
  state.nominalSeconds = !anyShed && !powerDeficit && st.o2 > 0 && st.water > 0 && st.food > 0
    ? state.nominalSeconds + dt
    : 0;

  state.t += dt;

  if (!state.failed) {
    let reason = null;
    if (st.o2 <= 0) reason = "Oxygen";
    else if (st.water <= 0) reason = "Water";
    else if (st.food <= 0) reason = "Food";
    else if (state.deficitHours > p("maxDeficitHours")) reason = "Power";
    if (reason) {
      state.failed = { reason, sol: solNumber(state) };
      pushEvent(state, "critical", `${reason} exhausted — settlement can no longer sustain the crew.`);
    }
  }
  if (anyShed && !state.wasShedding) {
    pushEvent(state, "caution", `Load shedding: ${Object.keys(shed).map((k) => LOAD_LABELS[k]).join(", ")}.`);
  } else if (!anyShed && state.wasShedding) {
    pushEvent(state, "info", "Power restored — all loads back online.");
  }
  state.wasShedding = anyShed;
  const storm = pw.tau > 2;
  if (storm && !state.wasStorm) pushEvent(state, "caution", `Dust storm: optical depth τ ${pw.tau.toFixed(1)} and rising.`);
  if (!storm && state.wasStorm) pushEvent(state, "info", "Dust storm has cleared.");
  state.wasStorm = storm;
}

function estimateMeanSolarKW(state) {
  const c = state.config;
  // Sol-mean of max(0, sin elevation) at equinox ≈ cos(lat)/π.
  const meanSin = Math.cos(p("latitude") * DEG) / Math.PI;
  return (
    c.solarArea *
    p("solarConstant") *
    Math.exp(-p("atmosphericK") * opticalDepth(c, solFraction(state))) *
    p("panelEfficiency") *
    state.dust *
    p("trackingGain") *
    meanSin
  );
}

export function step(state, dtSeconds) {
  let remaining = dtSeconds;
  while (remaining > 1e-6) {
    const h = Math.min(remaining, MAX_SUBSTEP);
    advance(state, h);
    remaining -= h;
  }
  return state;
}

function pushEvent(state, level, text) {
  state.eventSeq = (state.eventSeq ?? 0) + 1;
  state.events.push({ id: state.eventSeq, t: state.t, sol: solNumber(state), clock: clockString(state), level, text });
  if (state.events.length > 80) state.events.shift();
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ── Actions ──────────────────────────────────────────────────

export function setSystem(state, key, on) {
  if (!(key in state.systems)) return;
  state.systems[key] = !!on;
}

export function cleanPanels(state) {
  state.dust = 1;
  pushEvent(state, "info", "Solar arrays cleaned — full output restored.");
}

export function applyConfig(state, patch) {
  Object.assign(state.config, patch);
  state.stores.battery = Math.min(state.stores.battery, state.config.batteryKWh);
}

export function logEvent(state, level, text) {
  pushEvent(state, level, text);
}

// ── Analysis ─────────────────────────────────────────────────

export function reserveStatus(reserveSols) {
  if (reserveSols === Infinity || reserveSols >= 60) return "nominal";
  if (reserveSols >= 15) return "caution";
  if (reserveSols > 0) return "critical";
  return "depleted";
}

function resource(store, prod, use, cap) {
  const net = prod - use;
  const reserve = store <= 0 ? 0 : net >= -1e-9 ? Infinity : store / -net;
  return {
    store,
    cap,
    prod,
    use,
    net,
    closure: use > 0 ? prod / use : 1,
    reserve,
    status: reserveStatus(reserve),
  };
}

export function summarize(state) {
  const a = state.avg;
  const st = state.stores;
  const c = state.config;
  if (!a) return null;
  const o2 = resource(st.o2, a.o2Prod, a.o2Use, p("o2Capacity"));
  const water = resource(st.water, a.waterRecovered + a.waterExtracted, a.waterGross, p("waterCapacity"));
  const food = resource(st.food, a.foodProd, a.foodUse, null);
  const powerClosure = a.demandKW > 0 ? a.genKW / a.demandKW : 1;
  const soc = c.batteryKWh > 0 ? st.battery / c.batteryKWh : 0;
  const shedKeys = Object.keys(state.shed);
  let powerStatus = "nominal";
  if (state.powerDeficit) powerStatus = "critical";
  else if (shedKeys.length) powerStatus = "caution";
  else if (powerClosure < 1 && soc < 0.35) powerStatus = "caution";
  const power = {
    gen: a.genKW,
    demand: a.demandKW,
    closure: powerClosure,
    soc,
    status: powerStatus,
    shed: shedKeys,
    deficit: state.powerDeficit,
  };
  const cap1 = (x) => Math.max(0, Math.min(1, x));
  const closures = {
    o2: cap1(o2.closure),
    water: cap1(water.closure),
    food: cap1(food.closure),
    power: cap1(powerClosure),
  };
  const limitingKey = Object.entries(closures).sort((x, y) => x[1] - y[1])[0][0];
  const autonomy = Math.min(...Object.values(closures));

  const warnings = [];
  const label = { o2: "Oxygen", water: "Water", food: "Food" };
  for (const [k, r] of Object.entries({ o2, water, food })) {
    if (r.status === "critical" || r.status === "depleted")
      warnings.push({ level: "critical", text: `${label[k]} reserve critical — ${fmtSols(r.reserve)} remaining.` });
    else if (r.status === "caution")
      warnings.push({ level: "caution", text: `${label[k]} reserve below 60 sols (${fmtSols(r.reserve)}).` });
  }
  if (state.powerDeficit)
    warnings.push({ level: "critical", text: "Power deficit — life support running on borrowed time." });
  else if (shedKeys.length)
    warnings.push({ level: "caution", text: `Load shedding active: ${shedKeys.map((k) => LOAD_LABELS[k]).join(", ")}.` });
  if (state.dust < 0.85)
    warnings.push({ level: "caution", text: `Solar arrays at ${Math.round(state.dust * 100)}% — dispatch the rover to clean them.` });
  if (state.flows && state.flows.tau > 2)
    warnings.push({ level: "caution", text: `Dust storm in progress (τ ${state.flows.tau.toFixed(1)}).` });

  return {
    o2,
    water,
    food,
    power,
    closures,
    autonomy,
    limitingKey,
    warnings,
    nominal: warnings.length === 0,
  };
}

export function fmtSols(r) {
  if (r === Infinity) return "sustained";
  if (r > 9999) return ">9,999 sols";
  return `${Math.round(r).toLocaleString("en-US")} sols`;
}

/** Strip transient fields for persistence / projection. */
export function serialize(state) {
  const { flows: _f, events, ...rest } = state;
  return JSON.parse(JSON.stringify({ ...rest, events: events.slice(-40) }));
}

/**
 * Projection: fast-forward a copy of the settlement with the current configuration and no
 * operator intervention (no resupply, no panel cleaning) for up to one synodic period.
 */
export function project(state, horizonSols = 760, stepHours = 2) {
  if (state.failed) return { survives: false, sols: 0, limiting: state.failed.reason };
  const sim = serialize(state);
  sim.events = [];
  sim.flows = null;
  const start = sim.t;
  const end = start + horizonSols * SOL_SECONDS;
  const dt = stepHours * 3600;
  while (sim.t < end) {
    advance(sim, dt);
    if (sim.failed) {
      return { survives: false, sols: (sim.t - start) / SOL_SECONDS, limiting: sim.failed.reason };
    }
  }
  return { survives: true, sols: horizonSols, limiting: null };
}
