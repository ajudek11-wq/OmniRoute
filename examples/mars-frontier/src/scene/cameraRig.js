import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { heightAt } from "./terrain.js";

export const CAMERA_MODES = {
  orbit: {
    label: "Orbit",
    target: [6, 3, -2],
    radius: 150,
    phi: 1.0,
    theta: 0.75,
    min: 30,
    max: 650,
    maxPolar: 1.42,
    autoRotate: true,
  },
  surface: {
    label: "Surface",
    target: [4, 4, 4],
    radius: 46,
    phi: 1.49,
    theta: 0.42,
    min: 3,
    max: 90,
    maxPolar: 1.56,
  },
  aerial: {
    label: "Aerial",
    target: [20, 0, 10],
    radius: 640,
    phi: 0.42,
    theta: 0.4,
    min: 220,
    max: 1700,
    maxPolar: 1.1,
  },
  habitat: {
    label: "Habitat",
    target: [0, 5, 0],
    radius: 36,
    phi: 1.2,
    theta: 0.35,
    min: 14,
    max: 120,
    maxPolar: 1.52,
  },
  rover: {
    label: "Rover",
    target: null,
    radius: 16,
    phi: 1.18,
    theta: null,
    min: 5,
    max: 80,
    maxPolar: 1.53,
  },
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, dom);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.075;
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 0.9;
    c.panSpeed = 0.7;
    c.screenSpacePanning = false;
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.autoRotateSpeed = 0.35;
    this.mode = "orbit";
    this.transition = null;
    this.follow = null;
    this.lastFollow = new THREE.Vector3();
    this.idle = 0;
    this.reduceMotion = false;
    this._sph = new THREE.Spherical();
    this._v = new THREE.Vector3();
    c.addEventListener("start", () => {
      this.idle = 0;
      c.autoRotate = false;
      if (this.transition) this.finishTransition();
    });
  }

  applyLimits(cfg) {
    const c = this.controls;
    c.minDistance = cfg.min;
    c.maxDistance = cfg.max;
    c.maxPolarAngle = cfg.maxPolar;
  }

  /** Smoothly fly to a target with a given spherical offset. */
  flyTo(target, { radius, phi, theta, duration = 1.7 }) {
    const c = this.controls;
    const from = this._sph.setFromVector3(this._v.copy(this.camera.position).sub(c.target));
    const toTheta = theta ?? from.theta;
    let dTheta = toTheta - from.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    this.transition = {
      t: 0,
      dur: this.reduceMotion ? 0.001 : duration,
      fromTarget: c.target.clone(),
      toTarget: target.clone(),
      from: { radius: from.radius, phi: from.phi, theta: from.theta },
      to: { radius, phi: phi ?? from.phi, theta: from.theta + dTheta },
    };
    c.enabled = false;
    c.autoRotate = false;
  }

  finishTransition() {
    this.transition = null;
    this.controls.enabled = true;
  }

  setMode(mode, rover, opts = {}) {
    const cfg = CAMERA_MODES[mode];
    this.mode = mode;
    this.applyLimits({ ...cfg, min: Math.min(cfg.min, this.controls.minDistance) });
    this.pendingLimits = cfg;
    const target = cfg.target ? new THREE.Vector3(...cfg.target) : rover.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
    const theta = cfg.theta ?? rover.heading + Math.PI + 0.5;
    this.follow = mode === "rover" ? rover : null;
    if (this.follow) this.lastFollow.copy(rover.pos);
    this.flyTo(target, { radius: cfg.radius, phi: cfg.phi, theta, duration: opts.duration ?? 1.8 });
    this.idle = 0;
  }

  focusOn(center, { distance, height = 2 }) {
    const target = center.clone();
    target.y += height;
    this.flyTo(target, { radius: distance, phi: Math.min(1.25, this.controls.getPolarAngle()), duration: 1.4 });
  }

  update(dt) {
    const c = this.controls;
    if (this.transition) {
      const tr = this.transition;
      tr.t += dt;
      const k = ease(Math.min(1, tr.t / tr.dur));
      if (this.follow) {
        tr.toTarget.copy(this.follow.pos).y += 1.4;
      }
      c.target.lerpVectors(tr.fromTarget, tr.toTarget, k);
      const radius = Math.exp(Math.log(tr.from.radius) + (Math.log(tr.to.radius) - Math.log(tr.from.radius)) * k);
      // Arc up and over during long flights for a cinematic path.
      const lift = Math.sin(k * Math.PI) * Math.min(0.35, Math.abs(Math.log(tr.to.radius / tr.from.radius)) * 0.08);
      const phi = tr.from.phi + (tr.to.phi - tr.from.phi) * k - lift;
      const theta = tr.from.theta + (tr.to.theta - tr.from.theta) * k;
      this._sph.set(radius, Math.max(0.05, phi), theta);
      this.camera.position.copy(c.target).add(this._v.setFromSpherical(this._sph));
      this.camera.lookAt(c.target);
      if (tr.t >= tr.dur) {
        this.finishTransition();
        if (this.pendingLimits) this.applyLimits(this.pendingLimits);
        this.pendingLimits = null;
      }
    } else {
      if (this.follow) {
        const d = this._v.copy(this.follow.pos).sub(this.lastFollow);
        c.target.add(d);
        this.camera.position.add(d);
      }
      this.idle += dt;
      if (this.mode === "orbit" && this.idle > 9 && !this.reduceMotion) c.autoRotate = true;
      // Keep the target near the settlement region.
      const r = Math.hypot(c.target.x, c.target.z);
      if (r > 950) c.target.multiplyScalar(950 / r);
      if (this.mode !== "aerial") {
        const g = heightAt(c.target.x, c.target.z);
        if (c.target.y < g + 0.5) c.target.y = g + 0.5;
      }
      c.update(dt);
    }
    if (this.follow) this.lastFollow.copy(this.follow.pos);
    // Never clip into the ground.
    const ground = heightAt(this.camera.position.x, this.camera.position.z) + 1.4;
    if (this.camera.position.y < ground) this.camera.position.y = ground;
  }
}
