import * as THREE from "three";
import { DESTINATIONS, byId, SCI } from "./destinations.js";
import { Panel, grid } from "../xr/panel.js";
import * as common from "./common.js";
import { VR_TIERS } from "../xr/vrQuality.js";

/**
 * The universe director: owns which destination is live, the travel sequence between them, the
 * discovery archive and the hand-off to/from Mars (which is run by the original App).
 *
 * A destination module exports `async build(ctx)` and returns a world object that doubles as the
 * XR adapter:
 *   { scene, spawn:{x,z,yaw,y?}, near?, far?, groundAt(x,z), colliders?, bounds?, interactables?,
 *     lockMove?, lockTurn?, eye?, update(dt, t), dispose(), onEnter?(), title? }
 */

const SAVE = "mars-frontier:cosmos:v1";

const MODULES = {
  hub: () => import("./hub.js"),
  ship: () => import("./ship.js"),
  moon: () => import("./worlds/moon.js"),
  orbit: () => import("./worlds/orbit.js"),
  venus: () => import("./worlds/venus.js"),
  asteroids: () => import("./worlds/asteroids.js"),
  jupiter: () => import("./worlds/jupiter.js"),
  europa: () => import("./worlds/europa.js"),
  titan: () => import("./worlds/titan.js"),
  saturn: () => import("./worlds/saturn.js"),
  deep: () => import("./worlds/deep.js"),
};

export function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE) ?? "null");
    return { found: s?.found ?? {}, visited: s?.visited ?? [] };
  } catch {
    return { found: {}, visited: [] };
  }
}

export class Cosmos {
  constructor(app) {
    this.app = app;
    this.renderer = app.renderer;
    this.xr = app.xr;
    this.world = null; // null → Mars (the App) is live
    this.id = "mars";
    this.state = loadState();
    this.busy = false;
    this.archive = null;
    this.onChange = () => {};
  }

  get active() {
    return this.world;
  }

  get tier() {
    if (this.xr.presenting) return VR_TIERS[this.app.vrTier]?.scene ?? "balanced";
    return this.app.quality?.key ?? "balanced";
  }

  save() {
    try {
      localStorage.setItem(SAVE, JSON.stringify(this.state));
    } catch {
      /* private mode */
    }
  }

  ctx(extra = {}) {
    return {
      THREE,
      common,
      renderer: this.renderer,
      tier: this.tier,
      xr: this.xr,
      audio: this.app.audio,
      dest: extra.dest ?? null,
      destinations: DESTINATIONS,
      state: this.state,
      SCI,
      toast: (title, text, opts) => this.toast(title, text, opts),
      discover: (entry) => this.discover(entry),
      go: (id, opts) => this.go(id, opts),
      travel: (id) => this.travel(id),
      toggleArchive: () => this.toggleArchive(),
      cycleQuality: () => this.app.cycleVrTier(),
      tierLabel: VR_TIERS[this.app.vrTier]?.name,
      gpu: this.app.gpu || "GPU not reported",
      ...extra,
    };
  }

  toast(title, text = "", opts = {}) {
    if (this.xr.presenting) this.xr.toast(title, text, opts);
    else this.app.hud?.toast(title, text, opts.kind ?? "info", (opts.seconds ?? 4) * 1000);
  }

  /**
   * Record a discovery once: { id, title, text, sci: "established"|… , dest }.
   * Shows a short notification; the full explanation lives in the archive.
   */
  discover(entry) {
    const key = entry.id;
    if (this.state.found[key]) return false;
    this.state.found[key] = { title: entry.title, text: entry.text ?? "", sci: entry.sci ?? "established", dest: entry.dest ?? this.id, t: Date.now() };
    this.save();
    this.app.audio?.chime?.();
    this.toast(`Discovered: ${entry.title}`, entry.short ?? "", { tag: SCI[entry.sci ?? "established"], seconds: 4.5 });
    this.onChange();
    return true;
  }

  discoveriesFor(dest) {
    return Object.values(this.state.found).filter((f) => f.dest === dest).length;
  }

  /** Switch the live destination with a comfort fade. Mars hands control back to the App. */
  async go(id, opts = {}) {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.archive?.mesh.visible) this.toggleArchive(false);
      await this.xr.fadeTo(1, 0.35);
      const old = this.world;
      this.world = null;
      old?.dispose?.();
      this.disposeScene(old?.scene);
      this.id = id;
      if (!this.state.visited.includes(id)) {
        this.state.visited.push(id);
        this.save();
      }
      if (id === "mars") {
        this.app.enterMarsFromCosmos(opts);
      } else {
        const mod = await MODULES[id]();
        const world = await mod.build(this.ctx({ dest: byId[id] ?? null, opts }));
        this.applyCamera(world);
        this.world = world;
        this.app.enterCosmos(world);
        const s = world.spawn ?? { x: 0, z: 0, yaw: 0 };
        this.xr.update(0, world);
        this.xr.place(s.x, s.z, s.yaw ?? 0, s.y ?? null);
        await world.onEnter?.();
        // Compile before the fade-in so the first VR frames do not stutter.
        try {
          await this.renderer.compileAsync(world.scene, this.xr.camera);
        } catch {
          this.renderer.compile(world.scene, this.xr.camera);
        }
      }
      this.onChange();
      await this.xr.fadeTo(0, 0.6);
    } catch (err) {
      console.error(err);
      this.toast("Could not load destination", String(err?.message ?? err));
      await this.xr.fadeTo(0, 0.3);
    } finally {
      this.busy = false;
    }
  }

  /** Launch a mission: board the ship, fly, then the destination-specific arrival. */
  travel(dest) {
    return this.go("ship", { to: dest, from: this.id });
  }

  applyCamera(world) {
    const cam = this.xr.camera;
    cam.near = world.near ?? 0.05;
    cam.far = world.far ?? 2.0e7;
    cam.updateProjectionMatrix();
  }

  disposeScene(scene) {
    if (!scene) return;
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const v of Object.values(m)) if (v?.isTexture && !v.userData?.shared) v.dispose?.();
        m.dispose();
      }
    });
  }

  // ── Discovery archive (holographic panel in front of the player) ──
  toggleArchive(force) {
    if (!this.archive) {
      this.archive = new Panel({ width: 0.9, height: 0.62, ppm: 1300, glow: "#9fe6c0" });
      this.archive.mesh.userData.interact = { object: this.archive.mesh, panel: this.archive, onButton: (b) => b.id === "close" && this.toggleArchive(false) };
    }
    const show = force ?? !this.archive.mesh.visible;
    this.archive.mesh.visible = show;
    if (!show) {
      this.archive.mesh.removeFromParent();
      return;
    }
    const found = Object.values(this.state.found).sort((a, b) => b.t - a.t);
    const lines = found.length
      ? found.slice(0, 9).map((f) => `${byId[f.dest]?.name ?? f.dest} · ${f.title} — ${SCI[f.sci]?.text ?? ""}`)
      : ["Nothing recorded yet. Scan rocks, ice and landmarks with the trigger to log discoveries."];
    const total = found.length;
    this.archive.setContent({
      eyebrow: "Holographic archive",
      title: `Discoveries · ${total}`,
      titleSize: 70,
      lines,
      lineSize: 30,
      buttons: grid(this.archive, [{ id: "close", label: "Close" }], { top: 0.86, cols: 1, rowH: 0.1, side: 0.38 }),
    });
    const cam = this.xr.camera;
    const scene = this.world?.scene ?? this.app.world.scene;
    scene.add(this.archive.mesh);
    cam.getWorldPosition(this.archive.mesh.position);
    const dir = cam.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    this.archive.mesh.position.addScaledVector(dir, 1.3);
    this.archive.mesh.position.y -= 0.1;
    this.archive.mesh.lookAt(cam.getWorldPosition(new THREE.Vector3()));
  }

  /** Extra interactables every world gets (the archive panel when open). */
  extras() {
    return this.archive?.mesh.visible ? [this.archive.mesh.userData.interact] : [];
  }

  tick(dt, t) {
    const w = this.world;
    if (!w) return;
    w.update?.(dt, t);
    const adapter = this.extras().length ? Object.assign(Object.create(w), { interactables: [...(w.interactables ?? []), ...this.extras()] }) : w;
    this.xr.update(dt, adapter);
    this.renderer.render(w.scene, this.xr.camera);
  }
}
