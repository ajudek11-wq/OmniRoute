import { ICONS } from "./icons.js";
import { CAMERA_MODES } from "../scene/cameraRig.js";

const DOCK = [
  ["missions", "Missions"],
  ["systems", "Systems"],
  ["scenario", "Scenario"],
  ["log", "Log"],
];

const RES = [
  ["o2", "o2", "O₂"],
  ["water", "water", "H₂O"],
  ["food", "food", "Food"],
  ["power", "power", "Power"],
  ["battery", "battery", "Batt"],
];

const short = (r) => {
  if (r === Infinity) return "∞";
  if (r <= 0) return "0";
  if (r >= 1000) return `${(r / 1000).toFixed(1)}k sol`;
  return `${Math.round(r)} sol`;
};

export class HUD {
  constructor(app) {
    this.app = app;
    this.$ = (id) => document.getElementById(id);
    this.toastsEl = this.$("toasts");

    // Dock
    const dock = this.$("dock");
    dock.innerHTML = DOCK.map(
      ([k, l]) => `<button class="dock-btn" data-tab="${k}"><i>${ICONS[k]}</i><span>${l}</span>${k === "missions" ? '<b class="dock-badge" id="badge-missions"></b>' : ""}</button>`
    ).join("");
    dock.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (b) app.toggleTab(b.dataset.tab);
    });

    // Camera views
    const views = this.$("views");
    views.innerHTML = Object.entries(CAMERA_MODES)
      .filter(([, m]) => !m.hidden)
      .map(([k, m]) => `<button class="view-btn" data-mode="${k}" aria-label="${m.label} view"><i>${ICONS[k]}</i><span>${m.label}</span></button>`)
      .join("");
    views.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mode]");
      if (b) app.setMode(b.dataset.mode);
    });

    // Resources
    const res = this.$("resources");
    res.innerHTML = RES.map(
      ([k, icon, l]) => `<div class="res" id="res-${k}"><div class="res-top"><i>${ICONS[icon]}</i>${l}</div><div class="res-val">—</div><div class="res-bar"><span></span></div></div>`
    ).join("");
    res.addEventListener("click", () => app.toggleTab("systems"));
    this.resEls = Object.fromEntries(
      RES.map(([k]) => {
        const el = this.$(`res-${k}`);
        return [k, { el, val: el.querySelector(".res-val"), bar: el.querySelector(".res-bar span") }];
      })
    );

    this.$("btn-settings").innerHTML = ICONS.settings;
    this.$("btn-settings").addEventListener("click", () => app.toggleTab("settings"));
    this.$("btn-cine").innerHTML = ICONS.film;
    this.$("btn-cine").addEventListener("click", () => app.toggleCinematic(true));
    this.$("clock-open").addEventListener("click", () => app.toggleTab("time"));
    this.$("btn-play").addEventListener("click", () => app.togglePause());
    this.$("btn-speed").addEventListener("click", () => app.cycleSpeed());
    this.clockSol = this.$("clock-sol");
    this.clockTime = this.$("clock-time");
  }

  setTab(tab) {
    for (const b of document.querySelectorAll(".dock-btn")) b.classList.toggle("active", b.dataset.tab === tab);
    this.$("btn-settings").classList.toggle("on", tab === "settings");
    this.$("clock-open").classList.toggle("on", tab === "time");
  }

  setMode(mode) {
    for (const b of document.querySelectorAll(".view-btn")) b.classList.toggle("active", b.dataset.mode === mode);
    this.$("drive-hint").hidden = mode !== "rover" && mode !== "mastcam";
    this.$("mastcam-hud").hidden = mode !== "mastcam";
  }

  setSound() {
    /* sound lives in Settings and on the start screen */
  }

  setTime(paused, speedLabel) {
    const b = this.$("btn-play");
    b.innerHTML = paused ? ICONS.play : ICONS.pause;
    b.setAttribute("aria-label", paused ? "Resume time" : "Pause time");
    this.$("btn-speed").textContent = speedLabel;
  }

  update({ sol, clock, summary, sim, missionsLeft }) {
    this.clockSol.textContent = `SOL ${sol}`;
    this.clockTime.textContent = clock;
    if (!summary) return;
    const set = (k, text, frac, status) => {
      const r = this.resEls[k];
      if (r.val.textContent !== text) r.val.textContent = text;
      r.bar.style.width = `${Math.max(2, Math.min(100, frac * 100))}%`;
      const cls = `res ${status}`;
      if (r.el.className !== cls) r.el.className = cls;
    };
    set("o2", short(summary.o2.reserve), summary.o2.store / summary.o2.cap, summary.o2.status);
    set("water", short(summary.water.reserve), summary.water.store / summary.water.cap, summary.water.status);
    set("food", short(summary.food.reserve), Math.min(1, summary.food.reserve / 760), summary.food.status);
    const net = sim.flows.netKW;
    set("power", `${net >= 0 ? "+" : "−"}${Math.abs(net).toFixed(1)}kW`, Math.min(1, summary.power.closure), summary.power.status);
    const soc = summary.power.soc;
    set("battery", `${Math.round(soc * 100)}%`, soc, soc < 0.15 ? "critical" : soc < 0.35 ? "caution" : "nominal");
    const badge = this.$("badge-missions");
    badge.textContent = missionsLeft > 0 ? String(missionsLeft) : "";
    badge.style.display = missionsLeft > 0 ? "" : "none";
  }

  toast(title, text = "", kind = "info", ms = 4200) {
    const icon = kind === "success" ? ICONS.check : kind === "warn" ? ICONS.info : ICONS.info;
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.innerHTML = `<i>${icon}</i><div><b></b><span></span></div>`;
    el.querySelector("b").textContent = title;
    el.querySelector("span").textContent = text;
    if (!text) el.querySelector("span").remove();
    el.addEventListener("click", () => dismiss());
    this.toastsEl.prepend(el);
    while (this.toastsEl.children.length > (document.getElementById("app").classList.contains("walking") ? 2 : 3)) this.toastsEl.lastChild.remove();
    const dismiss = () => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 400);
    };
    setTimeout(dismiss, ms);
  }
}
