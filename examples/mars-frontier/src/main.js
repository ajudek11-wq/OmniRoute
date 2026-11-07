import "./styles.css";
import * as THREE from "three";
import { resolveQuality, FrameGovernor, isMobileDevice, rememberPerf } from "./core/quality.js";
import { createWorld } from "./scene/world.js";
import { buildTerrain, buildRocks, buildPaths, heightAt } from "./scene/terrain.js";
import { buildSettlement, PANEL_AREA } from "./scene/settlement.js";
import { Rover, ROVER_PARTS } from "./scene/rover.js";
import { CameraRig, CAMERA_MODES } from "./scene/cameraRig.js";
import { Cinematic } from "./scene/cinematic.js";
import { configureSurfaces, loadGroundSets, terrainMaterial, rockMaterial, installAtmosphere } from "./scene/surfaces.js";
import { SOL_SECONDS } from "./sim/constants.js";
import { AudioEngine } from "./audio/audio.js";
import {
  createState,
  step,
  summarize,
  project,
  serialize,
  solNumber,
  clockString,
  sunVector,
  localTime,
  setSystem,
  cleanPanels,
  applyConfig,
  logEvent,
} from "./sim/engine.js";
import { getScenario, CONFIG_LIMITS } from "./sim/scenarios.js";
import { MissionManager, MISSIONS } from "./game/missions.js";
import { STRUCTURE_INFO } from "./data/structures.js";
import { SURVEY_SITES, ROVER_HOME, SOLAR_SERVICE_POINT, STRUCTURE_POS } from "./data/layout.js";
import { HUD } from "./ui/hud.js";
import { Sheet } from "./ui/sheet.js";
import {
  structureView,
  siteView,
  roverView,
  systemsView,
  missionsView,
  scenarioView,
  logView,
  settingsView,
  methodologyView,
  updateSliderOutput,
  timeView,
  partView,
} from "./ui/panels.js";

const SAVE_KEY = "mars-frontier:save:v2";
const SETTINGS_KEY = "mars-frontier:settings:v1";
const SPEEDS = [
  { label: "1m/s", v: 60 },
  { label: "10m/s", v: 600 },
  { label: "1h/s", v: 3600 },
  { label: "4h/s", v: 14400 },
];
/** Lighting presets = local solar time (fraction of a sol) at the settlement's latitude. */
export const LIGHT_PRESETS = [
  { id: "sunrise", label: "Sunrise", frac: 0.272, hint: "Warm, low-angle light · sun ≈ 6° up" },
  { id: "midday", label: "Midday", frac: 0.5, hint: "Sharp overhead sunlight · sun ≈ 50° up" },
  { id: "sunset", label: "Sunset", frac: 0.727, hint: "Long shadows, deep rust tones" },
  { id: "blue", label: "Blue hour", frac: 0.762, hint: "Sun just below the horizon · blue glow" },
  { id: "night", label: "Night", frac: 0.9, hint: "Settlement lighting, stars, Earth" },
];
const LABEL_HEIGHT = { habitat: 15.5, lab: 10.5, greenhouse: 8.5, solar: 7, battery: 5.5, comms: 18, water: 9, garage: 8.5, landing: 19, fission: 10 };

const storage = {
  get(key) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  set(key, v) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* private mode / quota — the app works without persistence */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// Block iOS Safari page zoom gestures; the 3D canvas handles pinch itself.
for (const ev of ["gesturestart", "gesturechange"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

class App {
  async boot() {
    const appEl = document.getElementById("app");
    appEl.classList.add("booting");
    this.settings = {
      quality: "auto",
      sound: false,
      volume: 0.7,
      labels: true,
      reduceMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
      fps: false,
      ...storage.get(SETTINGS_KEY),
    };
    this.quality = resolveQuality(this.settings.quality);
    const fill = document.getElementById("loading-fill");
    const stage = document.getElementById("loading-stage");
    const canvas = document.getElementById("scene");
    const progress = async (p, text) => {
      fill.style.width = `${p * 100}%`;
      stage.textContent = text;
      await nextFrame();
    };

    try {
      await progress(0.06, "Calibrating renderer");
      this.world = createWorld(canvas, this.quality);
      this.renderer = this.world.renderer;
      const { scene, camera } = this.world;

      const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      configureSurfaces({ size: this.quality.surfSize, anisotropy: Math.min(4, aniso) });
      await progress(0.1, "Streaming surface textures");
      const sets = await loadGroundSets(this.quality.texSize, aniso, (f) => {
        fill.style.width = `${(0.1 + f * 0.12) * 100}%`;
      });
      if (sets.fallback) document.getElementById("loading-note").textContent = "Photographic textures unavailable. Using procedural surfaces.";

      await progress(0.24, "Generating Arcadia Planitia terrain");
      const terrainGeo = buildTerrain(this.quality.terrain);
      this.terrain = new THREE.Mesh(terrainGeo, terrainMaterial(sets, { low: this.quality.terrainLow }));
      this.terrain.receiveShadow = true;
      scene.add(this.terrain);

      await progress(0.44, "Scattering boulders and ejecta");
      scene.add(buildRocks(this.quality.rocks, this.quality.key === "high", rockMaterial(sets), this.quality.rockDetail));
      scene.add(buildPaths());

      await progress(0.6, "Constructing settlement");
      this.settlement = buildSettlement(this.quality);
      scene.add(this.settlement.root);
      this.maxPanels = this.settlement.structures.solar.maxPanels;

      await progress(0.74, "Deploying exploration rover");
      this.rover = new Rover(this.settlement.materials);
      scene.add(this.rover.root);

      await progress(0.84, "Bringing life support online");
      this.initState();
      this.rig = new CameraRig(camera, canvas);
      this.rig.reduceMotion = this.settings.reduceMotion;
      this.governor = new FrameGovernor(this.renderer, this.quality, { degrade: (stage) => this.degrade(stage) });
      this.cinematic = new Cinematic(this);
      this.audio = new AudioEngine();
      this.audio.volume = this.settings.volume;
      this.hud = new HUD(this);
      this.sheet = new Sheet(this);
      this.buildLabels();
      this.buildSelectionRing();
      this.initInput(canvas);
      this.applyVisualConfig();

      await progress(0.94, "Compiling shaders");
      scene.traverse((o) => {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) installAtmosphere(m);
      });
      this.world.resize();
      this.updateSim(0);
      this.world.updateEnvironment({ sunDir: this.sunDir, tau: this.sim.flows.tau, focus: new THREE.Vector3(), time: 0, dt: 0, frame: 0 });
      this.renderer.shadowMap.needsUpdate = true;
      this.world.refreshEnvironment(0, true);
      this.renderer.compile(scene, camera);
      this.renderer.render(scene, camera);

      await progress(1, "Settlement ready");
    } catch (err) {
      console.error(err);
      stage.textContent = "This device could not start the 3D renderer.";
      document.getElementById("loading-note").textContent = "WebGL may be disabled. Try another browser or enable hardware acceleration.";
      return;
    }

    this.hud.setTime(this.paused, SPEEDS[this.speedIdx].label);
    this.hud.setMode(null);
    document.getElementById("chk-sound").checked = this.settings.sound;
    document.getElementById("loading-actions").hidden = false;
    document.getElementById("loading-note").textContent = isMobileDevice()
      ? "Drag to look around · pinch to zoom · tap buildings to inspect"
      : "Drag to orbit · scroll to zoom · right-drag to pan · click buildings to inspect";
    document.getElementById("btn-enter").addEventListener("click", () => this.enter(), { once: true });

    const onResize = () => {
      this.world.resize();
      this.labels.forEach((L) => (L.w = 0));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", () => setTimeout(onResize, 250));
    window.visualViewport?.addEventListener("resize", onResize);
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.save();
      this.hud.toast("Graphics paused", "The GPU reset the 3D view. Tap to reload.", "warn", 60000);
      document.getElementById("toasts").addEventListener("click", () => location.reload(), { once: true });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.save();
      this.lastTime = performance.now();
    });
    window.addEventListener("pagehide", () => this.save());
    this.frame = 0;
    this.lastTime = performance.now();
    this.started = false;
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** Automatic quality: shed the most expensive features live if the device can't keep up. */
  degrade(stage) {
    if (stage === 1) {
      this.world.setShadows(false);
      this.quality.envMap = false;
      rememberPerf("balanced");
    } else if (stage === 2) {
      this.world.scene.traverse((o) => {
        if (o.isPoints && o.material.size < 1) o.visible = false;
      });
      rememberPerf("low");
    } else return;
    this.hud.toast("Graphics adjusted", "Automatic quality reduced effects to keep the view smooth.", "info", 3500);
  }

  // ── State ────────────────────────────────────────────────
  initState() {
    const saved = storage.get(SAVE_KEY);
    this.surveyed = new Set(saved?.surveyed ?? []);
    this.history = { o2: [], water: [], food: [], battery: [] };
    this.paused = false;
    this.speedIdx = saved?.speedIdx ?? 1;
    if (saved?.sim?.version === 2) {
      this.sim = Object.assign(createState(saved.sim.scenarioId), saved.sim);
    } else {
      this.sim = createState("outpost");
    }
    this.missions = new MissionManager(saved?.missions, (m) => this.onMissionComplete(m));
    if (saved?.rover) {
      const r = this.rover;
      r.pos.set(saved.rover.x, heightAt(saved.rover.x, saved.rover.z), saved.rover.z);
      r.heading = saved.rover.heading;
      r.odometer = saved.rover.odometer ?? 0;
      r.battery = saved.rover.battery ?? 1;
      r.task = "Idle";
    }
    this.presets = LIGHT_PRESETS;
    this.speeds = SPEEDS;
    this.timeLapse = null;
    this.roverTask = null;
    this.reportCooldown = 0;
    this.selected = null;
    this.lastEventId = this.sim.eventSeq ?? 0;
    this.prevSinEl = null;
    this.sunset = false;
    this.lastHistoryHour = Math.floor(this.sim.t / 3600);
    this.projectionTimer = 0;
    for (const s of SURVEY_SITES) this.settlement.sites[s.id].setDone(this.surveyed.has(s.id));
  }

  save() {
    if (!this.sim) return;
    storage.set(SAVE_KEY, {
      sim: serialize(this.sim),
      missions: this.missions.serialize(),
      surveyed: [...this.surveyed],
      rover: { x: this.rover.pos.x, z: this.rover.pos.z, heading: this.rover.heading, odometer: this.rover.odometer, battery: this.rover.battery },
      speedIdx: this.speedIdx,
    });
  }

  saveSettings() {
    storage.set(SETTINGS_KEY, this.settings);
  }

  applyVisualConfig() {
    const c = this.sim.config;
    this.panelCount = Math.min(this.maxPanels, Math.round(c.solarArea / PANEL_AREA));
    this.settlement.structures.solar.setCount(this.panelCount);
    this.settlement.structures.fission.setUnits(c.fissionUnits);
  }

  // ── Intro ────────────────────────────────────────────────
  enter() {
    const wantSound = document.getElementById("chk-sound").checked;
    if (wantSound) this.setSound(true); // inside the click gesture (required by iOS)
    this.settings.sound = wantSound;
    this.saveSettings();
    const loading = document.getElementById("loading");
    loading.classList.add("hidden");
    setTimeout(() => loading.remove(), 1200);
    const { camera } = this.world;
    const c = this.rig.controls;
    c.target.set(0, 0, 0);
    camera.position.set(420, 760, 620);
    camera.lookAt(c.target);
    this.rig.setMode("orbit", this.rover, { duration: this.settings.reduceMotion ? 0.01 : 6 });
    this.hud.setMode("orbit");
    const title = document.getElementById("intro-title");
    title.classList.add("show");
    this.started = true;
    setTimeout(
      () => {
        document.getElementById("app").classList.remove("booting");
        title.remove();
        const m = this.missions.current;
        if (m) this.hud.toast(`Mission · ${m.title}`, `${m.brief} ${m.hint}`, "info", 6500);
      },
      this.settings.reduceMotion ? 300 : 5200
    );
  }

  // ── Labels & selection ───────────────────────────────────
  buildLabels() {
    const root = document.getElementById("labels");
    this.labels = [];
    const add = (kind, id, name, getPos, maxDist) => {
      const el = document.createElement("button");
      el.className = `label ${kind}`;
      el.textContent = name;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        this.select(kind, id);
      });
      root.appendChild(el);
      this.labels.push({ kind, id, el, getPos, maxDist, visible: false });
    };
    for (const [id, s] of Object.entries(this.settlement.structures)) {
      const p = s.center.clone();
      p.y += LABEL_HEIGHT[id] ?? 8;
      add("structure", id, STRUCTURE_INFO[id].name, () => p, id === "landing" || id === "fission" || id === "solar" ? 1300 : 700);
    }
    for (const site of SURVEY_SITES) {
      const s = this.settlement.sites[site.id];
      const p = s.center.clone();
      p.y += 7;
      add("site", site.id, `${site.name}`, () => p, 1700);
    }
    const rp = new THREE.Vector3();
    add("rover", "rover", "Rover FR-1", () => rp.copy(this.rover.pos).setY(this.rover.pos.y + 5), 900);
    for (const part of ROVER_PARTS) {
      const pp = new THREE.Vector3();
      add("part", part.id, part.name, () => this.rover.parts[part.id].getWorldPosition(pp), 40);
    }
    document.getElementById("app").classList.toggle("label-hidden", !this.settings.labels);
  }

  updateOccluders() {
    const ids = ["resources", "views", "dock", "toasts"];
    if (this.sheet.isOpen()) ids.push("sheet");
    this.occluders = ids
      .map((id) => document.getElementById(id)?.getBoundingClientRect())
      .filter((r) => r && r.width > 0 && r.height > 0);
    const top = document.querySelector(".topbar")?.getBoundingClientRect();
    if (top) this.occluders.push(top);
  }

  /** Project labels, then greedily place them by priority so none overlap the HUD or each other. */
  updateLabels() {
    const cam = this.world.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const v = this._lv ?? (this._lv = new THREE.Vector3());
    const focus = this.missions.current?.focus;
    const occ = this.occluders ?? [];
    const cands = [];
    for (const L of this.labels) {
      const key = L.kind === "structure" ? L.id : L.kind === "site" ? `site:${L.id}` : L.kind === "part" ? `part:${L.id}` : "rover";
      const inspecting = this.rig.mode === "roverInspect";
      if ((L.kind === "part") !== inspecting || this.rig.mode === "mastcam" || this.cinematic.active) {
        L.show = false;
        continue;
      }
      const active = this.selected?.key === key;
      const objective = focus === key;
      L.el.classList.toggle("active", active);
      L.el.classList.toggle("objective", objective);
      if (L.kind === "site") L.el.classList.toggle("done", this.surveyed.has(L.id));
      const p = L.getPos();
      const dist = cam.position.distanceTo(p);
      v.copy(p).project(cam);
      L.show = false;
      if (!(v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && dist < L.maxDist && dist > 6)) continue;
      if (!L.w) {
        L.w = L.el.offsetWidth || 120;
        L.h = L.el.offsetHeight || 26;
      }
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      const rect = { l: x - L.w / 2, r: x + L.w / 2, t: y - L.h, b: y };
      const prio = (active ? -1e6 : 0) + (objective ? -5e5 : 0) + (L.kind === "rover" ? -1e3 : 0) + dist;
      if (L.kind === "part" && L.el.style.zIndex !== "2") L.el.style.zIndex = "2";
      cands.push({ L, x, y, rect, prio, dist });
    }
    cands.sort((a, b) => a.prio - b.prio);
    const placed = [];
    const hit = (a, b, pad = 4) => a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad;
    for (const c of cands) {
      const r = c.rect;
      if (r.l < 6 || r.r > w - 6 || r.t < 6) continue;
      if (occ.some((o) => hit(r, { l: o.left, r: o.right, t: o.top, b: o.bottom }, 0))) continue;
      if (placed.some((p) => hit(r, p))) continue;
      placed.push(r);
      c.L.show = true;
      c.L.el.style.transform = `translate3d(${(c.x - c.L.w / 2).toFixed(1)}px, ${(c.y - c.L.h).toFixed(1)}px, 0)`;
      c.L.el.style.opacity = String(Math.max(0, Math.min(1, (c.L.maxDist - c.dist) / (c.L.maxDist * 0.25))));
    }
    for (const L of this.labels) {
      if (L.show !== L.visible) {
        L.visible = L.show;
        L.el.style.visibility = L.show ? "visible" : "hidden";
      }
    }
  }

  buildSelectionRing() {
    const geo = new THREE.RingGeometry(1, 1.06, 72);
    geo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: "#ff8a4c", transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false });
    this.ring = new THREE.Mesh(geo, this.ringMat);
    this.ring.visible = false;
    this.ring.renderOrder = 3;
    this.world.scene.add(this.ring);
  }

  objectFor(kind, id) {
    if (kind === "structure") return this.settlement.structures[id];
    if (kind === "site") return this.settlement.sites[id];
    return null;
  }

  select(kind, id, { focus = true } = {}) {
    this.audio.select();
    if (kind === "part") {
      this.selected = { kind, id, key: `part:${id}` };
      this.sheet.open(partView(this, id));
      return;
    }
    if (kind === "rover") {
      this.selected = { kind, id: "rover", key: "rover" };
      this.sheet.open(roverView(this));
      this.missions.emit({ type: "inspect", id: "rover" }, this.ctx());
      return;
    }
    const obj = this.objectFor(kind, id);
    if (!obj) return;
    const key = kind === "site" ? `site:${id}` : id;
    this.selected = { kind, id, key };
    this.sheet.open(kind === "site" ? siteView(this, id) : structureView(this, id));
    if (focus && this.rig.mode !== "rover") this.focusObject(obj);
    this.missions.emit({ type: "inspect", id }, this.ctx());
  }

  focusObject(obj) {
    this.rig.follow = null;
    this.rig.mode = "inspect";
    this.rig.applyLimits({ min: 4, max: 1700, maxPolar: 1.5 });
    this.rig.focusOn(obj.center, obj.focus);
    this.hud.setMode(null);
  }

  deselect() {
    this.selected = null;
  }

  // ── Input ────────────────────────────────────────────────
  initInput(canvas) {
    const pointers = new Map();
    let down = null;
    let multi = false;
    this.raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    canvas.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, true);
      if (pointers.size > 1) multi = true;
      if (pointers.size === 1) {
        multi = false;
        down = { x: e.clientX, y: e.clientY, t: performance.now() };
      }
    });
    const up = (e, cancelled) => {
      pointers.delete(e.pointerId);
      if (cancelled || !down || multi) {
        if (pointers.size === 0) down = null;
        return;
      }
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (moved < 10 && dt < 500) {
        ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
        this.handleTap(ndc);
      }
    };
    canvas.addEventListener("pointerup", (e) => up(e, false));
    canvas.addEventListener("pointercancel", (e) => up(e, true));
    window.addEventListener("keydown", (e) => {
      if (e.target.closest?.("input")) return;
      const modes = Object.keys(CAMERA_MODES);
      if (e.key >= "1" && e.key <= "5") this.setMode(modes[Number(e.key) - 1]);
      else if (e.key === " ") {
        e.preventDefault();
        this.togglePause();
      } else if (e.key === "Escape") {
        if (this.cinematic.active) this.toggleCinematic(false);
        else this.sheet.close();
      } else if (e.key === "c") this.toggleCinematic(!this.cinematic.active);
    });
  }

  handleTap(ndc) {
    if (!this.started) return;
    const rc = this.raycaster;
    rc.setFromCamera(ndc, this.world.camera);
    const firstPerson = this.rig.mode === "mastcam";
    const hits = rc.intersectObjects(firstPerson ? this.settlement.pickables : [...this.settlement.pickables, this.rover.hit], false);
    const terrainHit = rc.intersectObject(this.terrain, false)[0];
    const hit = hits.find((h) => !terrainHit || h.distance < terrainHit.distance + 2);
    if (hit) {
      const pick = hit.object.userData.pick;
      this.select(pick.kind, pick.id, { focus: true });
      return;
    }
    if ((this.rig.mode === "rover" || firstPerson) && terrainHit) {
      const p = terrainHit.point;
      if (this.roverTask && this.roverTask.type !== "manual") this.hud.toast("Task cancelled", "Manual drive command overrides the rover's task.", "warn", 2600);
      this.roverTask = { type: "manual" };
      this.rover.busy = false;
      this.rover.driveTo(p.x, p.z, "Driving to waypoint", () => {
        this.rover.task = "Holding at waypoint";
        this.roverTask = null;
      });
      this.showWaypoint(p);
      this.audio.tap();
      return;
    }
    if (this.sheet.isOpen() && this.selected) {
      this.sheet.close();
    }
  }

  showWaypoint(p) {
    if (!this.waypoint) {
      const g = new THREE.RingGeometry(0.8, 1.2, 40);
      g.rotateX(-Math.PI / 2);
      this.waypoint = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: "#e7a94f", transparent: true, depthWrite: false, toneMapped: false }));
      this.waypoint.renderOrder = 3;
      this.world.scene.add(this.waypoint);
    }
    this.waypoint.position.set(p.x, heightAt(p.x, p.z) + 0.2, p.z);
    this.waypoint.visible = true;
    this.waypointT = 0;
  }

  // ── Actions (from panels) ────────────────────────────────
  action(name, data) {
    const sim = this.sim;
    switch (name) {
      case "toggle-system": {
        setSystem(sim, data.key, !sim.systems[data.key]);
        this.audio.tap();
        this.scheduleProjection();
        this.sheet.refresh();
        break;
      }
      case "clean-panels":
        this.dispatchClean();
        break;
      case "send-report":
        if (this.reportCooldown > 0) break;
        this.reportCooldown = 6;
        logEvent(sim, "info", "Status report transmitted to Earth (one-way light time ≈ 12.6 min).");
        this.hud.toast("Report transmitted", "Telemetry packet sent via X-band. It will reach Earth in about 12.6 minutes.", "info");
        this.missions.emit({ type: "action", id: "send-report" }, this.ctx());
        this.audio.tap();
        break;
      case "rover-home":
        this.roverTask = { type: "home" };
        this.rover.driveTo(ROVER_HOME.x, ROVER_HOME.z, "Returning to garage", () => {
          this.rover.task = "Parked at garage · charging";
          this.roverTask = null;
        });
        this.audio.tap();
        break;
      case "survey":
        this.dispatchSurvey(data.id);
        break;
      case "focus": {
        const obj = this.objectFor(data.kind, data.id);
        if (obj) this.focusObject(obj);
        break;
      }
      case "mode":
        this.setMode(data.mode);
        break;
      case "preset":
        this.applyPreset(data.id);
        break;
      case "speed":
        this.speedIdx = Number(data.idx);
        this.paused = false;
        this.hud.setTime(this.paused, SPEEDS[this.speedIdx].label);
        this.sheet.refresh();
        break;
      case "pause":
        this.togglePause();
        this.sheet.refresh();
        break;
      case "cinematic":
        this.toggleCinematic(true);
        break;
      case "part":
        this.select("part", data.id);
        break;
      case "open-rover":
        this.select("rover", "rover");
        break;
      case "mission-go": {
        const m = MISSIONS.find((x) => x.id === data.id);
        if (!m?.focus) break;
        if (m.focus === "rover") {
          this.setMode("rover");
          this.sheet.open(roverView(this));
          this.selected = { kind: "rover", id: "rover", key: "rover" };
        } else if (m.focus.startsWith("site:")) this.select("site", m.focus.slice(5));
        else this.select("structure", m.focus);
        break;
      }
      case "scenario":
        this.loadScenario(data.id);
        break;
      case "config": {
        const key = data.key;
        const L = CONFIG_LIMITS[key];
        const v = Math.min(L.max, Math.max(L.min, Number(data.value)));
        applyConfig(sim, { [key]: v });
        updateSliderOutput(data.el);
        this.applyVisualConfig();
        this.scheduleProjection();
        break;
      }
      case "methodology":
        this.sheet.open(methodologyView());
        this.hud.setTab(null);
        break;
      case "setting": {
        if (data.name === "quality") {
          this.settings.quality = data.value;
          this.saveSettings();
          this.save();
          location.reload();
        }
        break;
      }
      case "setting-toggle": {
        const n = data.name;
        if (n === "sound") this.setSound(!this.settings.sound);
        else this.settings[n] = !this.settings[n];
        if (n === "labels") document.getElementById("app").classList.toggle("label-hidden", !this.settings.labels);
        if (n === "reduceMotion") this.rig.reduceMotion = this.settings.reduceMotion;
        if (n === "fps") this.toggleFps();
        this.saveSettings();
        this.sheet.refresh();
        break;
      }
      case "volume":
        this.settings.volume = Number(data.value);
        this.audio.setVolume(this.settings.volume);
        updateSliderFill(data.el);
        this.saveSettings();
        break;
      case "reset-all":
        if (window.confirm("Reset the settlement, missions and surveys?")) {
          storage.remove(SAVE_KEY);
          location.reload();
        }
        break;
      default:
        break;
    }
  }

  toggleFps() {
    if (!this.fpsEl) {
      this.fpsEl = document.createElement("div");
      this.fpsEl.style.cssText =
        "position:absolute;z-index:50;left:calc(env(safe-area-inset-left) + 12px);top:calc(env(safe-area-inset-top) + 124px);font:11px ui-monospace,monospace;color:#e7a94f;background:rgba(0,0,0,.45);padding:4px 7px;border-radius:7px;pointer-events:none";
      document.getElementById("app").appendChild(this.fpsEl);
    }
    this.fpsEl.style.display = this.settings.fps ? "" : "none";
  }

  setSound(on) {
    const ok = this.audio.setEnabled(on);
    this.settings.sound = !!(on && ok !== false);
    this.hud?.setSound(this.settings.sound);
    if (this.settings.sound) this.audio.tap();
  }

  toggleSound() {
    this.setSound(!this.settings.sound);
    this.saveSettings();
  }

  togglePause() {
    this.paused = !this.paused;
    this.hud.setTime(this.paused, SPEEDS[this.speedIdx].label);
    this.audio.tap();
  }

  cycleSpeed() {
    this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
    this.hud.setTime(this.paused, SPEEDS[this.speedIdx].label);
    this.audio.tap();
  }

  setMode(mode) {
    if (this.cinematic?.active) this.toggleCinematic(false);
    this.rig.setMode(mode, this.rover);
    this.hud.setMode(mode);
    document.getElementById("app").classList.toggle("mastcam", mode === "mastcam");
    if (mode !== "mastcam") this.world.resize();
    this.audio.tap();
    if (mode === "rover" && !this.settings.seenDriveHint) {
      this.settings.seenDriveHint = true;
      this.saveSettings();
      this.hud.toast("Rover view", "Tap anywhere on the ground to drive there. Tap a blue beacon to plan a survey.", "info", 5000);
    }
  }

  /** Lighting presets run the simulation forward as a smooth time-lapse to that local time. */
  applyPreset(id) {
    const preset = LIGHT_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const now = localTime(this.sim);
    let delta = preset.frac - now;
    if (delta < 0) delta += 1;
    if (delta < 0.002) return;
    const total = delta * SOL_SECONDS;
    const dur = this.settings.reduceMotion ? 0.05 : 2.6;
    this.timeLapse = { remaining: total, rate: total / dur, label: preset.label };
    this.paused = false;
    this.hud.setTime(this.paused, SPEEDS[this.speedIdx].label);
    this.audio.tap();
  }

  toggleCinematic(on) {
    if (on === this.cinematic.active) return;
    if (on) {
      this.sheet.close();
      this.rig.cinematic = true;
      this.rig.controls.enabled = false;
      this.cinematic.start();
      this.hud.toast("Cinematic mode", "Tap anywhere to return.", "info", 2500);
    } else {
      this.cinematic.stop();
      this.rig.cinematic = false;
      this.rig.controls.enabled = true;
      this.rig.setMode("orbit", this.rover, { duration: 2.2 });
      this.hud.setMode("orbit");
    }
  }

  toggleTab(tab) {
    if (this.sheet.isOpen(tab)) {
      this.sheet.close();
      return;
    }
    const views = { missions: missionsView, systems: systemsView, scenario: scenarioView, log: logView, settings: settingsView, time: timeView };
    this.selected = null;
    this.sheet.open(views[tab](this));
    this.audio.tap();
  }

  onSheetChange(key) {
    const tab = ["missions", "systems", "scenario", "log", "settings"].includes(key) ? key : null;
    this.hud.setTab(tab);
    if (!key) this.selected = null;
    this.updateOccluders();
    setTimeout(() => this.updateOccluders(), 480); // after the sheet's slide animation
  }

  // ── Rover tasks ──────────────────────────────────────────
  roverBusy() {
    return !!this.roverTask && (this.roverTask.type === "survey" || this.roverTask.type === "clean");
  }

  roverAtHome() {
    return Math.hypot(this.rover.pos.x - ROVER_HOME.x, this.rover.pos.z - ROVER_HOME.z) < 6;
  }

  dispatchSurvey(id) {
    if (this.roverBusy() || this.surveyed.has(id)) return;
    const site = SURVEY_SITES.find((s) => s.id === id);
    this.roverTask = { type: "survey", site: id, phase: "drive" };
    this.rover.busy = true;
    this.rover.driveTo(site.x, site.z, `En route to ${site.name}`, () => {
      this.roverTask.phase = "survey";
      this.roverTask.t = 6;
      this.rover.armTarget = 1;
      this.rover.task = `Surveying ${site.name} · arm deployed`;
    });
    this.hud.toast(`Rover dispatched · ${site.name}`, "Switch to Rover view to ride along.", "info", 3500);
    this.audio.tap();
  }

  dispatchClean() {
    if (this.roverBusy()) return;
    this.roverTask = { type: "clean", phase: "drive" };
    this.rover.busy = true;
    this.rover.driveTo(SOLAR_SERVICE_POINT.x, SOLAR_SERVICE_POINT.z, "En route to solar field", () => {
      this.roverTask.phase = "clean";
      this.roverTask.t = 5;
      this.rover.task = "Cleaning arrays (brush + compressed CO₂)";
    });
    this.hud.toast("Rover dispatched", "Heading to the solar field to clear dust.", "info", 3000);
    this.audio.tap();
  }

  updateRoverTask(dt) {
    const task = this.roverTask;
    if (!task || !task.t) return;
    task.t -= dt;
    if (task.t > 0) return;
    if (task.type === "survey") {
      const site = SURVEY_SITES.find((s) => s.id === task.site);
      this.surveyed.add(site.id);
      this.settlement.sites[site.id].setDone(true);
      logEvent(this.sim, "info", `${site.name} surveyed: ${site.subtitle.toLowerCase()}.`);
      this.hud.toast(`Survey complete · ${site.name}`, site.finding, "success", 7000);
      this.audio.chime();
      this.rover.task = "Survey complete · idle";
      this.rover.armTarget = 0;
      this.rover.busy = false;
      this.roverTask = null;
      this.missions.emit({ type: "survey", id: site.id }, this.ctx());
    } else if (task.type === "clean") {
      cleanPanels(this.sim);
      this.missions.emit({ type: "clean" }, this.ctx());
      this.hud.toast("Arrays cleaned", "Solar output restored to 100%.", "success");
      this.rover.task = "Cleaning complete · idle";
      this.rover.busy = false;
      this.roverTask = null;
      this.scheduleProjection();
    }
    this.save();
  }

  // ── Scenarios & projection ───────────────────────────────
  loadScenario(id) {
    const sc = getScenario(id);
    this.sim = createState(sc.id);
    this.lastEventId = 0;
    this.history = { o2: [], water: [], food: [], battery: [] };
    this.lastHistoryHour = 0;
    this.applyVisualConfig();
    this.updateSim(0);
    this.projection = null;
    this.scheduleProjection(50);
    this.hud.toast(`Scenario · ${sc.name}`, sc.tagline, "info");
    if (this.sheet.isOpen("scenario")) this.sheet.open(scenarioView(this));
    this.save();
  }

  scheduleProjection(delay = 300) {
    this.projectionTimer = Math.min(this.projectionTimer > 0 ? this.projectionTimer : Infinity, delay / 1000);
  }

  ctx() {
    return { sim: this.sim, summary: this.summary, rover: this.rover, sol: solNumber(this.sim), sunset: this.sunset };
  }

  onMissionComplete(m) {
    this.hud.toast(`Mission complete · ${m.title}`, m.codex, "success", 6500);
    this.audio.chime();
    logEvent(this.sim, "info", `Mission complete: ${m.title}.`);
    this.save();
  }

  // ── Main loop ────────────────────────────────────────────
  updateSim(dtReal) {
    const sim = this.sim;
    if (this.timeLapse && dtReal > 0) {
      const dts = Math.min(this.timeLapse.remaining, this.timeLapse.rate * dtReal);
      step(sim, dts);
      this.timeLapse.remaining -= dts;
      if (this.timeLapse.remaining <= 1) this.timeLapse = null;
    } else if (!this.paused && this.started && dtReal > 0) step(sim, dtReal * SPEEDS[this.speedIdx].v);
    else if (!sim.flows) step(sim, 1);
    this.summary = summarize(sim);
    const s = sunVector(localTime(sim));
    this.sunDir = s;
    // Sunset detection for the Blue Hour mission.
    if (this.prevSinEl != null && this.prevSinEl > 0.0 && s.y <= 0.0) {
      this.sunset = true;
      if (!this.missions.state["blue-sunset"].done) this.hud.toast("Sunset", "Look near the sun: Martian sunsets glow blue.", "info", 5000);
    } else this.sunset = false;
    this.prevSinEl = s.y;
    // Hourly history samples (last 5 sols).
    const hour = Math.floor(sim.t / 3600);
    if (hour !== this.lastHistoryHour) {
      this.lastHistoryHour = hour;
      const h = this.history;
      h.o2.push(sim.stores.o2);
      h.water.push(sim.stores.water);
      h.food.push(sim.stores.food);
      h.battery.push(sim.stores.battery / Math.max(1, sim.config.batteryKWh));
      for (const k of Object.keys(h)) if (h[k].length > 124) h[k].shift();
    }
    // Toast new engine events.
    for (const e of sim.events) {
      if (e.id > this.lastEventId) {
        this.lastEventId = e.id;
        if (e.text.startsWith("Mission complete") || e.text.startsWith("Status report") || e.text.includes("surveyed")) continue;
        if (e.level !== "info" || e.text.includes("restored") || e.text.includes("cleared")) {
          this.hud.toast(e.level === "critical" ? "Critical alert" : e.level === "caution" ? "Caution" : "Update", e.text, e.level === "info" ? "info" : "warn", 5000);
          if (e.level !== "info") this.audio.warn();
        }
      }
    }
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.frame++;
    const t = now / 1000;

    this.updateSim(dt);
    this.rover.update(dt, t);
    this.updateRoverTask(dt);
    if (this.reportCooldown > 0) this.reportCooldown -= dt;

    const garage = this.settlement.structures.garage;
    const gd = Math.hypot(this.rover.pos.x - STRUCTURE_POS.garage.x, this.rover.pos.z - (STRUCTURE_POS.garage.z + 8));
    garage.setOpen(gd < 18);

    this.rig.update(dt);
    if (this.cinematic.active) this.cinematic.update(dt, this.world.camera);
    const focus = this.rig.controls.target;
    const env = this.world.updateEnvironment({ sunDir: this.sunDir, tau: this.sim.flows.tau, focus, time: t, dt, frame: this.frame });
    this.settlement.update(t, env, this.sim);

    // Selection ring
    if (this.selected) {
      const obj = this.selected.kind === "rover" ? null : this.objectFor(this.selected.kind, this.selected.id);
      const c = obj ? obj.center : this.rover.pos;
      const r = obj ? obj.radius : 4;
      this.ring.visible = true;
      this.ring.position.set(c.x, heightAt(c.x, c.z) + 0.3, c.z);
      this.ring.scale.setScalar(r * (1 + Math.sin(t * 3) * 0.025));
      this.ringMat.opacity = 0.55 + Math.sin(t * 3) * 0.25;
    } else this.ring.visible = false;
    if (this.waypoint?.visible) {
      this.waypointT += dt;
      this.waypoint.scale.setScalar(1 + this.waypointT * 1.5);
      this.waypoint.material.opacity = Math.max(0, 1 - this.waypointT / 1.5);
      if (this.waypointT > 1.5 && !this.rover.target) this.waypoint.visible = false;
      if (this.waypointT > 1.5) this.waypointT = 0;
    }

    // Audio proximity
    const camDist = this.world.camera.position.length();
    this.audio.update(Math.max(0, 1 - camDist / 140), env.storm);

    if (this.started) this.updateLabels();

    // Throttled UI work
    this.uiTimer = (this.uiTimer ?? 0) - dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.25;
      this.hud.update({
        sol: solNumber(this.sim),
        clock: clockString(this.sim),
        summary: this.summary,
        sim: this.sim,
        missionsLeft: MISSIONS.length - this.missions.doneCount,
      });
      if (this.sheet.isOpen()) this.sheet.refresh();
      this.updateOccluders();
      this.missions.tick(this.ctx());
      if (this.rig.mode === "mastcam") {
        const az = ((((this.rover.heading + this.rig.look.yaw) * 180) / Math.PI) % 360 + 360) % 360;
        document.getElementById("mc-readout").textContent = `AZ ${String(Math.round(az)).padStart(3, "0")}° EL ${Math.round((this.rig.look.pitch * 180) / Math.PI)}°`;
      }
      if (this.fpsEl && this.settings.fps) {
        this.fpsEl.textContent = `${Math.round(this.governor.fps)} fps · ${this.governor.dpr.toFixed(2)}× · ${this.renderer.info.render.calls} calls`;
      }
    }
    if (this.sunset) this.missions.tick(this.ctx());

    this.projectionTimer -= dt;
    if (this.projectionTimer <= 0) {
      this.projection = project(this.sim);
      this.projectionTimer = 3;
    }
    this.saveTimer = (this.saveTimer ?? 6) - dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 6;
      this.save();
    }

    this.governor.sample(dt);
    this.renderer.render(this.world.scene, this.world.camera);
  }
}

function updateSliderFill(el) {
  const p = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty("--p", `${p}%`);
}

const app = new App();
window.__frontier = app;
app.boot();

if (import.meta.env.PROD && "serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
