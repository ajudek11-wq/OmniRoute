import * as THREE from "three";
import { Merger, mat4, sign, pick } from "./kit.js";
import { RING_R, ringFloorY } from "./physics.js";

/**
 * The walkable part of the rotating habitat ring, in the ring's own (co-rotating) frame:
 * the ring's spin axis is +X through (0, R, 0); the floor's lowest point is the origin.
 *  - A 4.4 m wide concourse runs around the ring (along ±Z). Its floor and ceiling are real arcs of
 *    the 225 m ring, so they visibly curve upward ahead of and behind you.
 *  - Eight rooms branch off it to ±X (along the spin axis, where the floor really is flat). Each room
 *    is level at the concourse height of its doorway (a ≤1° error over its length vs. a true ring).
 */
export const CONC_HALF = 2.2; // concourse inner half-width
export const CONC_H = 3.6;
export const ROOM_X0 = 2.45; // room front wall (inner face) |x|
export const ROOM_DEPTH = 11.55; // → back wall at |x| = 14
export const ROOM_HALF = 7; // along z
export const ROOM_H = 3.4;
export const WALK_Z = 59; // concourse walkable to the sealed bulkheads
const SEG = 2; // concourse segment arc length
const NSEG = 62;
const BODY = 0.32;

export const ROOMS = [
  { id: "control", side: 1, zc: -30, name: "Control Room", sub: "Flight control · orbit · power · traffic" },
  { id: "lounge", side: 1, zc: -10, name: "Observation Lounge", sub: "Earth view · ring info" },
  { id: "greenhouse", side: 1, zc: 10, name: "Greenhouse", sub: "Hydroponics · LED growth racks" },
  { id: "comms", side: 1, zc: 30, name: "Communications", sub: "Relay links · ground stations" },
  { id: "lift", side: -1, zc: -30, name: "Spoke Lift · Hub Airlock", sub: "To the hub, docking & EVA" },
  { id: "lab", side: -1, zc: -10, name: "Research Laboratory", sub: "Glovebox · microscopy · −80 °C freezers" },
  { id: "quarters", side: -1, zc: 10, name: "Crew Quarters", sub: "Sleep cabins · galley" },
  { id: "engineering", side: -1, zc: 30, name: "Engineering", sub: "Life support · coolant · power" },
];

/** Matrix of a concourse segment frame at arc angle θ (z = R sinθ). */
export function segFrame(theta) {
  return new THREE.Matrix4().makeTranslation(0, RING_R, 0).multiply(new THREE.Matrix4().makeRotationX(-theta)).multiply(new THREE.Matrix4().makeTranslation(0, -RING_R, 0));
}

/** Room frame: local u into the room, y up, w along z (mirrored on the −X side). */
export function roomFrame(r) {
  const y0 = ringFloorY(r.zc);
  return new THREE.Matrix4().makeTranslation(r.side * ROOM_X0, y0, r.zc).multiply(new THREE.Matrix4().makeRotationY(r.side > 0 ? 0 : Math.PI));
}

class Door {
  constructor(room, mats, audio) {
    this.room = room;
    this.audio = audio;
    this.open = false;
    this.t = 0;
    this.idle = 0;
    this.locked = false;
    const g = new THREE.Group();
    // Two leaves meeting in the middle, sliding into the wall pockets.
    const leafGeo = new THREE.BoxGeometry(0.05, 2.25, 1.02);
    this.leaves = [-1, 1].map((s) => {
      const leaf = new THREE.Group();
      const body = new THREE.Mesh(leafGeo, mats.white);
      body.position.y = 1.125;
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.22), mats.glassTint);
      win.position.set(0, 1.45, -s * 0.2);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), mats.accent);
      stripe.position.y = 1.0;
      leaf.add(body, win, stripe);
      leaf.userData.s = s;
      g.add(leaf);
      return leaf;
    });
    this.group = g;
    this.setT(0);
  }
  setT(t) {
    this.t = t;
    const e = t * t * (3 - 2 * t);
    for (const l of this.leaves) l.position.set(-0.06, 0, l.userData.s * (0.51 + e * 0.98));
  }
  toggle(force) {
    const want = force ?? !this.open;
    if (want === this.open) return;
    if (this.locked && want) {
      this.audio?.warn?.();
      return;
    }
    this.open = want;
    this.idle = 0;
    this.onSound?.(want);
  }
  update(dt, nearby) {
    const target = this.open ? 1 : 0;
    if (this.t !== target) this.setT(Math.max(0, Math.min(1, this.t + Math.sign(target - this.t) * dt * 1.4)));
    if (this.open) {
      this.idle = nearby ? 0 : this.idle + dt;
      if (this.idle > 14) this.toggle(false);
    }
  }
  get passable() {
    return this.t > 0.85;
  }
}

/**
 * Build the ring interior. Returns { group, rooms: [{…room, frame, group, merger, door}], groundAt,
 * colliders, interactables, anchors, update }.
 */
export function buildRing(ctx, mats, sfx) {
  const group = new THREE.Group();
  group.name = "ring-interior";
  const colliders = [];
  const interactables = [];
  const anchors = []; // interior light anchors { p, color, k }
  const updaters = [];

  // ── Concourse ───────────────────────────────────────────────
  const doorAt = new Map(); // segment index → room
  for (const r of ROOMS) doorAt.set(`${r.side}:${Math.round(Math.asin(r.zc / RING_R) / (SEG / RING_R))}`, r);
  const merge = new Merger();
  const dth = SEG / RING_R;
  const bulkI = Math.round(Math.asin((WALK_Z + 2.5) / RING_R) / dth);
  for (let i = -NSEG; i <= NSEG; i++) {
    const th = i * dth;
    merge.push(segFrame(th));
    const h = CONC_HALF;
    merge.span("floor", -h - 0.15, -0.14, -1.02, h + 0.15, 0, 1.02);
    merge.span("dark", -h, 0, -1.01, -h + 0.18, 0.16, 1.01);
    merge.span("dark", h - 0.18, 0, -1.01, h, 0.16, 1.01);
    merge.span("strip", -h + 0.18, 0.1, -0.9, -h + 0.19, 0.13, 0.9);
    merge.span("strip", h - 0.19, 0.1, -0.9, h - 0.18, 0.13, 0.9);
    merge.span("accent", -0.07, 0, -0.9, 0.07, 0.008, 0.9);
    merge.span("white", -h - 0.15, CONC_H, -1.02, h + 0.15, CONC_H + 0.12, 1.02);
    merge.span("lightPanel", -0.32, CONC_H - 0.02, -0.85, 0.32, CONC_H, 0.85);
    // Coves with cable trays and indirect light
    merge.span("dark", -h, CONC_H - 0.34, -1.01, -h + 0.42, CONC_H, 1.01);
    merge.span("dark", h - 0.42, CONC_H - 0.34, -1.01, h, CONC_H, 1.01);
    merge.span("strip", -h + 0.42, CONC_H - 0.36, -0.95, -h + 0.44, CONC_H - 0.3, 0.95);
    merge.span("strip", h - 0.44, CONC_H - 0.36, -0.95, h - 0.42, CONC_H - 0.3, 0.95);
    // Structural rib every other segment
    if (i % 2 === 0) {
      merge.span("trim", -h, CONC_H - 0.12, -1.0, h, CONC_H - 0.02, -0.9);
      merge.span("trim", -h, 0.16, -1.0, -h + 0.07, CONC_H - 0.12, -0.9);
      merge.span("trim", h - 0.07, 0.16, -1.0, h, CONC_H - 0.12, -0.9);
    }
    for (const s of [-1, 1]) {
      const room = doorAt.get(`${s}:${i}`);
      const xIn = s * h;
      const xOut = s * (h + 0.15);
      if (room) {
        // Door opening: header above, frame trims at the jambs.
        merge.span("wall", Math.min(xIn, xOut), 2.25, -1.02, Math.max(xIn, xOut), CONC_H, 1.02);
        merge.span("trim", Math.min(xIn, xOut) - 0.03, 2.25, -1.08, Math.max(xIn, xOut) + 0.03, 2.33, 1.08);
        for (const e of [-1, 1]) merge.span("trim", Math.min(xIn, xOut) - 0.03, 0, e * 1.0 - 0.05, Math.max(xIn, xOut) + 0.03, 2.33, e * 1.0 + 0.05);
        merge.span("stripAmber", s * (h - 0.01), 2.36, -0.6, s * (h - 0.02), 2.4, 0.6);
      } else {
        merge.span("wall", Math.min(xIn, xOut), 0, -1.02, Math.max(xIn, xOut), CONC_H, 1.02);
        // Wall panel seams + handrail with brackets
        merge.span("dark", s * (h - 0.004), 0.2, -1.0, s * (h + 0.0), CONC_H - 0.4, -0.985);
        merge.tube("rail", [s * (h - 0.09), 1.0, -1.0], [s * (h - 0.09), 1.0, 1.0], 0.022, 8);
        merge.span("trim", s * (h - 0.09) - 0.02, 0.97, -0.02, s * h, 1.0, 0.02);
        // Service hatches and vents
        if (Math.abs(i) % 7 === 3) merge.span("dark", s * (h - 0.01), 0.4, -0.45, s * h, 0.75, 0.45);
        if (Math.abs(i) % 5 === 1) merge.span("dark", s * (h - 0.012), 2.55, -0.5, s * h, 2.85, 0.5);
        // Sealed side doors of other sectors (visual only)
        if (Math.abs(i) >= 22 && Math.abs(i) % 6 === 4) {
          merge.span("dark", s * (h - 0.02), 0, -0.8, s * h, 2.2, 0.8);
          merge.span("ledRed", s * (h - 0.03), 2.25, -0.08, s * (h - 0.02), 2.3, 0.08);
        }
      }
    }
    // Sealed bulkheads (glass doors) at the ends of the walkable sector
    if (Math.abs(i) === bulkI) {
      const e = Math.sign(i) * 1.0;
      merge.span("trim", -h, 0, e - 0.06, h, 0.12, e + 0.06);
      merge.span("trim", -h, 2.4, e - 0.06, h, CONC_H, e + 0.06);
      merge.span("trim", -h, 0, e - 0.06, -h + 0.25, 2.4, e + 0.06);
      merge.span("trim", h - 0.25, 0, e - 0.06, h, 2.4, e + 0.06);
      merge.span("trim", -0.04, 0.12, e - 0.05, 0.04, 2.4, e + 0.05);
      merge.span("glassTint", -h + 0.25, 0.12, e - 0.02, h - 0.25, 2.4, e + 0.02);
      merge.span("stripAmber", -h + 0.3, 2.44, e - 0.07, h - 0.3, 2.5, e - 0.06);
    }
    if (Math.abs(i) === NSEG) merge.span("dark", -h, 0, Math.sign(i) * 1.0 - 0.1, h, CONC_H, Math.sign(i) * 1.0);
    merge.pop();
  }
  merge.build(mats, group, "concourse");
  for (const zb of [-1, 1]) {
    const thb = zb * bulkI * dth;
    const s = sign(["SECTOR " + (zb > 0 ? "4" : "2") + " · PRESSURE TEST", "Sealed · no entry this rotation"], { w: 1.5, bg: "#3a1a12", accent: "#ffb347", size: 70 });
    s.applyMatrix4(segFrame(thb).multiply(mat4(0, 1.9, zb * 0.92, 0, zb > 0 ? Math.PI : 0, 0)));
    group.add(s);
  }
  for (const z of [0, -20, 20, -45, 45]) anchors.push({ p: new THREE.Vector3(0, ringFloorY(z) + 3.1, z), color: 0xeef4ff, k: 7, conc: true });

  // ── Rooms (shell + door) ────────────────────────────────────
  const rooms = ROOMS.map((r) => {
    const frame = roomFrame(r);
    const y0 = ringFloorY(r.zc);
    const rg = new THREE.Group();
    rg.matrix.copy(frame);
    rg.matrixAutoUpdate = false;
    group.add(rg);
    const m = new Merger().push(frame);
    const lounge = r.id === "lounge";
    const L = (k) => (lounge && mats[k + "L"] ? k + "L" : k);
    const D = ROOM_DEPTH;
    const W = ROOM_HALF;
    const H = ROOM_H;
    m.span(L("floor"), -0.35, -0.15, -W - 0.15, D + 0.15, 0, W + 0.15);
    m.span(L("white"), -0.15, H, -W - 0.15, D + 0.15, H + 0.12, W + 0.15);
    // front wall with door opening
    m.span(L("wall"), -0.1, 0, -W, 0, H, -1.0);
    m.span(L("wall"), -0.1, 0, 1.0, 0, H, W);
    m.span(L("wall"), -0.1, 2.25, -1.0, 0, H, 1.0);
    for (const e of [-1, 1]) m.span(L("trim"), 0, 0, e * 1.0 - 0.06, 0.05, 2.31, e * 1.0 + 0.06);
    m.span(L("trim"), 0, 2.25, -1.06, 0.05, 2.31, 1.06);
    m.span(L("dark"), -0.33, -0.005, -1.0, 0.1, 0.012, 1.0);
    // side walls
    m.span(L("wall"), -0.1, 0, -W - 0.12, D, H, -W);
    m.span(L("wall"), -0.1, 0, W, D, H, W + 0.12);
    // back (exterior) wall: the lounge gets floor-to-ceiling windows
    if (!lounge) m.span("wall", D, 0, -W - 0.12, D + 0.12, H, W + 0.12);
    // kick plates, cove lights, ceiling light panels
    for (const e of [-1, 1]) {
      m.span(L("dark"), 0.05, 0, e * (W - 0.02) - 0.01, D, 0.14, e * W);
      m.span(L("dark"), 0.05, H - 0.3, e * W - e * 0.35, D, H, e * W);
      m.span("strip", 0.05, H - 0.32, e * (W - 0.36), D, H - 0.3, e * (W - 0.34));
    }
    if (!lounge) m.span("dark", D - 0.02, 0, -W, D, 0.14, W);
    for (const uu of [2.6, 5.8, 9.0]) m.span(lounge ? "lightWarm" : "lightPanel", uu - 0.9, H - 0.015, -1.6, uu + 0.9, H, 1.6);
    const room = { ...r, frame, y0, group: rg, merger: m, lounge, L };
    // Door
    const door = new Door(room, mats, ctx.audio);
    door.group.matrixAutoUpdate = true;
    rg.add(door.group);
    door.onSound = (open) => sfx.door(open);
    room.door = door;
    // Door control panels on both sides (poke or trigger)
    for (const [uu, face] of [
      [-0.5, 1],
      [0.16, -1],
    ]) {
      const p = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.16), mats.dark);
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16).rotateZ(Math.PI / 2), mats.ledGreen);
      btn.position.x = face * -0.025;
      p.add(base, btn);
      // uu < 0: on the concourse wall; the concourse wall sits 0.25 m in front of the room wall.
      p.position.set(uu < 0 ? -0.25 - 0.02 : 0.02, 1.25, -1.35);
      rg.add(p);
      const it = {
        object: p,
        label: `${r.name} door`,
        onSelect: () => door.toggle(),
        poke: true,
        pokeRadius: 0.07,
        onPoke: () => door.toggle(),
      };
      interactables.push(it);
      room.doorButtons = [...(room.doorButtons ?? []), btn];
    }
    // Room sign over the door (concourse side) and inside
    const s1 = sign([r.name.toUpperCase(), r.sub], { w: 1.7, size: 62 });
    s1.position.set(-0.27, 2.75, 0);
    s1.rotation.y = -Math.PI / 2;
    rg.add(s1);
    anchors.push({ p: new THREE.Vector3(5.8, 2.9, 0).applyMatrix4(frame), color: lounge ? 0xffe2c0 : 0xf2f6ff, k: lounge ? 6 : 9, room });
    return room;
  });

  // ── Walkable floor ──────────────────────────────────────────
  const toLocal = (room, x, z) => ({ u: room.side * x - ROOM_X0, w: room.side * (z - room.zc) });
  function groundAt(x, z) {
    const ax = Math.abs(x);
    if (ax <= CONC_HALF - BODY && Math.abs(z) <= WALK_Z) return ringFloorY(z);
    for (const room of rooms) {
      if (Math.sign(x) !== room.side) continue;
      const { u, w } = toLocal(room, x, z);
      if (Math.abs(w) > ROOM_HALF) continue;
      if (u >= BODY && u <= ROOM_DEPTH - BODY && Math.abs(w) <= ROOM_HALF - BODY) return room.y0;
      // Doorway (between the concourse and the room)
      if (Math.abs(w) <= 1.0 - 0.28 && u > -(ROOM_X0 - (CONC_HALF - BODY)) - 0.01 && u < BODY + 0.01) return room.door.passable ? (ax < CONC_HALF ? ringFloorY(z) : room.y0) : null;
    }
    return null;
  }

  return {
    group,
    rooms,
    colliders,
    interactables,
    anchors,
    groundAt,
    updaters,
    toLocal,
    update(dt, head) {
      for (const room of rooms) {
        const { u, w } = toLocal(room, head.x, head.z);
        room.door.update(dt, Math.abs(u) < 2.4 && Math.abs(w) < 2.2 && Math.sign(head.x) === room.side);
      }
      for (const f of updaters) f(dt);
    },
  };
}

/** Helpers for furnishing a room in its local frame. */
export function roomKit(room, ring) {
  const { frame } = room;
  return {
    world(u, w) {
      const p = new THREE.Vector3(u, 0, w).applyMatrix4(frame);
      return { x: p.x, z: p.z };
    },
    collide(u, w, r) {
      const p = this.world(u, w);
      ring.colliders.push({ x: p.x, z: p.z, r });
    },
    /** Colliders covering a box footprint (u0..u1, w0..w1). */
    block(u0, w0, u1, w1) {
      const du = u1 - u0;
      const dw = w1 - w0;
      const long = Math.abs(du) >= Math.abs(dw);
      const r = Math.min(Math.abs(du), Math.abs(dw)) / 2 + 0.05;
      const len = Math.max(Math.abs(du), Math.abs(dw));
      const n = Math.max(1, Math.ceil(len / r));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        this.collide(long ? u0 + du * t : (u0 + u1) / 2, long ? (w0 + w1) / 2 : w0 + dw * t, r);
      }
    },
    add(obj, u = 0, y = 0, w = 0, ry = 0) {
      obj.position.set(u, y, w);
      obj.rotation.y = ry;
      room.group.add(obj);
      return obj;
    },
    interact(it) {
      ring.interactables.push(it);
      return it;
    },
    anim(f) {
      ring.updaters.push(f);
    },
    pick,
  };
}
