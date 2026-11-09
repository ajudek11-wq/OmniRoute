import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { heightAt } from "./terrain.js";
import { bakeStatic } from "./settlement.js";
import { OBSTACLES, ROVER_HOME } from "../data/layout.js";

const WHEEL_R = 0.46;
const TRACK = 1.55; // half-width between wheel centres
const BASE = 1.6; // front/back wheel offset
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export const ROVER_PARTS = [
  {
    id: "mast",
    name: "Mast camera head",
    desc: "Stereo colour cameras on a pan/tilt head about 3.4 m above the ground. They take navigation images and geological context panoramas.",
  },
  {
    id: "libs",
    name: "Laser spectrometer",
    desc: "A pulsed laser vaporises a pinhead of rock up to about 7 m away, and a spectrometer reads the elemental composition of the plasma flash. The same idea as ChemCam/SuperCam.",
  },
  {
    id: "arm",
    name: "Robotic arm & turret",
    desc: "A five-joint arm carrying a coring drill, dust-removal brush and contact spectrometer. It deploys automatically at survey sites.",
  },
  {
    id: "hga",
    name: "High-gain antenna",
    desc: "A steerable flat-panel antenna that keeps pointing at the settlement's comms tower for high-rate telemetry.",
  },
  {
    id: "power",
    name: "Battery & thermal pack",
    desc: "Lithium-ion pack with radiators and heaters. Martian nights fall below −70 °C, so keeping the electronics warm costs real energy.",
  },
  {
    id: "wheels",
    name: "Rocker-bogie suspension",
    desc: "Six independently driven wheels. The four corner wheels steer. The rocker-bogie linkage keeps all six on the ground over obstacles up to about a wheel diameter.",
  },
  {
    id: "nav",
    name: "Hazard cameras & lidar",
    desc: "Wide-angle hazard cameras front and rear, plus a scanning lidar, build the terrain map the autonomous driver uses to plan around obstacles.",
  },
];

function strut(parent, a, b, r, mat, cast = true) {
  _a.copy(b).sub(a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, _a.length(), 8), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, _a.normalize());
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function wheelGeometries() {
  // Tyre with chevron grousers (merged) + hub.
  const tire = new THREE.CylinderGeometry(WHEEL_R - 0.04, WHEEL_R - 0.04, 0.4, 28, 1, false);
  tire.rotateZ(Math.PI / 2);
  const parts = [tire.toNonIndexed()];
  const n = 18;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.2, 0.05, 0.06);
      g.rotateY(s * 0.5);
      g.translate(s * 0.09, WHEEL_R - 0.02, 0);
      g.rotateX(a);
      parts.push(g.toNonIndexed());
    }
  }
  const tread = mergeGeometries(parts);
  const hubParts = [];
  const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.44, 16);
  hub.rotateZ(Math.PI / 2);
  hubParts.push(hub.toNonIndexed());
  for (let k = 0; k < 6; k++) {
    const sp = new THREE.BoxGeometry(0.04, WHEEL_R * 1.7, 0.05);
    sp.rotateX((k / 6) * Math.PI);
    sp.translate(0.17, 0, 0);
    hubParts.push(sp.toNonIndexed());
  }
  return { tread, hub: mergeGeometries(hubParts) };
}

/**
 * Regolith dust kicked up behind the wheels: one pooled THREE.Points draw call with per-particle
 * size and alpha (≤ 60 particles). Lives in world space so puffs stay where they were thrown.
 */
const DUST_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(320.0, aSize * projectionMatrix[1][1] * uScale / max(0.1, -mv.z));
  vAlpha = aAlpha;
}`;
const DUST_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.1, d);
  a *= sqrt(a) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class DustPuffs {
  constructor(max = 60) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.p = Array.from({ length: max }, () => ({ life: 0, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 0, s1: 0, a: 0 }));
    this.next = 0;
    this.live = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.base = new THREE.Color("#dcb896"); // lighter than the ground: fine dust scatters sunlight
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.base.clone() }, uScale: { value: 400 } },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.visible = true; // compiled with the scene at boot; hidden on the first update
  }

  /** Daylight factor (0 night … 1 noon) and drawing-buffer height for point sizing. */
  setView(light, bufferHeight) {
    this.mat.uniforms.uColor.value.copy(this.base).multiplyScalar(Math.max(0.12, Math.min(1, light)));
    this.mat.uniforms.uScale.value = bufferHeight * 0.5;
  }

  emit(x, y, z, vx, vy, vz, strength) {
    const q = this.p[this.next];
    this.next = (this.next + 1) % this.max;
    q.life = 1.3 + Math.random() * 1.1;
    q.age = 0;
    q.x = x + (Math.random() - 0.5) * 0.4;
    q.y = y + 0.08;
    q.z = z + (Math.random() - 0.5) * 0.4;
    q.vx = vx + (Math.random() - 0.5) * 0.9;
    q.vy = vy * (0.6 + Math.random() * 0.6);
    q.vz = vz + (Math.random() - 0.5) * 0.9;
    q.s0 = 0.35 + Math.random() * 0.3;
    q.s1 = 2.2 + Math.random() * 1.6 + strength * 1.2;
    q.a = 0.5 + strength * 0.35;
  }

  update(dt) {
    let live = 0;
    // Prevailing wind (towards ESE) carries the dust off slowly; drag settles it.
    const drag = Math.exp(-dt * 1.6);
    for (let i = 0; i < this.max; i++) {
      const q = this.p[i];
      if (q.age >= q.life) {
        this.alpha[i] = 0;
        continue;
      }
      live++;
      q.age += dt;
      q.vx = q.vx * drag + 0.25 * dt;
      q.vz = q.vz * drag + 0.08 * dt;
      q.vy = q.vy * drag - 0.5 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      const k = Math.min(1, q.age / q.life);
      this.pos[i * 3] = q.x;
      this.pos[i * 3 + 1] = q.y;
      this.pos[i * 3 + 2] = q.z;
      this.size[i] = q.s0 + (q.s1 - q.s0) * Math.sqrt(k);
      this.alpha[i] = q.a * Math.min(1, q.age * 8) * Math.pow(1 - k, 1.6);
    }
    this.live = live;
    this.points.visible = live > 0;
    if (live > 0 || this.wasLive) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
    }
    this.wasLive = live > 0;
  }
}

export class Rover {
  constructor(M) {
    this.M = M;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.wheels = [];
    this.parts = {};
    this.build(M);
    this.pos = new THREE.Vector3(ROVER_HOME.x, 0, ROVER_HOME.z);
    this.heading = ROVER_HOME.heading;
    this.speed = 0;
    this.maxSpeed = 9;
    this.pitch = 0;
    this.roll = 0;
    this.yawRate = 0;
    this.target = null;
    this.onArrive = null;
    this.task = "Parked at garage";
    this.odometer = 0;
    this.battery = 1;
    this.armDeploy = 0;
    this.armTarget = 0;
    this.busy = false;
    // Manual driving: when true, pos/heading/speed come from applyManual() each frame.
    this.manual = false;
    this.manualStep = 0;
    this.steerInput = 0;
    this.accel = 0;
    this.bodyPitch = 0;
    this.bodyRoll = 0;
    this.dust = new DustPuffs(60);
    this.dustAcc = 0;
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.root.position.copy(this.pos);
    this.root.rotation.order = "YXZ";
    this.root.rotation.y = this.heading;
    this.hit.userData.pick = { kind: "rover", id: "rover" };
  }

  build(M) {
    const b = this.body;
    const chassis = new THREE.Group();
    b.add(chassis);
    const mk = (geo, mat, x, y, z, o = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (o.rx) m.rotation.x = o.rx;
      if (o.ry) m.rotation.y = o.ry;
      if (o.rz) m.rotation.z = o.rz;
      m.castShadow = o.cast ?? true;
      m.receiveShadow = true;
      (o.parent ?? chassis).add(m);
      return m;
    };
    const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const cylG = (r1, r2, h, s = 12) => new THREE.CylinderGeometry(r1, r2, h, s);

    // ── Body: warm electronics box, insulated panels, deck ──
    mk(boxG(2.2, 0.72, 3.3), M.hull, 0, 1.42, 0);
    mk(boxG(2.26, 0.1, 3.36), M.metalDark, 0, 1.03, 0);
    mk(boxG(2.1, 0.08, 3.2), M.composite, 0, 1.82, 0);
    mk(boxG(2.24, 0.42, 1.2), M.mli, 0, 1.4, -0.9);
    mk(boxG(2.3, 0.12, 0.42), M.orange, 0, 1.62, 1.55);
    mk(boxG(0.9, 0.42, 0.8), M.foil, -0.5, 2.07, -0.95);
    mk(boxG(0.7, 0.32, 0.6), M.hullDark, 0.55, 2.0, 0.2);
    mk(boxG(0.5, 0.2, 0.5), M.foil, -0.55, 1.95, 0.55);
    // Radiator panel on the deck.
    mk(boxG(1.4, 0.04, 0.9), M.radiator, 0.35, 1.9, -0.6);
    // Rear battery & thermal pack with fins.
    mk(boxG(1.6, 0.6, 0.55), M.hullDark, 0, 1.45, -1.95);
    for (let k = 0; k < 9; k++) mk(boxG(0.03, 0.5, 0.42), M.metal, -0.72 + k * 0.18, 1.45, -2.27, { cast: false });
    // Headlights + hazcams + lidar.
    for (const s of [-1, 1]) {
      mk(boxG(0.4, 0.1, 0.05), M.lampHead, s * 0.6, 1.3, 1.67, { cast: false });
      mk(boxG(0.22, 0.12, 0.12), M.metalDark, s * 0.25, 1.15, 1.7);
      mk(cylG(0.035, 0.035, 0.05, 10), M.window, s * 0.25, 1.15, 1.77, { rx: Math.PI / 2, cast: false });
      mk(boxG(0.22, 0.12, 0.12), M.metalDark, s * 0.3, 1.2, -2.27);
    }
    mk(cylG(0.13, 0.13, 0.16, 16), M.metalDark, 0.95, 1.95, 1.45);
    mk(cylG(0.11, 0.11, 0.06, 16), M.window, 0.95, 2.05, 1.45, { cast: false });
    // Low-gain antenna whip.
    mk(cylG(0.015, 0.015, 1.3, 4), M.metal, 0.95, 2.45, -1.55, { cast: false });
    // Handrails.
    for (const s of [-1, 1]) mk(cylG(0.025, 0.025, 2.6, 6), M.metal, s * 1.08, 1.95, 0, { rx: Math.PI / 2, cast: false });

    // ── Rocker-bogie suspension (static linkages) ──
    for (const s of [-1, 1]) {
      const pivot = V3(s * 1.22, 1.12, 0.35);
      const bogie = V3(s * 1.45, 0.82, -0.8);
      const steerTop = (z) => V3(s * TRACK, 1.0, z);
      strut(chassis, pivot, steerTop(BASE), 0.06, M.metal);
      strut(chassis, pivot, bogie, 0.06, M.metal);
      strut(chassis, bogie, steerTop(0), 0.055, M.metal);
      strut(chassis, bogie, steerTop(-BASE), 0.055, M.metal);
      mk(cylG(0.11, 0.11, 0.2, 12), M.metalDark, pivot.x, pivot.y, pivot.z, { rz: Math.PI / 2 });
      mk(cylG(0.09, 0.09, 0.18, 12), M.metalDark, bogie.x, bogie.y, bogie.z, { rz: Math.PI / 2 });
      // Steering / drive actuators above each wheel.
      for (const z of [BASE, 0, -BASE]) mk(cylG(0.1, 0.1, 0.22, 10), M.hullDark, s * TRACK, 1.0, z);
    }
    // Differential bar across the top.
    mk(boxG(2.5, 0.08, 0.1), M.metal, 0, 1.92, 0.35);
    bakeStatic(chassis);

    // ── Wheels (spin inside steer groups) ──
    const { tread, hub } = wheelGeometries();
    for (const s of [-1, 1]) {
      for (const z of [BASE, 0, -BASE]) {
        const steer = new THREE.Group();
        steer.position.set(s * TRACK, WHEEL_R, z);
        const spin = new THREE.Group();
        steer.add(spin);
        const t = new THREE.Mesh(tread, M.rubber);
        const h = new THREE.Mesh(hub, M.metal);
        t.castShadow = true;
        h.castShadow = true;
        t.receiveShadow = h.receiveShadow = true;
        spin.add(t, h);
        // Vertical steering column from the actuator down to the hub.
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0 - WHEEL_R, 8), M.metal);
        col.position.y = (1.0 - WHEEL_R) / 2;
        col.position.x = -s * 0.27;
        const fork = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.24), M.metalDark);
        fork.position.set(-s * 0.27, 0.02, 0);
        steer.add(col, fork);
        b.add(steer);
        this.wheels.push({ steer, spin, side: s, z, susp: 0, angle: 0 });
      }
    }

    // ── Mast with pan/tilt head, stereo cameras and laser spectrometer ──
    const mastBase = new THREE.Group();
    mastBase.position.set(0.72, 1.86, 1.25);
    b.add(mastBase);
    const mastTube = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 1.45, 10), M.hull);
    mastTube.position.y = 0.72;
    mastTube.castShadow = true;
    mastBase.add(mastTube);
    this.mastHead = new THREE.Group();
    this.mastHead.position.set(0, 1.5, 0);
    mastBase.add(this.mastHead);
    this.mastTilt = new THREE.Group();
    this.mastHead.add(this.mastTilt);
    const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.26, 0.34), M.hull);
    headBox.castShadow = true;
    this.mastTilt.add(headBox);
    for (const x of [-0.2, 0.2]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 14), M.metalDark);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(x, 0, 0.2);
      const glassL = new THREE.Mesh(new THREE.CircleGeometry(0.045, 14), M.window);
      glassL.position.set(x, 0, 0.262);
      this.mastTilt.add(lens, glassL);
    }
    const libs = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.4, 16), M.hullDark);
    libs.rotation.x = Math.PI / 2;
    libs.position.set(0, 0.24, 0.05);
    const libsLens = new THREE.Mesh(new THREE.CircleGeometry(0.085, 16), M.window);
    libsLens.position.set(0, 0.24, 0.252);
    this.mastTilt.add(libs, libsLens);

    // ── High-gain antenna on a two-axis gimbal ──
    this.hga = new THREE.Group();
    this.hga.position.set(-0.7, 2.1, -0.15);
    b.add(this.hga);
    const hgaPost = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.4, 8), M.metal);
    hgaPost.position.y = 0.2;
    this.hga.add(hgaPost);
    this.hgaTilt = new THREE.Group();
    this.hgaTilt.position.y = 0.42;
    this.hga.add(this.hgaTilt);
    const panel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 6), M.radiator);
    panel.castShadow = true;
    this.hgaTilt.add(panel);

    // ── Five-joint robotic arm (stowed across the front) ──
    const arm = new THREE.Group();
    arm.position.set(-0.55, 1.25, 1.72);
    b.add(arm);
    this.arm = { root: arm };
    const seg = (len, r, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(r, r, len), mat);
      m.position.z = len / 2;
      m.castShadow = true;
      return m;
    };
    const shoulder = new THREE.Group();
    arm.add(shoulder);
    shoulder.add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.22, 12), M.metalDark));
    const upper = new THREE.Group();
    shoulder.add(upper);
    upper.add(seg(0.95, 0.12, M.hull));
    const elbow = new THREE.Group();
    elbow.position.z = 0.95;
    upper.add(elbow);
    elbow.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.18, 12), M.metalDark));
    elbow.add(seg(0.85, 0.1, M.hull));
    const wrist = new THREE.Group();
    wrist.position.z = 0.85;
    elbow.add(wrist);
    const turret = new THREE.Group();
    wrist.add(turret);
    turret.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 12), M.metalDark));
    const drill = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.4, 8), M.metal);
    drill.position.set(0, -0.25, 0.08);
    const spec = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.2), M.foil);
    spec.position.set(0.17, -0.12, 0);
    const brush = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10), M.composite);
    brush.position.set(-0.17, -0.14, 0);
    turret.add(drill, spec, brush);
    Object.assign(this.arm, { shoulder, upper, elbow, wrist, turret });

    // ── Status LEDs (power, comms link, task) ──
    const ledGeo = new THREE.SphereGeometry(0.045, 8, 6);
    this.leds = ["#5ce08a", "#6fb8ff", "#f0b04a"].map((c, i) => {
      const m = new THREE.Mesh(ledGeo, new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
      m.position.set(-0.3 + i * 0.3, 1.8, -2.24);
      b.add(m);
      return m;
    });
    this.lights = { material: M.lampHead };

    // Inspection anchors.
    const anchor = (parent, x, y, z) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    this.parts = {
      mast: anchor(this.mastTilt, 0, 0.2, 0),
      libs: anchor(this.mastTilt, 0, 0.45, 0.1),
      arm: anchor(turret, 0, 0.1, 0),
      hga: anchor(this.hgaTilt, 0, 0.25, 0),
      power: anchor(b, 0, 1.9, -2.1),
      wheels: anchor(b, TRACK + 0.2, 1.2, BASE),
      nav: anchor(b, 0.95, 2.25, 1.45),
    };

    this.hit = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4, 5.4), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.position.y = 1.7;
    this.root.add(this.hit);
  }

  /** World position of the mast cameras (for the first-person Mastcam view). */
  mastWorld(out = new THREE.Vector3()) {
    return this.mastTilt.getWorldPosition(out);
  }

  driveTo(x, z, task, onArrive) {
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
    this.armTarget = 0;
  }

  stop(task = "Holding position") {
    this.target = null;
    this.task = task;
  }

  get moving() {
    return Math.abs(this.speed) > 0.2;
  }

  /** Hand the controls to the player (true) or back to the autonomous driver (false). */
  setManual(on) {
    this.manual = on;
    this.target = null;
    this.onArrive = null;
    this.manualStep = 0;
    this.steerInput = 0;
    if (on) {
      this.armTarget = 0;
      this.busy = false;
      this.task = "Manual drive";
    }
  }

  /** Apply one frame of player driving (from walk/drive.js stepRover). update() animates the rest. */
  applyManual(st, steerInput = 0) {
    this.pos.x = st.x;
    this.pos.z = st.z;
    this.heading = st.heading;
    this.speed = st.speed;
    this.manualStep = st.step;
    this.steerInput = steerInput;
  }

  update(dt, t) {
    let desired = 0;
    const prevHeading = this.manual ? this.lastHeading ?? this.heading : this.heading;
    const prevSpeed = this.speed;
    if (this.manual) {
      // Pose already set by applyManual(); fall through to animation only.
    } else if (this.target) {
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
        const turnRate = 1.4;
        this.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
        const turnPenalty = Math.max(0.25, 1 - Math.abs(diff) / 1.6);
        desired = Math.min(this.maxSpeed, dist * 0.8 + 1.5) * turnPenalty;
      }
    }
    let step;
    if (this.manual) {
      step = this.manualStep;
      this.manualStep = 0;
    } else {
      this.speed += (desired - this.speed) * Math.min(1, dt * 1.4);
      step = this.speed * dt;
      this.pos.x += Math.sin(this.heading) * step;
      this.pos.z += Math.cos(this.heading) * step;
    }
    this.lastHeading = this.heading;
    this.odometer += Math.abs(step);
    this.accel += ((dt > 0 ? (this.speed - prevSpeed) / dt : 0) - this.accel) * Math.min(1, dt * 4);
    this.battery = Math.max(0.05, this.battery - Math.abs(step) * 0.00004);
    const atHome = Math.hypot(this.pos.x - ROVER_HOME.x, this.pos.z - ROVER_HOME.z) < 8;
    if (atHome && !this.moving) this.battery = Math.min(1, this.battery + dt * 0.01);
    let dh = this.heading - prevHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.yawRate += ((dt > 0 ? dh / dt : 0) - this.yawRate) * Math.min(1, dt * 5);

    // Terrain following from four contact points.
    const sh = Math.sin(this.heading);
    const ch = Math.cos(this.heading);
    const hf = heightAt(this.pos.x + sh * BASE, this.pos.z + ch * BASE);
    const hb = heightAt(this.pos.x - sh * BASE, this.pos.z - ch * BASE);
    const hr = heightAt(this.pos.x + ch * TRACK, this.pos.z - sh * TRACK);
    const hl = heightAt(this.pos.x - ch * TRACK, this.pos.z + sh * TRACK);
    const k = Math.min(1, dt * 6);
    this.pitch += (-Math.atan2(hf - hb, BASE * 2) - this.pitch) * k;
    this.roll += (Math.atan2(hr - hl, TRACK * 2) - this.roll) * k;
    this.pos.y += ((hf + hb + hl + hr) / 4 - this.pos.y) * Math.min(1, dt * 10);
    this.root.position.copy(this.pos);
    this.root.rotation.set(this.pitch, this.heading, this.roll);

    // Body squats under acceleration and leans out of turns (only a degree or two).
    const lean = this.speed * this.yawRate;
    this.bodyPitch += (Math.max(-0.035, Math.min(0.035, -this.accel * 0.012)) - this.bodyPitch) * Math.min(1, dt * 5);
    this.bodyRoll += (Math.max(-0.03, Math.min(0.03, lean * 0.012)) - this.bodyRoll) * Math.min(1, dt * 5);
    const bob = Math.sin(t * 9) * 0.01 * Math.min(1, Math.abs(this.speed));
    this.body.position.y = bob;
    this.body.rotation.set(this.bodyPitch, 0, this.bodyRoll);

    // Corner-wheel steering: follows the stick (manual) or the turn rate (autonomous). Front and
    // rear turn opposite ways; at a standstill the corners toe in for a point turn.
    const steerAuto = Math.max(-0.45, Math.min(0.45, this.yawRate * (this.moving ? 0.9 : 3)));
    const steer = this.manual ? -this.steerInput * 0.42 : steerAuto;
    const pivot = this.manual ? Math.abs(this.steerInput) * Math.max(0, 1 - Math.abs(this.speed) / 1.2) : 0;
    const sinP = Math.sin(this.pitch);
    const sinR = Math.sin(this.roll);
    const ks = Math.min(1, dt * 14);
    for (const w of this.wheels) {
      // Skid steering: the two sides spin at different rates in a turn (opposite in a point turn).
      w.spin.rotation.x += (step + this.yawRate * dt * w.side * TRACK) / WHEEL_R;
      const normal = w.z > 0.1 ? steer : w.z < -0.1 ? -steer : 0;
      const pivotAngle = w.z > 0.1 ? -w.side * 0.8 : w.z < -0.1 ? w.side * 0.8 : 0;
      const ang = normal * (1 - pivot) + pivotAngle * pivot;
      w.angle += (ang - w.angle) * Math.min(1, dt * 8);
      w.steer.rotation.y = w.angle;
      // Rocker-bogie: each wheel rides the ground under it, relative to the body's mean plane.
      const lx = w.side * TRACK;
      const wx = this.pos.x + ch * lx + sh * w.z;
      const wz = this.pos.z - sh * lx + ch * w.z;
      const plane = this.pos.y - w.z * sinP + lx * sinR;
      const rough = this.moving ? (Math.sin(wx * 1.7 + wz * 0.9) * Math.sin(wz * 2.3 - wx * 0.6)) * 0.1 : 0;
      const off = Math.max(-0.24, Math.min(0.24, heightAt(wx, wz) - plane + rough));
      w.susp += (off - w.susp) * ks;
      // Undo the body's squat/lean/bob for the wheels so they stay planted.
      w.steer.position.y = WHEEL_R + w.susp + w.z * Math.sin(this.bodyPitch) - lx * Math.sin(this.bodyRoll) - bob;
    }

    // Dust puffs behind the trailing wheels, more with speed.
    const sp = Math.abs(this.speed);
    if (sp > 0.8) {
      this.dustAcc += dt * Math.min(30, sp * 4.5);
      const dir = this.speed > 0 ? 1 : -1;
      while (this.dustAcc > 1) {
        this.dustAcc -= 1;
        const w = this.wheels[(Math.random() * 6) | 0];
        const lx = w.side * TRACK;
        const lz = -dir * BASE * 1.05;
        const wx = this.pos.x + ch * lx + sh * lz;
        const wz = this.pos.z - sh * lx + ch * lz;
        const back = -dir * sp * 0.22;
        this.dust.emit(wx, heightAt(wx, wz), wz, sh * back + ch * lx * 0.25, 0.5 + sp * 0.12, ch * back - sh * lx * 0.25, Math.min(1, sp / 7));
      }
    } else this.dustAcc = 0;
    this.dust.update(dt);
    // Mast scans when idle, looks ahead while driving.
    const pan = this.moving ? 0 : Math.sin(t * 0.3) * 0.9;
    this.mastHead.rotation.y += (pan - this.mastHead.rotation.y) * Math.min(1, dt * 2);
    this.mastTilt.rotation.x += ((this.moving ? 0.12 : 0.25 + Math.sin(t * 0.21) * 0.1) - this.mastTilt.rotation.x) * Math.min(1, dt * 2);
    // High-gain antenna keeps pointing at the comms tower (≈ −42, 36).
    const toComms = Math.atan2(-42 - this.pos.x, 36 - this.pos.z) - this.heading;
    this.hga.rotation.y += (Math.atan2(Math.sin(toComms), Math.cos(toComms)) - this.hga.rotation.y) * Math.min(1, dt * 1.5);
    this.hgaTilt.rotation.x = -1.1;
    // Arm: stowed ↔ deployed to the ground in front.
    this.armDeploy += (this.armTarget - this.armDeploy) * Math.min(1, dt * 1.2);
    const d = this.armDeploy;
    const A = this.arm;
    A.shoulder.rotation.y = 1.45 * (1 - d) + 0.25 * d + (d > 0.95 ? Math.sin(t * 0.8) * 0.05 : 0);
    A.upper.rotation.x = d * 0.55;
    A.elbow.rotation.y = 2.95 * (1 - d);
    A.elbow.rotation.x = d * 0.9;
    A.turret.rotation.x = d * 0.4;
    A.turret.rotation.z = d > 0.95 ? t * 0.6 : 0;
    // Status LEDs: comms blinks, task glows while busy.
    this.leds[1].visible = Math.sin(t * 4) > 0.2;
    this.leds[2].visible = this.busy ? Math.sin(t * 7) > 0 : false;
    this.leds[0].material.color.set(this.battery < 0.25 ? "#ff5a3c" : "#5ce08a");
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
