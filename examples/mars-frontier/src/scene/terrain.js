import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { createNoise2D, mulberry32, smoothstep } from "./noise.js";
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
  for (const c of CRATERS) {
    const dx = x - c.x;
    const dz = z - c.z;
    const d2 = dx * dx + dz * dz;
    const lim = c.r * 2.4;
    if (d2 > lim * lim) continue;
    const dd = Math.sqrt(d2) / c.r;
    if (dd < 1) {
      h -= c.depth * (1 - dd * dd);
      interior = Math.max(interior, 1 - dd);
      if (c.ice) ice = Math.max(ice, smoothstep(0.85, 0.35, dd));
    }
    const rimFall = (dd - 1) / (dd < 1 ? 0.22 : 0.45);
    h += c.rim * Math.exp(-rimFall * rimFall);
  }
  return { h, interior, ice };
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
    h += m * (ridged(nE, x * 0.0009 + 4, z * 0.0009 - 2, 5) * 300 + fbm(nD, x * 0.004, z * 0.004, 3) * 26);
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

// sRGB design colours → linear (THREE.Color converts automatically).
const C = {
  dust: new THREE.Color("#b5653d"),
  ochre: new THREE.Color("#c78450"),
  dark: new THREE.Color("#6a3824"),
  basalt: new THREE.Color("#4a2b20"),
  bright: new THREE.Color("#d9a477"),
  pad: new THREE.Color("#8e6a55"),
  ice: new THREE.Color("#e6eef3"),
  mountain: new THREE.Color("#9a5636"),
  band: new THREE.Color("#c99168"),
};

export function buildTerrain(segments) {
  const N = segments;
  const R = TERRAIN_RADIUS;
  const count = (N + 1) * (N + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  for (let j = 0; j <= N; j++) {
    const z = R * warp(-1 + (2 * j) / N);
    for (let i = 0; i <= N; i++) {
      const x = R * warp(-1 + (2 * i) / N);
      const k = j * (N + 1) + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = heightAt(x, z);
      pos[k * 3 + 2] = z;
      uv[k * 2] = x / 5;
      uv[k * 2 + 1] = z / 5;
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
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();

  const nrm = geo.attributes.normal.array;
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < count; k++) {
    const x = pos[k * 3];
    const y = pos[k * 3 + 1];
    const z = pos[k * 3 + 2];
    const slope = 1 - nrm[k * 3 + 1];
    const d = Math.hypot(x, z);
    c.copy(C.dust).lerp(C.ochre, nA(x * 0.004, z * 0.004) * 0.5 + 0.5);
    c.lerp(C.basalt, smoothstep(0.35, 0.8, nB(x * 0.0025 + 9, z * 0.0025)) * 0.65);
    c.lerp(C.bright, smoothstep(0.45, 0.9, nC(x * 0.006 - 3, z * 0.006 + 5)) * 0.45);
    c.lerp(C.dark, smoothstep(0.06, 0.3, slope) * 0.8);
    const cr = craterContribution(x, z);
    c.lerp(C.dark, cr.interior * 0.35);
    // Mountains: layered banding
    const m = smoothstep(800, 1800, d);
    if (m > 0) {
      const band = Math.sin(y * 0.09 + nD(x * 0.003, z * 0.003) * 2) * 0.5 + 0.5;
      c.lerp(C.mountain, m * 0.4).lerp(C.band, m * band * 0.25);
    }
    const md = Math.hypot(x - MESA.x, z - MESA.z);
    if (md < MESA.r + 10) {
      const band = Math.sin(y * 1.6) * 0.5 + 0.5;
      c.lerp(C.band, smoothstep(MESA.r + 10, MESA.r - 10, md) * band * 0.5);
    }
    const fw = flatWeight(x, z);
    c.lerp(C.pad, fw * 0.38);
    c.lerp(C.ice, cr.ice * 0.92);
    col[k * 3] = c.r;
    col[k * 3 + 1] = c.g;
    col[k * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** Tileable grain texture + matching normal map for close-up regolith detail. */
export function buildDetailTextures(anisotropy) {
  const S = 256;
  const h = new Float32Array(S * S);
  const rand = mulberry32(7);
  for (const cells of [8, 16, 32, 64, 128]) {
    const g = new Float32Array(cells * cells).map(() => rand());
    const amp = 1 / Math.sqrt(cells);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const fx = (x / S) * cells;
        const fy = (y / S) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const at = (i, j) => g[((j % cells) * cells + (i % cells)) | 0];
        const v =
          at(x0, y0) * (1 - sx) * (1 - sy) +
          at(x0 + 1, y0) * sx * (1 - sy) +
          at(x0, y0 + 1) * (1 - sx) * sy +
          at(x0 + 1, y0 + 1) * sx * sy;
        h[y * S + x] += v * amp;
      }
    }
  }
  // Pebbles
  for (let i = 0; i < 900; i++) {
    const cx = rand() * S;
    const cy = rand() * S;
    const r = 0.8 + rand() * 2.4;
    for (let y = -4; y <= 4; y++) {
      for (let x = -4; x <= 4; x++) {
        const dd = Math.hypot(x, y) / r;
        if (dd < 1) {
          const px = (Math.floor(cx + x) + S) % S;
          const py = (Math.floor(cy + y) + S) % S;
          h[py * S + px] += (1 - dd * dd) * 0.35;
        }
      }
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of h) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const map = new Uint8Array(S * S * 4);
  const nmap = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const v = (h[i] - min) / (max - min);
      const g = Math.round(178 + v * 77);
      map[i * 4] = g;
      map[i * 4 + 1] = Math.round(g * 0.97);
      map[i * 4 + 2] = Math.round(g * 0.94);
      map[i * 4 + 3] = 255;
      const hl = h[y * S + ((x - 1 + S) % S)];
      const hr = h[y * S + ((x + 1) % S)];
      const hu = h[((y - 1 + S) % S) * S + x];
      const hd = h[((y + 1) % S) * S + x];
      const nx = (hl - hr) * 3;
      const ny = (hu - hd) * 3;
      const len = Math.hypot(nx, ny, 1);
      nmap[i * 4] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      nmap[i * 4 + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      nmap[i * 4 + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      nmap[i * 4 + 3] = 255;
    }
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(map, true), normalMap: mk(nmap, false) };
}

function rockGeometry(seed) {
  let g = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  const n = createNoise2D(seed);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + n(v.x * 1.7 + v.z, v.y * 1.7 - v.z) * 0.32;
    v.multiplyScalar(k);
    v.y *= 0.62;
    if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildRocks(count, castShadow) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true });
  const rand = mulberry32(99);
  const variants = [rockGeometry(3), rockGeometry(8), rockGeometry(15)];
  const per = Math.ceil(count / variants.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const t = new THREE.Vector3();
  const col = new THREE.Color();
  const base = [new THREE.Color("#7b4630"), new THREE.Color("#5a3324"), new THREE.Color("#94603f"), new THREE.Color("#3f2a22")];
  for (const geo of variants) {
    const mesh = new THREE.InstancedMesh(geo, mat, per);
    let placed = 0;
    let guard = 0;
    while (placed < per && guard < per * 20) {
      guard++;
      const ang = rand() * Math.PI * 2;
      const dist = 18 + Math.pow(rand(), 1.35) * 620;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      if (distToPaths(x, z) < 6) continue;
      if (OBSTACLES.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 4)) continue;
      if (FLAT_ZONES.some((f) => Math.hypot(x - f.x, z - f.z) < f.r * 0.7) && rand() > 0.12) continue;
      // Clusters near crater rims and the mesa
      const clump = nE(x * 0.01, z * 0.01) * 0.5 + 0.5;
      if (rand() > clump * 1.3) continue;
      const big = rand() < 0.04;
      const sc = big ? 1.2 + rand() * 1.8 : 0.12 + Math.pow(rand(), 2.2) * 0.9;
      s.set(sc * (0.8 + rand() * 0.5), sc * (0.7 + rand() * 0.6), sc * (0.8 + rand() * 0.5));
      t.set(x, heightAt(x, z) - sc * 0.12, z);
      q.setFromEuler(e.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4));
      m4.compose(t, q, s);
      mesh.setMatrixAt(placed, m4);
      col.copy(base[Math.floor(rand() * base.length)]).multiplyScalar(0.8 + rand() * 0.4);
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

/** Road ribbons that follow the ground. */
export function buildPaths(detailMap) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#7c4c35"),
    roughness: 1,
    map: detailMap,
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
    const uvs = [];
    const idx = [];
    let acc = 0;
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
      if (i > 0) acc += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      pos.push(x + ox, heightAt(x + ox, z + oz) + 0.05, z + oz, x - ox, heightAt(x - ox, z - oz) + 0.05, z - oz);
      uvs.push(0, acc / 4, 0.9, acc / 4);
      if (i < pts.length - 1) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
