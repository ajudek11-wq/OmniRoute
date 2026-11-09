import * as THREE from "three";
import { Merger, mat4 } from "./kit.js";
import { RING_R } from "./physics.js";

/**
 * The outside of Meridian Station.
 *  - Rotating assembly (ring frame): the habitat ring hull, four spokes and the hub drum.
 *  - Non-rotating assembly (hub frame "H", spin axis +X through the origin): bearing collars, the
 *    truss spine, sun-tracking solar wings, radiators, the docking node with a berthed cargo ship,
 *    the robotic arm, and a crew shuttle that approaches, docks and leaves on a slow cycle.
 */
const R = RING_R;
const HULL_IN = 218.5;
const HULL_OUT = 227;
const HULL_X = 14.8;

export function flip(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position.array;
  const n = g.attributes.normal.array;
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const a = p[i + 3 + k];
      p[i + 3 + k] = p[i + 6 + k];
      p[i + 6 + k] = a;
      const b = n[i + 3 + k];
      n[i + 3 + k] = n[i + 6 + k];
      n[i + 6 + k] = b;
    }
  }
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return g;
}

/** Ring-frame point at radius r, angle θ (θ = 0 is the floor's lowest point), axial x. */
const ringPt = (x, r, th) => [x, R - r * Math.cos(th), r * Math.sin(th)];

/** Annulus face of the ring hull at axial x, with an optional window cut-out [th0, th1, r0, r1]. */
function annulus(x, normalX, cut, segs = 720) {
  const pos = [];
  const bands = [
    [HULL_IN, cut ? cut[2] : HULL_OUT],
    ...(cut ? [[cut[2], cut[3], true], [cut[3], HULL_OUT]] : []),
  ];
  for (let k = 0; k < segs; k++) {
    const a0 = (k / segs) * Math.PI * 2 - Math.PI;
    const a1 = ((k + 1) / segs) * Math.PI * 2 - Math.PI;
    for (const [r0, r1, isCut] of bands) {
      if (isCut && a1 > cut[0] && a0 < cut[1]) continue;
      const A = ringPt(x, r0, a0);
      const B = ringPt(x, r1, a0);
      const C = ringPt(x, r1, a1);
      const D = ringPt(x, r0, a1);
      if (normalX < 0) pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      else pos.push(...A, ...C, ...B, ...A, ...D, ...C);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildRingExterior(mats, { windowCut }) {
  const group = new THREE.Group();
  group.name = "ring-exterior";
  const m = new Merger();
  const axisX = (g) => g.rotateZ(Math.PI / 2).translate(0, R, 0);
  m.addM("hull", axisX(new THREE.CylinderGeometry(HULL_OUT, HULL_OUT, HULL_X * 2, 360, 1, true)), new THREE.Matrix4());
  m.addM("mli", flip(axisX(new THREE.CylinderGeometry(HULL_IN, HULL_IN, HULL_X * 2, 360, 1, true))), new THREE.Matrix4());
  m.addM("hull", annulus(HULL_X, 1, windowCut), new THREE.Matrix4());
  m.addM("hull", annulus(-HULL_X, -1, null), new THREE.Matrix4());
  // Structural bands, lit windows of other sectors, and the spokes.
  for (let k = 0; k < 36; k++) {
    const th = (k / 36) * Math.PI * 2;
    for (const s of [-1, 1]) {
      const [x, y, z] = ringPt(s * (HULL_X + 0.15), (HULL_IN + HULL_OUT) / 2, th);
      m.box("extDark", 0.3, HULL_OUT - HULL_IN + 0.4, 1.4, x, y, z, -th, 0, 0);
      if (k % 3 !== 1 && Math.abs(Math.sin(th)) > 0.12) {
        const [wx, wy, wz] = ringPt(s * (HULL_X + 0.05), R - 1.8, th + 0.045);
        m.box("extGlass", 0.12, 1.4, 7, wx, wy, wz, -(th + 0.045), 0, 0);
      }
    }
    const [x2, y2, z2] = ringPt(0, HULL_OUT + 0.1, th);
    m.box("extDark", HULL_X * 2 + 0.6, 0.35, 1.2, x2, y2, z2, -th, 0, 0);
  }
  const thLift = Math.asin(-30 / R);
  for (let k = 0; k < 4; k++) {
    const th = thLift + (k * Math.PI) / 2;
    m.tube("hull", ringPt(-8, HULL_IN, th), ringPt(-8, 13.5, th), 2.2, 20);
    m.tube("extDark", ringPt(-8, HULL_IN - 2, th), ringPt(-8, HULL_IN + 0.2, th), 3.2, 20);
    for (let d = 40; d < 200; d += 40) m.tube("extDark", ringPt(-8, d, th), ringPt(-8, d + 0.8, th), 2.5, 20);
  }
  // Hub drum (rotates with the ring)
  m.addM("hull", axisX(new THREE.CylinderGeometry(14, 14, 24, 64, 1, false)), new THREE.Matrix4());
  for (const x of [-11, 0, 11]) m.addM("extDark", axisX(new THREE.CylinderGeometry(14.3, 14.3, 0.8, 64)), mat4(x, 0, 0));
  m.build(mats, group, "ring-ext");
  return { group };
}

/** Sun-tracking angle about the Z axis for a wing whose cells face +Y at angle 0. */
const trackAngle = (sunH) => Math.atan2(-sunH.x, sunH.y);

export function buildHubExterior(mats, ctx) {
  const group = new THREE.Group();
  group.name = "hub-exterior";
  const m = new Merger();
  const ax = (g) => g.rotateZ(Math.PI / 2);
  // Bearings between the spinning drum and the fixed spine
  for (const s of [-1, 1]) {
    m.addM("extDark", ax(new THREE.CylinderGeometry(8, 9, 3, 48)), mat4(s * 13.5, 0, 0));
    m.addM("foil", ax(new THREE.CylinderGeometry(6, 6, 4, 32)), mat4(s * 16.5, 0, 0));
  }
  // Truss spine
  const X0 = -165;
  const X1 = 55;
  for (const [y, z] of [
    [3, 3],
    [3, -3],
    [-3, 3],
    [-3, -3],
  ])
    m.tube("truss", [X0, y, z], [X1, y, z], 0.32, 8);
  for (let x = X0; x <= X1; x += 10) {
    m.box("truss", 0.3, 6.3, 0.3, x, 0, 3);
    m.box("truss", 0.3, 6.3, 0.3, x, 0, -3);
    m.box("truss", 0.3, 0.3, 6.3, x, 3, 0);
    m.box("truss", 0.3, 0.3, 6.3, x, -3, 0);
    if (x < X1) {
      m.tube("truss", [x, 3, 3], [x + 10, -3, 3], 0.12, 6);
      m.tube("truss", [x, 3, -3], [x + 10, -3, -3], 0.12, 6);
      m.tube("truss", [x, 3, 3], [x + 10, 3, -3], 0.12, 6);
      m.tube("truss", [x, -3, 3], [x + 10, -3, -3], 0.12, 6);
    }
  }
  // Pressurised transfer tunnel along the spine, node, docking port
  m.addM("mli", ax(new THREE.CylinderGeometry(1.9, 1.9, 38, 24)), mat4(36, 0, 0));
  m.addM("mli", ax(new THREE.CylinderGeometry(4.2, 4.2, 16, 40)), mat4(63, 0, 0));
  m.addM("hull", ax(new THREE.CylinderGeometry(2.2, 4.2, 2.4, 40)), mat4(72.2, 0, 0));
  m.addM("extDark", ax(new THREE.CylinderGeometry(1.5, 1.5, 1.4, 32)), mat4(74, 0, 0));
  m.addM("foil", ax(new THREE.CylinderGeometry(1.25, 1.25, 0.2, 32)), mat4(74.75, 0, 0));
  for (const x of [56, 63, 70]) m.addM("extDark", ax(new THREE.CylinderGeometry(4.35, 4.35, 0.5, 40)), mat4(x, 0, 0));
  m.box("extDark", 0.1, 1.6, 0.12, 74.9, 0, 0);
  m.box("extDark", 0.1, 0.12, 1.6, 74.9, 0, 0);
  // Berthed cargo ship on the node's nadir side
  m.tube("hull", [63, -4.2, 0], [63, -6, 0], 1.6, 24);
  m.tube("mli", [63, -6, 0], [63, -13.5, 0], 2.1, 28);
  m.tube("foil", [63, -13.5, 0], [63, -15.5, 0], 1.6, 24);
  for (const s of [-1, 1]) m.box("solar", 0.08, 2.0, 9, 63, -12.5, s * 6.8);
  // Radiators (edge-on to the Sun along ±Y)
  for (const s of [-1, 1])
    for (let k = 0; k < 3; k++) {
      const y = s * (8 + k * 9);
      m.box("radiator", 22, 8, 0.15, -100, y, 0);
      m.box("truss", 22.4, 0.3, 0.3, -100, y + s * 4.1, 0);
    }
  m.tube("truss", [-100, -36, 0], [-100, 36, 0], 0.4, 8);
  // EVA gantry, airlock: built by eva.js; floodlight housings here
  m.build(mats, group, "hub-ext");

  // ── Solar wings (rotate about the mast to face the Sun) ──
  const wings = [];
  for (const xm of [-70, -135]) {
    const w = new THREE.Group();
    w.position.set(xm, 0, 0);
    const wm = new Merger();
    wm.tube("truss", [0, 0, -72], [0, 0, 72], 0.5, 10);
    wm.box("foil", 1.6, 1.6, 4, 0, 0, 0);
    for (const s of [-1, 1]) {
      for (const dx of [-4, 4]) {
        wm.box("solar", 7.2, 0.06, 60, dx, 0, s * 39);
        wm.box("truss", 0.25, 0.2, 60, dx + Math.sign(dx) * 3.65, 0, s * 39);
      }
      wm.box("foil", 16, 0.3, 0.6, 0, 0, s * 9);
      wm.box("foil", 16, 0.3, 0.6, 0, 0, s * 69);
    }
    wm.build(mats, w, "wing");
    group.add(w);
    wings.push(w);
  }

  // ── Robotic arm (on the spine near the node) ──
  const arm = new THREE.Group();
  arm.position.set(46, 3.3, 3.3);
  const armMat = mats.hull;
  const joint = (r) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.4, 20), mats.extDark);
  const boom = (len) => {
    const g = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, len, 16), armMat);
    g.position.y = len / 2;
    return g;
  };
  const base = new THREE.Group();
  base.add(joint(0.8));
  arm.add(base);
  const shoulder = new THREE.Group();
  shoulder.position.y = 0.8;
  base.add(shoulder);
  const sj = joint(0.7);
  sj.rotation.z = Math.PI / 2;
  shoulder.add(sj, boom(14));
  const elbow = new THREE.Group();
  elbow.position.y = 14;
  shoulder.add(elbow);
  const ej = joint(0.6);
  ej.rotation.z = Math.PI / 2;
  elbow.add(ej, boom(13));
  const wrist = new THREE.Group();
  wrist.position.y = 13;
  elbow.add(wrist);
  const eff = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.6, 16), mats.foil);
  eff.position.y = 0.8;
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mats.extDark);
  cam.position.set(0.5, 0.6, 0);
  wrist.add(eff, cam);
  group.add(arm);

  // ── Crew shuttle ──
  const shuttle = new THREE.Group();
  const sm = new Merger();
  // docking end faces −X
  sm.addM("mli", ax(new THREE.CylinderGeometry(1.0, 2.0, 3.0, 32)), mat4(1.8, 0, 0)); // capsule
  sm.addM("extDark", ax(new THREE.CylinderGeometry(0.75, 0.75, 0.6, 24)), mat4(0.05, 0, 0)); // docking adapter
  sm.addM("hull", ax(new THREE.CylinderGeometry(2.0, 2.0, 3.4, 32)), mat4(5.0, 0, 0)); // service module
  sm.addM("extDark", ax(new THREE.CylinderGeometry(0.8, 1.3, 1.2, 24)), mat4(7.2, 0, 0)); // engine bell
  for (const s of [-1, 1]) {
    sm.box("solar", 2.2, 0.06, 7, 5, 0, s * 5.6);
    sm.box("truss", 0.2, 0.2, 2.2, 5, 0, s * 2.6);
  }
  sm.box("extGlass", 0.05, 0.4, 0.8, 1.25, 0.95, 0);
  sm.build(mats, shuttle, "shuttle");
  const lightGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const blink = [];
  for (const [y, z, mat, ph] of [
    [1.8, 0, mats.ledWhite, 0],
    [0, 2.05, mats.ledGreen, 0.5],
    [0, -2.05, mats.ledRed, 0.5],
    [-1.8, 0, mats.ledWhite, 0.25],
  ]) {
    const l = new THREE.Mesh(lightGeo, mat);
    l.position.set(3.4, y, z);
    l.userData.ph = ph;
    shuttle.add(l);
    blink.push(l);
  }
  const headlights = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16).rotateY(-Math.PI / 2), mats.ledWhite);
  headlights.position.set(-0.27, 0, 0);
  shuttle.add(headlights);
  group.add(shuttle);

  // Station navigation strobes and floodlights (brighter in eclipse)
  const strobes = [];
  for (const p of [
    [74.6, 4.3, 0],
    [74.6, -4.3, 0],
    [-165, 3.4, 3.4],
    [-165, -3.4, -3.4],
  ]) {
    const l = new THREE.Mesh(lightGeo, mats.ledWhite);
    l.position.set(...p);
    group.add(l);
    strobes.push(l);
  }
  const flood = [];
  for (const p of [
    [56, -4.3, 2.5],
    [56, -4.3, -2.5],
    [70, 4.3, 0],
  ]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mats.ledWhite);
    l.position.set(...p);
    group.add(l);
    flood.push(l);
  }

  const DOCK_X = 75.1;
  // Simplified: real final approaches take tens of minutes; this one takes ~5.
  const shuttleState = { phase: "approach", dist: 0, rate: 0 };
  const FAR = 360;
  const T_IN = 300;
  const T_DOCK = 120;
  const T_OUT = 120;
  const CYCLE = T_IN + T_DOCK + T_OUT;
  function shuttleAt(t) {
    const c = (t + 40) % CYCLE;
    const ease = (x) => 1 - (1 - x) ** 3;
    if (c < T_IN) return { d: FAR * (1 - ease(c / T_IN)), phase: c < T_IN * 0.7 ? "approach" : "final approach" };
    if (c < T_IN + T_DOCK) return { d: 0, phase: "docked" };
    const k = (c - T_IN - T_DOCK) / T_OUT;
    return { d: FAR * k * k, phase: "departing" };
  }

  let prevD = 0;
  return {
    group,
    shuttle,
    shuttleState,
    update(dt, t, { sunH, eclipse }) {
      for (const w of wings) w.rotation.z += (trackAngle(sunH) - w.rotation.z) * Math.min(1, dt * 0.5);
      // Arm: slow inspection sweep
      base.rotation.y = 0.6 + Math.sin(t * 0.021) * 0.5;
      shoulder.rotation.z = -0.9 + Math.sin(t * 0.017 + 1) * 0.25;
      elbow.rotation.z = 1.7 + Math.sin(t * 0.013) * 0.35;
      wrist.rotation.z = -0.6 + Math.sin(t * 0.03) * 0.3;
      const s = shuttleAt(t);
      const lateral = s.d * 0.04 * Math.sin(t * 0.01);
      shuttle.position.set(DOCK_X + s.d, lateral, lateral * 0.5);
      shuttle.rotation.x = s.d > 1 ? t * 0.004 : shuttle.rotation.x;
      shuttleState.phase = s.phase;
      shuttleState.dist = s.d;
      shuttleState.rate = dt > 0 ? (prevD - s.d) / dt : 0;
      prevD = s.d;
      for (const l of blink) l.visible = ((t + l.userData.ph) % 1.2) < 0.18 || (s.phase !== "docked" && s.d < 150 && ((t * 2 + l.userData.ph) % 1) < 0.5);
      headlights.visible = s.phase !== "docked";
      for (const l of strobes) l.visible = (t % 2.5) < 0.1;
      for (const l of flood) l.visible = eclipse > 0.4;
    },
  };
}
