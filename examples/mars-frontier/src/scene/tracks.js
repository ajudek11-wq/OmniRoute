import * as THREE from "three";
import { heightAt } from "./terrain.js";

/**
 * Wheel tracks pressed into the regolith behind the rover: a fixed-size ring buffer of quads
 * (two tracks), one draw call, oldest segments fade out and are recycled.
 */
const SEG_LEN = 0.7;
const HALF_GAUGE = 1.55;
const WIDTH = 0.42;

function treadTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 64, 64);
  // Chevron grouser imprints, darker in the compressed centre.
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.fillRect(6, 0, 52, 64);
  g.fillStyle = "rgba(255,255,255,1)";
  for (let y = 0; y < 64; y += 16) {
    g.beginPath();
    g.moveTo(6, y + 10);
    g.lineTo(32, y + 2);
    g.lineTo(58, y + 10);
    g.lineTo(58, y + 15);
    g.lineTo(32, y + 7);
    g.lineTo(6, y + 15);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TrackTrail {
  constructor(maxSegments = 700) {
    this.max = maxSegments;
    const quads = maxSegments * 2;
    this.pos = new Float32Array(quads * 4 * 3);
    this.uv = new Float32Array(quads * 4 * 2);
    this.col = new Float32Array(quads * 4 * 4);
    const idx = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("uv", new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    const mat = new THREE.MeshStandardMaterial({
      color: "#4a2a1b",
      roughness: 1,
      map: treadTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = true;
    this.head = 0;
    this.count = 0;
    this.last = null;
    this.dist = 0;
    this.writes = 0;
  }

  /** Call every frame with the rover's position + heading. */
  update(pos, heading, moving) {
    if (!moving) {
      if (this.last) this.last = { x: pos.x, z: pos.z, h: heading, d: this.last.d };
      return;
    }
    if (!this.last) {
      this.last = { x: pos.x, z: pos.z, h: heading, d: 0 };
      return;
    }
    const step = Math.hypot(pos.x - this.last.x, pos.z - this.last.z);
    if (step < SEG_LEN) return;
    if (step > 6) {
      // Teleport (load/restore): restart the trail.
      this.last = { x: pos.x, z: pos.z, h: heading, d: 0 };
      return;
    }
    const d1 = this.last.d + step;
    for (const side of [-1, 1]) this.writeQuad(this.last, { x: pos.x, z: pos.z, h: heading, d: d1 }, side);
    this.head = (this.head + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this.last = { x: pos.x, z: pos.z, h: heading, d: d1 };
    this.geo.setDrawRange(0, this.count * 12);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    if (++this.writes % 25 === 0) this.refade();
    this.geo.attributes.color.needsUpdate = true;
  }

  writeQuad(a, b, side) {
    const q = this.head * 2 + (side > 0 ? 1 : 0);
    const v = q * 4;
    const corners = [];
    for (const p of [a, b]) {
      const rx = Math.cos(p.h);
      const rz = -Math.sin(p.h);
      const cx = p.x + rx * HALF_GAUGE * side;
      const cz = p.z + rz * HALF_GAUGE * side;
      for (const e of [-1, 1]) {
        const x = cx + rx * (WIDTH / 2) * e;
        const z = cz + rz * (WIDTH / 2) * e;
        corners.push([x, heightAt(x, z) + 0.06, z, e < 0 ? 0 : 1, p.d / 0.45]);
      }
    }
    corners.forEach(([x, y, z, u, w], i) => {
      this.pos.set([x, y, z], (v + i) * 3);
      this.uv.set([u, w], (v + i) * 2);
      this.col.set([1, 1, 1, 0.75], (v + i) * 4);
    });
  }

  /** Older segments fade towards nothing before they are recycled. */
  refade() {
    for (let k = 0; k < this.count; k++) {
      const slot = (this.head - 1 - k + this.max) % this.max;
      const age = k / this.max;
      const a = 0.75 * (1 - Math.max(0, (age - 0.55) / 0.45));
      for (let q = 0; q < 2; q++) {
        for (let i = 0; i < 4; i++) this.col[((slot * 2 + q) * 4 + i) * 4 + 3] = a;
      }
    }
  }
}
