import * as THREE from "three";
import { heightAt } from "./terrain.js";
import { bakeStatic } from "./settlement.js";
import { OBSTACLES, ROVER_HOME } from "../data/layout.js";

const WHEEL_R = 0.46;
const TRACK = 1.55; // half-width between wheel centres
const BASE = 1.6; // front/back wheel offset

export class Rover {
  constructor(M) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.wheels = [];
    this.build(M);
    this.pos = new THREE.Vector3(ROVER_HOME.x, 0, ROVER_HOME.z);
    this.heading = ROVER_HOME.heading;
    this.speed = 0;
    this.maxSpeed = 9;
    this.pitch = 0;
    this.roll = 0;
    this.target = null;
    this.onArrive = null;
    this.task = "Parked at garage";
    this.odometer = 0;
    this.battery = 1;
    this.mastYaw = 0;
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.root.position.copy(this.pos);
    this.root.rotation.order = "YXZ";
    this.root.rotation.y = this.heading;
    this.hit.userData.pick = { kind: "rover", id: "rover" };
  }

  build(M) {
    const b = this.body;
    const mk = (geo, mat, x, y, z, o = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (o.rx) m.rotation.x = o.rx;
      if (o.ry) m.rotation.y = o.ry;
      if (o.rz) m.rotation.z = o.rz;
      m.castShadow = o.cast ?? true;
      m.receiveShadow = true;
      if (o.parent) o.parent.add(m);
      else b.add(m);
      return m;
    };
    const chassis = new THREE.Group();
    b.add(chassis);
    const o = { parent: chassis };
    // Body
    mk(new THREE.BoxGeometry(2.3, 0.7, 3.6), M.white, 0, 1.35, 0, o);
    mk(new THREE.BoxGeometry(2.36, 0.12, 3.66), M.metalDark, 0, 1.02, 0, o);
    mk(new THREE.BoxGeometry(2.4, 0.16, 0.5), M.orange, 0, 1.55, 1.6, o);
    mk(new THREE.BoxGeometry(1.9, 0.08, 2.6), M.solar, 0, 1.74, -0.35, o);
    mk(new THREE.BoxGeometry(0.9, 0.5, 0.8), M.gold, -0.55, 1.95, -1.25, o);
    mk(new THREE.BoxGeometry(0.7, 0.4, 0.6), M.hullPanel, 0.6, 1.9, 1.15, o);
    // Rear power unit with fins
    mk(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 12), M.metalDark, 0, 1.45, -2.15, { ...o, rx: 0.9 });
    for (let k = 0; k < 6; k++) {
      mk(new THREE.BoxGeometry(0.04, 0.3, 1.0), M.metal, 0, 1.45, -2.15, { ...o, rx: 0.9, rz: (k / 6) * Math.PI });
    }
    // Front light bar
    this.lights = mk(new THREE.BoxGeometry(1.6, 0.12, 0.06), M.lampHead, 0, 1.25, 1.83, { ...o, cast: false });
    // Rocker-bogie arms + wheels
    const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.38, 18);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.42, 10);
    hubGeo.rotateZ(Math.PI / 2);
    const treadGeo = new THREE.BoxGeometry(0.4, 0.06, 0.12);
    for (const side of [-1, 1]) {
      mk(new THREE.BoxGeometry(0.12, 0.14, 2.2), M.metal, side * 1.32, 0.95, 0.5, { ...o, rx: 0.32 });
      mk(new THREE.BoxGeometry(0.12, 0.14, 1.9), M.metal, side * 1.32, 0.8, -1.0, { ...o, rx: -0.28 });
      mk(new THREE.CylinderGeometry(0.14, 0.14, 0.3, 10), M.metalDark, side * 1.3, 1.05, 0, { ...o, rz: Math.PI / 2 });
      for (const z of [BASE, 0, -BASE]) {
        const w = new THREE.Group();
        w.position.set(side * TRACK, WHEEL_R, z);
        const tire = new THREE.Mesh(wheelGeo, M.metalDark);
        tire.castShadow = true;
        w.add(tire);
        const hub = new THREE.Mesh(hubGeo, M.metal);
        w.add(hub);
        for (let k = 0; k < 10; k++) {
          const tr = new THREE.Mesh(treadGeo, M.metal);
          const a = (k / 10) * Math.PI * 2;
          tr.position.set(0, Math.cos(a) * WHEEL_R, Math.sin(a) * WHEEL_R);
          tr.rotation.x = -a;
          w.add(tr);
        }
        b.add(w);
        this.wheels.push({ group: w, side, z, phase: 0 });
      }
    }
    // Mast with camera head
    mk(new THREE.CylinderGeometry(0.07, 0.08, 1.6, 8), M.metal, 0.75, 2.5, 1.3, o);
    this.mastHead = new THREE.Group();
    this.mastHead.position.set(0.75, 3.35, 1.3);
    b.add(this.mastHead);
    mk(new THREE.BoxGeometry(0.62, 0.3, 0.32), M.white, 0, 0, 0, { parent: this.mastHead });
    mk(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10), M.metalDark, -0.16, 0, 0.18, { parent: this.mastHead, rx: Math.PI / 2 });
    mk(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10), M.metalDark, 0.16, 0, 0.18, { parent: this.mastHead, rx: Math.PI / 2 });
    // High-gain antenna
    mk(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), M.metal, -0.75, 2.1, -0.6, o);
    mk(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 18), M.white, -0.75, 2.42, -0.6, { ...o, rx: 0.6 });
    mk(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), M.metal, 0.9, 2.4, -1.6, { ...o, cast: false });
    // Folded robotic arm
    mk(new THREE.BoxGeometry(0.14, 0.14, 1.2), M.metal, -0.6, 1.1, 2.1, { ...o, ry: 0.4 });
    mk(new THREE.BoxGeometry(0.3, 0.3, 0.36), M.gold, -0.35, 1.1, 2.6, o);
    bakeStatic(chassis);

    this.hit = new THREE.Mesh(new THREE.BoxGeometry(4.5, 4.5, 5.5), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.position.y = 1.6;
    this.root.add(this.hit);
  }

  driveTo(x, z, task, onArrive) {
    // Never target the inside of an obstacle — push the goal to its edge.
    for (const o of OBSTACLES) {
      const dx = x - o.x;
      const dz = z - o.z;
      const d = Math.hypot(dx, dz);
      if (d < o.r + 2.5) {
        const k = (o.r + 3) / (d || 1);
        x = o.x + (d ? dx : 1) * k;
        z = o.z + (d ? dz : 0) * k;
      }
    }
    const lim = 900;
    const r = Math.hypot(x, z);
    if (r > lim) {
      x *= lim / r;
      z *= lim / r;
    }
    this.target = new THREE.Vector3(x, heightAt(x, z), z);
    this.task = task;
    this.onArrive = onArrive ?? null;
  }

  stop(task = "Holding position") {
    this.target = null;
    this.task = task;
  }

  get moving() {
    return this.speed > 0.2;
  }

  update(dt, t) {
    let desired = 0;
    if (this.target) {
      const dx = this.target.x - this.pos.x;
      const dz = this.target.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 2.2) {
        this.target = null;
        const cb = this.onArrive;
        this.onArrive = null;
        if (cb) cb();
      } else {
        let vx = dx / dist;
        let vz = dz / dist;
        // Steer around structures (potential field + tangential slide).
        for (const o of OBSTACLES) {
          const ox = this.pos.x - o.x;
          const oz = this.pos.z - o.z;
          const od = Math.hypot(ox, oz);
          const reach = o.r + 9;
          if (od < reach && od > 0.01) {
            const k = ((reach - od) / 9) * 1.6;
            const nx = ox / od;
            const nz = oz / od;
            const side = Math.sign(nx * vz - nz * vx) || 1;
            vx += nx * k + -nz * side * k * 0.9;
            vz += nz * k + nx * side * k * 0.9;
          }
        }
        const desiredHeading = Math.atan2(vx, vz);
        let diff = desiredHeading - this.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const turnRate = 1.5;
        this.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
        const turnPenalty = Math.max(0.25, 1 - Math.abs(diff) / 1.6);
        desired = Math.min(this.maxSpeed, dist * 0.8 + 1.5) * turnPenalty;
      }
    }
    this.speed += (desired - this.speed) * Math.min(1, dt * 1.6);
    const step = this.speed * dt;
    this.pos.x += Math.sin(this.heading) * step;
    this.pos.z += Math.cos(this.heading) * step;
    this.odometer += step;
    this.battery = Math.max(0.05, this.battery - step * 0.00004);
    const atHome = Math.hypot(this.pos.x - ROVER_HOME.x, this.pos.z - ROVER_HOME.z) < 8;
    if (atHome && !this.moving) this.battery = Math.min(1, this.battery + dt * 0.01);

    // Terrain following: sample four contact points for pitch & roll.
    const sh = Math.sin(this.heading);
    const ch = Math.cos(this.heading);
    const hf = heightAt(this.pos.x + sh * BASE, this.pos.z + ch * BASE);
    const hb = heightAt(this.pos.x - sh * BASE, this.pos.z - ch * BASE);
    const hr = heightAt(this.pos.x + ch * TRACK, this.pos.z - sh * TRACK);
    const hl = heightAt(this.pos.x - ch * TRACK, this.pos.z + sh * TRACK);
    const targetPitch = -Math.atan2(hf - hb, BASE * 2);
    const targetRoll = Math.atan2(hr - hl, TRACK * 2);
    const k = Math.min(1, dt * 6);
    this.pitch += (targetPitch - this.pitch) * k;
    this.roll += (targetRoll - this.roll) * k;
    this.pos.y += ((hf + hb + hl + hr) / 4 - this.pos.y) * Math.min(1, dt * 10);
    this.root.position.copy(this.pos);
    this.root.rotation.set(this.pitch, this.heading, this.roll);

    for (const w of this.wheels) {
      w.phase += step / WHEEL_R;
      w.group.rotation.x = w.phase;
    }
    this.mastYaw = this.moving ? 0 : Math.sin(t * 0.3) * 0.9;
    this.mastHead.rotation.y += (this.mastYaw - this.mastHead.rotation.y) * Math.min(1, dt * 2);
    this.body.position.y = Math.sin(t * 9) * 0.012 * Math.min(1, this.speed);
  }

  telemetry() {
    return {
      speed: this.speed,
      heading: ((((this.heading * 180) / Math.PI) % 360) + 360) % 360,
      pitch: (this.pitch * 180) / Math.PI,
      roll: (this.roll * 180) / Math.PI,
      odometer: this.odometer,
      battery: this.battery,
      task: this.task,
      x: this.pos.x,
      z: this.pos.z,
    };
  }
}
