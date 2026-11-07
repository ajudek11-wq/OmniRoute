import { ICONS } from "./icons.js";
import { STRUCTURE_INFO, SYSTEM_LABELS } from "../data/structures.js";
import { MISSIONS } from "../game/missions.js";
import { SCENARIOS, CONFIG_LIMITS } from "../sim/scenarios.js";
import { PARAMS, CATEGORIES } from "../sim/constants.js";
import { fmtSols, LOAD_LABELS } from "../sim/engine.js";
import { SURVEY_SITES } from "../data/layout.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (v) => `${Math.round(v * 100)}%`;
const num = (v, d = 0) => v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const signed = (v, d = 1) => `${v >= 0 ? "+" : "−"}${num(Math.abs(v), d)}`;
const STATUS_TEXT = { nominal: "Nominal", caution: "Caution", critical: "Critical", depleted: "Depleted" };

function teleTable(rows, bindPrefix) {
  return `<div class="tele">${rows
    .map(
      ([k], i) =>
        `<div class="tele-row"><span class="k">${esc(k)}</span><span class="v" data-bind="${bindPrefix}${i}"></span></div>`
    )
    .join("")}</div>`;
}

function teleBinds(app, rowsFn, prefix, count) {
  const binds = {};
  for (let i = 0; i < count; i++) {
    binds[`${prefix}${i}`] = () => {
      const row = rowsFn()[i];
      if (!row) return "";
      return { text: row[1], cls: row[2] ?? "" };
    };
  }
  return binds;
}

function toggleRow(key) {
  const s = SYSTEM_LABELS[key];
  return `<button class="toggle" role="switch" data-action="toggle-system" data-key="${key}" data-bind="sw-${key}">
    <div><div class="t-label">${esc(s.label)}</div><div class="t-hint" data-bind="swh-${key}">${esc(s.hint)}</div></div>
    <span class="switch"></span></button>`;
}

function toggleBinds(app, keys) {
  const binds = {};
  for (const key of keys) {
    binds[`sw-${key}`] = () => ({
      checked: app.sim.systems[key],
      cls: app.sim.shed[key] ? "shed" : "",
    });
    binds[`swh-${key}`] = () =>
      app.sim.shed[key] ? "Shed: not enough power" : SYSTEM_LABELS[key].hint;
  }
  return binds;
}

// ── Structure inspector ─────────────────────────────────────

export function structureView(app, id) {
  const info = STRUCTURE_INFO[id];
  const ctx = () => ({ sim: app.sim, summary: app.summary, app, rover: app.rover });
  const rows = info.telemetry(ctx());
  const systems = info.systems ?? [];
  const actions = info.actions ?? [];
  return {
    key: `structure:${id}`,
    eyebrow: info.eyebrow,
    title: info.name,
    html: `
      <p>${esc(info.blurb)}</p>
      <div class="section-title">Live telemetry</div>
      ${teleTable(rows, "t")}
      ${systems.length ? `<div class="section-title">Systems</div>${systems.map(toggleRow).join("")}` : ""}
      <div class="btn-row">
        ${actions.map((a) => `<button class="btn primary" data-action="${a.id}" data-bind="act-${a.id}">${esc(a.label)}</button>`).join("")}
        <button class="btn" data-action="focus" data-kind="structure" data-id="${id}"><i>${ICONS.target}</i>Focus view</button>
      </div>
      <div class="section-title">Field notes</div>
      <ul class="facts">${info.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`,
    binds: {
      ...teleBinds(app, () => info.telemetry(ctx()), "t", rows.length),
      ...toggleBinds(app, systems),
      "act-clean-panels": () => ({
        text: app.roverBusy() ? "Rover busy…" : app.sim.dust > 0.995 ? "Arrays are clean" : "Dispatch rover to clean arrays",
        disabled: app.roverBusy() || app.sim.dust > 0.995,
      }),
      "act-send-report": () => ({
        text: app.reportCooldown > 0 ? "Transmitting…" : "Transmit status report to Earth",
        disabled: app.reportCooldown > 0,
      }),
      "act-rover-home": () => ({ disabled: app.roverAtHome() && !app.rover.target }),
    },
  };
}

export function siteView(app, id) {
  const site = SURVEY_SITES.find((s) => s.id === id);
  const done = () => app.surveyed.has(id);
  const dist = () => Math.hypot(app.rover.pos.x - site.x, app.rover.pos.z - site.z);
  return {
    key: `site:${id}`,
    eyebrow: `Survey target · ${site.subtitle}`,
    title: site.name,
    html: `
      <p data-bind="desc"></p>
      ${teleTable([["Status"], ["Distance from rover"], ["Coordinates"]], "s")}
      <div class="btn-row">
        <button class="btn primary" data-action="survey" data-id="${id}" data-bind="go"></button>
        <button class="btn" data-action="focus" data-kind="site" data-id="${id}"><i>${ICONS.target}</i>Focus view</button>
      </div>`,
    binds: {
      desc: () =>
        done()
          ? site.finding
          : "An unsurveyed site flagged from orbital imagery. Send the rover to collect close-up imaging and spectra.",
      s0: () => {
        if (done()) return { text: "Surveyed", cls: "nominal" };
        if (app.roverTask?.site === id) return { text: app.roverTask.phase === "survey" ? "Surveying…" : "Rover en route", cls: "caution" };
        return { text: "Awaiting survey", cls: "" };
      },
      s1: () => `${num(dist())} m`,
      s2: () => `${num(site.x)} E · ${num(-site.z)} N (m)`,
      go: () => ({
        text: done() ? "Survey complete" : app.roverTask?.site === id ? "Rover dispatched" : "Send rover to survey",
        disabled: done() || app.roverBusy(),
      }),
    },
  };
}

export function roverView(app) {
  const r = app.rover;
  return {
    key: "rover",
    eyebrow: "Exploration rover · FR-1",
    title: "Rover Telemetry",
    html: `
      <p>A six-wheel rocker-bogie rover with a mast camera, arm-mounted spectrometer and high-gain antenna. In Rover view, tap the ground to drive.</p>
      ${teleTable([["Task"], ["Speed"], ["Heading"], ["Pitch / roll"], ["Odometer"], ["Battery"], ["Position"]], "r")}
      <div class="btn-row">
        <button class="btn primary" data-action="mode" data-mode="rover"><i>${ICONS.rover}</i>Rover view</button>
        <button class="btn" data-action="rover-home" data-bind="home">Return to garage</button>
      </div>`,
    binds: {
      r0: () => r.task,
      r1: () => `${r.speed.toFixed(1)} m/s`,
      r2: () => `${Math.round(r.telemetry().heading)}°`,
      r3: () => {
        const t = r.telemetry();
        return `${t.pitch.toFixed(1)}° / ${t.roll.toFixed(1)}°`;
      },
      r4: () => `${num(r.odometer)} m`,
      r5: () => ({ text: pct(r.battery), cls: r.battery < 0.25 ? "caution" : "" }),
      r6: () => `${num(r.pos.x)} E · ${num(-r.pos.z)} N`,
      home: () => ({ disabled: app.roverAtHome() && !r.target }),
    },
  };
}

// ── Systems overview ────────────────────────────────────────

function resCard(key, icon, title) {
  return `<div class="res-card">
    <div class="res-card-top"><i>${ICONS[icon]}</i><b>${title}</b><span class="badge" data-bind="${key}-badge"></span></div>
    <div class="res-grid">
      <div><div class="k">STORED</div><div class="v" data-bind="${key}-store"></div></div>
      <div><div class="k">NET / SOL</div><div class="v" data-bind="${key}-net"></div></div>
      <div><div class="k">RESERVE</div><div class="v" data-bind="${key}-res"></div></div>
    </div>
    <canvas class="spark" data-spark="${key}"></canvas>
  </div>`;
}

const STACK_COLORS = {
  habitat: "#e2733a",
  greenhouseLights: "#c86fd8",
  isruO2: "#74b9de",
  waterExtraction: "#5aa6a8",
  recycler: "#6cc58d",
  lab: "#e7a94f",
  comms: "#a59a90",
};

export function systemsView(app) {
  const s = () => app.summary;
  const resBinds = (key, unit, fmtStore) => ({
    [`${key}-badge`]: () => ({ text: STATUS_TEXT[s()[key].status], cls: s()[key].status }),
    [`${key}-store`]: () => fmtStore(s()[key].store),
    [`${key}-net`]: () => ({ text: `${signed(s()[key].net, key === "food" ? 0 : 1)}${unit}`, cls: s()[key].net < 0 ? "caution" : "" }),
    [`${key}-res`]: () => ({ text: fmtSols(s()[key].reserve), cls: s()[key].status }),
  });
  return {
    key: "systems",
    eyebrow: "Settlement systems",
    title: "Life Support & Power",
    html: `
      <div class="hero">
        <div class="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" stroke="rgba(255,255,255,0.08)" stroke-width="8" fill="none"/>
          <circle data-bind="ring" cx="50" cy="50" r="42" stroke="url(#rg)" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="264" stroke-dashoffset="264"/>
          <defs><linearGradient id="rg"><stop offset="0" stop-color="#e2733a"/><stop offset="1" stop-color="#e7a94f"/></linearGradient></defs></svg>
          <div class="ring-val"><div><span data-bind="auto"></span><small>AUTONOMY</small></div></div></div>
        <div>
          <div class="hero-k">LIMITING LOOP</div>
          <div class="hero-v" data-bind="limit"></div>
          <div class="hero-k">PROJECTED ENDURANCE</div>
          <div class="hero-v" data-bind="proj"></div>
        </div>
      </div>
      <p class="fine" style="margin-top:6px">Autonomy is the weakest loop's closure: local production ÷ consumption. Endurance fast-forwards today's configuration with no resupply and no operator action. <a href="#" data-action="methodology" style="color:var(--blue)">How this is calculated</a></p>
      <div class="section-title">Alerts</div>
      <div data-bind="warn"></div>
      <div class="section-title">Power</div>
      <div class="res-card">
        <div class="res-card-top"><i>${ICONS.power}</i><b>Generation vs load</b><span class="badge" data-bind="pw-badge"></span></div>
        <div class="res-grid">
          <div><div class="k">SOLAR</div><div class="v" data-bind="pw-solar"></div></div>
          <div><div class="k">FISSION</div><div class="v" data-bind="pw-fission"></div></div>
          <div><div class="k">LOAD</div><div class="v" data-bind="pw-load"></div></div>
          <div><div class="k">BATTERY</div><div class="v" data-bind="pw-soc"></div></div>
          <div><div class="k">SOL AVG GEN</div><div class="v" data-bind="pw-avg"></div></div>
          <div><div class="k">CLOSURE</div><div class="v" data-bind="pw-cl"></div></div>
        </div>
        <div class="stack" data-bind="stack"></div>
        <div class="legend" data-bind="legend"></div>
        <canvas class="spark" data-spark="battery"></canvas>
      </div>
      <div class="section-title">Resources</div>
      ${resCard("o2", "o2", "Oxygen")}
      ${resCard("water", "water", "Water")}
      ${resCard("food", "food", "Food")}
      <div class="section-title">Operations</div>
      ${["greenhouseLights", "isruO2", "waterExtraction", "recycler", "conservation"].map(toggleRow).join("")}
    `,
    binds: {
      ring: (el) => {
        el.setAttribute("stroke-dashoffset", String(264 * (1 - s().autonomy)));
        return null;
      },
      auto: () => pct(s().autonomy),
      limit: () => ({ o2: "Oxygen", water: "Water", food: "Food", power: "Power" })[s().limitingKey] + ` · ${pct(s().closures[s().limitingKey])} closed`,
      proj: () => {
        const p = app.projection;
        if (!p) return "Calculating…";
        if (p.survives) return { text: "Survives to next resupply (760 sols)", cls: "st-ok" };
        return { text: `${num(p.sols)} sols · ${p.limiting} runs out`, cls: p.sols < 60 ? "st-critical" : "st-caution" };
      },
      warn: () => ({
        html: s().warnings.length
          ? s().warnings.map((w) => `<div class="warn ${w.level}">${esc(w.text)}</div>`).join("")
          : `<div class="ok">All systems nominal.</div>`,
      }),
      "pw-badge": () => ({ text: STATUS_TEXT[s().power.status], cls: s().power.status }),
      "pw-solar": () => `${num(app.sim.flows.solarKW, 1)} kW`,
      "pw-fission": () => `${num(app.sim.flows.fissionKW, 1)} kW`,
      "pw-load": () => `${num(app.sim.flows.servedKW, 1)} kW`,
      "pw-soc": () => ({ text: pct(s().power.soc), cls: s().power.soc < 0.2 ? "critical" : s().power.soc < 0.4 ? "caution" : "" }),
      "pw-avg": () => `${num(s().power.gen, 1)} kW`,
      "pw-cl": () => ({ text: pct(s().power.closure), cls: s().power.closure < 1 ? "caution" : "nominal" }),
      stack: () => {
        const loads = app.sim.flows.demand;
        const total = Math.max(app.sim.flows.demandKW, app.sim.flows.genKW, 1);
        return {
          html: Object.entries(loads)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `<span style="width:${(v / total) * 100}%;background:${STACK_COLORS[k]};opacity:${app.sim.shed[k] ? 0.25 : 1}"></span>`)
            .join(""),
        };
      },
      legend: () => ({
        html: Object.entries(app.sim.flows.demand)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `<span><i style="background:${STACK_COLORS[k]}"></i>${LOAD_LABELS[k]} ${num(v, 1)}${app.sim.shed[k] ? " (shed)" : ""}</span>`)
          .join(""),
      }),
      ...resBinds("o2", " kg", (v) => `${num(v)} kg`),
      ...resBinds("water", " kg", (v) => `${num(v)} kg`),
      ...resBinds("food", " kcal", (v) => `${num(v / app.sim.config.crew / 2700)} crew-sols`),
      ...toggleBinds(app, ["greenhouseLights", "isruO2", "waterExtraction", "recycler", "conservation"]),
    },
    after2: (body) => drawSparks(app, body),
  };
}

function drawSparks(app, body) {
  for (const c of body.querySelectorAll("canvas[data-spark]")) {
    const key = c.dataset.spark;
    const data = app.history[key];
    if (!data || data.length < 2) continue;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w) continue;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    let min = Math.min(...data);
    let max = Math.max(...data);
    if (key === "battery") {
      min = 0;
      max = 1;
    }
    if (max - min < 1e-6) {
      max += 1;
      min -= 1;
    }
    const x = (i) => (i / (data.length - 1)) * w;
    const y = (v) => h - 3 - ((v - min) / (max - min)) * (h - 6);
    const grad = g.createLinearGradient(0, 0, 0, h);
    const col = key === "battery" ? "231,169,79" : "116,185,222";
    grad.addColorStop(0, `rgba(${col},0.28)`);
    grad.addColorStop(1, `rgba(${col},0)`);
    g.beginPath();
    data.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    g.fillStyle = grad;
    g.fill();
    g.beginPath();
    data.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
    g.strokeStyle = `rgba(${col},0.95)`;
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = "rgba(244,237,231,0.38)";
    g.font = "10px ui-monospace, monospace";
    g.fillText(key === "battery" ? "BATTERY · last 5 sols" : "last 5 sols", 2, 10);
  }
}

// ── Missions ────────────────────────────────────────────────

export function missionsView(app) {
  const mm = app.missions;
  const render = () => {
    const current = mm.current;
    return MISSIONS.map((m, i) => {
      const st = mm.state[m.id];
      const cls = st.done ? "done" : current?.id === m.id ? "current" : "";
      const steps = m.steps
        ? `<div class="steps">${m.steps.map((s) => `<span class="${st.progress[s] ? "on" : ""}">${s}</span>`).join("")}</div>`
        : "";
      return `<div class="mission ${cls}">
        <div class="m-icon">${st.done ? ICONS.check : i + 1}</div>
        <div><div class="m-title">${esc(m.title)}</div><div class="m-brief">${esc(m.brief)}</div>
          ${!st.done && current?.id === m.id ? `<div class="m-hint">${esc(m.hint)}</div>` : ""}${steps}</div>
        ${!st.done && m.focus ? `<button class="m-go" data-action="mission-go" data-id="${m.id}" aria-label="Locate">${ICONS.locate}</button>` : "<span></span>"}
      </div>`;
    }).join("");
  };
  return {
    key: "missions",
    eyebrow: "Exploration",
    title: "Mission Board",
    html: `
      <div class="progress"><div class="progress-bar"><span data-bind="bar"></span></div><span class="progress-n" data-bind="n"></span></div>
      <div data-bind="list"></div>
      <p class="fine">Missions can be completed in any order. Completing them unlocks entries in the Log.</p>`,
    binds: {
      bar: () => ({ width: `${(mm.doneCount / MISSIONS.length) * 100}%` }),
      n: () => `${mm.doneCount} / ${MISSIONS.length}`,
      list: () => ({ html: render() }),
    },
  };
}

// ── Scenario & configuration ────────────────────────────────

function sliderValue(key, v) {
  if (key === "waterRecovery") return `${Math.round(v * 100)}%`;
  if (key === "tau") return v.toFixed(1);
  const L = CONFIG_LIMITS[key];
  return `${num(v)}${L.unit ? ` ${L.unit}` : ""}`;
}

export function sliderFill(el) {
  const p = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty("--p", `${p}%`);
}

export function scenarioView(app) {
  const cfg = app.sim.config;
  return {
    key: "scenario",
    eyebrow: "Mission planning",
    title: "Scenario & Design",
    html: `
      <p>Choose a scenario to restart the settlement, or redesign the current one live with the controls below. Changes feed straight into the projection.</p>
      <div class="scenarios">${SCENARIOS.map(
        (s) => `<button class="scn ${s.id === app.sim.scenarioId ? "active" : ""}" data-action="scenario" data-id="${s.id}">
          <b>${esc(s.name)}</b><span class="tag">${esc(s.tagline)}</span><div class="d">${esc(s.description)}</div></button>`
      ).join("")}</div>
      <div class="section-title">Live design</div>
      <div class="res-card" style="margin-bottom:6px"><div class="res-grid">
        <div><div class="k">AUTONOMY</div><div class="v" data-bind="auto"></div></div>
        <div><div class="k">ENDURANCE</div><div class="v" data-bind="proj"></div></div>
        <div><div class="k">LIMITING</div><div class="v" data-bind="lim"></div></div>
      </div></div>
      ${Object.entries(CONFIG_LIMITS)
        .map(
          ([key, L]) => `<div class="slider"><div class="slider-top"><span>${esc(L.label)}</span><output data-out="${key}">${sliderValue(key, cfg[key])}</output></div>
          <input type="range" min="${L.min}" max="${L.max}" step="${L.step}" value="${cfg[key]}" data-input="config" data-key="${key}" aria-label="${esc(L.label)}"/></div>`
        )
        .join("")}
      <div class="btn-row"><button class="btn" data-action="scenario" data-id="${app.sim.scenarioId}">Reset this scenario</button></div>
      <p class="fine" style="margin-top:12px">Solar field visuals show up to ${app.maxPanels} modules. Storm timing is fixed by the scenario.</p>`,
    after: (body) => body.querySelectorAll('input[type="range"]').forEach(sliderFill),
    binds: {
      auto: () => pct(app.summary.autonomy),
      proj: () => (app.projection ? (app.projection.survives ? "760+ sols" : `${num(app.projection.sols)} sols`) : "…"),
      lim: () => (app.projection?.limiting ?? "—"),
    },
  };
}

export function updateSliderOutput(el) {
  const key = el.dataset.key;
  const out = el.closest(".slider").querySelector("output");
  out.textContent = sliderValue(key, Number(el.value));
  sliderFill(el);
}

// ── Log ─────────────────────────────────────────────────────

export function logView(app) {
  return {
    key: "log",
    eyebrow: "Records",
    title: "Mission Log",
    html: `<div class="section-title" style="margin-top:4px">Discoveries</div>
      <div data-bind="codex"></div>
      <div class="section-title">Settlement events</div>
      <div data-bind="events"></div>`,
    binds: {
      codex: () => {
        const done = MISSIONS.filter((m) => app.missions.state[m.id].done);
        const sites = SURVEY_SITES.filter((s) => app.surveyed.has(s.id));
        if (!done.length && !sites.length) return { html: `<p class="fine">Complete missions and surveys to unlock discoveries.</p>` };
        return {
          html:
            sites.map((s) => `<div class="codex"><b>${esc(s.name)} · ${esc(s.subtitle)}</b><p>${esc(s.finding)}</p></div>`).join("") +
            done.map((m) => `<div class="codex"><b>${esc(m.title)}</b><p>${esc(m.codex)}</p></div>`).join(""),
        };
      },
      events: () => ({
        html:
          app.sim.events
            .slice()
            .reverse()
            .slice(0, 40)
            .map((e) => `<div class="log-item ${e.level}"><span class="when">SOL ${e.sol}<br>${e.clock}</span><span class="what">${esc(e.text)}</span></div>`)
            .join("") || `<p class="fine">No events yet.</p>`,
      }),
    },
  };
}

// ── Settings ────────────────────────────────────────────────

export function settingsView(app) {
  const st = app.settings;
  const seg = (name, options, value) =>
    `<div class="seg">${options.map(([v, l]) => `<button class="${v === value ? "active" : ""}" data-action="setting" data-name="${name}" data-value="${v}">${l}</button>`).join("")}</div>`;
  return {
    key: "settings",
    eyebrow: "Preferences",
    title: "Settings",
    html: `
      <div class="setting"><label>Render quality · currently ${esc(app.quality.name)}</label>
        ${seg("quality", [["auto", "Auto"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]], st.quality)}
        <p class="fine" style="margin-top:6px">Changing quality reloads the scene; your settlement is saved.</p></div>
      <button class="toggle" role="switch" data-action="setting-toggle" data-name="sound" data-bind="sw-sound"><div><div class="t-label">Ambient sound</div><div class="t-hint">Wind, habitat hum and interface cues</div></div><span class="switch"></span></button>
      <div class="setting"><label>Volume</label><input type="range" min="0" max="1" step="0.05" value="${st.volume}" data-input="volume" aria-label="Volume"/></div>
      <button class="toggle" role="switch" data-action="setting-toggle" data-name="labels" data-bind="sw-labels"><div><div class="t-label">Structure labels</div><div class="t-hint">Floating names on buildings and sites</div></div><span class="switch"></span></button>
      <button class="toggle" role="switch" data-action="setting-toggle" data-name="reduceMotion" data-bind="sw-reduceMotion"><div><div class="t-label">Reduce motion</div><div class="t-hint">Instant camera moves, no auto-orbit</div></div><span class="switch"></span></button>
      <button class="toggle" role="switch" data-action="setting-toggle" data-name="fps" data-bind="sw-fps"><div><div class="t-label">Performance readout</div><div class="t-hint" data-bind="fps"></div></div><span class="switch"></span></button>
      <div class="btn-row">
        <button class="btn" data-action="methodology"><i>${ICONS.info}</i>Simulation methodology</button>
        <button class="btn" data-action="reset-all">Reset settlement & missions</button>
      </div>
      <p class="fine" style="margin-top:14px">MARS: FRONTIER is an educational simulation. Values are simplified and labelled by confidence; it is not an engineering tool.</p>`,
    after: (body) => body.querySelectorAll('input[type="range"]').forEach(sliderFill),
    binds: {
      "sw-sound": () => ({ checked: st.sound }),
      "sw-labels": () => ({ checked: st.labels }),
      "sw-reduceMotion": () => ({ checked: st.reduceMotion }),
      "sw-fps": () => ({ checked: st.fps }),
      fps: () => `${Math.round(app.governor.fps)} fps · ${app.governor.dpr.toFixed(2)}× resolution · ${app.renderer.info.render.calls} draw calls`,
    },
  };
}

// ── Methodology ─────────────────────────────────────────────

export function methodologyView() {
  const groups = Object.keys(CATEGORIES);
  const rows = (cat) =>
    Object.values(PARAMS)
      .filter((p) => p.category === cat)
      .map((p) => {
        const v = Math.abs(p.value) >= 100 ? num(p.value) : Number(p.value.toFixed(3));
        return `<tr><td>${esc(p.label)}${p.source ? `<small>${esc(p.source)}</small>` : ""}</td><td class="num">${v} ${esc(p.unit)}</td></tr>`;
      })
      .join("");
  return {
    key: "methodology",
    eyebrow: "Transparency",
    title: "How the Simulation Works",
    html: `
      <p>A deliberately simple, modular resource model. It runs separately from the 3D view, advances in steps of at most 10 simulated minutes, and is covered by automated tests. Treat it as an educational estimate, not a validated engineering prediction.</p>
      <div class="section-title">Power</div>
      <div class="formula">solar  = area × 0.59 kW/m² × e^(−k·τ) × η × dust × tracking × max(0, sin elevation)
fission = units × 10 kWe
load    = habitat + comms + recycler + lab + ISRU + extraction + greenhouse LEDs
If generation + battery can't meet load, shed in order:
  greenhouse LEDs → ice extraction → O₂ ISRU → lab → recycler
Life support is never shed. More than 72 h of unmet load counts as a failure.</div>
      <div class="section-title">Resources (per sol)</div>
      <div class="formula">O₂    : ISRU units × 4.9 kg + greenhouse m² × 0.03 × light − crew × 0.84 − 0.2
Water : recycled + extracted − (crew × 3.5 + greenhouse m² × 0.01)
Food  : greenhouse m² × 60 kcal × light − crew × 2,700 kcal</div>
      <div class="section-title">Autonomy & endurance</div>
      <div class="formula">closure  = local production ÷ consumption (sol-averaged, capped at 100%)
autonomy = min(closure of O₂, water, food, power)
reserve  = store ÷ today's net deficit (the top bar), a snapshot
endurance = sols until O₂, water or food reach zero, simulating up to 760 sols
            (≈ one Earth–Mars synodic period) with today's settings,
            no resupply and no panel cleaning</div>
      <div class="section-title">What is not modelled</div>
      <ul class="facts">
        <li>Seasons, orbital eccentricity and latitude-dependent day length (fixed at equinox).</li>
        <li>Equipment failures, maintenance, spares and crew health.</li>
        <li>CO₂ scrubbing, nitrogen buffer gas, thermal balance and radiation dose.</li>
        <li>Nutrition quality: food is counted as energy only.</li>
      </ul>
      ${groups
        .map(
          (g) => `<div class="section-title"><span class="cat ${g}">${CATEGORIES[g].label}</span></div>
        <p class="fine">${esc(CATEGORIES[g].desc)}</p><table class="params">${rows(g)}</table>`
        )
        .join("")}`,
  };
}
