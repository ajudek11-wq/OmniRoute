import * as THREE from "three";
import { STRUCTURE_POS as P } from "../../data/layout.js";
import { Panel } from "../../xr/panel.js";
import { Kit, mats, tubeShell, bearing, atBearing, lineCircles, arcCircles, angIn, slidingDoor, button, sign, hiss, wrap } from "./kit.js";
import { toLocal, lerp } from "./zones.js";
import { clockString, solNumber } from "../../sim/engine.js";

/**
 * Walkable interior of the main habitat (the bermed dome at 0,0) plus its airlock and the three
 * pressurised tunnels: to the greenhouse, the science lab and Habitat B.
 *
 * Levels (world y, the habitat sits on levelled ground at 0):
 *   ground deck 0.9 m (same as the airlock sill): suit room, medical corner, crew bunks, stowage, galley/commons
 *   upper deck 3.1 m under the dome: observation lounge with the eight real windows
 * The ground deck sits below the top of the regolith berm (2.75 m), so it has no windows: the
 * berm is the radiation shield. Windows are on the upper deck, which matches the exterior.
 */
export const HAB = {
  F: 0.9, // ground deck
  C: 3.0, // ground deck ceiling
  U: 3.1, // upper deck
  RL: 9.75, // liner radius
  RW: 10, // exterior wall radius
};
const TAU = Math.PI * 2;
const WINDOWS = Array.from({ length: 8 }, (_, k) => (k / 8) * TAU + 0.2);
const WIN_HALF = 0.65; // m
const WIN_Y = [3.3, 4.2];
const unit = (a, b) => {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  return { x: (b.x - a.x) / d, z: (b.z - a.z) / d, d };
};

/** Tunnel specs (from settlement.js buildSettlement). */
function tunnelSpecs() {
  const u = unit(P.habitat, P.habitatB);
  return {
    gh: { a: { x: 3, z: -9.6 }, b: { x: 3, z: -28.6 }, y: 1.8, r: 1.15, floor: 0.9, half: 0.62, top: 2.7, end: { x: 3, z: -29.75 } },
    lab: { a: { x: -9.4, z: 4 }, b: { x: -22, z: 4 }, y: 2.4, r: 1.25, floor: 1.6, half: 0.7, top: 3.35, end: { x: -22.0, z: 4 } },
    habB: { a: { x: u.x * 9.4, z: u.z * 9.4 }, b: { x: P.habitatB.x - u.x * 5.5, z: P.habitatB.z - u.z * 5.5 }, y: 2.4, r: 1.15, floor: 1.6, half: 0.6, top: 3.3, end: { x: P.habitatB.x - u.x * 5.6, z: P.habitatB.z - u.z * 5.6 } },
    garage: { a: { x: 7.5, z: 6.5 }, b: { x: 31, z: 13 }, y: 1.7, r: 1.0 },
  };
}

/** Where a tunnel axis crosses a circle of radius R about the habitat centre. */
function crossing(t, R) {
  const u = unit(t.a, t.b);
  // Solve |a + u s| = R for s (a is near the wall).
  const bq = 2 * (t.a.x * u.x + t.a.z * u.z);
  const cq = t.a.x * t.a.x + t.a.z * t.a.z - R * R;
  const s = (-bq + Math.sqrt(Math.max(0, bq * bq - 4 * cq))) / 2;
  return { x: t.a.x + u.x * s, z: t.a.z + u.z * s, s, u };
}

export function buildHabitatVR({ app, zones, audio, card, y0 = 0 }) {
  const M = mats();
  const S = app.settlement;
  const SM = S.materials;
  const hab = S.structures.habitat;
  const T = tunnelSpecs();
  const { F, C, U, RL, RW } = HAB;
  const group = new THREE.Group();
  group.name = "vr-habitat-interior";
  group.position.y = y0;
  const upper = new THREE.Group(); // culled when on the ground deck far from the ladder? (kept simple: same group)
  group.add(upper);
  const interact = [];
  const updaters = [];

  // ── Openings: bearings and half-angles on the liner and on the exterior wall ──
  const hatch = {};
  for (const id of ["gh", "lab", "habB"]) {
    const t = T[id];
    const c = crossing(t, RL);
    hatch[id] = { ...t, id, at: c, ang: bearing(c.x, c.z), u: c.u };
  }
  const air = { ang: 0, half: 1.0, y0: F, y1: C };
  const holesAt = (R) => {
    const list = [];
    const span = (a, half, t0, t1) => list.push({ a0: a - half / R, a1: a + half / R, t0, t1 });
    span(air.ang, air.half, air.y0, air.y1);
    for (const h of Object.values(hatch)) span(h.ang, h.half, h.floor, h.top);
    for (const a of WINDOWS) span(a, WIN_HALF, WIN_Y[0], WIN_Y[1]);
    // Normalise into [-π, π] and split holes that wrap.
    return list.map((h) => {
      const w = (x) => Math.atan2(Math.sin(x), Math.cos(x));
      const c = w((h.a0 + h.a1) / 2);
      const d = (h.a1 - h.a0) / 2;
      return { ...h, a0: c - d, a1: c + d };
    });
  };

  // ── Exterior wall re-cut with real openings (VR only; restored on exit) ──
  const vrParts = hab.vr;
  const orig = { wall: vrParts.wall.geometry, tube: vrParts.airlockTube.geometry, cap: vrParts.airlockCap.geometry };
  const wallGeo = tubeShell({ origin: new THREE.Vector3(0, 0, 0), axis: new THREE.Vector3(0, 1, 0), ref: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0), radius: RW, t0: 0, t1: 5, a0: -Math.PI, a1: Math.PI, segs: 96, holes: holesAt(RW) });
  wallGeo.translate(0, -2.5, 0); // the original mesh is centred at y = 2.5
  const tubeGeo = new THREE.CylinderGeometry(1.8, 1.8, 6.4, 24, 1, true);
  // Airlock end cap: open ring + a front face with a real door opening (1.24 × 2.1 m).
  const capGeo = (() => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 1.95, 0, TAU, false);
    const hole = new THREE.Path();
    const hw = 0.64;
    const yb = F - 2.0;
    const yt = C - 2.0;
    hole.moveTo(-hw, yb);
    hole.lineTo(hw, yb);
    hole.lineTo(hw, yt);
    hole.lineTo(-hw, yt);
    hole.lineTo(-hw, yb);
    shape.holes.push(hole);
    const face = new THREE.ShapeGeometry(shape, 24);
    // Cap mesh is a cylinder rotated rx = π/2 (local y → world z). Build in world-aligned space then undo.
    face.translate(0, 0, 0.175);
    face.rotateX(-Math.PI / 2);
    const ring = new THREE.CylinderGeometry(1.95, 1.95, 0.35, 24, 1, true);
    const a = ring.toNonIndexed();
    const b = face.toNonIndexed();
    for (const g of [a, b]) for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    const out = mergeTwo(a, b);
    ring.dispose();
    face.dispose();
    return out;
  })();
  const exteriorHide = S.structures.habitat.group.children.filter((o) => o.isMesh && (o.material === SM.window || o.material === SM.metalDark) && o !== vrParts.hatch);
  // Tunnel tubes: open their ends (closed caps would block the hatches).
  const tunnelSwaps = [];
  for (const tg of S.tunnels ?? []) {
    for (const m of tg.children) {
      if (!m.isMesh || m.material !== SM.mli) continue;
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      for (const id of ["gh", "lab", "garage"]) {
        const t = T[id];
        const mid = { x: (t.a.x + t.b.x) / 2, z: (t.a.z + t.b.z) / 2 };
        const c = bb.getCenter(new THREE.Vector3());
        if (Math.hypot(c.x - mid.x, c.z - mid.z) > 1.5) continue;
        const A = new THREE.Vector3(t.a.x, t.y, t.a.z);
        const B = new THREE.Vector3(t.b.x, t.y, t.b.z);
        const len = A.distanceTo(B);
        const g = new THREE.CylinderGeometry(t.r, t.r, len, 20, 1, true);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
        g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
        tunnelSwaps.push({ mesh: m, orig: m.geometry, vr: g });
      }
    }
  }

  // ── Interior shell ──
  const kit = new Kit();
  // Wall liner, both decks, with every opening.
  kit.add(
    tubeShell({ origin: new THREE.Vector3(0, F, 0), axis: new THREE.Vector3(0, 1, 0), ref: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0), radius: RL, t0: 0, t1: 5 - F, a0: -Math.PI, a1: Math.PI, segs: 96, holes: holesAt(RL).map((h) => ({ ...h, t0: h.t0 - F, t1: h.t1 - F })) }),
    M.liner
  );
  // Dome liner.
  const prof = [];
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * (Math.PI / 2);
    prof.push(new THREE.Vector2(Math.max(0.01, (RL - 0.05) * Math.cos(a)), 5 + 6.35 * Math.sin(a)));
  }
  kit.add(new THREE.LatheGeometry(prof, 64), M.liner);
  // Reveals: frames around every window opening (cover the gap between liner and wall).
  for (const a of WINDOWS) {
    const p = atBearing(a, (RL + RW) / 2);
    const d = RW - RL + 0.12;
    const w = WIN_HALF * 2;
    const yc = (WIN_Y[0] + WIN_Y[1]) / 2;
    const hh = WIN_Y[1] - WIN_Y[0];
    const ox = Math.cos(a);
    const oz = -Math.sin(a);
    kit.box(M.trim, w + 0.24, 0.12, d, p.x, WIN_Y[1] + 0.06, p.z, a);
    kit.box(M.trim, w + 0.24, 0.16, d + 0.18, p.x - Math.sin(a) * 0.09, WIN_Y[0] - 0.08, p.z - Math.cos(a) * 0.09, a);
    for (const s of [-1, 1]) kit.box(M.trim, 0.12, hh, d, p.x + ox * s * (WIN_HALF + 0.06), yc, p.z + oz * s * (WIN_HALF + 0.06), a);
    const gp = atBearing(a, RW - 0.06);
    kit.put(new THREE.PlaneGeometry(w, hh), M.glass, gp.x, yc, gp.z, a);
  }
  // Collars round the airlock door and the tunnel hatches.
  const collar = (a, half, y0c, y1c) => {
    const p = atBearing(a, (RL + RW) / 2 + 0.02);
    const d = RW - RL + 0.2;
    const ox = Math.cos(a);
    const oz = -Math.sin(a);
    kit.box(M.dark, half * 2 + 0.3, 0.15, d, p.x, y1c + 0.075, p.z, a);
    for (const s of [-1, 1]) kit.box(M.dark, 0.15, y1c - y0c, d, p.x + ox * s * (half + 0.075), (y0c + y1c) / 2, p.z + oz * s * (half + 0.075), a);
  };
  collar(air.ang, air.half, F, C);
  for (const h of Object.values(hatch)) collar(h.ang, h.half, h.floor, h.top);

  // Floors and ceilings: discs with the ladder hole; the upper deck is notched over the raised hatch platforms.
  const LAD = { x: 2.0, z: 1.6, hw: 0.5 };
  const NOTCH = 9.5 * (Math.PI / 180);
  const notchOf = (a) => [hatch.lab, hatch.habB].find((h) => angIn(a, h.ang - NOTCH, h.ang + NOTCH));
  const deckShape = () => {
    const s = new THREE.Shape();
    const n = 128;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU - Math.PI;
      const r = notchOf(a) ? 7.0 : RL;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      // Shape lives in the XY plane; we map shape (x, y) → world (x, -z) after rotateX(-π/2).
      if (i === 0) s.moveTo(x, -z);
      else s.lineTo(x, -z);
    }
    const hole = new THREE.Path();
    hole.moveTo(LAD.x - LAD.hw, -(LAD.z - LAD.hw));
    hole.lineTo(LAD.x - LAD.hw, -(LAD.z + LAD.hw));
    hole.lineTo(LAD.x + LAD.hw, -(LAD.z + LAD.hw));
    hole.lineTo(LAD.x + LAD.hw, -(LAD.z - LAD.hw));
    s.holes.push(hole);
    return s;
  };
  // Faces up; the ground-deck ceiling uses the same geometry with a back-side material.
  const deckGeo = (y) => new THREE.ShapeGeometry(deckShape(), 1).rotateX(-Math.PI / 2).translate(0, y, 0);
  const groundFloor = new THREE.CircleGeometry(RL, 96).rotateX(-Math.PI / 2).translate(0, F, 0);
  kit.add(groundFloor, M.floor);
  kit.add(deckGeo(C), M.ceiling);
  kit.add(deckGeo(U), M.floor);
  // Deck slab edges: the notches and the ladder hole.
  for (const h of [hatch.lab, hatch.habB]) {
    for (let i = 0; i < 8; i++) {
      const a0 = h.ang - NOTCH + (i / 8) * 2 * NOTCH;
      const a1 = h.ang - NOTCH + ((i + 1) / 8) * 2 * NOTCH;
      const p = atBearing((a0 + a1) / 2, 7.0);
      kit.box(M.trim, 7.0 * (a1 - a0) + 0.02, U - C + 0.02, 0.06, p.x, (U + C) / 2, p.z, (a0 + a1) / 2);
      // Railing on the upper deck along the notch edge.
      kit.box(M.steel, 7.0 * (a1 - a0) + 0.02, 0.05, 0.05, p.x, U + 1.0, p.z, (a0 + a1) / 2);
    }
    for (const s of [-1, 1]) {
      const a = h.ang + s * NOTCH;
      const p0 = atBearing(a, 7.0);
      const p1 = atBearing(a, RL);
      kit.wall(M.trim, p0.x, p0.z, p1.x, p1.z, C, U, [], 0.06);
      kit.rod(M.steel, new THREE.Vector3(p0.x, U + 1.0, p0.z), new THREE.Vector3(p1.x, U + 1.0, p1.z), 0.025);
      for (const r of [7.0, 8.4]) {
        const q = atBearing(a, r);
        kit.cyl(M.steel, 0.025, 0.025, 1.0, 6, q.x, U + 0.5, q.z);
      }
    }
  }
  for (const [ax, az, bx, bz] of [
    [LAD.x - LAD.hw, LAD.z - LAD.hw, LAD.x + LAD.hw, LAD.z - LAD.hw],
    [LAD.x + LAD.hw, LAD.z - LAD.hw, LAD.x + LAD.hw, LAD.z + LAD.hw],
    [LAD.x + LAD.hw, LAD.z + LAD.hw, LAD.x - LAD.hw, LAD.z + LAD.hw],
    [LAD.x - LAD.hw, LAD.z + LAD.hw, LAD.x - LAD.hw, LAD.z - LAD.hw],
  ]) {
    kit.wall(M.trim, ax, az, bx, bz, C, U, [], 0.06);
    // Hatch coaming + railing round the ladder well (open on the ladder side).
    if (az !== LAD.z - LAD.hw || bz !== LAD.z - LAD.hw) kit.wall(M.steel, ax, az, bx, bz, U + 0.95, U + 1.0, [], 0.05);
  }
  for (const [x, z] of [
    [LAD.x - LAD.hw, LAD.z - LAD.hw],
    [LAD.x + LAD.hw, LAD.z - LAD.hw],
    [LAD.x + LAD.hw, LAD.z + LAD.hw],
    [LAD.x - LAD.hw, LAD.z + LAD.hw],
  ])
    kit.cyl(M.steel, 0.03, 0.03, 1.0, 6, x, U + 0.5, z);
  // Ladder: two rails + rungs on the north edge of the well, up to handholds above the upper deck.
  for (const s of [-1, 1]) kit.cyl(M.steel, 0.025, 0.025, U + 1.1 - F, 8, LAD.x + s * 0.32, (F + U + 1.1) / 2, LAD.z - LAD.hw + 0.08);
  for (let y = F + 0.3; y < U + 1.0; y += 0.3) kit.cyl(M.steel, 0.018, 0.018, 0.64, 6, LAD.x, y, LAD.z - LAD.hw + 0.08, 0, 0, Math.PI / 2);

  // ── Ground deck rooms ──
  const groundCols = [];
  const wallSeg = (ax, az, bx, bz, holes = [], y0w = F, y1w = C) => {
    kit.wall(M.wall, ax, az, bx, bz, y0w, y1w, holes, 0.1);
    // Colliders only where the wall is solid at foot level.
    const len = Math.hypot(bx - ax, bz - az);
    let u = 0;
    const gaps = holes.filter((h) => h.v0 <= F + 0.05).sort((p, q) => p.u0 - q.u0);
    for (const gp of [...gaps, { u0: len, u1: len }]) {
      if (gp.u0 > u + 0.05) {
        const t0 = u / len;
        const t1 = gp.u0 / len;
        groundCols.push(...lineCircles(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, 0.14, 0.26));
      }
      u = gp.u1;
    }
  };
  const chordX = (z) => Math.sqrt(RL * RL - z * z);
  const chordZ = (x) => Math.sqrt(RL * RL - x * x);
  // Suit room partition (z = 5) with a 1.6 m doorway.
  wallSeg(-chordX(5), 5, chordX(5), 5, [{ u0: chordX(5) - 0.8, u1: chordX(5) + 0.8, v0: F, v1: F + 2.15 }]);
  // Medical corner: west wall x = 4.2 (z 0.6 → 5), north wall z = −1 (x 4.2 → wall).
  wallSeg(4.2, 0.6, 4.2, 5);
  wallSeg(4.2, -1.0, chordX(-1.0), -1.0);
  kit.box(M.wall, 0.1, C - F - 2.15, 1.6, 4.2, F + 2.15 + (C - F - 2.15) / 2, -0.2); // header over the medical doorway
  // Bunk room: z = −1.6 (west of x = −3.6) and x = −3.6 (z −1.6 → north wall), door at z −3.4…−2.0.
  wallSeg(-chordX(-1.6), -1.6, -3.6, -1.6);
  wallSeg(-3.6, -1.6, -3.6, -chordZ(3.6), [{ u0: 0.4, u1: 1.8, v0: F, v1: F + 2.15 }]);
  // Hatch platforms (lab, Habitat B): raised to the tunnel floor with steps.
  const platforms = [];
  for (const h of [hatch.lab, hatch.habB]) {
    const half = 7 * (Math.PI / 180);
    platforms.push({ ang: h.ang, half, floor: h.floor });
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = h.ang - half + ((i + 0.5) / n) * 2 * half;
      const wseg = (2 * half * 8.4) / n + 0.04;
      const p = atBearing(a, (8.4 + RL) / 2);
      kit.box(M.floor, wseg * 1.1, h.floor - F, RL - 8.4 + 0.1, p.x, (F + h.floor) / 2, p.z, a);
      for (let k = 0; k < 4; k++) {
        const r0 = 7.2 + k * 0.3;
        const ty = F + ((k + 1) * (h.floor - F)) / 4;
        const q = atBearing(a, r0 + 0.15);
        kit.box(M.trim, ((2 * half * r0) / n) * 1.12, ty - F, 0.3, q.x, (F + ty) / 2, q.z, a);
      }
    }
    for (const s of [-1, 1]) {
      const a = h.ang + s * half;
      const p0 = atBearing(a, 7.2);
      const p1 = atBearing(a, RL);
      kit.rod(M.steel, new THREE.Vector3(p0.x, F + 0.95, p0.z), new THREE.Vector3(p1.x, h.floor + 0.95, p1.z), 0.025);
      groundCols.push(...lineCircles(p0.x, p0.z, p1.x, p1.z, 0.12, 0.25));
    }
  }

  // Suits on racks (south face of the partition), helmets, boots.
  const suitAt = (x, z, ry) => {
    const g = new Kit();
    g.box(M.white, 0.5, 0.62, 0.32, 0, 1.32, 0); // torso
    g.box(M.orange, 0.52, 0.08, 0.34, 0, 1.08, 0);
    g.box(M.trim, 0.36, 0.46, 0.2, 0, 1.36, -0.25); // PLSS backpack
    g.put(new THREE.SphereGeometry(0.17, 16, 12), M.glass, 0, 1.82, 0.03);
    g.put(new THREE.SphereGeometry(0.18, 16, 12, 0, TAU, 0, Math.PI * 0.55), M.white, 0, 1.84, -0.03);
    g.cyl(M.trim, 0.19, 0.19, 0.06, 16, 0, 1.66, 0);
    for (const s of [-1, 1]) {
      g.cyl(M.white, 0.075, 0.07, 0.6, 10, s * 0.33, 1.25, 0, 0, 0, s * 0.12); // arms
      g.put(new THREE.SphereGeometry(0.06, 8, 6), M.dark, s * 0.37, 0.92, 0);
      g.cyl(M.white, 0.09, 0.08, 0.78, 10, s * 0.12, 0.62, 0); // legs
      g.box(M.dark, 0.13, 0.1, 0.27, s * 0.12, 0.2, 0.04); // boots
    }
    g.box(M.steel, 0.7, 0.06, 0.06, 0, 1.72, -0.35); // rack arm
    g.box(M.steel, 0.06, 1.7, 0.06, 0, 1.0, -0.4);
    const holder = new THREE.Group();
    g.build(holder);
    holder.position.set(x, F - 0.05, z);
    holder.rotation.y = ry;
    group.add(holder);
    return holder;
  };
  const suitIds = ["CDR", "ENG", "SCI", "MED"];
  [-6.2, -4.7, -3.2, 3.2].forEach((x, i) => {
    const s = suitAt(x, 5.48, 0);
    const pick = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.9, 0.5), M.pick);
    pick.position.set(x, F + 1.0, 5.5);
    group.add(pick);
    void s;
    interact.push({
      object: pick,
      label: `EVA suit · ${suitIds[i]}`,
      onSelect: () =>
        card.show(new THREE.Vector3(x, y0 + F + 1.6, 6.3), app.xr.headWorld(), {
          eyebrow: "Suit room",
          title: `EVA suit · ${suitIds[i]}`,
          lines: [
            ...wrap("Rear-entry hard-torso suit on its rack, backpack charging. The suit and its design are fiction.", 50),
            ...wrap("Real: Mars' surface pressure is only ~0.6 kPa (about 0.6 % of Earth's), so a suit is a full pressure vessel.", 50),
          ],
          tag: "fiction + established",
        }),
    });
  });
  for (const x of [-2.2, 2.2]) {
    kit.box(M.trim, 0.45, 0.42, 2.4, x, F + 0.21, 7.4);
    kit.box(M.fabric, 0.42, 0.08, 2.36, x, F + 0.46, 7.4);
  }
  // Tool bench + lockers.
  kit.box(M.trim, 1.6, 0.9, 0.6, 5.6, F + 0.45, 5.4);
  kit.box(M.dark, 1.56, 0.04, 0.56, 5.6, F + 0.92, 5.4);
  for (let i = 0; i < 4; i++) kit.box(i % 2 ? M.orange : M.trim, 0.3, 0.06, 0.12, 5.1 + i * 0.32, F + 0.97, 5.35);
  groundCols.push(...lineCircles(-6.6, 5.5, -2.9, 5.5, 0.3, 0.35), { x: 3.2, z: 5.5, r: 0.32 }, ...lineCircles(4.9, 5.4, 6.3, 5.4, 0.35, 0.35));
  groundCols.push(...lineCircles(-2.2, 6.3, -2.2, 8.5, 0.25, 0.3), ...lineCircles(2.2, 6.3, 2.2, 8.5, 0.25, 0.3));
  const suitSign = sign("SUIT ROOM", { w: 0.8, h: 0.18, bg: "#cf5c27" });
  suitSign.position.set(0, F + 2.35, 4.93);
  suitSign.rotation.y = Math.PI;
  group.add(suitSign);
  // Garage tunnel hatch (sealed): round hatch on the wall.
  {
    const a = bearing(T.garage.a.x, T.garage.a.z);
    const p = atBearing(a, RL - 0.06);
    const hz = new Kit();
    hz.put(new THREE.TorusGeometry(0.62, 0.07, 8, 28), M.trim, 0, 0, 0);
    hz.put(new THREE.CircleGeometry(0.6, 28), M.dark, 0, 0, 0.01);
    hz.box(M.yellow, 0.5, 0.08, 0.06, 0, 0, 0.04);
    const g = new THREE.Group();
    hz.build(g);
    g.position.set(p.x, F + 1.0, p.z);
    g.rotation.y = a + Math.PI;
    group.add(g);
    const sg = sign("GARAGE TUNNEL · SEALED", { w: 0.9, h: 0.14, bg: "#2b2f35" });
    sg.position.set(p.x - Math.sin(a) * 0.02, F + 1.85, p.z - Math.cos(a) * 0.02);
    sg.rotation.y = a + Math.PI;
    group.add(sg);
  }

  // Medical corner.
  kit.box(M.trim, 0.85, 0.62, 2.0, 7.7, F + 0.31, 2.0); // bed base
  kit.box(M.white, 0.8, 0.14, 1.95, 7.7, F + 0.69, 2.0);
  kit.box(M.fabric, 0.8, 0.1, 0.5, 7.7, F + 0.81, 1.15);
  kit.box(M.trim, 0.6, 1.9, 0.5, 4.6, F + 0.95, 4.6); // supply cabinet
  kit.box(M.white, 0.56, 1.8, 0.02, 4.6, F + 0.95, 4.34);
  kit.box(M.red, 0.18, 0.18, 0.02, 4.6, F + 1.6, 4.32);
  kit.box(M.trim, 0.5, 0.9, 0.5, 6.4, F + 0.45, 0.0); // ultrasound cart
  kit.box(M.dark, 0.46, 0.32, 0.04, 6.4, F + 1.2, -0.05, 0, -0.3);
  for (const z of [0.6, 3.4]) kit.cyl(M.steel, 0.015, 0.015, C - F, 6, 6.95, (F + C) / 2, z);
  kit.box(M.steel, 0.03, 0.03, 2.8, 6.95, C - 0.08, 2.0);
  kit.box(M.fabric, 0.02, 1.7, 1.2, 6.95, F + 1.2, 0.9); // privacy curtain (half drawn)
  groundCols.push(...lineCircles(7.7, 1.1, 7.7, 2.9, 0.48, 0.3), { x: 4.6, z: 4.6, r: 0.4 }, { x: 6.4, z: 0, r: 0.35 });
  const medSign = sign("MEDICAL", { w: 0.6, h: 0.16, bg: "#b5332a" });
  medSign.position.set(4.14, F + 2.35, -0.2);
  medSign.rotation.y = -Math.PI / 2;
  group.add(medSign);
  const medPick = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 2), M.pick);
  medPick.position.set(7.7, F + 0.7, 2.0);
  group.add(medPick);
  interact.push({
    object: medPick,
    label: "Medical bay",
    onSelect: () =>
      card.show(new THREE.Vector3(6.6, y0 + F + 1.6, 2.4), app.xr.headWorld(), {
        eyebrow: "Medical corner",
        title: "Radiation dose log",
        lines: [
          ...wrap("Curiosity's RAD instrument measured about 0.67 mSv per day on the surface of Gale crater (Hassler et al. 2014).", 50),
          ...wrap("The crew's dosimeters here are part of the fiction; the berm round this deck is the shielding.", 50),
        ],
        tag: "established + fiction",
      }),
  });

  // Bunks: three double berths along the north-west.
  const bunk = (cx, cz) => {
    kit.box(M.trim, 2.0, 0.08, 0.9, cx, F + 0.42, cz);
    kit.box(M.fabric, 1.94, 0.14, 0.84, cx, F + 0.53, cz);
    kit.box(M.trim, 2.0, 0.08, 0.9, cx, F + 1.42, cz);
    kit.box(M.fabricWarm, 1.94, 0.14, 0.84, cx, F + 1.53, cz);
    kit.box(M.white, 0.45, 0.12, 0.5, cx - 0.72, F + 0.66, cz);
    kit.box(M.white, 0.45, 0.12, 0.5, cx - 0.72, F + 1.66, cz);
    for (const [dx, dz] of [[-0.98, -0.43], [0.98, -0.43], [-0.98, 0.43], [0.98, 0.43]]) kit.box(M.steel, 0.05, 1.95, 0.05, cx + dx, F + 0.98, cz + dz);
    kit.box(M.fabric, 2.0, 1.5, 0.02, cx, F + 1.2, cz + 0.46);
    groundCols.push(...lineCircles(cx - 0.75, cz, cx + 0.75, cz, 0.5, 0.35));
  };
  bunk(-7.3, -2.3);
  bunk(-7.3, -4.6);
  bunk(-5.2, -7.0);
  for (let i = 0; i < 3; i++) kit.box(i % 2 ? M.trim : M.wall, 0.5, 1.9, 0.45, -4.0, F + 0.95, -4.6 - i * 0.52); // lockers
  groundCols.push(...lineCircles(-4.0, -4.6, -4.0, -5.7, 0.3, 0.3));
  const bunkSign = sign("CREW QUARTERS", { w: 0.8, h: 0.16 });
  bunkSign.position.set(-3.54, F + 2.35, -2.7);
  bunkSign.rotation.y = Math.PI / 2;
  group.add(bunkSign);

  // Stowage / workshop by the lab hatch.
  kit.box(M.trim, 0.6, 1.8, 2.4, -5.0, F + 0.9, 2.6); // shelving
  for (let i = 0; i < 4; i++) kit.box(i % 2 ? M.orange : M.white, 0.5, 0.32, 0.5, -5.0, F + 0.3 + i * 0.44, 2.0 + (i % 3) * 0.5);
  groundCols.push(...lineCircles(-5.0, 1.5, -5.0, 3.7, 0.36, 0.3));

  // Galley + commons.
  kit.box(M.trim, 4.8, 0.9, 0.62, -0.9, F + 0.45, -8.45);
  kit.box(M.white, 4.84, 0.05, 0.66, -0.9, F + 0.92, -8.45);
  kit.box(M.trim, 4.8, 0.7, 0.36, -0.9, F + 1.75, -8.62); // wall cabinets
  kit.box(M.dark, 0.6, 0.5, 0.5, -2.6, F + 1.2, -8.45); // food warmer
  kit.box(M.steel, 0.36, 0.5, 0.36, 0.8, F + 1.2, -8.5); // water dispenser
  kit.cyl(M.lampCool, 0.03, 0.03, 0.02, 8, 0.8, F + 1.35, -8.31, 0, Math.PI / 2);
  groundCols.push(...lineCircles(-3.1, -8.4, 1.3, -8.4, 0.35, 0.3));
  // Table with benches.
  kit.box(M.white, 2.6, 0.06, 1.0, 0.4, F + 0.76, -4.6);
  kit.box(M.trim, 0.12, 0.72, 0.12, -0.6, F + 0.37, -4.6);
  kit.box(M.trim, 0.12, 0.72, 0.12, 1.4, F + 0.37, -4.6);
  for (const dz of [-0.85, 0.85]) {
    kit.box(M.trim, 2.4, 0.42, 0.36, 0.4, F + 0.21, -4.6 + dz);
    kit.box(M.fabric, 2.36, 0.06, 0.34, 0.4, F + 0.45, -4.6 + dz);
  }
  for (const [x, z, c] of [[-0.2, -4.4, M.orange], [0.5, -4.8, M.white], [1.1, -4.4, M.red]]) kit.cyl(c, 0.05, 0.045, 0.11, 10, x, F + 0.84, z);
  groundCols.push(...lineCircles(-0.9, -4.6, 1.7, -4.6, 0.75, 0.35));
  const galleyPick = new THREE.Mesh(new THREE.BoxGeometry(4.8, 1.2, 0.8), M.pick);
  galleyPick.position.set(-0.9, F + 0.9, -8.4);
  group.add(galleyPick);
  interact.push({
    object: galleyPick,
    label: "Galley",
    onSelect: () => {
      const s = app.summary ?? {};
      const days = (v) => (v === undefined ? "—" : Number.isFinite(v) ? `${Math.round(v)} sols` : "stable");
      card.show(new THREE.Vector3(-0.9, y0 + F + 1.7, -7.2), app.xr.headWorld(), {
        eyebrow: "Galley · live from the life-support model",
        title: "Food and water",
        lines: [
          `Food reserve: ${days(s.food?.reserve)}`,
          `Water reserve: ${days(s.water?.reserve)}`,
          ...wrap("Water is recycled (the model assumes ~98 % recovery, an ISS-class figure); food mostly comes from the greenhouse and stores.", 50),
        ],
        tag: "simplified",
      });
    },
  });
  // Live status screen in the commons (on the medical wall, facing the table).
  const status = new Panel({ width: 1.3, height: 0.74, ppm: 700, opacity: 0.96 });
  status.mesh.position.set(6.6, F + 1.55, -1.07);
  status.mesh.rotation.y = Math.PI;
  group.add(status.mesh);
  kit.box(M.dark, 1.38, 0.82, 0.04, 6.6, F + 1.55, -1.04);
  let statusT = 0;
  updaters.push((dt) => {
    statusT -= dt;
    if (statusT > 0) return;
    statusT = 1;
    const sim = app.sim;
    const st = sim.stores;
    const f = sim.flows ?? {};
    status.setContent({
      eyebrow: "Frontier Base · habitat status",
      title: `Sol ${solNumber(sim)} · ${clockString(sim)}`,
      titleSize: 70,
      lines: [
        `O₂ stored ${Math.round(st.o2)} kg · water ${Math.round(st.water)} kg`,
        `Battery ${Math.round((100 * st.battery) / Math.max(1, sim.config.batteryKWh))} % · solar ${(f.solarKW ?? 0).toFixed(0)} kW`,
        `Dust optical depth τ ${(f.tau ?? 0.5).toFixed(1)}`,
        `Crew ${sim.config.crew} · greenhouse lights ${sim.systems.greenhouseLights ? "on" : "off"}`,
      ],
      lineSize: 44,
      tag: "live simulation",
    });
  });
  // Ceiling lights (ground deck).
  for (const [x, z] of [[0, 7.2], [-5, 7], [5, 7], [6.5, 2], [-6.5, -4], [0.4, -4.6], [-1, -7.6], [5.5, -4.5], [-5.5, 2.5], [0, 0.5], [-2.4, -1.5]]) {
    kit.box(M.trim, 1.1, 0.05, 0.36, x, C - 0.03, z);
    kit.box(M.lamp, 1.0, 0.02, 0.28, x, C - 0.06, z);
  }
  // Ladder collider + interaction (to the upper deck).
  groundCols.push({ x: LAD.x - 0.32, z: LAD.z - LAD.hw + 0.08, r: 0.08 }, { x: LAD.x + 0.32, z: LAD.z - LAD.hw + 0.08, r: 0.08 });
  const ladPick = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.0, 0.3), M.pick);
  ladPick.position.set(LAD.x, F + 1.2, LAD.z - LAD.hw + 0.1);
  group.add(ladPick);
  const ladSign = sign("UPPER DECK ↑", { w: 0.6, h: 0.14 });
  ladSign.position.set(LAD.x, F + 2.2, LAD.z - LAD.hw + 0.16);
  group.add(ladSign);
  const climb = async (up) => {
    if (climb.busy) return;
    climb.busy = true;
    audio?.tone?.(up ? 520 : 400, 0.12, "triangle", 0.04);
    await app.xr.fadeTo(1, 0.2);
    zones.set(up ? "habUpper" : "habGround");
    if (up) app.xr.place(LAD.x, LAD.z - LAD.hw - 0.75, 0, y0 + U);
    else app.xr.place(LAD.x, LAD.z + 0.2, 0, y0 + F);
    await app.xr.fadeTo(0, 0.25);
    climb.busy = false;
  };
  interact.push({ object: ladPick, label: "Climb to the upper deck", enabled: () => zones.current?.id === "habGround", onSelect: () => climb(true) });

  // ── Upper deck: observation lounge ──
  const upperCols = [...arcCircles(0, 0, RL, [], 0.2, 0.3)];
  for (const h of [hatch.lab, hatch.habB]) {
    // Railing round the notch.
    for (let i = 0; i <= 14; i++) {
      const p = atBearing(h.ang - NOTCH + (i / 14) * 2 * NOTCH, 7.0);
      upperCols.push({ x: p.x, z: p.z, r: 0.12 });
    }
    for (const s of [-1, 1]) {
      const p0 = atBearing(h.ang + s * NOTCH, 7.0);
      const p1 = atBearing(h.ang + s * NOTCH, RL);
      upperCols.push(...lineCircles(p0.x, p0.z, p1.x, p1.z, 0.12, 0.25));
    }
  }
  upperCols.push(...lineCircles(LAD.x - LAD.hw, LAD.z - LAD.hw, LAD.x + LAD.hw, LAD.z - LAD.hw, 0.1, 0.2));
  upperCols.push(...lineCircles(LAD.x + LAD.hw, LAD.z - LAD.hw, LAD.x + LAD.hw, LAD.z + LAD.hw, 0.1, 0.2));
  upperCols.push(...lineCircles(LAD.x - LAD.hw, LAD.z + LAD.hw, LAD.x + LAD.hw, LAD.z + LAD.hw, 0.1, 0.2));
  upperCols.push(...lineCircles(LAD.x - LAD.hw, LAD.z - LAD.hw, LAD.x - LAD.hw, LAD.z + LAD.hw, 0.1, 0.2));
  // Window benches (skip where the hatch notch is).
  for (const a of WINDOWS) {
    if (notchOf(a - 0.09) || notchOf(a + 0.09)) continue;
    const p = atBearing(a, RL - 0.4);
    kit.box(M.trim, 1.5, 0.42, 0.5, p.x, U + 0.21, p.z, a);
    kit.box(M.fabric, 1.46, 0.07, 0.48, p.x, U + 0.45, p.z, a);
    upperCols.push(...lineCircles(p.x - Math.cos(a) * 0.55, p.z + Math.sin(a) * 0.55, p.x + Math.cos(a) * 0.55, p.z - Math.sin(a) * 0.55, 0.25, 0.3));
  }
  // Command workstation with a live screen + telescope + plants.
  kit.box(M.trim, 2.2, 0.75, 0.7, -2.0, U + 0.375, -3.0);
  kit.box(M.dark, 2.24, 0.04, 0.74, -2.0, U + 0.77, -3.0);
  for (const dx of [-0.6, 0.6]) {
    kit.box(M.trim, 0.45, 0.45, 0.45, -2.0 + dx, U + 0.24, -2.25);
  }
  upperCols.push(...lineCircles(-2.9, -3.0, -1.1, -3.0, 0.42, 0.3));
  const cmd = new Panel({ width: 1.1, height: 0.6, ppm: 700, opacity: 0.96 });
  cmd.mesh.position.set(-2.0, U + 1.25, -3.32);
  cmd.mesh.rotation.x = -0.12;
  upper.add(cmd.mesh);
  kit.box(M.dark, 1.16, 0.66, 0.04, -2.0, U + 1.25, -3.36, 0, -0.12);
  let cmdT = 0;
  updaters.push((dt) => {
    cmdT -= dt;
    if (cmdT > 0) return;
    cmdT = 2;
    const sim = app.sim;
    const sun = app.sunDir ?? { y: 0 };
    const el = Math.round((Math.asin(Math.max(-1, Math.min(1, sun.y))) * 180) / Math.PI);
    cmd.setContent({
      eyebrow: "Command deck · Arcadia Planitia",
      title: `Sun elevation ${el}°`,
      titleSize: 64,
      lines: [`Optical depth τ ${(sim.flows?.tau ?? 0.5).toFixed(1)} (dust)`, el < 8 && el > -6 ? "Sunset/sunrise: look west/east" : "Windows all round this deck", "Sunsets on Mars look blue near the Sun (established)."],
      lineSize: 40,
      tag: "live",
    });
  });
  // Telescope on a tripod by the north-west window.
  {
    const a = WINDOWS[5];
    const p = atBearing(a, RL - 1.3);
    for (let k = 0; k < 3; k++) {
      const b = (k / 3) * TAU;
      kit.rod(M.steel, new THREE.Vector3(p.x, U + 1.1, p.z), new THREE.Vector3(p.x + Math.sin(b) * 0.4, U, p.z + Math.cos(b) * 0.4), 0.015);
    }
    const tube = new THREE.CylinderGeometry(0.07, 0.07, 0.75, 14);
    tube.rotateX(Math.PI / 2 - 0.35);
    kit.put(tube, M.white, p.x, U + 1.2, p.z, a);
    upperCols.push({ x: p.x, z: p.z, r: 0.42 });
  }
  for (const [x, z] of [[4.2, -5.5], [-6.2, 3.5], [5.6, 4.6]]) {
    kit.cyl(M.dark, 0.22, 0.18, 0.4, 12, x, U + 0.2, z);
    kit.put(new THREE.IcosahedronGeometry(0.35, 1), M.green, x, U + 0.65, z);
    upperCols.push({ x, z, r: 0.3 });
  }
  // Dome light ring.
  kit.put(new THREE.TorusGeometry(3.4, 0.06, 6, 48).rotateX(Math.PI / 2), M.lamp, 0, 9.6, 0);
  kit.put(new THREE.TorusGeometry(6.8, 0.05, 6, 64).rotateX(Math.PI / 2), M.lampCool, 0, 7.3, 0);
  const downPick = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), M.pick);
  downPick.position.set(LAD.x, U + 0.6, LAD.z);
  upper.add(downPick);
  const downSign = sign("LADDER ↓ GROUND DECK", { w: 0.7, h: 0.12 });
  downSign.position.set(LAD.x, U + 1.15, LAD.z - LAD.hw - 0.02);
  downSign.rotation.y = Math.PI;
  upper.add(downSign);
  interact.push({ object: downPick, label: "Climb down to the ground deck", enabled: () => zones.current?.id === "habUpper", onSelect: () => climb(false) });

  // ── Airlock interior ──
  const AZ0 = 9.85;
  const AZ1 = 16.2;
  kit.add(tubeShell({ origin: new THREE.Vector3(0, 2.0, AZ0), axis: new THREE.Vector3(0, 0, 1), ref: new THREE.Vector3(0, 1, 0), side: new THREE.Vector3(1, 0, 0), radius: 1.72, t0: 0, t1: AZ1 - AZ0, segs: 28 }), M.liner);
  kit.plane(M.floor, 2.6, AZ1 - AZ0, 0, F, (AZ0 + AZ1) / 2);
  kit.box(M.yellow, 0.06, 0.01, AZ1 - AZ0, -0.7, F + 0.005, (AZ0 + AZ1) / 2);
  kit.box(M.yellow, 0.06, 0.01, AZ1 - AZ0, 0.7, F + 0.005, (AZ0 + AZ1) / 2);
  // Outer end wall with the door opening (seen from inside).
  {
    const shape = new THREE.Shape();
    shape.absarc(0, 2.0, 1.75, 0, TAU, false);
    const hole = new THREE.Path();
    hole.moveTo(-0.62, F);
    hole.lineTo(0.62, F);
    hole.lineTo(0.62, C);
    hole.lineTo(-0.62, C);
    hole.lineTo(-0.62, F);
    shape.holes.push(hole);
    const g = new THREE.ShapeGeometry(shape, 24);
    g.rotateY(Math.PI);
    kit.add(g.translate(0, 0, AZ1 + 0.02), M.linerFront);
  }
  for (const s of [-1, 1]) {
    kit.box(M.trim, 0.36, 0.42, 3.6, s * 1.05, F + 0.21, 13.0);
    kit.box(M.fabric, 0.34, 0.06, 3.5, s * 1.05, F + 0.45, 13.0);
    kit.rod(M.steel, new THREE.Vector3(s * 1.25, F + 1.3, 10.6), new THREE.Vector3(s * 1.25, F + 1.3, 15.6), 0.02);
  }
  kit.box(M.lamp, 0.3, 0.02, 4.4, 0, 3.66, 13.0);
  const airLed = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: "#5ce08a", toneMapped: false, fog: false }));
  airLed.position.set(0.8, F + 2.3, AZ1 - 0.05);
  group.add(airLed);
  const airSign = sign("AIRLOCK 1", { w: 0.6, h: 0.14, bg: "#d9a92c", fg: "#1d2228" });
  airSign.position.set(0, C + 0.18, AZ1 - 0.03);
  airSign.rotation.y = Math.PI;
  group.add(airSign);
  const airCols = [...lineCircles(-0.95, AZ0, -0.95, AZ1, 0.12, 0.25), ...lineCircles(0.95, AZ0, 0.95, AZ1, 0.12, 0.25)];
  // Exterior: steps up to the 0.9 m sill on top of the existing ramp, and side rails.
  const outKit = new Kit();
  for (let i = 0; i < 4; i++) {
    const zz = 16.55 + i * 0.5;
    const top = F - i * 0.18;
    outKit.box(SM.sintered, 2.2, Math.max(0.05, top - 0.24), 0.5, 0, 0.24 + (top - 0.24) / 2, zz + 0.25);
  }

  // ── Tunnels: liners, floors, lights, rails ──
  const tunnelZones = [];
  const tunnelLiner = (h, from, to, label) => {
    const u = h.u;
    const len = Math.hypot(to.x - from.x, to.z - from.z);
    const ref = new THREE.Vector3(0, 1, 0);
    const ax = new THREE.Vector3(u.x, 0, u.z);
    kit.add(tubeShell({ origin: new THREE.Vector3(from.x, h.y, from.z), axis: ax, ref, radius: h.r - 0.07, t0: 0, t1: len, segs: 22, tSteps: Math.ceil(len / 3) }), M.liner);
    const half = Math.sqrt(Math.max(0, (h.r - 0.07) ** 2 - (h.y - h.floor) ** 2));
    const mid = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
    const yaw = Math.atan2(u.x, u.z);
    kit.plane(M.floor, half * 2 + 0.02, len, mid.x, h.floor, mid.z, yaw);
    kit.box(M.lamp, 0.12, 0.02, len - 0.4, mid.x, h.y + h.r - 0.12, mid.z, yaw);
    const ox = Math.cos(yaw);
    const oz = -Math.sin(yaw);
    for (const s of [-1, 1]) {
      const a = new THREE.Vector3(from.x + ox * s * (half - 0.08), h.floor + 0.95, from.z + oz * s * (half - 0.08));
      const b = new THREE.Vector3(to.x + ox * s * (half - 0.08), h.floor + 0.95, to.z + oz * s * (half - 0.08));
      if (half > 0.6) kit.rod(M.steel, a, b, 0.018);
    }
    const lab = sign(label, { w: 0.7, h: 0.13 });
    lab.position.set(from.x + u.x * 0.35 - ox * 0, h.y + h.r - 0.35, from.z + u.z * 0.35);
    lab.rotation.y = yaw + Math.PI;
    group.add(lab);
    const cols = [];
    for (const s of [-1, 1]) cols.push(...lineCircles(from.x + ox * s * (half + 0.06), from.z + oz * s * (half + 0.06), to.x + ox * s * (half + 0.06), to.z + oz * s * (half + 0.06), 0.12, 0.26));
    return { half, len, yaw, mid, cols };
  };
  const ghFrom = hatch.gh.at;
  const ghL = tunnelLiner(hatch.gh, ghFrom, hatch.gh.end, "GREENHOUSE →");
  const labL = tunnelLiner(hatch.lab, hatch.lab.at, hatch.lab.end, "SCIENCE LAB →");
  const habBL = tunnelLiner(hatch.habB, hatch.habB.at, hatch.habB.end, "HABITAT B →");
  // Habitat B end: docking hatch, locked from the far side (Habitat B is the night-shift module).
  {
    const h = hatch.habB;
    const e = h.end;
    const g = new Kit();
    g.put(new THREE.CircleGeometry(h.r - 0.07, 24), M.trim, 0, 0, 0);
    g.put(new THREE.TorusGeometry(0.55, 0.06, 8, 24), M.dark, 0, -0.05, 0.02);
    g.put(new THREE.CircleGeometry(0.52, 24), M.dark, 0, -0.05, 0.015);
    const grp = new THREE.Group();
    g.build(grp);
    grp.position.set(e.x, h.y, e.z);
    grp.rotation.y = Math.atan2(h.u.x, h.u.z) + Math.PI;
    group.add(grp);
    const btn = button({ label: "Habitat B hatch", color: "#ffb347", onPress: () => app.xr.toast("Habitat B hatch", "Locked from the far side: Habitat B crew are asleep. Use its own airlock outside.") });
    btn.mesh.position.set(e.x - h.u.x * 0.06 + Math.cos(grp.rotation.y) * 0.6, h.floor + 1.2, e.z - h.u.z * 0.06 - Math.sin(grp.rotation.y) * 0.6);
    btn.mesh.rotation.y = grp.rotation.y;
    group.add(btn.mesh);
    interact.push(btn.it);
    updaters.push((dt) => btn.tick(dt));
  }

  // ── Doors ──
  const doors = {};
  const mkDoor = (id, x, z, yaw, floor, w, h, panelOffsets) => {
    const d = slidingDoor({ w, h, audio });
    d.group.position.set(x, floor, z);
    d.group.rotation.y = yaw;
    group.add(d.group);
    doors[id] = { ...d, id, x, z, floor, far: 0, buttons: [] };
    for (const [side, label] of panelOffsets) {
      const b = button({ label, color: "#5ce08a", onPress: () => press(id, side) });
      // side: +1 = local +z face, −1 = local −z face
      const ox = Math.cos(yaw);
      const oz = -Math.sin(yaw);
      const lx = w / 2 + 0.3;
      b.mesh.position.set(x + ox * lx + Math.sin(yaw) * side * 0.1, floor + 1.2, z + oz * lx + Math.cos(yaw) * side * 0.1);
      b.mesh.rotation.y = yaw + (side > 0 ? 0 : Math.PI);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.02), M.dark);
      plate.position.copy(b.mesh.position).addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), -side * 0.015);
      plate.rotation.y = yaw;
      group.add(plate, b.mesh);
      interact.push(b.it);
      doors[id].buttons.push(b);
    }
    return doors[id];
  };
  // Airlock: inner door on the habitat wall, outer door in the end cap.
  mkDoor("inner", 0, AZ0 - 0.04, 0, F, 1.2, 2.1, [[-1, "Open airlock"], [1, "Cycle airlock inward"]]);
  mkDoor("outer", 0, AZ1 + 0.1, 0, F, 1.2, 2.1, [[-1, "Cycle airlock outward"], [1, "Cycle airlock"]]);
  for (const id of ["gh", "lab", "habB"]) {
    const h = hatch[id];
    const yaw = Math.atan2(h.u.x, h.u.z);
    const p = { x: h.at.x - h.u.x * 0.06, z: h.at.z - h.u.z * 0.06 };
    mkDoor(id, p.x, p.z, yaw, h.floor, h.half * 2, h.top - h.floor - 0.05, [[-1, `Open hatch · ${id === "gh" ? "greenhouse" : id === "lab" ? "lab" : "Habitat B"}`], [1, "Open hatch · habitat"]]);
  }
  // Airlock cycle (an interlock: never both doors open).
  const cyc = { busy: 0, then: null };
  const airlockLight = (c) => airLed.material.color.set(c);
  function press(id, side) {
    const head = app.xr.headWorld();
    void side;
    if (id === "inner" || id === "outer") {
      const other = id === "inner" ? doors.outer : doors.inner;
      const me = doors[id];
      if (cyc.busy > 0) return;
      if (me.state.target === 1) {
        me.close();
        return;
      }
      if (id === "outer") app.actAirlock?.();
      if (other.state.target === 1 || other.state.open > 0.02) {
        other.close();
        cyc.busy = 1.2 + 2.4;
        cyc.then = () => me.open();
        setTimeout(() => {
          hiss(audio, 2.4, 0.09, 600, 2600);
          airlockLight("#ffb347");
        }, 1200);
        app.xr.toast("Airlock", id === "inner" ? "Pressurising… 2 s" : "Depressurising… 2 s");
      } else {
        me.open();
        if (id === "inner" && zones.current?.id === "airlock") app.xr.toast("Airlock", "Pressure equal. Welcome inside.");
      }
      void head;
      return;
    }
    const d = doors[id];
    if (d.state.target === 1) d.close();
    else d.open();
  }
  updaters.push((dt, head) => {
    if (cyc.busy > 0) {
      cyc.busy -= dt;
      if (cyc.busy <= 0) {
        airlockLight("#5ce08a");
        cyc.then?.();
        cyc.then = null;
      }
    }
    for (const d of Object.values(doors)) {
      d.update(dt);
      for (const b of d.buttons) b.tick(dt);
      // Doors close themselves once nobody is near.
      const dist = Math.hypot(head.x - d.x, head.z - d.z);
      if (d.state.target === 1 && dist > 2.6) {
        d.far += dt;
        if (d.far > 3.5) d.close();
      } else d.far = 0;
    }
    vrParts.airlockLight && (vrParts.airlockLight.material.color.set(doors.outer.state.target ? "#ffb347" : "#5ce08a"));
  });

  // ── Zones ──
  const inHab = (x, z) => x * x + z * z < RL * RL;
  const platformAt = (x, z) => {
    const r = Math.hypot(x, z);
    const a = bearing(x, z);
    for (const p of platforms) {
      if (!angIn(a, p.ang - p.half, p.ang + p.half)) continue;
      if (r >= 8.4) return p.floor;
      if (r >= 7.2) return F + (Math.min(4, Math.floor((r - 7.2) / 0.3) + 1) * (p.floor - F)) / 4;
    }
    return F;
  };
  const wallGaps = [[air.ang - 1.1 / RL, air.ang + 1.1 / RL], ...Object.values(hatch).map((h) => [h.ang - (h.half + 0.05) / RL, h.ang + (h.half + 0.05) / RL])];
  zones.add({ id: "habGround", name: "Habitat · ground deck", contains: inHab, floor: (x, z) => y0 + platformAt(x, z), colliders: [...arcCircles(0, 0, RL + 0.05, wallGaps, 0.2, 0.3), ...groundCols] });
  zones.add({ id: "habUpper", name: "Habitat · upper deck", level: true, contains: inHab, floor: () => y0 + U, colliders: upperCols });
  zones.add({ id: "airlock", name: "Airlock", contains: (x, z) => Math.abs(x) < 1.1 && z > Math.sqrt(Math.max(0, RL * RL - x * x)) && z < AZ1 + 0.1, floor: () => y0 + F, colliders: airCols });
  const tz = (id, h, L, name) =>
    zones.add({
      id,
      name,
      contains: (x, z) => {
        if (inHab(x, z)) return false;
        const p = toLocal(x, z, L.mid.x, L.mid.z, L.yaw);
        return Math.abs(p.x) < L.half + 0.15 && Math.abs(p.z) < L.len / 2 + 0.02;
      },
      floor: () => y0 + h.floor,
      colliders: L.cols,
    });
  tz("ghTunnel", hatch.gh, ghL, "Tunnel to the greenhouse");
  tz("labTunnel", hatch.lab, labL, "Tunnel to the lab");
  tz("habBTunnel", hatch.habB, habBL, "Tunnel to Habitat B");
  zones.portal({ a: null, b: "airlock", x: 0, z: AZ1 + 0.1, r: 1.0, open: () => doors.outer.isOpen });
  zones.portal({ a: "airlock", b: "habGround", x: 0, z: AZ0 - 0.04, r: 1.0, open: () => doors.inner.isOpen });
  for (const [id, zid] of [["gh", "ghTunnel"], ["lab", "labTunnel"], ["habB", "habBTunnel"]]) {
    const d = doors[id];
    zones.portal({ a: "habGround", b: zid, x: d.x, z: d.z, r: 1.0, open: () => d.isOpen });
  }
  tunnelZones.push("ghTunnel", "labTunnel", "habBTunnel");

  // Outside: the berm and the airlock flanks replace the single r 14.5 circle.
  const outsideCols = [...arcCircles(0, 0, 13.0, [[-2.3 / 13, 2.3 / 13]], 0.45, 0.55), ...lineCircles(-2.25, 12.9, -2.25, 16.55, 0.25, 0.3), ...lineCircles(2.25, 12.9, 2.25, 16.55, 0.25, 0.3)];
  /** Outside floor near the habitat: the approach steps to the sill; the berm itself is not walkable. */
  const outsideFloor = (x, z, terrain) => {
    if (Math.abs(x) < 1.6 && z > AZ1 && z < 18.6) return y0 + lerp(F, Math.max(0.24, terrain - y0), (z - AZ1 - 0.1) / 2.2);
    if (x * x + z * z < 12.8 * 12.8) return null;
    return terrain;
  };

  const meshes = kit.build(group, { receive: true });
  outKit.build(group);
  void meshes;
  // Glass and panels render after opaque.
  group.traverse((o) => {
    if (o.material === M.glass) o.renderOrder = 3;
  });

  return {
    group,
    center: new THREE.Vector3(0, y0, 0),
    radius: 32,
    interactables: interact,
    zoneIds: ["habGround", "habUpper", "airlock", ...tunnelZones],
    insideIds: ["habGround", "habUpper", "airlock"],
    doors,
    outsideCols,
    outsideFloor,
    /** Exterior re-cut on/off (VR session start/end). */
    setVR(on) {
      vrParts.wall.geometry = on ? wallGeo : orig.wall;
      vrParts.airlockTube.geometry = on ? tubeGeo : orig.tube;
      vrParts.airlockCap.geometry = on ? capGeo : orig.cap;
      for (const p of [vrParts.hatch, vrParts.hatchRing, vrParts.hatchSign]) if (p) p.visible = !on;
      for (const s of tunnelSwaps) s.mesh.geometry = on ? s.vr : s.orig;
    },
    /** Inside the habitat: hide exterior faces that would block the windows. */
    setInside(on) {
      for (const m of exteriorHide) m.visible = !on;
    },
    update(dt, head) {
      for (const u of updaters) u(dt, head);
    },
    /** Exterior faces that hide the outside when the decks below the berm are sealed. */
    sealed() {
      return !doors.outer.isOpen && doors.outer.state.open < 0.05 && doors.gh.state.open < 0.05 && doors.lab.state.open < 0.05;
    },
  };
}

function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  for (const k of ["position", "normal", "uv"]) {
    const A = a.attributes[k];
    const B = b.attributes[k];
    const arr = new Float32Array(A.array.length + B.array.length);
    arr.set(A.array, 0);
    arr.set(B.array, A.array.length);
    g.setAttribute(k, new THREE.BufferAttribute(arr, A.itemSize));
  }
  a.dispose();
  b.dispose();
  return g;
}
