import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { surface } from "../../scene/surfaces.js";
import { interiorEnvironment } from "../common.js";

/**
 * The Pathfinder shuttle's flight deck (fiction). Ship frame: x right, y up, −Z forward, floor at y = 0.
 * The seated eye sits at EYE. Static parts are merged per material; controls, screens and the hatch
 * are separate objects so they can move.
 */

export const EYE = new THREE.Vector3(0, 1.22, 0);
const D2R = Math.PI / 180;

// Canopy: an ellipsoid around the eye; windows are rectangles in (azimuth θ, elevation φ) degrees.
const SHELL = { rx: 0.98, rzF: 1.1, rzB: 0.95, ryU: 0.74, ryD: 1.25 };
export const WINDOWS = [
  [-27, 27, -6, 30], // windscreen
  [-70, -31, -10, 28],
  [31, 70, -10, 28],
  [-98, -74, -14, 22],
  [74, 98, -14, 22],
  [-27, -3, 35, 62], // eyebrow (upper) windows
  [3, 27, 35, 62],
];
const TH_RANGE = [-100, 100];

function shellPoint(thDeg, phDeg, k = 1, out = new THREE.Vector3()) {
  const th = thDeg * D2R;
  const ph = phDeg * D2R;
  const cp = Math.cos(ph);
  const rz = Math.cos(th) > 0 ? SHELL.rzF : SHELL.rzB;
  out.set(Math.sin(th) * cp * SHELL.rx * k, Math.sin(ph) * (ph > 0 ? SHELL.ryU : SHELL.ryD) * k, -Math.cos(th) * cp * rz * k);
  return out.add(EYE);
}

const inWindow = (th, ph) => WINDOWS.some(([a, b, c, d]) => th > a && th < b && ph > c && ph < d);

function breaks(lo, hi, edges, step) {
  const s = new Set([lo, hi, ...edges.filter((e) => e > lo && e < hi)]);
  for (let v = lo; v < hi; v += step) s.add(Math.round(v * 1000) / 1000);
  return [...s].sort((a, b) => a - b);
}

/** Canopy shell split into hull (opaque) and glass cells along the window edges. */
function shellGeometries() {
  const ths = breaks(TH_RANGE[0], TH_RANGE[1], WINDOWS.flatMap((w) => [w[0], w[1]]), 5);
  const phs = breaks(-88, 90, WINDOWS.flatMap((w) => [w[2], w[3]]), 5);
  const nT = ths.length;
  const pos = [];
  const uv = [];
  const p = new THREE.Vector3();
  for (let j = 0; j < phs.length; j++) {
    for (let i = 0; i < nT; i++) {
      shellPoint(ths[i], phs[j], 1, p);
      pos.push(p.x, p.y, p.z);
      uv.push((ths[i] - TH_RANGE[0]) / 200, (phs[j] + 88) / 178);
    }
  }
  const hullIdx = [];
  const glassIdx = [];
  for (let j = 0; j < phs.length - 1; j++) {
    for (let i = 0; i < nT - 1; i++) {
      const a = j * nT + i;
      const b = a + 1;
      const c = a + nT + 1;
      const d = a + nT;
      const win = inWindow((ths[i] + ths[i + 1]) / 2, (phs[j] + phs[j + 1]) / 2);
      (win ? glassIdx : hullIdx).push(a, b, c, a, c, d);
    }
  }
  const mk = (idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  return { hull: mk(hullIdx), glass: mk(glassIdx) };
}

/** A tube following a window's outline, slightly inside the shell. */
function windowFrame([a, b, c, d], r, k) {
  const pts = [];
  const n = 10;
  for (let i = 0; i < n; i++) pts.push(shellPoint(a + ((b - a) * i) / n, c, k));
  for (let i = 0; i < n; i++) pts.push(shellPoint(b, c + ((d - c) * i) / n, k));
  for (let i = 0; i < n; i++) pts.push(shellPoint(b - ((b - a) * i) / n, d, k));
  for (let i = 0; i < n; i++) pts.push(shellPoint(a, d - ((d - c) * i) / n, k));
  const curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.1);
  return new THREE.TubeGeometry(curve, 96, r, 6, true);
}

/** Collects geometries per material and merges them into one mesh each. */
class Builder {
  constructor() {
    this.parts = new Map();
  }
  add(mat, geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], "YXZ")), new THREE.Vector3(...s));
    let g = geo.index ? geo : geo;
    g = g.clone().applyMatrix4(m);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) {
      const idx = [];
      for (let i = 0; i < g.attributes.position.count; i++) idx.push(i);
      g.setIndex(idx);
    }
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return g;
  }
  build(group, { shadows = false } = {}) {
    for (const [mat, list] of this.parts) {
      const g = mergeGeometries(list, false);
      const m = new THREE.Mesh(g, mat);
      m.castShadow = shadows && !mat.transparent;
      m.receiveShadow = shadows;
      group.add(m);
      list.forEach((x) => x.dispose());
    }
    this.parts.clear();
  }
}

function labelTexture(lines, { w = 256, h = 128, bg = "#16191d", fg = "#e9edf1", size = 40, sub = null, subColor = "#7fd3ff" } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, "rgba(255,255,255,0.10)");
  grd.addColorStop(1, "rgba(0,0,0,0.25)");
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `700 ${size}px system-ui, sans-serif`;
  const L = Array.isArray(lines) ? lines : [lines];
  L.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (L.length - 1) / 2) * size * 1.05 - (sub ? size * 0.35 : 0)));
  if (sub) {
    g.font = `600 ${Math.round(size * 0.5)}px system-ui, sans-serif`;
    g.fillStyle = subColor;
    g.fillText(sub, w / 2, h - size * 0.55);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Build the flight deck. Returns the group plus handles for the controls, screens, hatch and lights.
 */
export function buildCockpit({ renderer, tier = "balanced" }) {
  const group = new THREE.Group();
  group.name = "pathfinder-flight-deck";
  const env = interiorEnvironment(renderer);
  const shadows = tier !== "low";
  const clean = { dustTop: 0, dustBase: 0 };
  const withEnv = (m, k = 0.45) => {
    m.envMap = env;
    m.envMapIntensity = k;
    return m;
  };
  const M = {
    hull: withEnv(surface({ kind: "composite", color: 0x3b4047, roughness: 0.72, metalness: 0.05, scale: 2.2, grime: 0.08, bump: 0.25, ...clean, side: THREE.DoubleSide }), 0.35),
    panel: withEnv(surface({ kind: "panel", color: 0x24282d, roughness: 0.5, metalness: 0.35, scale: 3.5, grime: 0.1, bump: 0.3, ...clean })),
    light: withEnv(surface({ kind: "panel", color: 0xb9bec4, roughness: 0.48, metalness: 0.15, scale: 2.5, grime: 0.12, bump: 0.25, ...clean, side: THREE.DoubleSide }), 0.4),
    trim: withEnv(surface({ kind: "brushed", color: 0xa7aeb6, roughness: 0.28, metalness: 0.92, scale: 5, grime: 0.05, ...clean }), 0.8),
    frame: withEnv(surface({ kind: "brushed", color: 0x2a2e33, roughness: 0.34, metalness: 0.75, scale: 6, grime: 0.06, ...clean }), 0.7),
    seat: withEnv(surface({ kind: "rubber", color: 0x2c2b2e, roughness: 0.86, metalness: 0, scale: 9, grime: 0.05, bump: 0.6, ...clean }), 0.25),
    leather: withEnv(surface({ kind: "rubber", color: 0x4a3326, roughness: 0.62, metalness: 0, scale: 7, grime: 0.08, bump: 0.35, ...clean }), 0.35),
    floor: withEnv(surface({ kind: "rubber", color: 0x1d1f22, roughness: 0.8, metalness: 0.05, scale: 3, grime: 0.15, bump: 0.8, ...clean }), 0.25),
    strap: withEnv(new THREE.MeshStandardMaterial({ color: 0xc8541e, roughness: 0.8 }), 0.2),
    black: withEnv(new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.35, metalness: 0.2 }), 0.5),
    glowCyan: new THREE.MeshBasicMaterial({ color: 0x6fd6ff, toneMapped: false }),
    glowWarm: new THREE.MeshBasicMaterial({ color: 0xffc27a, toneMapped: false }),
    glowRed: new THREE.MeshBasicMaterial({ color: 0xff4a3a, toneMapped: false }),
    glowGreen: new THREE.MeshBasicMaterial({ color: 0x5dff9a, toneMapped: false }),
  };
  const glass = withEnv(new THREE.MeshStandardMaterial({ color: 0x8fb4d0, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.1, depthWrite: false }), 1.0);
  const B = new Builder();

  // ── Canopy shell, window glass and frames ──
  const sh = shellGeometries();
  B.add(M.hull, sh.hull);
  const glassMesh = new THREE.Mesh(sh.glass, glass);
  glassMesh.renderOrder = 5;
  group.add(glassMesh);
  for (const w of WINDOWS) {
    B.add(M.frame, windowFrame(w, 0.022, 0.985));
    B.add(M.trim, windowFrame(w, 0.006, 0.97));
  }
  // Rib between the eyebrow windows and the windscreen (structural arch).
  {
    const pts = [];
    for (let th = -100; th <= 100; th += 5) pts.push(shellPoint(th, 32.5, 0.975));
    B.add(M.frame, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.03, 8, false));
  }
  // Aft frame ring closing the shell against the cabin box.
  {
    const s = new THREE.Shape();
    s.moveTo(-0.99, -0.02);
    s.lineTo(0.99, -0.02);
    s.lineTo(0.99, 1.98);
    s.lineTo(-0.99, 1.98);
    s.closePath();
    const hole = new THREE.Path();
    const pts = [];
    for (let ph = -88; ph <= 90; ph += 6) pts.push(shellPoint(100, ph, 0.995));
    for (let ph = 90; ph >= -88; ph -= 6) pts.push(shellPoint(-100, ph, 0.995));
    const ys = pts.map((p) => Math.max(0.01, p.y));
    hole.moveTo(pts[0].x, ys[0]);
    for (let i = 1; i < pts.length; i++) hole.lineTo(pts[i].x * 0.999, ys[i]);
    hole.closePath();
    s.holes.push(hole);
    B.add(M.light, new THREE.ShapeGeometry(s, 4), { p: [0, 0, 0.17] });
  }

  // ── Cabin box aft of the canopy, floor, ceiling, aft bulkhead with the hatch opening ──
  B.add(M.floor, new THREE.BoxGeometry(1.94, 0.04, 4.3), { p: [0, -0.02, 0.95] });
  for (const sx of [-1, 1]) {
    B.add(M.light, new THREE.BoxGeometry(0.04, 1.98, 1.1), { p: [sx * 0.99, 0.99, 0.72] });
    // stowage lockers on the side walls
    for (let i = 0; i < 2; i++) {
      B.add(M.panel, new THREE.BoxGeometry(0.06, 0.42, 0.44), { p: [sx * 0.95, 1.38, 0.47 + i * 0.47] });
      B.add(M.trim, new THREE.BoxGeometry(0.02, 0.03, 0.12), { p: [sx * 0.915, 1.3, 0.47 + i * 0.47] });
      B.add(M.panel, new THREE.BoxGeometry(0.1, 0.5, 0.44), { p: [sx * 0.93, 0.5, 0.47 + i * 0.47] });
    }
    // handrails
    B.add(M.trim, new THREE.CylinderGeometry(0.014, 0.014, 0.9, 10).rotateX(Math.PI / 2), { p: [sx * 0.9, 1.72, 0.7] });
    for (const z of [0.3, 1.1]) B.add(M.trim, new THREE.CylinderGeometry(0.01, 0.01, 0.08, 8).rotateZ(Math.PI / 2), { p: [sx * 0.94, 1.72, z] });
    // LED strips along the window sills (premium cabin accent)
    const pts = [];
    for (let th = 5; th <= 98; th += 4) pts.push(shellPoint(sx * th, -16, 0.95));
    B.add(M.glowCyan, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0035, 4, false));
  }
  B.add(M.light, new THREE.BoxGeometry(1.98, 0.04, 1.1), { p: [0, 1.98, 0.72] });
  // ceiling light panel
  B.add(M.glowWarm, new THREE.BoxGeometry(0.5, 0.01, 0.16), { p: [0, 1.955, 0.55] });
  // Aft bulkhead with hatch opening (0.8 × 1.6 m)
  {
    const s = new THREE.Shape();
    s.moveTo(-0.99, 0);
    s.lineTo(0.99, 0);
    s.lineTo(0.99, 1.98);
    s.lineTo(-0.99, 1.98);
    s.closePath();
    const h = new THREE.Path();
    h.moveTo(-0.4, 0.22);
    h.lineTo(0.4, 0.22);
    h.lineTo(0.4, 1.66);
    h.absarc(0, 1.66, 0.4, 0, Math.PI, false);
    h.lineTo(-0.4, 0.22);
    s.holes.push(h);
    B.add(M.light, new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false, curveSegments: 16 }), { p: [0, 0, 1.27] });
    // hatch frame
    const fp = [new THREE.Vector3(-0.42, 0.2, 1.26), new THREE.Vector3(-0.42, 1.66, 1.26)];
    for (let a = 180; a >= 0; a -= 15) fp.push(new THREE.Vector3(Math.cos(a * D2R) * 0.42, 1.66 + Math.sin(a * D2R) * 0.42, 1.26));
    fp.push(new THREE.Vector3(0.42, 0.2, 1.26));
    B.add(M.trim, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fp, false, "catmullrom", 0.05), 60, 0.025, 8, false));
    B.add(M.strap, new THREE.BoxGeometry(0.84, 0.05, 0.02), { p: [0, 0.2, 1.25] });
  }

  // ── Cargo compartment and airlock behind the hatch ──
  {
    const z0 = 1.33;
    const z1 = 3.05;
    const L = z1 - z0;
    const zc = (z0 + z1) / 2;
    for (const sx of [-1, 1]) {
      B.add(M.light, new THREE.BoxGeometry(0.04, 1.92, L), { p: [sx * 0.85, 0.96, zc] });
      // ribs
      for (let z = z0 + 0.25; z < z1; z += 0.42) B.add(M.frame, new THREE.BoxGeometry(0.05, 1.9, 0.05), { p: [sx * 0.81, 0.95, z] });
      // cargo nets and crates
      for (let k = 0; k < 2; k++) {
        const z = z0 + 0.45 + k * 0.6;
        B.add(M.composite ?? M.panel, new THREE.BoxGeometry(0.42, 0.36, 0.48), { p: [sx * 0.56, 0.18 + 0, z] });
        B.add(M.light, new THREE.BoxGeometry(0.36, 0.3, 0.42), { p: [sx * 0.58, 0.54, z] });
        B.add(M.strap, new THREE.BoxGeometry(0.44, 0.03, 0.04), { p: [sx * 0.56, 0.37, z] });
        B.add(M.strap, new THREE.BoxGeometry(0.38, 0.03, 0.04), { p: [sx * 0.58, 0.69, z] });
      }
      B.add(M.panel, new THREE.BoxGeometry(0.3, 0.04, L - 0.2), { p: [sx * 0.66, 1.3, zc] });
    }
    B.add(M.light, new THREE.BoxGeometry(1.72, 0.04, L), { p: [0, 1.92, zc] });
    B.add(M.glowWarm, new THREE.BoxGeometry(0.08, 0.01, L - 0.4), { p: [0, 1.895, zc] });
    // Airlock outer hatch (round, with a small window and status lights)
    B.add(M.light, new THREE.BoxGeometry(1.72, 1.94, 0.06), { p: [0, 0.97, z1 + 0.03] });
    B.add(M.trim, new THREE.TorusGeometry(0.46, 0.035, 10, 40), { p: [0, 1.0, z1] });
    B.add(M.panel, new THREE.CylinderGeometry(0.44, 0.44, 0.06, 40).rotateX(Math.PI / 2), { p: [0, 1.0, z1 - 0.01] });
    B.add(M.black, new THREE.CylinderGeometry(0.09, 0.09, 0.07, 24).rotateX(Math.PI / 2), { p: [0, 1.18, z1 - 0.02] });
    B.add(M.trim, new THREE.TorusGeometry(0.16, 0.018, 8, 24), { p: [0, 0.92, z1 - 0.05] });
    B.add(M.glowGreen, new THREE.SphereGeometry(0.018, 10, 8), { p: [0.6, 1.5, z1 - 0.01] });
    B.add(M.glowRed, new THREE.SphereGeometry(0.018, 10, 8), { p: [0.6, 1.44, z1 - 0.01] });
    // Suit stowage outline on the right wall
    B.add(M.black, new THREE.BoxGeometry(0.04, 1.2, 0.5), { p: [0.82, 1.05, 2.6] });
  }

  // ── Instrument panel, glare shield, side consoles ──
  // Main panel face: tilted back 18°, centre (0, 0.84, −0.76)
  const PANEL = { y: 0.82, z: -0.76, tilt: -18 * D2R };
  B.add(M.panel, new THREE.BoxGeometry(1.34, 0.36, 0.08), { p: [0, PANEL.y, PANEL.z - 0.02], r: [PANEL.tilt, 0, 0] });
  B.add(M.panel, new THREE.BoxGeometry(1.34, 0.62, 0.3), { p: [0, 0.32, -0.9] });
  // Glare shield with a rounded leather-wrapped lip
  B.add(M.panel, new THREE.BoxGeometry(1.36, 0.05, 0.26), { p: [0, 0.985, -0.84] });
  B.add(M.leather, new THREE.CylinderGeometry(0.024, 0.024, 1.36, 16).rotateZ(Math.PI / 2), { p: [0, 0.982, -0.71] });
  B.add(M.black, new THREE.BoxGeometry(1.34, 0.05, 0.01), { p: [0, 0.955, -0.72] });
  // Mission control strip (the poke buttons) on a short bracket in front of the lower panel
  const STRIP = { y: 0.835, z: -0.5, tilt: -42 * D2R };
  B.add(M.panel, new THREE.BoxGeometry(0.62, 0.12, 0.04), { p: [0, STRIP.y, STRIP.z], r: [STRIP.tilt, 0, 0] });
  B.add(M.trim, new THREE.BoxGeometry(0.63, 0.008, 0.008), { p: [0, STRIP.y - 0.047, STRIP.z + 0.04] });
  B.add(M.frame, new THREE.BoxGeometry(0.5, 0.03, 0.2), { p: [0, STRIP.y - 0.05, STRIP.z - 0.12] });
  // Side consoles
  for (const sx of [-1, 1]) {
    B.add(M.panel, new THREE.BoxGeometry(0.34, 0.06, 0.9), { p: [sx * 0.6, 0.7, -0.2] });
    B.add(M.light, new THREE.BoxGeometry(0.34, 0.66, 0.9), { p: [sx * 0.6, 0.34, -0.2] });
    B.add(M.trim, new THREE.BoxGeometry(0.012, 0.012, 0.9), { p: [sx * 0.43, 0.733, -0.2] });
    // slots for the levers
    B.add(M.black, new THREE.BoxGeometry(0.05, 0.012, 0.22), { p: [sx * 0.52, 0.735, -0.2] });
    // small knobs and switches on the side consoles
    for (let i = 0; i < 4; i++) {
      B.add(M.trim, new THREE.CylinderGeometry(0.012, 0.014, 0.022, 14), { p: [sx * 0.68, 0.742, -0.5 + i * 0.07] });
      B.add(M.black, new THREE.BoxGeometry(0.03, 0.006, 0.03), { p: [sx * 0.7 - 0.06 * sx, 0.735, -0.5 + i * 0.07] });
    }
    // Rudder pedals
    B.add(M.trim, new THREE.BoxGeometry(0.1, 0.22, 0.03), { p: [sx * 0.16, 0.14, -0.7], r: [-0.5, 0, 0] });
    B.add(M.black, new THREE.BoxGeometry(0.11, 0.2, 0.01), { p: [sx * 0.16, 0.145, -0.68], r: [-0.5, 0, 0] });
  }
  // Panel bezels for the five screens
  const SCREEN_X = [-0.5, -0.255, 0, 0.255, 0.5];
  const SCREEN_W = [0.21, 0.21, 0.26, 0.21, 0.21];
  const SCREEN_H = 0.165;
  const panelQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(PANEL.tilt, 0, 0));
  const panelN = new THREE.Vector3(0, 0, 1).applyQuaternion(panelQuat);
  const screenPos = (x) => new THREE.Vector3(x, PANEL.y + 0.02, PANEL.z).addScaledVector(panelN, 0.031);
  SCREEN_X.forEach((x, i) => {
    const p = screenPos(x).addScaledVector(panelN, -0.008);
    B.add(M.frame, new THREE.BoxGeometry(SCREEN_W[i] + 0.03, SCREEN_H + 0.03, 0.02), { p: [p.x, p.y, p.z], r: [PANEL.tilt, 0, 0] });
    // bezel softkeys
    for (let k = 0; k < 4; k++) {
      const q = screenPos(x + (k - 1.5) * (SCREEN_W[i] / 4)).addScaledVector(panelN, -0.004);
      q.y -= (SCREEN_H / 2 + 0.03) * Math.cos(PANEL.tilt);
      q.z += (SCREEN_H / 2 + 0.03) * Math.sin(-PANEL.tilt);
      B.add(M.black, new THREE.BoxGeometry(0.03, 0.014, 0.012), { p: [q.x, q.y, q.z], r: [PANEL.tilt, 0, 0] });
    }
  });

  // ── Overhead switch panel ──
  const OVH = { y: 1.87, z: -0.05, tilt: 0.42 };
  B.add(M.panel, new THREE.BoxGeometry(0.72, 0.04, 0.42), { p: [0, OVH.y, OVH.z], r: [OVH.tilt, 0, 0] });
  B.add(M.trim, new THREE.BoxGeometry(0.74, 0.01, 0.01), { p: [0, OVH.y - 0.02, OVH.z - 0.2] });
  const toggles = [];
  {
    const qO = new THREE.Quaternion().setFromEuler(new THREE.Euler(OVH.tilt, 0, 0));
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 9; c++) {
        if (r === 2 && c === 4) continue; // cabin light switch is interactive
        const local = new THREE.Vector3(-0.3 + c * 0.075, -0.024, -0.13 + r * 0.11).applyQuaternion(qO);
        toggles.push(local.add(new THREE.Vector3(0, OVH.y, OVH.z)));
      }
  }
  // instanced toggle switches (bat handles) + guard bases
  const toggleGeo = new THREE.CylinderGeometry(0.004, 0.006, 0.03, 8).translate(0, -0.015, 0);
  const baseGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.006, 12);
  const tInst = new THREE.InstancedMesh(toggleGeo, M.trim, toggles.length);
  const bInst = new THREE.InstancedMesh(baseGeo, M.black, toggles.length);
  const m4 = new THREE.Matrix4();
  toggles.forEach((p, i) => {
    const flip = (i * 7) % 3 === 0 ? 0.35 : -0.35;
    m4.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(OVH.tilt + flip, 0, 0)), new THREE.Vector3(1, 1, 1));
    tInst.setMatrixAt(i, m4);
    m4.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(OVH.tilt, 0, 0)), new THREE.Vector3(1, 1, 1));
    bInst.setMatrixAt(i, m4);
  });
  group.add(tInst, bInst);
  // overhead annunciator strip (emissive tiles)
  const annTex = labelTexture(["FUEL CELL 1  ·  FUEL CELL 2  ·  O₂  ·  N₂  ·  COOLANT  ·  RCS  ·  GEAR  ·  APU"], { w: 1024, h: 64, bg: "#0b0d10", fg: "#9fe3b8", size: 26 });
  const ann = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.04), new THREE.MeshBasicMaterial({ map: annTex, toneMapped: false }));
  ann.position.set(0, OVH.y - 0.024, OVH.z - 0.165).add(new THREE.Vector3(0, 0, 0));
  ann.rotation.x = Math.PI / 2 + OVH.tilt;
  ann.position.copy(new THREE.Vector3(0, -0.023, -0.17).applyEuler(new THREE.Euler(OVH.tilt, 0, 0)).add(new THREE.Vector3(0, OVH.y, OVH.z)));
  group.add(ann);

  // ── Pilot seat ──
  {
    B.add(M.frame, new THREE.BoxGeometry(0.36, 0.3, 0.34), { p: [0, 0.15, 0.1] });
    B.add(M.trim, new THREE.BoxGeometry(0.04, 0.04, 0.6), { p: [-0.15, 0.03, 0.05] });
    B.add(M.trim, new THREE.BoxGeometry(0.04, 0.04, 0.6), { p: [0.15, 0.03, 0.05] });
    // cushion + back + headrest, leather side bolsters
    B.add(M.seat, new THREE.BoxGeometry(0.5, 0.12, 0.48), { p: [0, 0.38, -0.02], r: [0.06, 0, 0] });
    B.add(M.seat, new THREE.BoxGeometry(0.5, 0.6, 0.12), { p: [0, 0.74, 0.32], r: [-0.18, 0, 0] });
    for (const sx of [-1, 1]) {
      B.add(M.leather, new THREE.BoxGeometry(0.07, 0.16, 0.48), { p: [sx * 0.27, 0.42, -0.02], r: [0.06, 0, 0] });
      B.add(M.leather, new THREE.BoxGeometry(0.08, 0.58, 0.16), { p: [sx * 0.27, 0.75, 0.33], r: [-0.18, 0, 0] });
      // armrests
      B.add(M.leather, new THREE.BoxGeometry(0.07, 0.05, 0.36), { p: [sx * 0.32, 0.66, 0.02] });
      B.add(M.trim, new THREE.BoxGeometry(0.03, 0.22, 0.03), { p: [sx * 0.32, 0.54, 0.14] });
      // harness straps
      B.add(M.strap, new THREE.BoxGeometry(0.045, 0.42, 0.01), { p: [sx * 0.11, 0.8, 0.255], r: [-0.18, 0, -sx * 0.12] });
    }
    B.add(M.trim, new THREE.CylinderGeometry(0.035, 0.035, 0.015, 20).rotateX(Math.PI / 2), { p: [0, 0.68, 0.2] });
  }

  // ── Screens (live canvases; drawn by displays.js) ──
  const screens = SCREEN_X.map((x, i) => {
    const w = SCREEN_W[i];
    const c = document.createElement("canvas");
    c.width = Math.round(512 * (w / 0.21));
    c.height = 400;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, SCREEN_H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    m.position.copy(screenPos(x));
    m.quaternion.copy(panelQuat);
    group.add(m);
    return { canvas: c, ctx: c.getContext("2d"), tex, mesh: m };
  });

  // ── Mission buttons (poke) ──
  const stripQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(STRIP.tilt, 0, 0));
  const stripN = new THREE.Vector3(0, 0, 1).applyQuaternion(stripQuat);
  const BTN = [
    { id: "launch", label: "LAUNCH", color: "#ffb15a" },
    { id: "auto", label: ["AUTO", "PILOT"], color: "#6fd6ff" },
    { id: "manual", label: "MANUAL", color: "#ffe27a" },
    { id: "land", label: ["LAND", "DOCK"], color: "#7fffb0" },
    { id: "hatch", label: "HATCH", color: "#ff8a6a" },
    { id: "skip", label: "SKIP", sub: "hold", color: "#c8a2ff" },
  ];
  const capGeo = new THREE.BoxGeometry(0.05, 0.05, 0.016);
  const guardGeo = new THREE.BoxGeometry(0.062, 0.062, 0.01);
  const buttons = BTN.map((b, i) => {
    const x = -0.225 + i * 0.09;
    const base = new THREE.Vector3(x, STRIP.y, STRIP.z).addScaledVector(stripN, 0.026);
    const holder = new THREE.Group();
    holder.position.copy(base);
    holder.quaternion.copy(stripQuat);
    group.add(holder);
    const guard = new THREE.Mesh(guardGeo, M.frame);
    holder.add(guard);
    const tex = labelTexture(b.label, { w: 128, h: 128, bg: "#1a1d21", fg: "#eef2f5", size: Array.isArray(b.label) ? 30 : b.label.length > 5 ? 26 : 32, sub: b.sub ?? null });
    const capMat = [M.frame, M.frame, M.frame, M.frame, new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.1 }), M.frame];
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.z = 0.012;
    holder.add(cap);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.006, 0.004), new THREE.MeshBasicMaterial({ color: 0x222222, toneMapped: false }));
    led.position.set(0, 0.034, 0.008);
    holder.add(led);
    // Pick / poke volume
    const pick = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.05), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.z = 0.014;
    holder.add(pick);
    return { ...b, holder, cap, capMat: capMat[4], led, pick, ledColor: new THREE.Color(b.color), press: 0, on: false, blink: false, enabled: true };
  });

  // Cabin light switch on the overhead panel (poke)
  const cabinSwitch = (() => {
    const p = new THREE.Vector3(-0.3 + 4 * 0.075, -0.024, -0.13 + 2 * 0.11).applyEuler(new THREE.Euler(OVH.tilt, 0, 0)).add(new THREE.Vector3(0, OVH.y, OVH.z));
    const holder = new THREE.Group();
    holder.position.copy(p);
    holder.rotation.x = OVH.tilt;
    group.add(holder);
    const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.008, 0.036, 10).translate(0, -0.018, 0), M.glowWarm);
    holder.add(bat);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 16), M.trim);
    holder.add(ring);
    const pick = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.y = -0.02;
    holder.add(pick);
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.022), new THREE.MeshBasicMaterial({ map: labelTexture("CABIN LT", { w: 256, h: 80, size: 40, bg: "#101215" }), toneMapped: false }));
    tag.position.set(0, -0.0215, 0.035);
    tag.rotation.x = Math.PI / 2;
    holder.add(tag);
    return { holder, bat, pick };
  })();

  // ── Throttle (left console) and side-stick (right console) ──
  const throttle = (() => {
    const pivot = new THREE.Group();
    pivot.position.set(-0.52, 0.73, -0.2);
    group.add(pivot);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.15, 0.026).translate(0, 0.075, 0), M.trim);
    pivot.add(arm);
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.06, 6, 14).rotateZ(Math.PI / 2).translate(0.022, 0.16, 0), M.leather);
    pivot.add(grip);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.01, 10).translate(0.065, 0.17, 0).rotateZ(0), M.glowRed);
    pivot.add(btn);
    // detent scale beside the slot
    const scale = new THREE.Group();
    for (let i = 0; i <= 10; i++) {
      const a = (-35 + i * 7) * D2R;
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.003, i % 5 === 0 ? 0.008 : 0.004), i === 10 ? M.glowWarm : M.glowCyan);
      t.position.set(-0.035, 0.008 + Math.cos(a) * 0.03 - 0.03, -Math.sin(a) * 0.06);
      scale.add(t);
    }
    scale.position.copy(pivot.position);
    group.add(scale);
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    return { pivot, grip, proxy, value: 0, range: 35 * D2R, len: 0.16 };
  })();
  const stick = (() => {
    const pivot = new THREE.Group();
    pivot.position.set(0.52, 0.73, -0.18);
    group.add(pivot);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.045, 0.05, 16).translate(0, 0.02, 0), M.black);
    group.add(boot);
    boot.position.copy(pivot.position);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.1, 12).translate(0, 0.05, 0), M.trim);
    pivot.add(shaft);
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.07, 6, 14).translate(0, 0.14, 0.005), M.leather);
    handle.rotation.x = 0.12;
    pivot.add(handle);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 10).translate(0, 0.19, -0.01), M.black);
    pivot.add(hat);
    const trig = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.012).translate(0, 0.15, -0.03), M.glowRed);
    pivot.add(trig);
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    return { pivot, proxy, x: 0, y: 0, range: 22 * D2R, len: 0.15 };
  })();

  // ── Hatch door (hinged on the left of the opening) with a porthole ──
  const hatch = (() => {
    const hinge = new THREE.Group();
    hinge.position.set(-0.4, 0, 1.25);
    group.add(hinge);
    const s = new THREE.Shape();
    s.moveTo(0, 0.22);
    s.lineTo(0.8, 0.22);
    s.lineTo(0.8, 1.66);
    s.absarc(0.4, 1.66, 0.4, 0, Math.PI, false);
    s.lineTo(0, 0.22);
    const hole = new THREE.Path();
    hole.absarc(0.4, 1.45, 0.11, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const door = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2, curveSegments: 20 }), M.light);
    door.position.z = -0.03;
    hinge.add(door);
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.016, 8, 28), M.trim);
    ringM.position.set(0.4, 1.45, -0.04);
    hinge.add(ringM);
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), glass);
    win.position.set(0.4, 1.45, 0);
    hinge.add(win);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 20, Math.PI), M.trim);
    handle.position.set(0.68, 1.0, -0.05);
    handle.rotation.z = -Math.PI / 2;
    hinge.add(handle);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.04, 0.005), M.strap);
    stripe.position.set(0.4, 0.4, -0.045);
    hinge.add(stripe);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff4a3a, toneMapped: false }));
    lamp.position.set(0.9, 1.2, -0.01);
    group.add(lamp);
    lamp.position.set(0.5, 1.4, 1.24);
    return { hinge, lamp, open: 0, target: 0 };
  })();

  B.build(group, { shadows });

  // ── Cabin lights ──
  const cabin = new THREE.PointLight(0xffe4c4, 1.6, 4.5, 1.6);
  cabin.position.set(0, 1.86, 0.45);
  const foot = new THREE.PointLight(0x9fd8ff, 0.5, 2.2, 2);
  foot.position.set(0, 0.45, -0.55);
  const cargo = new THREE.PointLight(0xfff0dc, 1.4, 3.5, 2);
  cargo.position.set(0, 1.7, 2.2);
  group.add(cabin, foot, cargo);

  return { group, M, glass, screens, buttons, cabinSwitch, throttle, stick, hatch, lights: { cabin, foot, cargo }, labelTexture };
}
