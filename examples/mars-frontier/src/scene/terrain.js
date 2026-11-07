import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { createNoise2D, mulberry32, smoothstep } from "./noise.js";
import { surface } from "./surfaces.js";
import { FLAT_ZONES, PATHS, NAMED_CRATERS, MESA, SURVEY_SITES, OBSTACLES } from "../data/layout.js";

export const TERRAIN_RADIUS = 3200;

const nA = createNoise2D(11);
const nB = createNoise2D(23);
const nC = createNoise2D(37);
const nD = createNoise2D(51);
const nE = createNoise2D(77);

function fbm(noise, x, z, oct) {
  let a = 1;
  let f = 1;
  let s = 0;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    s += noise(x * f, z * f) * a;
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

function ridged(noise, x, z, oct) {
  let a = 1;
  let f = 1;
  let s = 0;
  let n = 0;
  let prev = 1;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(noise(x * f, z * f));
    v *= v;
    s += v * a * prev;
    prev = v;
    n += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / n;
}

// ── Crater field ─────────────────────────────────────────────
const CRATERS = [...NAMED_CRATERS];
{
  const rand = mulberry32(2024);
  let tries = 0;
  while (CRATERS.length < 46 && tries < 2000) {
    tries++;
    const ang = rand() * Math.PI * 2;
    const dist = 150 + Math.pow(rand(), 0.8) * 1100;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const r = 5 + Math.pow(rand(), 2.6) * 55;
    if (FLAT_ZONES.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + f.blend + r * 1.6)) continue;
    if (distToPaths(x, z) < r * 1.5 + 6) continue;
    if (CRATERS.some((c) => Math.hypot(x - c.x, z - c.z) < (c.r + r) * 1.1)) continue;
    if (SURVEY_SITES.some((s) => Math.hypot(x - s.x, z - s.z) < r * 1.8 + 14)) continue;
    CRATERS.push({ x, z, r, depth: r * (0.16 + rand() * 0.08), rim: r * (0.05 + rand() * 0.05) });
  }
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function distToPaths(x, z) {
  let d = Infinity;
  for (const path of PATHS) {
    for (let i = 0; i < path.length - 1; i++) {
      d = Math.min(d, distToSegment(x, z, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]));
    }
  }
  return d;
}

function flatWeight(x, z) {
  let w = 0;
  for (const f of FLAT_ZONES) {
    const d = Math.hypot(x - f.x, z - f.z);
    w = Math.max(w, 1 - smoothstep(f.r, f.r + f.blend, d));
  }
  // Roads are graded gently too.
  const pd = distToPaths(x, z);
  w = Math.max(w, (1 - smoothstep(3, 14, pd)) * 0.8);
  return w;
}

function craterContribution(x, z) {
  let h = 0;
  let interior = 0;
  let ice = 0;
  let rimRock = 0;
  for (const c of CRATERS) {
    const dx = x - c.x;
    const dz = z - c.z;
    const d2 = dx * dx + dz * dz;
    const lim = c.r * 2.4;
    if (d2 > lim * lim) continue;
    // Real craters are not perfect circles: wobble the radius with angle.
    const ang = Math.atan2(dz, dx);
    const wob = 1 + nD(Math.cos(ang) * 1.3 + c.x * 0.01, Math.sin(ang) * 1.3 + c.z * 0.01) * 0.07;
    const dd = Math.sqrt(d2) / (c.r * wob);
    if (dd < 1) {
      // Flat-ish floor with steeper walls (power profile) for larger craters.
      const prof = c.r > 40 ? 1 - Math.pow(dd, 3.2) : 1 - dd * dd;
      h -= c.depth * prof;
      if (c.r > 80) h += c.depth * 0.42 * Math.exp(-((dd / 0.16) ** 2)); // central peak
      interior = Math.max(interior, 1 - dd);
      if (c.ice) ice = Math.max(ice, smoothstep(0.85, 0.35, dd));
    }
    const rimFall = (dd - 1) / (dd < 1 ? 0.2 : 0.45);
    const rim = Math.exp(-rimFall * rimFall);
    h += c.rim * rim;
    rimRock = Math.max(rimRock, rim * Math.min(1, c.r / 30));
    if (dd > 1 && dd < 2.4) {
      // Hummocky ejecta blanket decaying outward.
      h += c.rim * 0.35 * nC(x * 0.08, z * 0.08) * Math.max(0, 1 - (dd - 1) / 1.4);
    }
  }
  return { h, interior, ice, rimRock };
}

/** Derivative-damped fBm: slopes suppress detail, carving gully-like erosion patterns. */
function erodedFbm(x, z) {
  let a = 0.5;
  let s = 0;
  let gx = 0;
  let gz = 0;
  let px = x;
  let pz = z;
  const e = 0.01;
  for (let i = 0; i < 6; i++) {
    const n = nE(px, pz);
    const nx = (nE(px + e, pz) - n) / e;
    const nz = (nE(px, pz + e) - n) / e;
    gx += nx;
    gz += nz;
    s += (a * (n * 0.5 + 0.5)) / (1 + gx * gx + gz * gz);
    a *= 0.5;
    const tx = px * 1.6 - pz * 1.2;
    pz = px * 1.2 + pz * 1.6;
    px = tx;
  }
  return s;
}

function rawHeight(x, z) {
  const d = Math.hypot(x, z);
  let h = fbm(nA, x * 0.0016, z * 0.0016, 4) * 9;
  h += nB(x * 0.012 + 31, z * 0.012 - 17) * 1.4;
  h += nC(x * 0.05, z * 0.05) * 0.28;
  // Mesa / layered outcrop
  const md = Math.hypot(x - MESA.x, z - MESA.z) + nD(x * 0.05, z * 0.05) * 9;
  const mesa = smoothstep(MESA.r, MESA.r - 12, md);
  h += mesa * MESA.height + mesa * Math.round(nC(x * 0.02, z * 0.02) * 2) * 0.8;
  // Distant mountain ranges
  const m = smoothstep(700, 2000, d);
  if (m > 0) {
    const r = ridged(nE, x * 0.0009 + 4, z * 0.0009 - 2, 5);
    const er = erodedFbm(x * 0.0016 + 7, z * 0.0016 - 3);
    h += m * (r * 190 + er * 230 + fbm(nD, x * 0.004, z * 0.004, 3) * 22);
  }
  return h;
}

/** Ground height at (x, z). Shared by the terrain mesh, structures, rocks and the rover. */
export function heightAt(x, z) {
  const base = rawHeight(x, z) + craterContribution(x, z).h;
  const w = flatWeight(x, z);
  return base * (1 - w);
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 1.2;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}

const warp = (t) => Math.sign(t) * (0.14 * Math.abs(t) + 0.86 * Math.abs(t) ** 3);

// sRGB design colours → linear (THREE.Color converts automatically). Tuned to multiply with
// the photographic detail maps (average ratio 1.0).
const C = {
  dust: new THREE.Color("#b46a43"),
  ochre: new THREE.Color("#c4875a"),
  dark: new THREE.Color("#71402b"),
  basalt: new THREE.Color("#5a3626"),
  bright: new THREE.Color("#d2a079"),
  pad: new THREE.Color("#8d6c58"),
  ice: new THREE.Color("#eef3f6"),
  mountain: new THREE.Color("#a3603e"),
  band: new THREE.Color("#c59573"),
};
// Prevailing wind (towards ESE): dust streaks trail downwind of craters.
const WIND = { x: 0.95, z: 0.31 };

function windStreak(x, z) {
  let s = 0;
  for (const c of CRATERS) {
    if (c.r < 7) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const along = dx * WIND.x + dz * WIND.z;
    if (along < c.r * 0.6 || along > c.r * 14) continue;
    const perp = Math.abs(-dx * WIND.z + dz * WIND.x);
    const width = c.r * (0.75 + (along / (c.r * 14)) * 0.5);
    if (perp > width * 2.5) continue;
    s = Math.max(s, Math.exp(-((perp / width) ** 2)) * Math.exp(-along / (c.r * 6)));
  }
  return s;
}

export function buildTerrain(segments) {
  const N = segments;
  const R = TERRAIN_RADIUS;
  const count = (N + 1) * (N + 1);
  const pos = new Float32Array(count * 3);
  for (let j = 0; j <= N; j++) {
    const z = R * warp(-1 + (2 * j) / N);
    for (let i = 0; i <= N; i++) {
      const x = R * warp(-1 + (2 * i) / N);
      const k = j * (N + 1) + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = heightAt(x, z);
      pos[k * 3 + 2] = z;
    }
  }
  const index = new Uint32Array(N * N * 6);
  let o = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b = a + 1;
      const c = a + N + 1;
      const d = c + 1;
      index[o++] = a;
      index[o++] = c;
      index[o++] = b;
      index[o++] = b;
      index[o++] = c;
      index[o++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();

  const nrm = geo.attributes.normal.array;
  const col = new Float32Array(count * 3);
  const surf = new Float32Array(count * 2);
  const c = new THREE.Color();
  for (let k = 0; k < count; k++) {
    const x = pos[k * 3];
    const y = pos[k * 3 + 1];
    const z = pos[k * 3 + 2];
    const slope = 1 - nrm[k * 3 + 1];
    const d = Math.hypot(x, z);
    c.copy(C.dust).lerp(C.ochre, nA(x * 0.004, z * 0.004) * 0.5 + 0.5);
    c.lerp(C.basalt, smoothstep(0.3, 0.8, nB(x * 0.0025 + 9, z * 0.0025)) * 0.7);
    c.lerp(C.bright, smoothstep(0.4, 0.9, nC(x * 0.006 - 3, z * 0.006 + 5)) * 0.5);
    c.lerp(C.dark, smoothstep(0.35, 0.9, nD(x * 0.03 + 2, z * 0.03 - 7)) * 0.22);
    c.lerp(C.bright, smoothstep(0.5, 0.95, nA(x * 0.05 - 9, z * 0.05 + 3)) * 0.15);
    c.lerp(C.dark, smoothstep(0.08, 0.32, slope) * 0.6);
    const cr = craterContribution(x, z);
    c.lerp(C.dark, cr.interior * 0.3);
    c.lerp(C.bright, windStreak(x, z) * 0.55);
    const m = smoothstep(800, 1800, d);
    if (m > 0) {
      const band = Math.sin(y * 0.09 + nD(x * 0.003, z * 0.003) * 2) * 0.5 + 0.5;
      c.lerp(C.mountain, m * 0.35).lerp(C.band, m * band * 0.22);
    }
    const md = Math.hypot(x - MESA.x, z - MESA.z);
    const fw = flatWeight(x, z);
    c.lerp(C.pad, fw * 0.32);
    c.lerp(C.ice, cr.ice * 0.92);
    col[k * 3] = c.r;
    col[k * 3 + 1] = c.g;
    col[k * 3 + 2] = c.b;
    // Exposed rock: crater rims & walls, mesa, mountain flanks, scattered outcrops.
    const outcrop = smoothstep(0.62, 0.85, nB(x * 0.011 - 40, z * 0.011 + 12)) * 0.7;
    const mesaRock = smoothstep(MESA.r + 6, MESA.r - 4, md);
    let rock = Math.max(cr.rimRock * 0.85, cr.interior > 0.05 ? smoothstep(0.05, 0.25, slope) : 0, outcrop, mesaRock, m * 0.5);
    rock *= 1 - fw * 0.95;
    rock *= 1 - cr.ice;
    surf[k * 2] = rock;
    surf[k * 2 + 1] = 0;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aSurf", new THREE.BufferAttribute(surf, 2));
  geo.computeBoundingSphere();
  return geo;
}

function rockGeometry(seed, detail, kind) {
  let g = kind === "angular" ? new THREE.DodecahedronGeometry(1, Math.max(0, detail - 1)) : new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  const n = createNoise2D(seed);
  const n2 = createNoise2D(seed + 1);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + n(v.x * 1.4 + v.z, v.y * 1.4 - v.z) * 0.28 + n2(v.x * 4 + v.y, v.z * 4) * 0.07;
    v.multiplyScalar(k);
    v.y *= kind === "slab" ? 0.38 : 0.66;
    if (v.y < -0.12) v.y = -0.12 + (v.y + 0.12) * 0.25; // flattened, embedded base
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function rimAffinity(x, z) {
  let a = 0;
  for (const c of CRATERS) {
    const dd = Math.hypot(x - c.x, z - c.z) / c.r;
    if (dd > 0.7 && dd < 2.4) a += Math.min(1, c.r / 25) * Math.exp(-(((dd - 1.2) / 0.45) ** 2));
  }
  return Math.min(1.5, a);
}

export function buildRocks(count, castShadow, material, detail = 1) {
  const group = new THREE.Group();
  const rand = mulberry32(99);
  const variants = [
    rockGeometry(3, detail, "round"),
    rockGeometry(8, detail, "round"),
    rockGeometry(15, detail, "angular"),
    rockGeometry(21, detail, "slab"),
    rockGeometry(34, detail, "angular"),
  ];
  const per = Math.ceil(count / variants.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const t = new THREE.Vector3();
  const col = new THREE.Color();
  const base = [new THREE.Color("#8a5a42"), new THREE.Color("#6e4636"), new THREE.Color("#9c6b4f"), new THREE.Color("#5b3f33")];
  for (const geo of variants) {
    const mesh = new THREE.InstancedMesh(geo, material, per);
    let placed = 0;
    let guard = 0;
    while (placed < per && guard < per * 30) {
      guard++;
      const ang = rand() * Math.PI * 2;
      const dist = 16 + Math.pow(rand(), 1.3) * 640;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      if (distToPaths(x, z) < 6) continue;
      if (OBSTACLES.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 4)) continue;
      if (FLAT_ZONES.some((f) => Math.hypot(x - f.x, z - f.z) < f.r * 0.75) && rand() > 0.3) continue;
      // Ejecta blocks cluster on crater rims; elsewhere follow a patchy noise field.
      const clump = (nE(x * 0.01, z * 0.01) * 0.5 + 0.5) * 0.8 + rimAffinity(x, z);
      if (rand() > clump) continue;
      const big = rand() < 0.035;
      const sc = big ? 1.1 + rand() * 1.9 : 0.1 + Math.pow(rand(), 2.4) * 0.85;
      s.set(sc * (0.8 + rand() * 0.5), sc * (0.7 + rand() * 0.6), sc * (0.8 + rand() * 0.5));
      t.set(x, heightAt(x, z) - sc * 0.14, z);
      q.setFromEuler(e.set((rand() - 0.5) * 0.5, rand() * Math.PI * 2, (rand() - 0.5) * 0.5));
      m4.compose(t, q, s);
      mesh.setMatrixAt(placed, m4);
      col.copy(base[Math.floor(rand() * base.length)]).multiplyScalar(0.85 + rand() * 0.3);
      mesh.setColorAt(placed, col);
      placed++;
    }
    mesh.count = placed;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

/** Compacted-regolith roads that follow the ground. */
export function buildPaths() {
  const mat = surface({
    kind: "sintered",
    color: "#86563d",
    roughness: 0.95,
    scale: 0.22,
    mix: 0.7,
    bump: 0.8,
    dustTop: 0.25,
    dustBase: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const group = new THREE.Group();
  for (const path of PATHS) {
    const pts = [];
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i];
      const [bx, bz] = path[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.ceil(len / 2);
      for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    pts.push(path[path.length - 1]);
    const W = 1.8;
    const pos = [];
    const idx = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      const [nx, nz] = pts[Math.min(i + 1, pts.length - 1)];
      const [px, pz] = pts[Math.max(i - 1, 0)];
      let dx = nx - px;
      let dz = nz - pz;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const ox = -dz * W;
      const oz = dx * W;
      pos.push(x + ox, heightAt(x + ox, z + oz) + 0.05, z + oz, x - ox, heightAt(x - ox, z - oz) + 0.05, z - oz);
      if (i < pts.length - 1) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
