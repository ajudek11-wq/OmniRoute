import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { heightAt } from "./terrain.js";

export const CAMERA_MODES = {
  orbit: { label: "Orbit", target: [6, 3, -2], radius: 150, phi: 1.02, theta: -0.6, min: 25, max: 650, maxPolar: 1.45, autoRotate: true },
  surface: { label: "Surface", target: [4, 4, 4], radius: 46, phi: 1.49, theta: 0.42, min: 3, max: 90, maxPolar: 1.56 },
  aerial: { label: "Aerial", target: [20, 0, 10], radius: 640, phi: 0.42, theta: 0.4, min: 220, max: 1700, maxPolar: 1.1 },
  habitat: { label: "Habitat", target: [0, 5, 0], radius: 34, phi: 1.22, theta: 0.35, min: 12, max: 120, maxPolar: 1.53 },
  rover: { label: "Rover", target: null, radius: 15, phi: 1.2, theta: null, min: 5, max: 80, maxPolar: 1.53 },
  roverInspect: { label: "Inspect", hidden: true, target: null, radius: 7.5, phi: 1.12, theta: null, min: 3.2, max: 22, maxPolar: 1.55 },
  mastcam: { label: "Mastcam", hidden: true },
  walk: { label: "Walk", walk: true },
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.baseFov = camera.fov;
    this.controls = new OrbitControls(camera, dom);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.06;
    c.rotateSpeed = 0.5;
    c.zoomSpeed = 0.85;
    c.panSpeed = 0.7;
    c.screenSpacePanning = false;
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.autoRotateSpeed = 0.3;
    this.mode = "orbit";
    this.transition = null;
    this.follow = null;
    this.followHeight = 1.4;
    this.lastFollow = new THREE.Vector3();
    this.idle = 0;
    this.reduceMotion = false;
    this.cinematic = false;
    this.look = { yaw: 0, pitch: -0.06, yawV: 0, pitchV: 0 };
    this.mastBlend = 0;
    this._sph = new THREE.Spherical();
    this._v = new THREE.Vector3();
    this._p = new THREE.Vector3();
    c.addEventListener("start", () => {
      this.idle = 0;
      c.autoRotate = false;
      if (this.transition) this.finishTransition();
    });
    this.initLook(dom);
  }

  /** Drag-to-look for the first-person Mastcam view. */
  initLook(dom) {
    let last = null;
    dom.addEventListener("pointerdown", (e) => {
      if (this.mode !== "mastcam") return;
      last = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener("pointermove", (e) => {
      if (this.mode !== "mastcam" || !last) return;
      const k = 0.0042 * (this.camera.fov / 40);
      this.look.yawV = -(e.clientX - last.x) * k;
      this.look.pitchV = -(e.clientY - last.y) * k;
      this.look.yaw += this.look.yawV;
      this.look.pitch = Math.max(-0.9, Math.min(0.6, this.look.pitch + this.look.pitchV));
      last = { x: e.clientX, y: e.clientY };
    });
    const end = () => (last = null);
    dom.addEventListener("pointerup", end);
    dom.addEventListener("pointercancel", end);
  }

  applyLimits(cfg) {
    const c = this.controls;
    c.minDistance = cfg.min;
    c.maxDistance = cfg.max;
    c.maxPolarAngle = cfg.maxPolar;
  }

  flyTo(target, { radius, phi, theta, duration = 1.8 }) {
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
    this.controls.enabled = this.mode !== "mastcam" && !this.cinematic;
  }

  setMode(mode, rover, opts = {}) {
    const cfg = CAMERA_MODES[mode];
    const prev = this.mode;
    this.mode = mode;
    this.idle = 0;
    if (mode === "mastcam") {
      if (prev !== "mastcam") this.baseFov = this.camera.fov;
      this.follow = rover;
      this.rover = rover;
      this.look.yaw = 0;
      this.look.pitch = -0.08;
      this.mastBlend = this.reduceMotion ? 1 : 0;
      this.controls.enabled = false;
      this.controls.autoRotate = false;
      this.transition = null;
      return;
    }
    if (prev === "mastcam") {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
      // Re-seat the orbit target in front of the camera so the fly-out starts cleanly.
      this.camera.getWorldDirection(this._v);
      this.controls.target.copy(this.camera.position).addScaledVector(this._v, 8);
    }
    this.applyLimits({ ...cfg, min: Math.min(cfg.min, this.controls.minDistance) });
    this.pendingLimits = cfg;
    this.followHeight = mode === "roverInspect" ? 1.3 : 1.4;
    const target = cfg.target ? new THREE.Vector3(...cfg.target) : rover.pos.clone().add(new THREE.Vector3(0, this.followHeight, 0));
    const theta = cfg.theta ?? rover.heading + Math.PI + (mode === "roverInspect" ? 0.9 : 0.5);
    this.follow = mode === "rover" || mode === "roverInspect" ? rover : null;
    if (this.follow) this.lastFollow.copy(rover.pos);
    this.flyTo(target, { radius: cfg.radius, phi: cfg.phi, theta, duration: opts.duration ?? 1.9 });
  }

  focusOn(center, { distance, height = 2 }) {
    const target = center.clone();
    target.y += height;
    this.flyTo(target, { radius: distance, phi: Math.min(1.25, this.controls.getPolarAngle()), duration: 1.5 });
  }

  updateMastcam(dt) {
    const r = this.rover;
    const cam = this.camera;
    const eye = r.mastWorld(this._p);
    eye.y += 0.05;
    const yaw = r.heading + r.mastHead.rotation.y * 0 + this.look.yaw;
    const dir = this._v.set(Math.sin(yaw) * Math.cos(this.look.pitch), Math.sin(this.look.pitch), Math.cos(yaw) * Math.cos(this.look.pitch));
    if (this.mastBlend < 1) {
      this.mastBlend = Math.min(1, this.mastBlend + dt / 1.4);
      const k = ease(this.mastBlend);
      cam.position.lerp(eye, k);
      cam.fov += (40 - cam.fov) * k;
    } else {
      cam.position.copy(eye);
      cam.fov = 40;
    }
    cam.updateProjectionMatrix();
    cam.lookAt(this._p.copy(cam.position).add(dir));
  }

  update(dt) {
    if (this.cinematic || this.mode === "walk") return;
    const c = this.controls;
    if (this.mode === "mastcam") {
      this.updateMastcam(dt);
      return;
    }
    if (this.transition) {
      const tr = this.transition;
      tr.t += dt;
      const k = ease(Math.min(1, tr.t / tr.dur));
      if (this.follow) tr.toTarget.copy(this.follow.pos).y += this.followHeight;
      c.target.lerpVectors(tr.fromTarget, tr.toTarget, k);
      const radius = Math.exp(Math.log(tr.from.radius) + (Math.log(tr.to.radius) - Math.log(tr.from.radius)) * k);
      const lift = Math.sin(k * Math.PI) * Math.min(0.3, Math.abs(Math.log(tr.to.radius / tr.from.radius)) * 0.07);
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
      const r = Math.hypot(c.target.x, c.target.z);
      if (r > 950) c.target.multiplyScalar(950 / r);
      if (this.mode !== "aerial") {
        const g = heightAt(c.target.x, c.target.z);
        if (c.target.y < g + 0.5) c.target.y = g + 0.5;
      }
      c.update(dt);
    }
    if (this.follow) this.lastFollow.copy(this.follow.pos);
    const ground = heightAt(this.camera.position.x, this.camera.position.z) + 1.2;
    if (this.camera.position.y < ground) this.camera.position.y = ground;
  }
}
