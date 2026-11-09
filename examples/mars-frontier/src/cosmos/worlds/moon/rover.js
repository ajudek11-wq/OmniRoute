import * as THREE from "three";
import { Panel, grid } from "../../../xr/panel.js";
import { Batch, hw, plain } from "./kit.js";
import { moonify } from "./shade.js";
import { LUNAR_G } from "./samples.js";
import { createPrints } from "./props.js";

/**
 * LTV-2 (fiction): an unpressurised lunar terrain vehicle you can board and drive.
 *   Board: trigger on the rover. Drive: left stick y = throttle, right stick x = steer
 *   (desktop: W/S throttle, A/D steer). Exit: B/Y on the right controller, the dashboard "Exit"
 *   button, or F on the keyboard.
 * Kinematic four-wheel-steer model, per-wheel suspension following the terrain, spinning wheels,
 * a live speed/heading screen, tyre tracks, and dust thrown on clean ballistic arcs (no air: no
 * drag, no billowing; grains simply fall back at 1.62 m/s²).
 */

const WB = 2.3; // wheelbase
const TRACK = 1.9;
const WR = 0.42; // wheel radius
const RIDE = 0.78; // chassis height above the ground plane through the wheel contacts
const VMAX = 4.2;
const SEAT = new THREE.Vector3(-0.45, 1.02, 0.25); // driver seat cushion (local)

function trackTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(70,68,64,0.55)";
  g.fillRect(4, 0, 56, 64);
  g.fillStyle = "rgba(190,186,176,0.45)";
  for (let y = 0; y < 64; y += 16) {
    g.beginPath();
    g.moveTo(6, y + 10);
    g.lineTo(32, y + 2);
    g.lineTo(58, y + 10);
    g.lineTo(58, y + 14);
    g.lineTo(32, y + 6);
    g.lineTo(6, y + 14);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export async function createRover(api) {
  const { scene, ctx, groundAt, discover, SCI, shadows } = api;
  const { xr } = ctx;
  const tier = ctx.tier;
  const root = new THREE.Group();
  root.name = "ltv2";
  scene.add(root);

  const M = {
    frame: hw({ kind: "brushed", color: 0xb9bdc3, roughness: 0.35, metalness: 0.85 }),
    dark: hw({ kind: "brushed", color: 0x2d3034, roughness: 0.55, metalness: 0.6 }),
    white: hw({ kind: "panel", color: 0xe7e3da, roughness: 0.55 }),
    orange: hw({ kind: "panel", color: 0xdf6d1d, roughness: 0.55 }),
    gold: hw({ kind: "foil", color: 0xcda04a, roughness: 0.3, metalness: 0.9 }),
    seat: hw({ kind: "composite", color: 0x4f5f73, roughness: 0.9 }),
    tyre: hw({ kind: "rubber", color: 0x3a3b3d, roughness: 0.75, metalness: 0.35 }),
    mesh: hw({ kind: "brushed", color: 0x8d9197, roughness: 0.5, metalness: 0.8 }),
  };

  // ── Body (one batch) ──
  const body = new THREE.Group();
  root.add(body);
  const B = new Batch();
  B.add(M.frame, new THREE.BoxGeometry(1.5, 0.1, 3.0), { p: [0, RIDE, 0] });
  B.add(M.dark, new THREE.BoxGeometry(1.42, 0.03, 2.9), { p: [0, RIDE + 0.065, 0] });
  for (const x of [-0.72, 0.72]) B.add(M.frame, new THREE.BoxGeometry(0.08, 0.14, 3.1), { p: [x, RIDE - 0.02, 0] });
  // Battery / electronics box under the deck with gold foil.
  B.add(M.gold, new THREE.BoxGeometry(1.1, 0.32, 1.4), { p: [0, RIDE - 0.22, 0.1] });
  // Seats (two, side by side).
  for (const x of [-0.45, 0.45]) {
    B.add(M.seat, new THREE.BoxGeometry(0.55, 0.1, 0.55), { p: [x, SEAT.y - 0.05, SEAT.z] });
    B.add(M.seat, new THREE.BoxGeometry(0.55, 0.65, 0.1), { p: [x, SEAT.y + 0.3, SEAT.z + 0.32], r: [-0.18, 0, 0] });
    B.add(M.frame, new THREE.BoxGeometry(0.05, 0.25, 0.5), { p: [x - 0.3, SEAT.y + 0.05, SEAT.z] });
    B.add(M.frame, new THREE.BoxGeometry(0.05, 0.25, 0.5), { p: [x + 0.3, SEAT.y + 0.05, SEAT.z] });
    B.add(M.frame, new THREE.BoxGeometry(0.4, 0.18, 0.3), { p: [x, RIDE + 0.17, SEAT.z] });
  }
  // Roll hoop and handhold.
  B.add(M.frame, new THREE.TorusGeometry(0.75, 0.03, 6, 20, Math.PI), { p: [0, SEAT.y + 0.45, SEAT.z + 0.55] });
  // Dashboard console in front of the driver, hand controller between the seats.
  B.add(M.white, new THREE.BoxGeometry(1.4, 0.36, 0.12), { p: [0, RIDE + 0.62, -0.62], r: [0.35, 0, 0] });
  B.add(M.dark, new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), { p: [-0.25, RIDE + 0.32, -0.6], r: [0.3, 0, 0] });
  B.add(M.dark, new THREE.BoxGeometry(0.12, 0.12, 0.16), { p: [0, RIDE + 0.25, -0.05] });
  B.add(M.dark, new THREE.CylinderGeometry(0.018, 0.022, 0.2, 8), { p: [0, RIDE + 0.4, -0.05] });
  // Fenders (half-tubes over each wheel).
  for (const [x, z] of [
    [-TRACK / 2, -WB / 2],
    [TRACK / 2, -WB / 2],
    [-TRACK / 2, WB / 2],
    [TRACK / 2, WB / 2],
  ]) {
    B.add(M.orange, new THREE.CylinderGeometry(WR + 0.1, WR + 0.1, 0.3, 18, 1, true, -Math.PI / 2, Math.PI), { p: [x, RIDE - 0.1, z], r: [0, 0, Math.PI / 2] });
    B.add(M.frame, new THREE.BoxGeometry(Math.abs(x) - 0.7, 0.06, 0.08), { p: [Math.sign(x) * (0.7 + (Math.abs(x) - 0.7) / 2), RIDE - 0.08, z] });
  }
  // Rear cargo pallet with tool rack and sample bags.
  B.add(M.frame, new THREE.BoxGeometry(1.3, 0.05, 0.7), { p: [0, RIDE + 0.25, 1.25] });
  B.add(M.white, new THREE.BoxGeometry(0.6, 0.4, 0.5), { p: [-0.3, RIDE + 0.48, 1.25] });
  B.add(M.orange, new THREE.BoxGeometry(0.45, 0.3, 0.45), { p: [0.35, RIDE + 0.43, 1.25] });
  for (let k = 0; k < 3; k++) B.add(M.frame, new THREE.CylinderGeometry(0.012, 0.012, 1.1, 5), { p: [0.6, RIDE + 0.75, 1.0 + k * 0.12], r: [0.25, 0, 0] });
  // High-gain antenna mast with an umbrella dish, and a camera mast.
  B.add(M.frame, new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), { p: [0.55, RIDE + 0.75, -1.1] });
  B.add(M.mesh, new THREE.ConeGeometry(0.45, 0.16, 18, 1, true), { p: [0.55, RIDE + 1.45, -1.1], r: [0.6, 0.3, 0] });
  B.add(M.frame, new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6), { p: [-0.6, RIDE + 0.6, -1.25] });
  B.add(M.dark, new THREE.BoxGeometry(0.22, 0.12, 0.14), { p: [-0.6, RIDE + 1.18, -1.25] });
  B.add(M.white, new THREE.BoxGeometry(1.3, 0.08, 0.25), { p: [0, RIDE + 0.08, -1.45] });
  B.build(body);
  // "LTV-2" label.
  {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "#1d1f22";
    g.font = "700 46px system-ui, sans-serif";
    g.fillText("LTV-2", 60, 48);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), moonify(new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6 }), { key: "label" }));
    lab.position.set(0, RIDE + 0.08, -1.58);
    lab.rotation.y = Math.PI;
    body.add(lab);
  }
  body.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  // ── Wheels: steering pivot → spin group with a chevron-treaded wire-mesh tyre ──
  const wheelGeo = (() => {
    const b = new Batch();
    b.add(M.tyre, new THREE.CylinderGeometry(WR, WR, 0.24, 28, 1, true).rotateZ(Math.PI / 2), {});
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      for (const s of [-1, 1])
        b.add(M.dark, new THREE.BoxGeometry(0.11, 0.025, 0.05), { p: [s * 0.055, Math.cos(a) * (WR + 0.01), Math.sin(a) * (WR + 0.01)], r: [-a, s * 0.5, 0] });
    }
    b.add(M.frame, new THREE.CylinderGeometry(0.16, 0.16, 0.26, 14).rotateZ(Math.PI / 2), {});
    for (let k = 0; k < 6; k++) b.add(M.frame, new THREE.BoxGeometry(0.03, WR * 1.9, 0.03), { r: [(k / 6) * Math.PI, 0, 0], p: [0.1, 0, 0] });
    const holder = new THREE.Group();
    b.build(holder);
    return holder;
  })();
  const wheelLocal = [
    [-TRACK / 2, -WB / 2, 1],
    [TRACK / 2, -WB / 2, 1],
    [-TRACK / 2, WB / 2, -1],
    [TRACK / 2, WB / 2, -1],
  ];
  const wheels = wheelLocal.map(([x, z, steer]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, WR, z);
    const spin = wheelGeo.clone();
    spin.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    pivot.add(spin);
    root.add(pivot);
    // Suspension arm from the frame to the hub.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.55), M.frame);
    root.add(arm);
    return { pivot, spin, arm, x, z, steer, travel: 0, ground: 0 };
  });

  // ── Dashboard screen with the Exit button ──
  const screen = new Panel({ width: 0.42, height: 0.26, ppm: 1100, glow: "#8fe3ff", opacity: 0.95 });
  screen.mesh.position.set(-0.3, RIDE + 0.72, -0.53);
  screen.mesh.rotation.x = -0.35;
  body.add(screen.mesh);
  const drawScreen = (st) =>
    screen.setContent({
      eyebrow: "LTV-2 · concept vehicle",
      title: `${(Math.abs(st.v) * 3.6).toFixed(1)} km/h`,
      titleSize: 64,
      lines: [`Heading ${st.hdg.toFixed(0).padStart(3, "0")}°  ·  ${st.dist.toFixed(0)} m to base`, `Pitch ${st.pitch.toFixed(0)}°  Roll ${st.roll.toFixed(0)}°  ·  Battery ${st.batt.toFixed(0)}%`],
      lineSize: 26,
      buttons: grid(screen, [{ id: "exit", label: "Exit" }], { top: 0.72, cols: 1, rowH: 0.2, side: 0.33 }),
    });

  // ── State ──
  const st = { x: 12, z: 22, yaw: 0.35, v: 0, steer: 0, y: 0, pitch: 0, roll: 0, batt: 94, hdg: 0, dist: 0 };
  const sm = { y: null, pitch: 0, roll: 0, vy: 0, vp: 0, vr: 0 };
  let seated = false;
  let refLocal = { x: 0, z: 0 };
  let prevYaw = st.yaw;
  let screenT = 0;

  // Dust: a pool of grains on ballistic arcs.
  const NP = { low: 260, balanced: 600, high: 1000 }[tier] ?? 600;
  const dPos = new Float32Array(NP * 3);
  const dVel = new Float32Array(NP * 3);
  const dLife = new Float32Array(NP);
  const dFloor = new Float32Array(NP);
  for (let i = 0; i < NP; i++) dPos[i * 3 + 1] = -1e5;
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
  const dustUni = { uC: { value: new THREE.Color(0x8d877d) }, uPx: { value: 1 } };
  const dust = new THREE.Points(
    dGeo,
    new THREE.ShaderMaterial({
      uniforms: dustUni,
      transparent: true,
      depthWrite: false,
      vertexShader: `uniform float uPx; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx * clamp(0.05 * 700.0 / -mv.z, 1.0, 5.0); }`,
      fragmentShader: `uniform vec3 uC; void main(){ vec2 q = gl_PointCoord - 0.5; if (dot(q,q) > 0.25) discard; gl_FragColor = vec4(uC, 0.9); }`,
    })
  );
  dust.frustumCulled = false;
  scene.add(dust);
  let dNext = 0;
  let emitAcc = 0;

  const tracks = createPrints(trackTexture(), { low: 600, balanced: 1400, high: 2400 }[tier] ?? 1400, { w: 0.26, l: 0.36 });
  scene.add(tracks.mesh);
  let lastTrack = null;

  // Motor whine carried through the structure (only audible while seated).
  let motor = null;
  const ensureMotor = () => {
    const a = ctx.audio;
    if (motor || !a?.ctx || !a.enabled) return;
    const ac = a.ctx;
    const o = ac.createOscillator();
    o.type = "sawtooth";
    const o2 = ac.createOscillator();
    o2.type = "triangle";
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    const gn = ac.createGain();
    gn.gain.value = 0;
    o.connect(lp);
    o2.connect(lp);
    lp.connect(gn).connect(a.master);
    o.start();
    o2.start();
    motor = { o, o2, gn, lp };
  };

  // ── Interactables ──
  const pick = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 3.3), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(0, RIDE + 0.3, 0);
  root.add(pick);
  const fwd = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function board() {
    if (seated) return;
    seated = true;
    discover(SCI.rover);
    root.updateMatrixWorld(true);
    const seat = root.localToWorld(SEAT.clone());
    const heading = st.yaw;
    xr.place(seat.x, seat.z, heading, seat.y - 0.45);
    xr.yaw = heading;
    refLocal = xr.presenting ? { x: xr.camera.position.x, z: xr.camera.position.z } : { x: 0, z: 0 };
    prevYaw = st.yaw;
    ctx.toast("LTV-2", xr.presenting ? "Left stick: throttle · right stick: steer · B: exit" : "W/S throttle · A/D steer · F or Exit to get out", { seconds: 5 });
    drawScreen(st);
  }
  function exit() {
    if (!seated) return;
    seated = false;
    st.v = 0;
    const side = new THREE.Vector3(-Math.cos(st.yaw), 0, Math.sin(st.yaw)); // rover's left
    let x = st.x + side.x * 1.9;
    let z = st.z + side.z * 1.9;
    if (groundAt(x, z) === null) {
      x = st.x - side.x * 1.9;
      z = st.z - side.z * 1.9;
    }
    xr.place(x, z, xr.yaw, null);
    if (motor) motor.gn.gain.setTargetAtTime(0, ctx.audio.ctx.currentTime, 0.1);
  }

  const interactables = [
    { object: pick, label: "Board LTV-2", enabled: () => !seated, onSelect: board },
    { object: screen.mesh, panel: screen, enabled: () => seated, onButton: (b) => b.id === "exit" && exit() },
  ];

  const colliders = () => (seated ? [] : [{ x: st.x, z: st.z, r: 1.35 }, { x: st.x - Math.sin(st.yaw) * 0.9, z: st.z - Math.cos(st.yaw) * 0.9, r: 1.0 }, { x: st.x + Math.sin(st.yaw) * 0.9, z: st.z + Math.cos(st.yaw) * 0.9, r: 1.0 }]);

  function blocked(x, z) {
    if (groundAt(x, z) === null) return true;
    if (Math.hypot(x, z) > 1480) return true;
    for (const c of api.colliders()) {
      if (Math.hypot(x - c.x, z - c.z) < c.r + 1.25) return true;
    }
    return false;
  }

  function pose(dt) {
    // Wheel contact heights → chassis plane (with spring-damper smoothing = suspension).
    const c = Math.cos(st.yaw);
    const s = Math.sin(st.yaw);
    for (const w of wheels) {
      const wx = st.x + w.x * c + w.z * s;
      const wz = st.z - w.x * s + w.z * c;
      w.ground = groundAt(wx, wz) ?? st.y;
    }
    const front = (wheels[0].ground + wheels[1].ground) / 2;
    const rear = (wheels[2].ground + wheels[3].ground) / 2;
    const left = (wheels[0].ground + wheels[2].ground) / 2;
    const right = (wheels[1].ground + wheels[3].ground) / 2;
    const ty = (front + rear) / 2;
    const tp = Math.atan2(front - rear, WB); // nose up positive
    const tr = Math.atan2(right - left, TRACK); // right side up positive
    if (sm.y === null) {
      sm.y = ty;
      sm.pitch = tp;
      sm.roll = tr;
    }
    const k = 60;
    const d = 2 * Math.sqrt(k) * 0.55;
    const h = Math.min(dt, 0.05);
    sm.vy += ((ty - sm.y) * k - sm.vy * d) * h;
    sm.y += sm.vy * h;
    sm.vp += ((tp - sm.pitch) * k - sm.vp * d) * h;
    sm.pitch += sm.vp * h;
    sm.vr += ((tr - sm.roll) * k - sm.vr * d) * h;
    sm.roll += sm.vr * h;
    if (Math.abs(sm.y - ty) > 0.6) sm.y = ty + Math.sign(sm.y - ty) * 0.6;
    root.position.set(st.x, sm.y, st.z);
    root.rotation.set(sm.pitch, st.yaw, sm.roll, "YXZ");
    root.updateMatrixWorld(true);
    // Each wheel follows its own contact: suspension travel in the chassis frame.
    for (const w of wheels) {
      tmp.set(w.x, WR, w.z);
      root.localToWorld(tmp);
      const want = w.ground + WR - tmp.y;
      w.travel = THREE.MathUtils.clamp(want, -0.22, 0.22);
      w.pivot.position.y = WR + w.travel;
      w.pivot.rotation.y = st.steer * w.steer;
      w.arm.position.set(w.x * 0.62, (WR + w.travel + RIDE - 0.05) / 2 + 0.1, w.z);
      w.arm.rotation.set(0, Math.PI / 2, Math.atan2(RIDE - 0.05 - (WR + w.travel), Math.abs(w.x) * 0.6) * -Math.sign(w.x));
    }
    st.pitch = (sm.pitch * 180) / Math.PI;
    st.roll = (sm.roll * 180) / Math.PI;
  }
  pose(0.016);
  sm.y = null;
  pose(0.016);

  const dustLit = () => {
    const S = shadows.shadowHeight(st.x, st.z);
    return sm.y > S - 0.4;
  };

  return {
    root,
    interactables,
    colliders,
    get seated() {
      return seated;
    },
    state: st,
    board,
    exit,
    inside: () => false,
    update(dt, t, head) {
      let moved = false;
      let throttle = 0;
      let steerIn = 0;
      if (seated) {
        const L = xr.hands.left?.pad;
        const R = xr.hands.right?.pad;
        throttle = (L?.stick.y ?? 0) + (xr.keys?.has("KeyW") || xr.keys?.has("ArrowUp") ? 1 : 0) - (xr.keys?.has("KeyS") || xr.keys?.has("ArrowDown") ? 1 : 0);
        steerIn = (R?.stick.x ?? 0) + (xr.keys?.has("KeyD") ? 1 : 0) - (xr.keys?.has("KeyA") ? 1 : 0);
        if (R?.bPressed || xr.keys?.has("KeyF")) {
          exit();
          return true;
        }
      }
      throttle = THREE.MathUtils.clamp(throttle, -1, 1);
      steerIn = THREE.MathUtils.clamp(steerIn, -1, 1);
      // Longitudinal dynamics.
      const target = throttle >= 0 ? throttle * VMAX : throttle * 1.6;
      const acc = Math.sign(target - st.v) * (Math.abs(throttle) > 0.05 ? (Math.sign(target) !== Math.sign(st.v) && Math.abs(st.v) > 0.1 ? 2.2 : 1.1) : 0.5);
      const dv = target - st.v;
      st.v += Math.sign(dv) * Math.min(Math.abs(dv), Math.abs(acc) * dt);
      // Uphill slows it down a little.
      st.v -= Math.sin(sm.pitch) * LUNAR_G * 0.25 * dt * Math.sign(st.v || 1) * (st.v ? 1 : 0);
      const steerMax = 0.42 / (1 + Math.abs(st.v) * 0.12);
      st.steer += (-steerIn * steerMax - st.steer) * Math.min(1, dt * 4);
      if (Math.abs(st.v) > 0.001) {
        st.yaw += ((st.v * Math.tan(st.steer) * 2) / WB) * dt;
        fwd.set(-Math.sin(st.yaw), 0, -Math.cos(st.yaw));
        const nx = st.x + fwd.x * st.v * dt;
        const nz = st.z + fwd.z * st.v * dt;
        if (blocked(nx, nz)) {
          if (Math.abs(st.v) > 1) ctx.audio?.bump?.();
          st.v = 0;
        } else {
          st.x = nx;
          st.z = nz;
        }
        moved = true;
        st.batt = Math.max(5, st.batt - Math.abs(st.v) * dt * 0.004);
      }
      pose(dt);
      const spin = (st.v / WR) * dt;
      for (const w of wheels) w.spin.rotation.x -= spin;

      // Rider follows the rover (yaw only, to keep the horizon steady).
      if (seated) {
        xr.yaw += st.yaw - prevYaw;
        xr.rig.rotation.y = xr.yaw;
        const seat = root.localToWorld(tmp.copy(SEAT));
        const c = Math.cos(xr.yaw);
        const s = Math.sin(xr.yaw);
        xr.rig.position.set(seat.x - (refLocal.x * c + refLocal.z * s), seat.y - 0.45, seat.z - (-refLocal.x * s + refLocal.z * c));
      }
      prevYaw = st.yaw;

      // Dust: grains flung from the treads fly on ballistic arcs and fall back (no drag).
      const speed = Math.abs(st.v);
      const lit = dustLit();
      dustUni.uC.value.setRGB(lit ? 0.55 : 0.03, lit ? 0.53 : 0.03, lit ? 0.5 : 0.03);
      if (speed > 0.4) {
        emitAcc += dt * speed * ({ low: 25, balanced: 55, high: 90 }[tier] ?? 55);
        const c = Math.cos(st.yaw);
        const s = Math.sin(st.yaw);
        while (emitAcc >= 1) {
          emitAcc -= 1;
          const w = wheels[(Math.random() * 4) | 0];
          const dir = Math.sign(st.v);
          const lx = w.x + (Math.random() - 0.5) * 0.2;
          const lz = w.z + dir * WR * 0.7;
          const i = dNext;
          dNext = (dNext + 1) % NP;
          dPos[i * 3] = st.x + lx * c + lz * s;
          dPos[i * 3 + 1] = w.ground + 0.08;
          dPos[i * 3 + 2] = st.z - lx * s + lz * c;
          const f = speed * (0.15 + Math.random() * 0.7);
          const up = speed * (0.45 + Math.random() * 0.8);
          const side = (Math.random() - 0.5) * speed * 0.5;
          dVel[i * 3] = fwd.x * f * dir + c * side;
          dVel[i * 3 + 1] = up;
          dVel[i * 3 + 2] = fwd.z * f * dir - s * side;
          dLife[i] = 4;
          dFloor[i] = w.ground;
        }
      }
      let any = false;
      for (let i = 0; i < NP; i++) {
        if (dLife[i] <= 0) continue;
        any = true;
        dLife[i] -= dt;
        dVel[i * 3 + 1] -= LUNAR_G * dt;
        dPos[i * 3] += dVel[i * 3] * dt;
        dPos[i * 3 + 1] += dVel[i * 3 + 1] * dt;
        dPos[i * 3 + 2] += dVel[i * 3 + 2] * dt;
        if (dPos[i * 3 + 1] < dFloor[i] - 0.05 || dLife[i] <= 0) {
          dLife[i] = 0;
          dPos[i * 3 + 1] = -1e5;
        }
      }
      if (any || speed > 0.4) dGeo.attributes.position.needsUpdate = true;
      dustUni.uPx.value = ctx.renderer.getPixelRatio();

      // Tyre tracks behind the rear wheels.
      if (speed > 0.2) {
        const p = { x: st.x, z: st.z };
        if (!lastTrack || Math.hypot(p.x - lastTrack.x, p.z - lastTrack.z) > 0.34) {
          lastTrack = p;
          const c = Math.cos(st.yaw);
          const s = Math.sin(st.yaw);
          for (const w of [wheels[2], wheels[3]]) {
            const wx = st.x + w.x * c + w.z * s;
            const wz = st.z - w.x * s + w.z * c;
            tracks.add(wx, w.ground + 0.014, wz, st.yaw, undefined, 1);
          }
        }
      }

      // Dashboard and motor sound.
      screenT -= dt;
      if (seated && screenT <= 0) {
        screenT = 0.25;
        st.hdg = (((-st.yaw * 180) / Math.PI) % 360 + 360) % 360;
        st.dist = Math.hypot(st.x - 0, st.z - 0);
        drawScreen(st);
      }
      ensureMotor();
      if (motor) {
        const ac = ctx.audio.ctx;
        const on = seated && ctx.audio.enabled;
        motor.o.frequency.setTargetAtTime(70 + speed * 55, ac.currentTime, 0.1);
        motor.o2.frequency.setTargetAtTime(140 + speed * 110, ac.currentTime, 0.1);
        motor.gn.gain.setTargetAtTime(on ? 0.006 + speed * 0.004 : 0, ac.currentTime, 0.2);
      }
      return moved || seated;
    },
    dispose() {
      if (motor) {
        try {
          motor.o.stop();
          motor.o2.stop();
          motor.gn.disconnect();
        } catch {
          /* stopped */
        }
      }
      screen.dispose?.();
    },
  };
}
