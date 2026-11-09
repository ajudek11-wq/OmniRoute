import * as THREE from "three";
import { Panel, grid } from "../../../xr/panel.js";
import { roomKit } from "./ring.js";
import { sign, screen, pick } from "./kit.js";
import { planetTex } from "../../common.js";

/**
 * Furnishing for every room except the lounge (lounge.js). Room-local frame: u runs from the door
 * (u = 0) to the back wall (u = 11.55); w runs along the ring (±7); y is up from the room floor.
 */
export function furnishRooms(ring, env) {
  const updaters = [];
  const by = Object.fromEntries(ring.rooms.map((r) => [r.id, r]));
  const k = (id) => roomKit(by[id], ring);
  const api = { update: (dt, t) => updaters.forEach((f) => f(dt, t)), machinery: () => 0 };
  const inspect = (kit, obj, title, text, sci, disc) =>
    kit.interact({
      object: obj,
      label: title,
      onSelect: () => {
        env.sfx.beep(3);
        env.ctx.toast(title, text, { tag: env.sci[sci], seconds: 7 });
        if (disc) env.discover(disc);
      },
    });
  const pickAt = (kit, w, h, d, u, y, ww) => kit.add(pick(w, h, d), u, y, ww);
  control(by.control, k("control"), env, updaters, inspect);
  lab(by.lab, k("lab"), env, inspect, pickAt);
  greenhouse(by.greenhouse, k("greenhouse"), env, inspect, pickAt);
  quarters(by.quarters, k("quarters"), env, inspect, pickAt);
  api.machinery = engineering(by.engineering, k("engineering"), env, updaters, inspect, pickAt);
  comms(by.comms, k("comms"), env, updaters, inspect, pickAt);
  lift(by.lift, k("lift"), env, inspect);
  return api;
}

// ── shared bits ───────────────────────────────────────────────
function desk(m, u0, w0, u1, w1, h = 0.76) {
  m.span("trim", u0, h - 0.05, w0, u1, h, w1);
  m.span("dark", u0 + 0.05, 0, w0 + 0.05, u1 - 0.05, h - 0.05, w0 + 0.12);
  m.span("dark", u0 + 0.05, 0, w1 - 0.12, u1 - 0.05, h - 0.05, w1 - 0.05);
  m.span("dark", u1 - 0.12, 0.1, w0 + 0.05, u1 - 0.05, h - 0.05, w1 - 0.05);
}
function chair(m, u, w, face = 1) {
  m.tube("trim", [u, 0, w], [u, 0.42, w], 0.035, 8);
  m.span("trim", u - 0.28, 0.02, w - 0.04, u + 0.28, 0.06, w + 0.04);
  m.span("trim", u - 0.04, 0.02, w - 0.28, u + 0.04, 0.06, w + 0.28);
  m.span("fabric", u - 0.25, 0.42, w - 0.25, u + 0.25, 0.5, w + 0.25);
  m.span("fabric", u - face * 0.27, 0.5, w - 0.24, u - face * 0.21, 1.0, w + 0.24);
}

// ── Control room ──────────────────────────────────────────────
function control(room, kit, env, updaters, inspect) {
  const m = room.merger;
  const { mats, info } = env;
  // Screen wall
  m.span("dark", 11.2, 0.6, -6.2, 11.55, 3.1, 6.2);
  const W = 2.5;
  const scr = [-3.6, 0, 3.6].map((w) => {
    const s = screen(3.4, 1.9, 150);
    s.mesh.position.set(11.18, 1.95, w);
    s.mesh.rotation.y = -Math.PI / 2;
    room.group.add(s.mesh);
    return s;
  });
  void W;
  // Console rows
  for (const [u, half] of [
    [8.2, 4.8],
    [5.0, 4.2],
  ]) {
    m.span("dark", u - 0.45, 0, -half, u + 0.45, 0.72, half);
    m.span("trim", u - 0.55, 0.72, -half - 0.05, u + 0.5, 0.77, half + 0.05);
    m.span("dark", u + 0.2, 0.77, -half, u + 0.45, 1.25, half);
    for (let w = -half + 0.9; w < half; w += 1.6) {
      m.span("screen", u + 0.18, 0.86, w - 0.6, u + 0.2, 1.22, w + 0.6);
      m.add("texDesk", new THREE.PlaneGeometry(1.12, 0.32), u + 0.175, 1.04, w, 0, -Math.PI / 2, 0);
      chair(m, u - 1.0, w, -1);
    }
    kit.block(u - 0.55, -half, u + 0.5, half);
  }
  m.span("accent", 10.2, 0, -6.5, 10.9, 0.05, 6.5);
  // Selector panel on the front console + physical poke buttons
  const panel = new Panel({ width: 0.9, height: 0.42, ppm: 1000, glow: "#8fd8ff" });
  panel.mesh.position.set(4.4, 1.12, 0);
  panel.mesh.rotation.set(0, -Math.PI / 2, 0);
  panel.mesh.rotateX(-0.55);
  room.group.add(panel.mesh);
  let mode = "power";
  const modes = [
    { id: "orbit", label: "Orbit track" },
    { id: "power", label: "Power" },
    { id: "docking", label: "Docking" },
    { id: "iss", label: "Heritage" },
  ];
  const drawPanel = () =>
    panel.setContent({
      eyebrow: "Flight director console",
      title: "Centre display",
      titleSize: 44,
      buttons: grid(panel, [...modes.map((x) => ({ ...x, on: x.id === mode })), { id: "warp", label: `Orbit time ×${info.warp === 1 ? 10 : 1}` }, { id: "sun", label: "Skip to sunset" }], { top: 0.36, cols: 3, rowH: 0.25, side: 0.04 }),
    });
  drawPanel();
  const press = (id) => {
    env.sfx.beep(modes.findIndex((x) => x.id === id) + 1);
    if (id === "warp") info.warp = info.warp === 1 ? 10 : 1;
    else if (id === "sun") {
      const st = info.sky.state;
      // advance to a few seconds before the next sunset
      const per = info.orbitSeconds;
      let guard = 0;
      while (st.lit < 0.5 && guard++ < 1600) info.sky.advance(per / 800);
      while (st.lit >= 0.5 && guard++ < 3200) info.sky.advance(per / 800);
      for (let i = 0; i < 12; i++) info.sky.advance(-per / 800);
    } else mode = id;
    if (id === "iss") env.discover("orbit-iss");
    if (id === "orbit") env.discover("orbit-sunrise16");
    drawPanel();
  };
  kit.interact({ object: panel.mesh, panel, onButton: (b) => press(b.id) });
  modes.forEach((x, i) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 16), i === 0 ? mats.ledGreen : mats.strip);
    kit.add(b, 4.68, 0.785, -1.4 + i * 0.22);
    kit.interact({ object: b, label: x.label, poke: true, pokeRadius: 0.05, onPoke: () => press(x.id), onSelect: () => press(x.id) });
  });
  const plaque = sign(["INTERNATIONAL SPACE STATION", "First module Nov 1998 · crewed since 2 Nov 2000"], { w: 1.4, size: 52, bg: "#1d2430", accent: "#7fe0a8" });
  kit.add(plaque, 2.5, 1.7, -6.86);
  inspect(kit, plaque, "The ISS", "Assembled in orbit since 1998 (Zarya, November 1998) and continuously crewed since Expedition 1 arrived on 2 November 2000.", "established", "orbit-iss");
  env.restSurfaces.push({ ...kit.world(5, 0), r: 0.1, y: room.y0 + 0.77 });

  // Displays
  const map = planetTex("earth_day", "balanced");
  const shade = new THREE.Vector3();
  const hist = [];
  let acc = 0;
  let soc = 0.82;
  updaters.push((dt, t) => {
    const st = info.sky.state;
    soc = Math.max(0.35, Math.min(1, soc + dt * info.warp * (st.lit > 0.5 ? 0.0007 : -0.0011)));
    acc += dt;
    if (acc < 0.3) return;
    acc = 0;
    hist.push({ lit: st.lit, soc });
    if (hist.length > 200) hist.shift();
    drawOrbit(scr[0], info, map, shade);
    const centre = scr[1];
    if (mode === "orbit") drawOrbit(centre, info, map, shade);
    else if (mode === "power") drawPower(centre, info, hist, soc);
    else if (mode === "docking") drawDocking(centre, info, t);
    else drawHeritage(centre);
    drawDocking(scr[2], info, t);
  });
}

function header(s, title, sub) {
  const { g, W, H } = s;
  g.fillStyle = "#06101a";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#8fd8ff";
  g.font = `700 ${H * 0.07}px system-ui, sans-serif`;
  g.fillText(title, W * 0.03, H * 0.09);
  g.fillStyle = "#ffd27f";
  g.font = `500 ${H * 0.045}px system-ui, sans-serif`;
  g.fillText(sub, W * 0.03, H * 0.15);
}

function drawOrbit(s, info, map, sunGeo) {
  const { g, W, H } = s;
  header(s, "GROUND TRACK", `Orbit compressed: 92 min shown in ${info.orbitSeconds / 60} min (simplified)`);
  const x0 = W * 0.03;
  const y0 = H * 0.2;
  const mw = W * 0.94;
  const mh = H * 0.74;
  if (map.image?.complete || map.image?.width) {
    try {
      g.drawImage(map.image, x0, y0, mw, mh);
    } catch {
      /* not decoded yet */
    }
  } else {
    g.fillStyle = "#123";
    g.fillRect(x0, y0, mw, mh);
  }
  // Night side shading from the Sun in the globe frame
  info.sky.sunGeo(sunGeo);
  const cols = 72;
  const rows = 36;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const lon = ((i + 0.5) / cols) * 2 * Math.PI - Math.PI;
      const lat = Math.PI / 2 - ((j + 0.5) / rows) * Math.PI;
      // inverse of geoLon: lon = atan2(z, -x)
      const n = [-Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
      const d = n[0] * sunGeo.x + n[1] * sunGeo.y + n[2] * sunGeo.z;
      if (d < 0.05) {
        g.fillStyle = `rgba(0,4,16,${Math.min(0.72, (0.05 - d) * 3)})`;
        g.fillRect(x0 + (i / cols) * mw, y0 + (j / rows) * mh, mw / cols + 1, mh / rows + 1);
      }
    }
  const P = (lat, lon) => [x0 + ((lon + 180) / 360) * mw, y0 + ((90 - lat) / 180) * mh];
  g.lineWidth = 3;
  g.strokeStyle = "rgba(255,210,127,0.9)";
  g.beginPath();
  let prev = null;
  for (let a = -Math.PI * 1.2; a <= Math.PI * 1.2; a += 0.04) {
    const p = info.sky.subPoint(a);
    const [x, y] = P(p.lat, p.lon);
    if (prev && Math.abs(prev[0] - x) < mw * 0.5) g.lineTo(x, y);
    else g.moveTo(x, y);
    prev = [x, y];
  }
  g.stroke();
  const st = info.sky.state;
  const [sx, sy] = P(st.latDeg, st.lonDeg ?? 0);
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(sx, sy, H * 0.02, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#e8edf2";
  g.font = `600 ${H * 0.045}px system-ui, sans-serif`;
  g.fillText(`${st.lit > 0.5 ? "DAY" : "NIGHT"} · lat ${st.latDeg.toFixed(1)}° · inclination 51.6° (ISS-like)`, x0 + 10, H * 0.97);
  s.tex.needsUpdate = true;
}

function drawPower(s, info, hist, soc) {
  const { g, W, H } = s;
  header(s, "STATION POWER", "Solar wings track the Sun · batteries carry the eclipse (fiction)");
  const st = info.sky.state;
  const out = st.lit * 4.2;
  g.fillStyle = "#e8edf2";
  g.font = `700 ${H * 0.11}px system-ui, sans-serif`;
  g.fillText(`${out.toFixed(2)} MW`, W * 0.05, H * 0.34);
  g.font = `500 ${H * 0.05}px system-ui, sans-serif`;
  g.fillText(st.lit > 0.5 ? "Arrays in sunlight" : "Eclipse: arrays dark, on batteries", W * 0.05, H * 0.42);
  g.fillText(`Battery charge ${(soc * 100).toFixed(0)} %`, W * 0.55, H * 0.34);
  g.strokeStyle = "#8fd8ff";
  g.strokeRect(W * 0.55, H * 0.38, W * 0.4, H * 0.05);
  g.fillStyle = soc > 0.5 ? "#7fe0a8" : "#ffb347";
  g.fillRect(W * 0.55, H * 0.38, W * 0.4 * soc, H * 0.05);
  const x0 = W * 0.05;
  const y0 = H * 0.5;
  const w = W * 0.9;
  const h = H * 0.42;
  g.strokeStyle = "rgba(143,216,255,0.3)";
  g.strokeRect(x0, y0, w, h);
  const line = (key, col, scale) => {
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.beginPath();
    hist.forEach((p, i) => {
      const x = x0 + (i / 199) * w;
      const y = y0 + h - p[key] * scale * h;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  };
  line("lit", "#ffd27f", 0.95);
  line("soc", "#7fe0a8", 0.95);
  g.fillStyle = "#ffd27f";
  g.fillText("array output", x0 + 10, y0 + h - 10);
  g.fillStyle = "#7fe0a8";
  g.fillText("battery", x0 + w * 0.3, y0 + h - 10);
  s.tex.needsUpdate = true;
}

function drawDocking(s, info, t) {
  const { g, W, H } = s;
  const sh = info.shuttle;
  header(s, "DOCKING TRAFFIC", "Axial port · crew shuttle (fiction) · approach time compressed");
  g.fillStyle = "#e8edf2";
  g.font = `700 ${H * 0.085}px system-ui, sans-serif`;
  g.fillText(sh.phase.toUpperCase(), W * 0.05, H * 0.32);
  g.font = `500 ${H * 0.055}px system-ui, sans-serif`;
  g.fillText(`Range ${sh.dist.toFixed(1)} m`, W * 0.05, H * 0.42);
  g.fillText(`Closing rate ${(sh.rate * 100).toFixed(1)} cm/s`, W * 0.05, H * 0.5);
  // approach corridor
  const cx = W * 0.1;
  const cy = H * 0.75;
  const len = W * 0.82;
  g.strokeStyle = "rgba(143,216,255,0.5)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + len, cy - H * 0.12);
  g.moveTo(cx, cy);
  g.lineTo(cx + len, cy + H * 0.12);
  g.stroke();
  g.fillStyle = "#8fd8ff";
  g.fillRect(cx - 12, cy - 20, 12, 40);
  const x = cx + (Math.min(sh.dist, 360) / 360) * len;
  g.fillStyle = (t * 2) % 1 < 0.5 ? "#ffffff" : "#ffd27f";
  g.beginPath();
  g.arc(x, cy, H * 0.025, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffd27f";
  g.font = `500 ${H * 0.045}px system-ui, sans-serif`;
  g.fillText("Station", cx - 10, cy + H * 0.12);
  g.fillText("360 m", cx + len - 60, cy + H * 0.18);
  s.tex.needsUpdate = true;
}

function drawHeritage(s) {
  const { g, W, H } = s;
  header(s, "HERITAGE", "Established history");
  g.fillStyle = "#e8edf2";
  g.font = `500 ${H * 0.055}px system-ui, sans-serif`;
  [
    "International Space Station",
    "• First module (Zarya) launched November 1998",
    "• Crewed continuously since 2 November 2000",
    "• ~400–420 km altitude, one orbit ≈ 92 minutes",
    "• Speed ≈ 7.7 km/s: ~16 sunrises a day",
    "Meridian Station (this one) is fiction.",
  ].forEach((l, i) => g.fillText(l, W * 0.05, H * (0.3 + i * 0.11)));
  s.tex.needsUpdate = true;
}

// ── Research laboratory ───────────────────────────────────────
function lab(room, kit, env, inspect, pickAt) {
  const m = room.merger;
  // Glovebox against the back wall
  m.span("white", 10.3, 0, -4.2, 11.5, 0.9, -0.8);
  m.span("trim", 10.25, 0.9, -4.25, 11.55, 0.95, -0.75);
  m.span("glass", 10.4, 0.95, -4.1, 10.42, 1.85, -0.9);
  m.span("trim", 10.4, 1.85, -4.15, 11.5, 1.95, -0.85);
  m.span("trim", 10.4, 0.95, -4.15, 11.5, 1.0, -4.05);
  m.span("trim", 10.4, 0.95, -0.95, 11.5, 1.0, -0.85);
  m.span("dark", 11.4, 0.95, -4.15, 11.5, 1.85, -0.85);
  m.span("lightPanel", 10.5, 1.83, -4.0, 11.3, 1.85, -1.0);
  for (const w of [-3.2, -1.8]) {
    m.add("dark", new THREE.TorusGeometry(0.13, 0.025, 8, 20).rotateY(Math.PI / 2), 10.39, 1.3, w);
    m.tube("fabric", [10.42, 1.3, w], [10.85, 1.12, w], 0.09, 10);
  }
  m.span("accent", 10.8, 0.95, -3.0, 11.0, 1.05, -2.6);
  kit.block(10.3, -4.2, 11.5, -0.8);
  inspect(kit, pickAt(kit, 1.3, 1.1, 3.5, 10.9, 1.4, -2.5), "Microgravity glovebox", "A sealed work volume with glove ports keeps fluids, powders and biological samples contained. The ISS has carried such gloveboxes since 2002. This one is fiction.", "established");
  // Sample freezers along the −w wall
  for (let i = 0; i < 3; i++) {
    const u = 3.0 + i * 1.05;
    m.span("white", u - 0.48, 0, -6.95, u + 0.48, 1.9, -6.15);
    m.span("trim", u - 0.45, 1.25, -6.16, u + 0.45, 1.3, -6.12);
    m.span("strip", u - 0.2, 1.55, -6.15, u + 0.2, 1.68, -6.13);
    m.span("trim", u + 0.32, 0.6, -6.16, u + 0.36, 1.1, -6.08);
  }
  const fz = sign(["−80 °C", "Sample freezers"], { w: 0.9, size: 70, bg: "#0b1a2a" });
  kit.add(fz, 4.05, 2.15, -6.9);
  kit.block(2.5, -6.95, 5.65, -6.15);
  inspect(kit, pickAt(kit, 3.2, 1.9, 0.85, 4.05, 0.95, -6.55), "−80 °C sample freezers", "Biological samples are stored deep-frozen until they can return to Earth. On the ISS this is done by the MELFI freezers (Minus Eighty Degree Laboratory Freezer for ISS). These cabinets are fiction.", "established");
  // Bench with microscopes and a centrifuge along +w
  desk(m, 2.8, 5.9, 9.8, 6.95, 0.9);
  for (const u of [4.0, 6.2]) {
    m.span("dark", u - 0.2, 0.9, 6.2, u + 0.2, 0.95, 6.55);
    m.tube("dark", [u, 0.95, 6.5], [u, 1.35, 6.5], 0.04, 8);
    m.span("trim", u - 0.12, 1.08, 6.15, u + 0.12, 1.1, 6.45);
    m.tube("white", [u, 1.35, 6.5], [u, 1.2, 6.3], 0.05, 10);
    m.tube("white", [u, 1.2, 6.3], [u, 1.12, 6.3], 0.035, 10);
    m.tube("dark", [u, 1.35, 6.48], [u - 0.06, 1.5, 6.35], 0.025, 8);
    m.tube("dark", [u, 1.35, 6.48], [u + 0.06, 1.5, 6.35], 0.025, 8);
    inspect(kit, pickAt(kit, 0.5, 0.7, 0.6, u, 1.2, 6.35), "Microscope", "Cells and tissues grown in weightlessness change shape and gene activity; astronauts image them on orbit. (Equipment fiction; the research field is established.)", "established");
  }
  m.add("white", new THREE.CylinderGeometry(0.28, 0.3, 0.3, 24), 8.2, 1.05, 6.4);
  m.add("glassTint", new THREE.SphereGeometry(0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 8.2, 1.2, 6.4);
  m.span("white", 9.0, 0.9, 6.2, 9.6, 1.35, 6.8);
  m.span("strip", 8.98, 1.15, 6.3, 9.0, 1.3, 6.7);
  kit.block(2.8, 5.9, 9.8, 6.95);
  // Central island workbench with stools
  desk(m, 5.0, -1.4, 8.0, 1.4, 0.92);
  m.span("lightPanel", 5.3, 0.93, -0.4, 5.6, 0.94, 0.4);
  for (const w of [-0.8, 0.0, 0.8]) m.add("glassTint", new THREE.CylinderGeometry(0.04, 0.04, 0.14, 10), 6.0, 0.99, w);
  m.add("accent", new THREE.BoxGeometry(0.4, 0.12, 0.3), 7.2, 0.98, 0.4);
  kit.block(5.0, -1.4, 8.0, 1.4);
  for (const w of [-0.9, 0.9]) chair(room.merger, 4.4, w, -1);
  const sg = sign(["RESEARCH LAB", "Life sciences · materials · fluids"], { w: 1.4, size: 60 });
  kit.add(sg, 11.48, 2.6, 3.5, -Math.PI / 2);
}

// ── Greenhouse ────────────────────────────────────────────────
function greenhouse(room, kit, env, inspect, pickAt) {
  const m = room.merger;
  const plants = [];
  const racks = [
    [2.6, -4.4],
    [2.6, 4.4],
    [6.8, -4.4],
    [6.8, 4.4],
    [10.4, 0],
  ];
  for (const [u0, wc] of racks) {
    const len = u0 > 10 ? 1 : 3.4;
    const wl = u0 > 10 ? 5 : 1.0;
    const [ua, ub] = u0 > 10 ? [u0, u0 + len] : [u0, u0 + len];
    for (const [uu, ww] of [
      [ua, wc - wl],
      [ub, wc - wl],
      [ua, wc + wl],
      [ub, wc + wl],
    ])
      m.tube("trim", [uu, 0, ww], [uu, 2.6, ww], 0.03, 6);
    for (const y of [0.35, 1.15, 1.95]) {
      m.span("white", ua, y - 0.04, wc - wl, ub, y, wc + wl);
      m.span("soil", ua + 0.05, y, wc - wl + 0.05, ub - 0.05, y + 0.05, wc + wl - 0.05);
      for (let q = 0; q < 3; q++) {
        const ww = wc - wl + ((q + 0.5) * 2 * wl) / 3;
        m.span("ledGrow", ua + 0.1, y + 0.72, ww - 0.05, ub - 0.1, y + 0.74, ww + 0.05);
      }
      m.span("dark", ua, y + 0.74, wc - wl, ub, y + 0.78, wc + wl);
      const nu = Math.round((ub - ua) / 0.32);
      const nw = Math.round((2 * wl) / 0.36);
      for (let i = 0; i < nu; i++) for (let j = 0; j < nw; j++) plants.push([ua + (i + 0.5) * ((ub - ua) / nu), y + 0.05, wc - wl + (j + 0.5) * ((2 * wl) / nw), (i * 7 + j * 3 + y * 10) % 5]);
    }
    kit.block(ua, wc - wl, ub, wc + wl);
    const p = pickAt(kit, ub - ua, 2.4, 2 * wl, (ua + ub) / 2, 1.2, wc);
    inspect(kit, p, "Growth rack", "Lettuce, mizuna and dwarf tomato under red-blue LEDs. NASA's Veggie unit on the ISS produced the first space-grown lettuce eaten by a crew, in August 2015. In weightlessness roots and shoots orient by light and water; here the ring's spin gravity does that job.", "established", "orbit-veggie");
  }
  // Instanced plant heads (two cultivars)
  const geo = new THREE.IcosahedronGeometry(0.13, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setY(i, y > 0 ? y * 0.9 : y * 0.35);
    const r = 1 + 0.18 * Math.sin(pos.getX(i) * 40) * Math.cos(pos.getZ(i) * 37);
    pos.setX(i, pos.getX(i) * r);
    pos.setZ(i, pos.getZ(i) * r);
  }
  geo.computeVertexNormals();
  const frame = room.frame;
  for (const [mat, pick2] of [
    [env.mats.leaf, (p) => p[3] < 3],
    [env.mats.leafRed, (p) => p[3] >= 3],
  ]) {
    const list = plants.filter(pick2);
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const M = new THREE.Matrix4();
    list.forEach((p, i) => {
      const s = 0.75 + ((p[0] * 13 + p[2] * 7) % 1) * 0.6;
      M.compose(new THREE.Vector3(p[0], p[1] + 0.1 * s, p[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p[0] * 9 + p[2] * 5, 0)), new THREE.Vector3(s, s, s));
      im.setMatrixAt(i, frame.clone().multiply(M));
    });
    im.computeBoundingSphere();
    env.ringRootAdd(im);
  }
  // Water tanks + nutrient lines along the back wall
  for (const w of [-5.5, -4.5]) m.tube("white", [11.2, 0, w], [11.2, 1.6, w], 0.35, 20);
  m.tube("pipe", [11.3, 2.8, -6.8], [11.3, 2.8, 6.8], 0.05, 8);
  m.tube("green", [11.35, 2.65, -6.8], [11.35, 2.65, 6.8], 0.035, 8);
  kit.block(10.8, -5.9, 11.55, -4.1);
  const sg = sign(["GREENHOUSE", "Hydroponics · LED growth light"], { w: 1.3, size: 60, accent: "#ff8fe0" });
  kit.add(sg, 3.0, 2.85, -6.9);
  room.anchorColor = 0xffb8f0;
}

// ── Crew quarters ─────────────────────────────────────────────
function quarters(room, kit, env, inspect, pickAt) {
  const m = room.merger;
  // Four sleep cabins (two per side wall), each with a bunk, light and curtain
  for (const e of [-1, 1])
    for (const u0 of [2.4, 6.6]) {
      const w0 = e * 7;
      const w1 = e * 4.6;
      const [wa, wb] = [Math.min(w0, w1), Math.max(w0, w1)];
      m.span("wall", u0 - 0.06, 0, wa, u0, 2.6, wb);
      m.span("wall", u0 + 3.8, 0, wa, u0 + 3.86, 2.6, wb);
      m.span("white", u0, 2.5, wa, u0 + 3.8, 2.6, wb);
      m.span("white", u0 + 0.2, 0, w0 - e * 2.0, u0 + 2.3, 0.5, w0);
      m.span("fabric", u0 + 0.25, 0.5, w0 - e * 1.95, u0 + 2.25, 0.62, w0);
      m.span("whiteL", u0 + 0.25, 0.62, w0 - e * 0.55, u0 + 0.7, 0.7, w0 - e * 0.05);
      m.span("dark", u0 + 2.5, 0, w0 - e * 0.7, u0 + 3.7, 2.0, w0);
      m.span("trim", u0 + 2.5, 1.0, w0 - e * 0.72, u0 + 3.7, 1.02, w0 - e * 0.69);
      m.span("lightWarm", u0 + 0.6, 2.48, w0 - e * 1.6, u0 + 1.6, 2.5, w0 - e * 0.6);
      m.span("fabric", u0 + 2.2, 0.05, w1 - e * 0.03, u0 + 3.7, 2.4, w1);
      m.span("accent", u0 - 0.05, 2.15, w1 - e * 0.02, u0 + 3.85, 2.45, w1 + e * 0.02);
      kit.block(u0 - 0.06, wa, u0 + 3.86, wb);
    }
  // Galley table and stools in the middle
  m.span("white", 5.2, 0.72, -1.2, 8.4, 0.78, 1.2);
  m.tube("trim", [6.8, 0, 0], [6.8, 0.72, 0], 0.08, 12);
  m.add("trim", new THREE.CylinderGeometry(0.5, 0.55, 0.04, 20), 6.8, 0.02, 0);
  for (const [u, w] of [
    [5.6, -1.6],
    [7.9, -1.6],
    [5.6, 1.6],
    [7.9, 1.6],
  ]) {
    m.tube("trim", [u, 0, w], [u, 0.45, w], 0.03, 8);
    m.add("fabric", new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16), u, 0.47, w);
  }
  kit.collide(6.8, 0, 1.4);
  env.restSurfaces.push({ ...kit.world(6.8, 0), r: 1.3, y: room.y0 + 0.78 });
  m.add("white", new THREE.CylinderGeometry(0.05, 0.04, 0.1, 12), 6.2, 0.83, 0.3);
  m.add("accent", new THREE.CylinderGeometry(0.05, 0.04, 0.1, 12), 7.3, 0.83, -0.4);
  // Galley wall on the back wall: lockers, food warmer, water dispenser
  m.span("white", 10.9, 0, -3.5, 11.55, 2.2, 3.5);
  for (let w = -3.5; w < 3.4; w += 0.7) m.span("trim", 10.88, 0.1, w + 0.02, 10.9, 2.1, w + 0.04);
  m.span("dark", 10.86, 0.95, -0.6, 10.9, 1.35, 0.6);
  m.span("strip", 10.85, 1.25, -0.5, 10.86, 1.3, 0.5);
  kit.block(10.9, -3.5, 11.55, 3.5);
  const sch = sign(["CREW DAY 142", "06:00 wake · 07:30 DPC · 13:00 exercise · 21:30 sleep"], { w: 1.5, size: 54 });
  kit.add(sch, 10.84, 1.85, -1.9, -Math.PI / 2);
  inspect(kit, sch, "Crew schedule", "Station crews follow GMT and a planned timeline: daily planning conference, maintenance, science, and about 2.5 h of exercise to slow bone and muscle loss. (On a spinning station like this fictional one, exercise needs would likely drop.)", "established");
}

// ── Engineering ───────────────────────────────────────────────
function engineering(room, kit, env, updaters, inspect, pickAt) {
  const m = room.merger;
  const anim = [];
  // Pipe runs along the ceiling and walls
  for (const [w, mat, r] of [
    [-6.3, "copper", 0.09],
    [-5.9, "pipe", 0.12],
    [6.2, "pipe", 0.12],
    [5.8, "copper", 0.08],
  ]) {
    m.tube(mat, [0.4, 3.0, w], [11.4, 3.0, w], r, 12);
    for (let u = 1; u < 11.4; u += 2.2) m.span("trim", u, 2.88, w - 0.2, u + 0.06, 3.4, w + 0.2);
  }
  for (const w of [-6.3, 6.2]) m.tube(w < 0 ? "copper" : "pipe", [11.2, 0.4, w], [11.2, 3.0, w], 0.1, 12);
  // Three pump skids with spinning impeller covers
  for (let i = 0; i < 3; i++) {
    const u = 3.2 + i * 2.6;
    const w = -4.8;
    m.span("dark", u - 0.8, 0, w - 0.9, u + 0.8, 0.25, w + 0.9);
    m.tube("accent", [u - 0.6, 0.65, w], [u + 0.2, 0.65, w], 0.36, 20);
    m.tube("trim", [u + 0.2, 0.65, w], [u + 0.45, 0.65, w], 0.42, 20);
    m.tube("pipe", [u - 0.6, 0.65, w], [u - 0.6, 3.0, w - 1.1], 0.08, 10);
    m.tube("copper", [u + 0.45, 0.65, w], [u + 0.45, 0.65, w - 1.5], 0.08, 10);
    m.tube("pipe", [u, 0.25, w], [u, 0.3, w], 0.3, 10);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 6).rotateZ(Math.PI / 2), env.mats.yellow);
    const g = kit.add(new THREE.Group(), u + 0.5, 0.65, w);
    g.add(fan);
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.06), env.mats.dark);
      blade.rotation.x = (b * Math.PI) / 3;
      blade.position.x = 0.04;
      g.add(blade);
    }
    anim.push((dt) => (g.rotation.x += dt * (9 + i * 2)));
    kit.block(u - 0.8, w - 0.9, u + 0.8, w + 0.9);
  }
  inspect(kit, pickAt(kit, 8, 1.4, 2, 5.8, 0.7, -4.8), "Coolant pumps", "Pumps drive the water and ammonia loops that carry heat from the cabin to the radiators. The ISS uses this two-loop design so toxic ammonia never enters the cabin. (These pumps are fiction.)", "established");
  // Flywheel energy-storage drum with a moving reference stripe
  m.add("trim", new THREE.CylinderGeometry(1.0, 1.0, 0.25, 32), 8.6, 0.13, 4.6);
  m.add("glassTint", new THREE.CylinderGeometry(0.95, 0.95, 1.6, 32, 1, true), 8.6, 1.05, 4.6);
  m.add("trim", new THREE.CylinderGeometry(1.0, 1.0, 0.2, 32), 8.6, 1.95, 4.6);
  const fly = kit.add(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 24), env.mats.copper), 8.6, 1.05, 4.6);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.22, 0.06), env.mats.ledGreen);
  mark.position.x = 0.7;
  fly.add(mark);
  anim.push((dt) => (fly.rotation.y += dt * 6));
  kit.collide(8.6, 4.6, 1.1);
  inspect(kit, fly, "Flywheel store", "A spinning rotor stores energy for eclipse peaks. Fiction here; the ISS uses lithium-ion batteries for orbital night.", "fiction");
  // Pistons / reciprocating compressor
  const comp = [];
  m.span("dark", 3.0, 0, 3.6, 5.6, 0.9, 5.8);
  for (let i = 0; i < 3; i++) {
    const p = kit.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 14), env.mats.trim), 3.5 + i * 0.8, 1.1, 4.7);
    m.tube("dark", [3.5 + i * 0.8, 0.9, 4.7], [3.5 + i * 0.8, 1.55, 4.7], 0.2, 14);
    comp.push(p);
  }
  m.span("strip", 3.1, 0.6, 3.58, 5.5, 0.66, 3.6);
  anim.push((dt, t) => comp.forEach((p, i) => (p.position.y = 1.3 + Math.sin(t * 5 + i * 2.1) * 0.15)));
  kit.block(3.0, 3.6, 5.6, 5.8);
  // Gauges with live needles on the back wall
  const needles = [];
  for (let i = 0; i < 4; i++) {
    const w = -2.4 + i * 1.6;
    m.add("white", new THREE.CylinderGeometry(0.22, 0.22, 0.05, 24).rotateZ(Math.PI / 2), 11.5, 1.6, w);
    m.add("trim", new THREE.TorusGeometry(0.22, 0.02, 6, 24).rotateY(Math.PI / 2), 11.47, 1.6, w);
    const n = kit.add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.17, 0.02), env.mats.ledRed), 11.46, 1.6, w);
    n.geometry.translate(0, 0.075, 0);
    needles.push(n);
  }
  anim.push((dt, t) => needles.forEach((n, i) => (n.rotation.x = -0.8 + Math.sin(t * (0.3 + i * 0.17) + i) * 0.35 + i * 0.3)));
  // Workbench with a grabbable torque wrench
  desk(m, 9.4, -1.2, 11.0, 1.2, 0.9);
  kit.block(9.4, -1.2, 11.0, 1.2);
  env.restSurfaces.push({ ...kit.world(10.2, 0), r: 1.0, y: room.y0 + 0.9 });
  const wrench = new THREE.Group();
  const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 10).rotateZ(Math.PI / 2), env.mats.trim);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.07), env.mats.dark);
  head.position.x = 0.23;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.14, 10).rotateZ(Math.PI / 2), env.mats.accent);
  grip.position.x = -0.15;
  wrench.add(h, head, grip);
  kit.add(wrench, 9.9, 0.92, 0.3, 0.6);
  env.grabbable(wrench, "Torque wrench");
  const sg = sign(["ENGINEERING", "Thermal control · power · life support"], { w: 1.5, size: 60, accent: "#ffb347" });
  kit.add(sg, 2.4, 2.75, 6.9, Math.PI);
  updaters.push((dt, t) => anim.forEach((f) => f(dt, t)));
  const centre = new THREE.Vector3(5.8, 0, 0).applyMatrix4(room.frame);
  return (head2) => Math.max(0, 1 - centre.distanceTo(head2) / 14);
}

// ── Communications ────────────────────────────────────────────
function comms(room, kit, env, updaters, inspect, pickAt) {
  const m = room.merger;
  // LED rack fronts share one animated canvas
  const leds = screen(0.6, 1.8, 120);
  const ledMat = leds.mesh.material;
  for (let i = 0; i < 6; i++) {
    const u = 3 + i * 1.3;
    for (const e of [-1, 1]) {
      m.span("dark", u - 0.32, 0, e * 6.95, u + 0.32, 2.2, e * 6.15);
      const f = new THREE.Mesh(leds.mesh.geometry, ledMat);
      kit.add(f, u, 1.1, e * 6.14, e > 0 ? Math.PI : 0);
    }
  }
  kit.block(2.6, -6.95, 10.2, -6.15);
  kit.block(2.6, 6.15, 10.2, 6.95);
  let acc = 0;
  updaters.push((dt) => {
    acc += dt;
    if (acc < 0.25) return;
    acc = 0;
    const { g, W, H } = leds;
    g.fillStyle = "#11161c";
    g.fillRect(0, 0, W, H);
    for (let r = 0; r < 18; r++) {
      g.fillStyle = "#1c232b";
      g.fillRect(4, r * (H / 18) + 2, W - 8, H / 18 - 4);
      for (let c = 0; c < 6; c++) {
        const on = Math.random() < 0.55;
        g.fillStyle = on ? (c === 5 ? "#ffb347" : "#30ff70") : "#0b3016";
        g.fillRect(8 + c * 9, r * (H / 18) + 6, 5, 4);
      }
    }
    leds.tex.needsUpdate = true;
  });
  // Operator desk with the relay-link display
  desk(m, 9.6, -3, 10.6, 3, 0.76);
  for (const w of [-1.5, 1.5]) chair(m, 9.0, w, -1);
  kit.block(9.6, -3, 10.6, 3);
  const s = screen(2.8, 1.5, 160);
  kit.add(s.mesh, 11.48, 1.9, 0, -Math.PI / 2);
  m.add("dark", new THREE.CylinderGeometry(0.06, 0.08, 0.04, 12), 10.0, 0.78, 0.4);
  m.tube("dark", [10.0, 0.78, 0.4], [9.9, 1.05, 0.35], 0.01, 6);
  m.add("dark", new THREE.SphereGeometry(0.035, 10, 8), 9.9, 1.06, 0.35);
  inspect(kit, s.mesh, "Relay links", "Low-orbit stations see any one ground station for only minutes per pass. The ISS relays voice, video and data through NASA's TDRS satellites in geostationary orbit, ~36,000 km up, for near-continuous contact with Mission Control.", "established", "orbit-tdrs");
  let acc2 = 0;
  updaters.push((dt, t) => {
    acc2 += dt;
    if (acc2 < 0.3) return;
    acc2 = 0;
    const { g, W, H } = s;
    header(s, "RELAY LINKS", "Ku-band via geostationary relays (TDRS-style) · S-band voice");
    const cx = W * 0.5;
    const cy = H * 0.6;
    const R = H * 0.3;
    g.fillStyle = "#1b4f8a";
    g.beginPath();
    g.arc(cx, cy, R * 0.45, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(143,216,255,0.4)";
    g.beginPath();
    g.arc(cx, cy, R * 1.25, 0, Math.PI * 2);
    g.stroke();
    const st = env.info.sky.state;
    const a = st.theta - Math.PI / 2;
    const sx = cx + Math.cos(a) * R * 0.55;
    const sy = cy + Math.sin(a) * R * 0.55;
    const relays = [0.4, 2.5, 4.6].map((b) => [cx + Math.cos(b) * R * 1.25, cy + Math.sin(b) * R * 1.25]);
    let best = null;
    for (const r of relays) {
      g.fillStyle = "#ffd27f";
      g.fillRect(r[0] - 6, r[1] - 6, 12, 12);
      const d = Math.hypot(r[0] - sx, r[1] - sy);
      if (!best || d < best.d) best = { r, d };
    }
    g.strokeStyle = (t * 3) % 1 < 0.7 ? "#30ff70" : "#1b7a3a";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(best.r[0], best.r[1]);
    g.lineTo(cx - R * 0.3, cy - R * 0.3);
    g.stroke();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(sx, sy, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#e8edf2";
    g.font = `500 ${H * 0.05}px system-ui, sans-serif`;
    g.fillText("LINK: NOMINAL · 300 Mbit/s down (fiction)", W * 0.04, H * 0.95);
    s.tex.needsUpdate = true;
  });
  const sg = sign(["COMMUNICATIONS", "Relay · ground · inter-station"], { w: 1.4, size: 60 });
  kit.add(sg, 2.0, 2.75, -6.9);
}

// ── Spoke lift ────────────────────────────────────────────────
function lift(room, kit, env, inspect) {
  const m = room.merger;
  // Lift shaft alcove on the back wall
  m.span("dark", 9.6, 0, -1.6, 11.55, 0.02, 1.6);
  for (const e of [-1, 1]) m.span("trim", 9.5, 0, e * 1.6 - 0.1, 11.55, 3.4, e * 1.6 + 0.1);
  m.span("trim", 9.5, 2.5, -1.6, 11.55, 3.4, 1.6);
  m.span("white", 11.4, 0, -1.5, 11.55, 2.5, 1.5);
  m.span("lightPanel", 10.0, 2.48, -1.2, 11.2, 2.5, 1.2);
  m.span("stripAmber", 9.5, 2.55, -1.2, 9.52, 2.6, 1.2);
  // Suit lockers along +w
  for (let i = 0; i < 4; i++) {
    const u = 2.6 + i * 1.5;
    m.span("white", u - 0.65, 0, 6.2, u + 0.65, 2.3, 6.95);
    m.span("glassTint", u - 0.6, 0.2, 6.18, u + 0.6, 2.2, 6.2);
    // EVA suit silhouette
    m.add("white", new THREE.CapsuleGeometry(0.28, 0.6, 4, 10), u, 1.3, 6.6);
    m.add("white", new THREE.SphereGeometry(0.2, 12, 8), u, 1.95, 6.6);
    m.add("extGlass", new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI), u, 1.97, 6.45);
    m.tube("white", [u - 0.12, 0.95, 6.6], [u - 0.12, 0.25, 6.6], 0.1, 8);
    m.tube("white", [u + 0.12, 0.95, 6.6], [u + 0.12, 0.25, 6.6], 0.1, 8);
  }
  kit.block(1.9, 6.2, 7.6, 6.95);
  // Lift call panel
  const panel = new Panel({ width: 0.7, height: 0.5, ppm: 1000, glow: "#ffd27f" });
  panel.mesh.position.set(9.3, 1.5, -2.2);
  panel.mesh.rotation.y = -Math.PI / 4;
  room.group.add(panel.mesh);
  panel.setContent({
    eyebrow: "Spoke B lift",
    title: "To the hub",
    titleSize: 52,
    lines: ["205 m up the spoke to the non-rotating hub: airlock and EVA gantry. You will float there."],
    lineSize: 26,
    buttons: grid(panel, [{ id: "go", label: "Ride to the hub" }], { top: 0.72, cols: 1, rowH: 0.2, side: 0.12 }),
  });
  kit.interact({ object: panel.mesh, panel, onButton: () => env.toHub() });
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16).rotateZ(Math.PI / 2), env.mats.stripAmber);
  kit.add(btn, 9.46, 1.15, 1.85);
  kit.interact({ object: btn, label: "Ride to the hub", poke: true, pokeRadius: 0.07, onPoke: () => env.toHub(), onSelect: () => env.toHub() });
  // Gravity-vs-radius diagram
  const d = sign(["SPOKE B · 205 m", "a = ω²r:  r 225 m → 1.00 g   ·   r 112 m → 0.50 g   ·   r 0 → 0 g"], { w: 2.2, size: 56, accent: "#ffd27f" });
  kit.add(d, 5.0, 2.6, -6.9);
  inspect(kit, d, "Gravity along the spoke", "Spin gravity grows linearly with distance from the axis (a = ω²r). Climbing the spoke, you would feel lighter and lighter, and the Coriolis effect would push you sideways in the lift. (Meridian Station is fiction; the physics is real.)", "simplified");
  // Bench
  m.span("trim", 3.0, 0, -6.9, 6.0, 0.42, -6.3);
  m.span("fabric", 3.0, 0.42, -6.9, 6.0, 0.5, -6.3);
  kit.block(3.0, -6.9, 6.0, -6.3);
}
