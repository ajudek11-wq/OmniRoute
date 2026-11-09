import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Panel } from "../../xr/panel.js";

/**
 * Shared building blocks for the walkable Mars interiors in VR: a merge-by-material geometry kit,
 * shells with real openings, interior materials, sliding doors, push buttons, info cards and sounds.
 * Everything here is VR-only: the groups are hidden on desktop and on phones.
 */

// ── Interior lighting ─────────────────────────────────────────
// Interiors take the sun only where the shadow map lets it in (through windows and doors). Without
// shadow maps (low tier) the sun would light floors through solid roofs, so it is scaled right down.
export const SUN_K = { value: 1 };

function patchSun(mat) {
  if (mat.userData.sunK) return mat;
  mat.userData.sunK = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey?.() ?? "";
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uSunK = SUN_K;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uSunK;")
      .replace(
        "#include <lights_fragment_begin>",
        THREE.ShaderChunk.lights_fragment_begin.replace(
          "getDirectionalLightInfo( directionalLight, directLight );",
          "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= uSunK;"
        )
      );
  };
  mat.customProgramCacheKey = () => `sunk|${prevKey}`;
  return mat;
}

/** Interior surface: PBR with a soft "artificial light" fill so rooms read lit at night. */
export function imat(color, { rough = 0.75, metal = 0.05, fill = 0.22, side = THREE.FrontSide, emissive = null, ei = 1, map = null } = {}) {
  const c = new THREE.Color(color);
  const m = new THREE.MeshStandardMaterial({
    color: c,
    roughness: rough,
    metalness: metal,
    side,
    map,
    emissive: emissive ? new THREE.Color(emissive) : c.clone().multiplyScalar(fill),
    emissiveIntensity: emissive ? ei : 1,
    fog: false,
  });
  return patchSun(m);
}

export function glowMat(color, intensity = 1) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: false, fog: false });
}

export function glassMat(tint = "#bcd6e6", opacity = 0.1) {
  return new THREE.MeshStandardMaterial({ color: tint, roughness: 0.04, metalness: 0, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false });
}

/** A small set of interior materials shared by all Mars interiors (one program each). */
let MATS = null;
export function mats() {
  if (MATS) return MATS;
  const canvasTex = (draw, w = 256, h = 256, rep = [1, 1]) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep[0], rep[1]);
    t.anisotropy = 4;
    return t;
  };
  // Wall panels: soft-white quilted liner with seams and fasteners.
  const panelTex = canvasTex((g, w, h) => {
    g.fillStyle = "#d9d6cf";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.025})`;
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
    g.strokeStyle = "rgba(60,60,60,0.35)";
    g.lineWidth = 3;
    g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = "rgba(40,40,40,0.4)";
    for (const [x, y] of [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]]) g.fillRect(x - 3, y - 3, 6, 6);
  });
  const floorTex = canvasTex((g, w, h) => {
    g.fillStyle = "#4b4d50";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) {
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(x + 2, y + 2, 6, 3);
    }
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
  });
  MATS = {
    liner: imat("#e8e4dc", { rough: 0.85, side: THREE.BackSide, map: panelTex, fill: 0.25 }),
    linerFront: imat("#e8e4dc", { rough: 0.85, map: panelTex, fill: 0.25 }),
    wall: imat("#d7d3cb", { rough: 0.8, fill: 0.24 }),
    trim: imat("#7f8790", { rough: 0.45, metal: 0.6, fill: 0.12 }),
    dark: imat("#2b2f35", { rough: 0.5, metal: 0.4, fill: 0.1 }),
    floor: imat("#9a9c9e", { rough: 0.9, map: floorTex, fill: 0.15 }),
    rubber: imat("#25272a", { rough: 0.95, fill: 0.08 }),
    fabric: imat("#41607e", { rough: 1, fill: 0.2 }),
    fabricWarm: imat("#9a5b3c", { rough: 1, fill: 0.2 }),
    wood: imat("#8a6a4a", { rough: 0.7, fill: 0.2 }),
    orange: imat("#cf5c27", { rough: 0.55, fill: 0.18 }),
    yellow: imat("#d9a92c", { rough: 0.55, fill: 0.18 }),
    white: imat("#f1efe9", { rough: 0.5, fill: 0.22 }),
    ceiling: imat("#ecebe6", { rough: 0.7, fill: 0.3, side: THREE.BackSide }),
    steel: imat("#aab0b6", { rough: 0.3, metal: 0.85, fill: 0.08 }),
    red: imat("#b5332a", { rough: 0.5, fill: 0.2 }),
    green: imat("#4f8a3c", { rough: 0.8, fill: 0.15 }),
    rock: imat("#7d5a45", { rough: 0.95, fill: 0.08, side: THREE.BackSide }),
    rockFront: imat("#7d5a45", { rough: 0.95, fill: 0.08 }),
    lamp: glowMat("#fff1dc", 1.0),
    lampCool: glowMat("#d8ecff", 1.0),
    pink: glowMat("#ff5ad0", 1.0),
    screen: glowMat("#1a3a52", 1.0),
    greenLed: glowMat("#5ce08a", 1.2),
    redLed: glowMat("#ff4a3a", 1.2),
    glass: glassMat(),
    glassOut: new THREE.MeshStandardMaterial({ color: "#0d1418", roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.82, fog: true }),
    pick: new THREE.MeshBasicMaterial({ visible: false }),
  };
  return MATS;
}

// ── Merge-by-material kit ─────────────────────────────────────
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

function normalise(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

export class Kit {
  constructor() {
    this.buckets = new Map();
  }
  add(geo, mat, matrix = null) {
    const g = normalise(geo);
    if (matrix) g.applyMatrix4(matrix);
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(g);
    geo.dispose();
    return this;
  }
  /** Add with position + Euler rotation (YXZ order: yaw first). */
  put(geo, mat, x, y, z, ry = 0, rx = 0, rz = 0) {
    _e.set(rx, ry, rz, "YXZ");
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s);
    return this.add(geo, mat, _m);
  }
  box(mat, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) {
    return this.put(new THREE.BoxGeometry(w, h, d), mat, x, y, z, ry, rx, rz);
  }
  cyl(mat, r1, r2, h, seg, x, y, z, ry = 0, rx = 0, rz = 0, open = false) {
    return this.put(new THREE.CylinderGeometry(r1, r2, h, seg, 1, open), mat, x, y, z, ry, rx, rz);
  }
  /** Cylinder between two points. */
  rod(mat, a, b, r, seg = 8) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    _m.compose(_p.copy(a).add(b).multiplyScalar(0.5), _q, _s);
    return this.add(g, mat, _m);
  }
  /** Horizontal rectangle (floor / ceiling) centred at x,z, facing up (or down). */
  plane(mat, w, d, x, y, z, ry = 0, down = false) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
    return this.put(g, mat, x, y, z, ry);
  }
  /** Vertical wall segment from (ax,az) to (bx,bz), from y0 to y1, with optional rectangular holes [{u0,u1,v0,v1}] (u along, v height). */
  wall(mat, ax, az, bx, bz, y0, y1, holes = [], thick = 0.08) {
    const len = Math.hypot(bx - ax, bz - az);
    const ry = Math.atan2(bx - ax, bz - az) - Math.PI / 2;
    const us = [0, len];
    const vs = [y0, y1];
    for (const h of holes) {
      us.push(h.u0, h.u1);
      vs.push(h.v0, h.v1);
    }
    const U = [...new Set(us.map((u) => Math.max(0, Math.min(len, u))))].sort((a, b) => a - b);
    const Vv = [...new Set(vs.map((v) => Math.max(y0, Math.min(y1, v))))].sort((a, b) => a - b);
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    for (let i = 0; i < U.length - 1; i++) {
      for (let j = 0; j < Vv.length - 1; j++) {
        const cu = (U[i] + U[i + 1]) / 2;
        const cv = (Vv[j] + Vv[j + 1]) / 2;
        if (holes.some((h) => cu > h.u0 && cu < h.u1 && cv > h.v0 && cv < h.v1)) continue;
        const w = U[i + 1] - U[i];
        const hh = Vv[j + 1] - Vv[j];
        if (w < 1e-3 || hh < 1e-3) continue;
        this.box(mat, w, hh, thick, ax + ux * cu, cv, az + uz * cu, ry);
      }
    }
    return this;
  }
  build(parent, { cast = false, receive = true } = {}) {
    const out = [];
    for (const [mat, geos] of this.buckets) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}

/**
 * Tube shell (part of a cylinder) with rectangular holes, as one BufferGeometry.
 * Axis from `origin` along unit `axis`; angle θ measured from `ref` toward `side` (= axis × ref by default).
 * holes: [{ t0, t1, a0, a1 }] in metres along the axis and radians. Normals face outward; use a
 * BackSide material to see it from inside.
 */
export function tubeShell({ origin, axis, ref, side = null, radius, t0, t1, a0 = 0, a1 = Math.PI * 2, segs = 48, holes = [], tSteps = 1 }) {
  const ax = axis.clone().normalize();
  const u = ref.clone().normalize();
  const v = side ? side.clone().normalize() : new THREE.Vector3().crossVectors(ax, u).normalize();
  const as = [];
  for (let i = 0; i <= segs; i++) as.push(a0 + ((a1 - a0) * i) / segs);
  const ts = [];
  for (let i = 0; i <= tSteps; i++) ts.push(t0 + ((t1 - t0) * i) / tSteps);
  for (const h of holes) {
    as.push(h.a0, h.a1);
    ts.push(h.t0, h.t1);
  }
  const A = [...new Set(as.filter((a) => a >= a0 - 1e-6 && a <= a1 + 1e-6).map((a) => +a.toFixed(6)))].sort((p, q) => p - q);
  const T = [...new Set(ts.filter((t) => t >= t0 - 1e-6 && t <= t1 + 1e-6).map((t) => +t.toFixed(6)))].sort((p, q) => p - q);
  const pos = [];
  const nor = [];
  const uv = [];
  const pt = (a, t) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const n = new THREE.Vector3().addScaledVector(u, c).addScaledVector(v, s);
    const p = origin.clone().addScaledVector(ax, t).addScaledVector(n, radius);
    return { p, n, uv: [a * radius, t] };
  };
  const inHole = (a, t) => holes.some((h) => a > h.a0 && a < h.a1 && t > h.t0 && t < h.t1);
  for (let i = 0; i < A.length - 1; i++) {
    for (let j = 0; j < T.length - 1; j++) {
      if (inHole((A[i] + A[i + 1]) / 2, (T[j] + T[j + 1]) / 2)) continue;
      const p00 = pt(A[i], T[j]);
      const p10 = pt(A[i + 1], T[j]);
      const p01 = pt(A[i], T[j + 1]);
      const p11 = pt(A[i + 1], T[j + 1]);
      // Winding so the face normal points outward (n): (p10-p00) × (p01-p00) ∝ v-direction × axis.
      const e1 = p10.p.clone().sub(p00.p);
      const e2 = p01.p.clone().sub(p00.p);
      const flip = new THREE.Vector3().crossVectors(e1, e2).dot(p00.n) < 0;
      const tri = flip ? [p00, p01, p10, p10, p01, p11] : [p00, p10, p01, p10, p11, p01];
      for (const q of tri) {
        pos.push(q.p.x, q.p.y, q.p.z);
        nor.push(q.n.x, q.n.y, q.n.z);
        uv.push(q.uv[0] / 1.6, q.uv[1] / 1.6);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Bearing (radians from +z toward +x) and back. */
export const bearing = (x, z) => Math.atan2(x, z);
export const atBearing = (a, r) => ({ x: Math.sin(a) * r, z: Math.cos(a) * r });

/** Collider circles along a segment. */
export function lineCircles(ax, az, bx, bz, r = 0.16, step = 0.28) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(len / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push({ x: ax + ((bx - ax) * i) / n, z: az + ((bz - az) * i) / n, r });
  return out;
}

/** Collider circles along an arc of radius R about (cx,cz), skipping bearing gaps [[a0,a1]]. */
export function arcCircles(cx, cz, R, gaps = [], r = 0.2, step = 0.3) {
  const n = Math.ceil((Math.PI * 2 * R) / step);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI;
    if (gaps.some(([g0, g1]) => angIn(a, g0, g1))) continue;
    out.push({ x: cx + Math.sin(a) * R, z: cz + Math.cos(a) * R, r });
  }
  return out;
}

export function angIn(a, a0, a1) {
  const w = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  const d = w(a - a0);
  const span = w(a1 - a0) < 0 ? w(a1 - a0) + Math.PI * 2 : w(a1 - a0);
  return (d >= 0 ? d : d + Math.PI * 2) <= span;
}

// ── Sound ─────────────────────────────────────────────────────
/** Pneumatic hiss + motor whirr for doors; a longer hiss for an airlock cycle. Cabin sounds only. */
export function hiss(audio, dur = 0.9, gain = 0.08, f0 = 2400, f1 = 900) {
  if (!audio?.enabled || !audio.ctx || !audio.noiseBuf) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 0.9;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(audio.master);
  src.start(t);
  src.stop(t + dur + 0.1);
}
export function doorSound(audio) {
  hiss(audio, 0.7, 0.06);
  audio?.tone?.(92, 0.6, "sawtooth", 0.018);
  audio?.tone?.(138, 0.5, "triangle", 0.012, 0.05);
  audio?.tone?.(520, 0.06, "sine", 0.03, 0.62);
}

// ── Info card (one shared, appears beside what you inspect) ───
export function createInfoCard() {
  const panel = new Panel({ width: 0.62, height: 0.4, ppm: 1100, opacity: 0.94 });
  panel.mesh.visible = false;
  panel.mesh.renderOrder = 20;
  let anchor = null;
  return {
    mesh: panel.mesh,
    panel,
    get anchor() {
      return anchor;
    },
    show(pos, head, { title, eyebrow = "", lines = [], tag = null }) {
      panel.setContent({ eyebrow, title, titleSize: 54, lines, lineSize: 30, tag });
      panel.mesh.position.copy(pos);
      panel.mesh.lookAt(head.x, pos.y, head.z);
      panel.mesh.visible = true;
      anchor = pos.clone();
    },
    hide() {
      panel.mesh.visible = false;
      anchor = null;
    },
    update(head) {
      if (anchor && head.distanceTo(anchor) > 4.5) this.hide();
    },
  };
}

/** Wrap long text into lines of about n characters (the panel does not wrap). */
export function wrap(text, n = 46) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      if ((line + " " + w).trim().length > n) {
        out.push(line.trim());
        line = w;
      } else line += " " + w;
    }
    if (line.trim()) out.push(line.trim());
  }
  return out;
}

/** A canvas sign (static text), e.g. room names and hazard labels. */
export function sign(text, { w = 0.9, h = 0.22, bg = "#1d2228", fg = "#f2efe8", size = 0.6, sub = "" } = {}) {
  const ppm = 600;
  const c = document.createElement("canvas");
  c.width = Math.round(w * ppm);
  c.height = Math.round(h * ppm);
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 4;
  g.strokeRect(6, 6, c.width - 12, c.height - 12);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const px = Math.round(c.height * (sub ? 0.42 : 0.55) * size * 1.4);
  g.font = `600 ${px}px system-ui, sans-serif`;
  g.fillText(text, c.width / 2, c.height * (sub ? 0.4 : 0.52));
  if (sub) {
    g.font = `400 ${Math.round(px * 0.5)}px system-ui, sans-serif`;
    g.globalAlpha = 0.8;
    g.fillText(sub, c.width / 2, c.height * 0.76);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, toneMapped: false, fog: false }));
  return m;
}

// ── Push button (poke with a fingertip, or point + trigger) ───
const BTN_GEO = new THREE.CylinderGeometry(0.035, 0.035, 0.025, 20).rotateX(Math.PI / 2);
const BTN_PICK = new THREE.BoxGeometry(0.2, 0.2, 0.08);
export function button({ label, color = "#5ce08a", onPress, enabled = null }) {
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, fog: false });
  const btn = new THREE.Mesh(BTN_GEO, mat);
  const pick = new THREE.Mesh(BTN_PICK, mats().pick);
  btn.add(pick);
  const base = new THREE.Color(color);
  let cool = 0;
  const fire = () => {
    if (cool > 0) return;
    cool = 0.5;
    btn.position.z -= 0.012;
    setTimeout(() => (btn.position.z += 0.012), 160);
    onPress();
  };
  const it = {
    object: btn,
    label,
    poke: true,
    pokeRadius: 0.06,
    onPoke: fire,
    onSelect: fire,
    onHover: (on) => mat.color.copy(base).multiplyScalar(on ? 1.6 : 1),
  };
  if (enabled) it.enabled = enabled;
  return {
    mesh: btn,
    it,
    mat,
    setColor(c) {
      base.set(c);
      mat.color.copy(base);
    },
    tick(dt) {
      cool -= dt;
    },
  };
}

// ── Sliding door (two leaves part sideways) ───────────────────
/**
 * A door in local space: opening w × h with the sill at y = 0, passage along local z.
 * Returns { group, state, open(), close(), update(dt), isOpen }.
 */
export function slidingDoor({ w = 1.2, h = 2.1, depth = 0.12, leafMat, frameMat, audio = null, round = false }) {
  const g = new THREE.Group();
  const M = mats();
  const fm = frameMat ?? M.trim;
  const lm = leafMat ?? M.white;
  const kit = new Kit();
  const f = 0.12;
  kit.box(fm, f, h + f, depth + 0.08, -w / 2 - f / 2, (h + f) / 2, 0);
  kit.box(fm, f, h + f, depth + 0.08, w / 2 + f / 2, (h + f) / 2, 0);
  kit.box(fm, w + 2 * f, f, depth + 0.08, 0, h + f / 2, 0);
  kit.box(M.yellow, w, 0.04, depth + 0.1, 0, 0.02, 0);
  kit.build(g);
  const leaves = [];
  for (const s of [-1, 1]) {
    const leaf = new THREE.Group();
    const k2 = new Kit();
    k2.box(lm, w / 2, h, depth * 0.6, 0, h / 2, 0);
    k2.box(M.dark, 0.04, h * 0.9, depth * 0.62, (-s * w) / 4 + s * 0.02, h / 2, 0);
    k2.box(M.yellow, w / 2, 0.06, depth * 0.64, 0, h * 0.52, 0);
    if (round) k2.box(M.glass, w * 0.22, h * 0.18, depth * 0.7, 0, h * 0.72, 0);
    k2.build(leaf);
    leaf.position.x = (s * w) / 4;
    leaf.userData.s = s;
    g.add(leaf);
    leaves.push(leaf);
  }
  const state = { open: 0, target: 0 };
  return {
    group: g,
    state,
    get isOpen() {
      return state.open > 0.85;
    },
    get isClosed() {
      return state.open < 0.02 && state.target === 0;
    },
    open() {
      if (state.target === 1) return;
      state.target = 1;
      doorSound(audio);
    },
    close() {
      if (state.target === 0) return;
      state.target = 0;
      doorSound(audio);
    },
    update(dt) {
      const d = state.target - state.open;
      state.open += Math.sign(d) * Math.min(Math.abs(d), dt * 1.25);
      const e = state.open * state.open * (3 - 2 * state.open);
      for (const leaf of leaves) leaf.position.x = leaf.userData.s * (w / 4 + e * (w / 2 - 0.04));
    },
  };
}
