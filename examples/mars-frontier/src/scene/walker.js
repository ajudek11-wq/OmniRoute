import * as THREE from "three";
import { heightAt, canyonCut } from "./terrain.js";
import { stepPlayer, headBob, clampLook, wrapAngle, WALK } from "../walk/movement.js";

/**
 * First-person walker. Owns the camera while walking: a player on the terrain surface with
 * eye height, head bob, collision against structures, rocks and landmarks, and a steep-cliff
 * limit. Input is a normalised move vector plus look rates, filled by touch, keyboard or mouse.
 */
export class Walker {
  constructor(camera) {
    this.camera = camera;
    this.active = false;
    this.state = { x: 0, z: 0, yaw: 0, pitch: -0.05, speed: 0, moving: false, blocked: false, travelled: 0 };
    this.input = { mx: 0, mz: 0, sprint: false, lookX: 0, lookY: 0 };
    this.sens = 1;
    this.colliders = [];
    this.groundY = 0;
    this.bob = 0;
    this.roll = 0;
    this.blend = null;
    this.cam = { yaw: 0, pitch: 0 };
  }

  setColliders(list) {
    this.colliders = list;
  }

  enter(x, z, yaw) {
    Object.assign(this.state, { x, z, yaw, pitch: -0.05, speed: 0, moving: false, blocked: false });
    this.groundY = heightAt(x, z);
    this.active = true;
    this.blend = { t: 0, from: this.camera.position.clone(), fromQ: this.camera.quaternion.clone() };
  }

  exit() {
    this.active = false;
    this.input.mx = this.input.mz = this.input.lookX = this.input.lookY = 0;
    this.input.sprint = false;
  }

  /** Touch/mouse drag in pixels. */
  look(dx, dy) {
    const k = 0.0042 * this.sens;
    this.state.yaw -= dx * k;
    this.state.pitch = clampLook(this.state.pitch - dy * k);
  }

  update(dt) {
    if (!this.active) return;
    const s = this.state;
    stepPlayer(s, this.input, dt, heightAt, this.colliders);
    // Stick-driven look (joystick right side or arrow keys).
    s.yaw -= this.input.lookX * dt * 2.4 * this.sens;
    s.pitch = clampLook(s.pitch + this.input.lookY * dt * 1.6 * this.sens);
    s.yaw = wrapAngle(s.yaw);

    const target = heightAt(s.x, s.z);
    this.groundY += (target - this.groundY) * Math.min(1, dt * 14);
    const bob = s.moving ? headBob(s.travelled) : { y: 0, roll: 0 };
    this.bob += (bob.y - this.bob) * Math.min(1, dt * 10);
    this.roll += (bob.roll - this.roll) * Math.min(1, dt * 10);

    const cam = this.camera;
    cam.position.set(s.x, this.groundY + WALK.eye + this.bob, s.z);
    // Three.js cameras look down −z; yaw 0 is +z (north is −z), so add π.
    cam.rotation.set(s.pitch, s.yaw + Math.PI, this.roll, "YXZ");
    if (this.blend) {
      this.blend.t += dt;
      const k = Math.min(1, this.blend.t / 1.1);
      const e = k * k * (3 - 2 * k);
      cam.position.lerpVectors(this.blend.from, cam.position, e);
      cam.quaternion.slerpQuaternions(this.blend.fromQ, cam.quaternion, e);
      if (k >= 1) this.blend = null;
    }
  }

  /** Looking direction in the world (for ray picks and the compass). */
  forward() {
    return new THREE.Vector3(Math.sin(this.state.yaw), 0, Math.cos(this.state.yaw));
  }

  /** Where the player is standing, described for the location label. */
  area() {
    if (canyonCut(this.state.x, this.state.z) > 4) return "Canyon floor";
    return null;
  }
}
