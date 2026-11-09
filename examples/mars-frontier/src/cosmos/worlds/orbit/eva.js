import * as THREE from "three";
import { Panel, grid } from "../../../xr/panel.js";
import { Merger, mat4, sign, pick } from "./kit.js";
import { flip } from "./exterior.js";

/**
 * The hub airlock and the EVA gantry, on the non-rotating spine (hub frame H; in hub mode the world
 * is H shifted up by `shift`, so the gantry deck is at y = 0). Zero g: movement is locked and you
 * pull yourself between handholds by selecting them. Outside there is no sound except your suit.
 */
const DECK = -9; // deck top in H
const AL = { x0: 26, x1: 33.6, r: 1.9, cy: DECK + 1.3 };

export function buildEva(ctx, mats, sfx, env, shift) {
  const group = new THREE.Group();
  group.name = "eva";
  const m = new Merger();
  const ax = (g) => g.rotateZ(Math.PI / 2);
  // ── Airlock (interior) ──
  m.addM("white", flip(ax(new THREE.CylinderGeometry(AL.r, AL.r, AL.x1 - AL.x0, 32, 1, true))), mat4((AL.x0 + AL.x1) / 2, AL.cy, 0));
  m.addM("mli", ax(new THREE.CylinderGeometry(AL.r + 0.15, AL.r + 0.15, AL.x1 - AL.x0, 32, 1, true)), mat4((AL.x0 + AL.x1) / 2, AL.cy, 0));
  m.addM("dark", new THREE.CircleGeometry(AL.r, 32).rotateY(Math.PI / 2), mat4(AL.x0 + 0.01, AL.cy, 0));
  m.addM("hull", new THREE.CircleGeometry(AL.r + 0.15, 32).rotateY(-Math.PI / 2), mat4(AL.x0 - 0.01, AL.cy, 0));
  m.addM("trim", new THREE.RingGeometry(0.85, AL.r + 0.15, 32).rotateY(-Math.PI / 2), mat4(AL.x1, AL.cy, 0));
  m.addM("hull", new THREE.RingGeometry(0.85, AL.r + 0.15, 32).rotateY(Math.PI / 2), mat4(AL.x1 + 0.02, AL.cy, 0));
  m.span("floor", AL.x0, DECK - 0.1, -1.3, AL.x1, DECK, 1.3);
  for (let x = AL.x0 + 0.8; x < AL.x1; x += 1.4) {
    m.addM("trim", ax(new THREE.TorusGeometry(AL.r - 0.02, 0.04, 6, 32)).rotateY(0), mat4(x, AL.cy, 0, 0, Math.PI / 2, 0));
    m.tube("rail", [x - 0.4, AL.cy + 0.9, -0.9], [x + 0.4, AL.cy + 0.9, -0.9], 0.025, 8);
    m.tube("rail", [x - 0.4, AL.cy + 0.9, 0.9], [x + 0.4, AL.cy + 0.9, 0.9], 0.025, 8);
  }
  m.span("lightPanel", AL.x0 + 0.5, AL.cy + AL.r - 0.25, -0.3, AL.x1 - 0.5, AL.cy + AL.r - 0.2, 0.3);
  m.span("stripAmber", AL.x1 - 0.06, AL.cy - 1.0, -0.95, AL.x1 - 0.04, AL.cy + 1.0, -0.9);
  // Struts to the spine
  for (const x of [AL.x0 + 1, AL.x1 - 1]) for (const z of [-1, 1]) m.tube("truss", [x, AL.cy + AL.r, z], [x, -3, z * 2.6], 0.12, 8);
  // ── Gantry deck ──
  const X0 = 34;
  const X1 = 46;
  const Z = 3;
  m.span("extDark", AL.x1, DECK - 0.15, -1.0, X0, DECK, 1.0);
  m.span("truss", X0, DECK - 0.18, -Z, X1, DECK - 0.1, Z);
  for (let x = X0 + 0.25; x < X1; x += 0.5) m.span("extDark", x - 0.03, DECK - 0.1, -Z, x + 0.03, DECK, Z);
  for (let z = -Z; z <= Z + 0.01; z += 1) m.span("truss", X0, DECK - 0.1, z - 0.03, X1, DECK - 0.02, z + 0.03);
  m.span("truss", X0, DECK - 0.1, -Z - 0.1, X1, DECK + 0.12, -Z);
  m.span("truss", X0, DECK - 0.1, Z, X1, DECK + 0.12, Z + 0.1);
  m.span("truss", X1, DECK - 0.1, -Z, X1 + 0.1, DECK + 0.12, Z);
  // Railings (posts, top and mid rails) — the gap at x = X0 is the hatch side
  const rail = (a, b) => {
    m.tube("yellowRail", [a[0], DECK + 1.05, a[1]], [b[0], DECK + 1.05, b[1]], 0.03, 8);
    m.tube("truss", [a[0], DECK + 0.55, a[1]], [b[0], DECK + 0.55, b[1]], 0.022, 6);
  };
  rail([X0 + 1.2, -Z], [X1, -Z]);
  rail([X0 + 1.2, Z], [X1, Z]);
  rail([X1, -Z], [X1, Z]);
  for (let x = X0 + 1.2; x <= X1 + 0.01; x += 1.8) for (const z of [-Z, Z]) m.tube("truss", [x, DECK, z], [x, DECK + 1.05, z], 0.03, 6);
  for (let z = -Z; z <= Z + 0.01; z += 1.5) m.tube("truss", [X1, DECK, z], [X1, DECK + 1.05, z], 0.03, 6);
  // Struts up to the spine and floodlight housings
  for (const x of [X0 + 0.5, X1 - 0.5]) for (const z of [-Z, Z]) m.tube("truss", [x, DECK + 0.12, z], [x, -3.0, z * 0.9], 0.1, 8);
  for (const z of [-Z, Z]) m.tube("truss", [X0 + 0.5, -4.5, z * 0.92], [X1 - 0.5, -4.5, z * 0.92], 0.08, 6);
  for (const z of [-Z + 0.3, Z - 0.3]) m.span("extDark", 40 - 0.3, -4.8, z - 0.2, 40 + 0.3, -4.4, z + 0.2);
  m.span("foil", 44.2, DECK, -2.6, 45.4, DECK + 0.55, -1.6);
  m.build({ ...mats, yellowRail: mats.yellow }, group, "eva");

  const flood = [];
  for (const z of [-Z + 0.3, Z - 0.3]) {
    const f = new THREE.Mesh(new THREE.CircleGeometry(0.18, 12).rotateX(Math.PI / 2), mats.ledWhite);
    f.position.set(40, -4.82, z);
    group.add(f);
    flood.push(f);
  }

  // ── Hatch ──
  const hatchPivot = new THREE.Group();
  hatchPivot.position.set(AL.x1 + 0.05, AL.cy + 0.85, 0);
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 0.1, 28).rotateZ(Math.PI / 2), mats.hull);
  hatch.position.y = -0.85;
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 6, 20).rotateY(Math.PI / 2), mats.trim);
  wheel.position.set(-0.07, -0.85, 0);
  hatchPivot.add(hatch, wheel);
  group.add(hatchPivot);

  // ── State ──
  const st = { pressurized: true, open: 0, cycling: false, outside: false };
  const panel = new Panel({ width: 0.62, height: 0.46, ppm: 1000, glow: "#ffd27f" });
  panel.mesh.position.set(AL.x1 - 0.5, AL.cy + 0.1, -1.45);
  panel.mesh.rotation.y = -0.35;
  group.add(panel.mesh);
  const draw = () =>
    panel.setContent({
      eyebrow: "Hub airlock · zero g",
      title: st.cycling ? "Cycling…" : st.pressurized ? "Pressurized" : "Vacuum · hatch open",
      titleSize: 50,
      lines: [st.pressurized ? "Suit sealed. Select a handhold to pull yourself along." : "Outside is silent: only your suit makes sound."],
      lineSize: 24,
      buttons: grid(
        panel,
        [
          { id: "cycle", label: st.pressurized ? "Depressurize · open hatch" : "Close hatch · repressurize", disabled: st.cycling },
          { id: "ring", label: "Lift back to the ring", disabled: st.cycling },
        ],
        { top: 0.6, cols: 1, rowH: 0.16, side: 0.06, gap: 0.03 }
      ),
    });
  draw();
  async function cycle() {
    if (st.cycling) return;
    st.cycling = true;
    draw();
    if (st.pressurized) {
      sfx.hiss(3.5);
      await wait(3.6);
      st.pressurized = false;
      sfx.setMode("suit");
    } else {
      st.open = Math.min(st.open, 1);
      st.wantOpen = false;
      await wait(1.6);
      sfx.setMode("airlock");
      sfx.hiss(2.5);
      await wait(2.4);
      st.pressurized = true;
    }
    st.wantOpen = !st.pressurized;
    st.cycling = false;
    draw();
  }
  async function back() {
    if (st.cycling) return;
    if (st.outside) {
      ctx.toast("Return to the airlock first", "Select the handholds back to the hatch.", { seconds: 3 });
      return;
    }
    if (!st.pressurized) await cycle();
    env.toRing();
  }
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const interactables = [{ object: panel.mesh, panel, onButton: (b) => (b.id === "cycle" ? cycle() : back()) }];

  // ── Handholds (teleport points) ──
  const holdGeo = new THREE.TorusGeometry(0.28, 0.025, 6, 28).rotateX(Math.PI / 2);
  const points = [
    [27.6, 0],
    [29.8, 0],
    [32.2, 0],
    [35.2, 0],
    [38, -1.6],
    [38, 1.6],
    [41, 0],
    [44, -1.8],
    [44, 1.8],
    [45.2, 0],
  ];
  const markers = points.map(([x, z]) => {
    const g = new THREE.Group();
    g.position.set(x, DECK + 0.02, z);
    const ring = new THREE.Mesh(holdGeo, mats.stripAmber);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8).rotateX(Math.PI / 2), mats.yellow);
    bar.position.set(0, 1.0, 0);
    const p = pick(0.9, 1.4, 0.9);
    p.position.y = 0.7;
    g.add(ring, bar, p);
    group.add(g);
    const outside = x > AL.x1;
    const it = {
      object: g,
      label: outside ? "Handhold (gantry)" : "Handhold (airlock)",
      enabled: () => !st.cycling,
      onSelect: () => {
        if (outside && (st.pressurized || st.open < 0.9)) {
          ctx.toast("Hatch closed", "Depressurize and open the hatch first.", { seconds: 3 });
          return;
        }
        ctx.xr.teleportTo(x, z);
        st.outside = outside;
        if (outside) env.discover("orbit-silence");
      },
    };
    interactables.push(it);
    return { g, ring, outside };
  });
  const s1 = sign(["EVA GANTRY", "Zero g · select handholds · Earth below"], { w: 1.3, size: 56, accent: "#ffd27f" });
  s1.position.set(AL.x1 - 0.08, AL.cy + 1.15, 0);
  s1.rotation.y = -Math.PI / 2;
  s1.scale.setScalar(0.6);
  group.add(s1);

  return {
    group,
    spawn: { x: 28.4, z: 0, yaw: -Math.PI / 2 },
    groundAt(x, z) {
      if (x > AL.x0 + 0.4 && x < AL.x1 - 0.2 && Math.abs(z) < 1.0) return 0;
      if (x >= AL.x1 - 0.2 && x <= 46 && Math.abs(z) < 2.8 && (x > 34 || Math.abs(z) < 0.8)) return 0;
      return null;
    },
    colliders: [],
    interactables,
    anchors: [
      { p: new THREE.Vector3(29.8, AL.cy + 1.2, 0), color: 0xf2f6ff, k: 4 },
      { p: new THREE.Vector3(40, -5.2, 0), color: 0xffffff, k: 10, on: () => (env.info?.sky.state.lit < 0.5 ? 1 : 0.15) },
    ],
    cycle,
    reset() {
      st.pressurized = true;
      st.wantOpen = false;
      st.open = 0;
      st.outside = false;
      st.cycling = false;
      draw();
    },
    update(dt, t, { eclipse }) {
      const tgt = st.wantOpen ? 1 : 0;
      st.open += Math.sign(tgt - st.open) * Math.min(Math.abs(tgt - st.open), dt * 0.6);
      hatchPivot.rotation.z = st.open * 1.9;
      for (const f of flood) f.visible = eclipse > 0.4;
      for (const mk of markers) mk.ring.material === mats.stripAmber && (mk.g.visible = !mk.outside || !st.pressurized);
      void shift;
    },
  };
}
