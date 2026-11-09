import { createNoise2D } from "../../../scene/noise.js";
import { SITE, MOON_RADIUS, EARTH_AZ } from "./layout.js";

/**
 * The terrain height model: an analytic field (Shackleton's bowl, named craters, random crater
 * populations, massifs and fractal relief) baked once into two grids — a 4 m "core" grid around the
 * base and an 80 m "far" grid out to the horizon — plus analytic fine detail (small pocks and
 * metre-scale relief) evaluated on demand near the player. Lunar curvature is applied everywhere.
 */

const nA = createNoise2D(11);
const nB = createNoise2D(23);
const nC = createNoise2D(37);
const nD = createNoise2D(51);
const nE = createNoise2D(67);
const nF = createNoise2D(83);

export const CORE = { n: 1301, step: 4, min: -2600 };
export const FAR = { n: 801, step: 80, min: -32000 };

export function hash(i, j, s) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Crater profile at normalised radius q: floor fraction f, depth d below datum, rim height rim. */
function craterProfile(q, d, rim, f = 0) {
  if (q < 1) {
    const s = f > 0 ? clamp01((q - f) / (1 - f)) : q;
    return -d + (d + rim) * Math.pow(s, 1.8);
  }
  return rim * Math.exp(-(q - 1) * 2.6);
}

// Horizon massifs and a large complex crater (with a central peak) beyond the walkable area.
const mAz = (SITE.massif.az * Math.PI) / 180;
const MASSIFS = [
  { x: Math.sin(mAz) * SITE.massif.dist, z: -Math.cos(mAz) * SITE.massif.dist, h: SITE.massif.h, s: SITE.massif.sigma },
  { x: 17000, z: -21000, h: 780, s: 3800 },
  { x: -6000, z: -27000, h: 700, s: 3200 },
  { x: 21000, z: -9000, h: 520, s: 4200 },
  { x: 8000, z: 28000, h: 650, s: 4200 },
];
const FAR_CRATERS = [
  { x: 9800, z: 8200, R: 4600, d: 1300, rim: 160, f: 0.45, peak: 520 },
  { x: 14500, z: -9000, R: 2600, d: 650, rim: 110, f: 0.3, peak: 0 },
  { x: -3500, z: -9000, R: 1500, d: 330, rim: 70, f: 0.2, peak: 0 },
  { x: 5200, z: 3600, R: 900, d: 180, rim: 45, f: 0.15, peak: 0 },
];
const NEAR_CRATERS = [
  { ...SITE.psr, rim: 28, f: 0.42 },
  { x: SITE.fresh.x, z: SITE.fresh.z, R: SITE.fresh.R, depth: SITE.fresh.depth, rim: 3.2, f: 0.05 },
  { x: 520, z: -380, R: 105, depth: 26, rim: 6, f: 0.2 },
  { x: -620, z: 720, R: 210, depth: 42, rim: 9, f: 0.35 },
  { x: 930, z: 880, R: 160, depth: 33, rim: 8, f: 0.25 },
  { x: -1150, z: -620, R: 140, depth: 30, rim: 7, f: 0.2 },
  { x: 1180, z: -260, R: 120, depth: 26, rim: 6, f: 0.15 },
  { x: 260, z: 760, R: 70, depth: 14, rim: 3, f: 0.1 },
];

function randomCraters(x, z, cell, pr, rMin, rMax, ratio, seed) {
  const ci = Math.floor(x / cell);
  const cj = Math.floor(z / cell);
  let h = 0;
  for (let j = cj - 1; j <= cj + 1; j++) {
    for (let i = ci - 1; i <= ci + 1; i++) {
      if (hash(i, j, seed) > pr) continue;
      const R = rMin + (rMax - rMin) * Math.pow(hash(i, j, seed + 1), 2.2);
      const cx = (i + hash(i, j, seed + 2)) * cell;
      const cz = (j + hash(i, j, seed + 3)) * cell;
      const dx = x - cx;
      const dz = z - cz;
      const q2 = (dx * dx + dz * dz) / (R * R);
      if (q2 > 6) continue;
      const fresh = 0.45 + 0.55 * hash(i, j, seed + 4); // degraded craters are shallower
      h += craterProfile(Math.sqrt(q2), R * ratio * fresh, R * 0.05 * fresh, 0.1);
    }
  }
  return h;
}

/** Broad relief (≥ ~130 m wavelengths): Shackleton, massifs, far craters, rolling highlands. */
function broadHeight(x, z) {
  let h = 0;
  // Shackleton: a simple crater 21 km across and ~4.1 km deep, its rim crest west of the base.
  const S = SITE.shackleton;
  const t = Math.hypot(x - S.x, z - S.z) / S.R;
  if (t < 1) h += -S.depth + (S.depth + 190) * Math.pow(sstep(0.3, 1.0, t), 1.15);
  else h += 190 * Math.exp(-(t - 1) / 0.11);
  // The ridge the base stands on: a broad swell along the rim flank.
  h += 34 * Math.exp(-((x - 30) ** 2 + (z - 20) ** 2) / (2 * 900 * 900)) + 40 * Math.exp(-(x * x + z * z) / (2 * 300 * 300));
  for (const m of MASSIFS) {
    const d2 = (x - m.x) ** 2 + (z - m.z) ** 2;
    if (d2 < 9 * m.s * m.s) h += m.h * Math.exp(-d2 / (2 * m.s * m.s)) * (0.8 + 0.35 * nF(x / 2600, z / 2600));
  }
  for (const c of FAR_CRATERS) {
    const q = Math.hypot(x - c.x, z - c.z) / c.R;
    if (q < 3) h += craterProfile(q, c.d, c.rim, c.f) + (c.peak ? c.peak * Math.exp(-((q / 0.16) ** 2)) : 0);
  }
  h += nA(x / 2400, z / 2400) * 34 + nB(x / 900, z / 900) * 13 + nC(x / 340, z / 340) * 5.5 + nD(x / 130, z / 130) * 2.2;
  return h;
}

/** Shorter wavelengths: near craters, crater populations and metre-to-decametre relief. */
function fineHeight(x, z) {
  let h = nE(x / 48, z / 48) * 0.9 + nF(x / 19, z / 19) * 0.35;
  for (const c of NEAR_CRATERS) {
    const dx = x - c.x;
    const dz = z - c.z;
    const r4 = c.R * 4;
    if (dx > r4 || dx < -r4 || dz > r4 || dz < -r4) continue;
    h += craterProfile(Math.sqrt(dx * dx + dz * dz) / c.R, c.depth, c.rim, c.f);
  }
  return h;
}

const POPULATIONS = [
  [520, 0.42, 45, 150, 0.17, 101],
  [110, 0.6, 4, 38, 0.19, 211],
];

/** Stamp the crater populations into a grid (same craters as randomCraters() would give). */
function stampCraters(arr, g) {
  const lo = g.min;
  const hi = g.min + (g.n - 1) * g.step;
  for (const [cell, pr, rMin, rMax, ratio, seed] of POPULATIONS) {
    const c0 = Math.floor(lo / cell) - 1;
    const c1 = Math.floor(hi / cell) + 1;
    for (let j = c0; j <= c1; j++) {
      for (let i = c0; i <= c1; i++) {
        if (hash(i, j, seed) > pr) continue;
        const R = rMin + (rMax - rMin) * Math.pow(hash(i, j, seed + 1), 2.2);
        const cx = (i + hash(i, j, seed + 2)) * cell;
        const cz = (j + hash(i, j, seed + 3)) * cell;
        const fresh = 0.45 + 0.55 * hash(i, j, seed + 4);
        const ext = R * Math.sqrt(6);
        const ia = Math.max(0, Math.ceil((cx - ext - lo) / g.step));
        const ib = Math.min(g.n - 1, Math.floor((cx + ext - lo) / g.step));
        const ja = Math.max(0, Math.ceil((cz - ext - lo) / g.step));
        const jb = Math.min(g.n - 1, Math.floor((cz + ext - lo) / g.step));
        const d = R * ratio * fresh;
        const rim = R * 0.05 * fresh;
        for (let jj = ja; jj <= jb; jj++) {
          const dz = lo + jj * g.step - cz;
          for (let ii = ia; ii <= ib; ii++) {
            const dx = lo + ii * g.step - cx;
            const q2 = (dx * dx + dz * dz) / (R * R);
            if (q2 > 6) continue;
            arr[jj * g.n + ii] += craterProfile(Math.sqrt(q2), d, rim, 0.1);
          }
        }
      }
    }
  }
}

function rawHeight(x, z, fine) {
  if (!fine) return broadHeight(x, z);
  let h = broadHeight(x, z) + fineHeight(x, z);
  for (const p of POPULATIONS) h += randomCraters(x, z, ...p);
  return h;
}

let baseH0 = null;
let padH0 = null;
function flatten(x, z, h) {
  const B = SITE.base;
  const P = SITE.pad;
  const db = Math.hypot(x - B.x, z - B.z);
  if (db < B.r + B.blend) h += (baseH0 - h) * (1 - sstep(B.r, B.r + B.blend, db));
  const dp = Math.hypot(x - P.x, z - P.z);
  if (dp < P.r + P.blend) h += (padH0 - h) * (1 - sstep(P.r, P.r + P.blend, dp));
  return h;
}

/** Depth carved by the skylight pit and its western ramp (local, ≥ 0). */
export function pitDepth(x, z) {
  const P = SITE.pit;
  const px = x - P.x;
  const pz = z - P.z;
  if (px < -90 || px > 60 || Math.abs(pz) > 34) return 0;
  const e = Math.hypot(px / P.a, pz / P.b) + nC(x / 9, z / 9) * 0.035;
  let d = P.depth * sstep(1.0, 0.8, e);
  // Ramp: a collapsed talus slope leading down from the west into the pit floor.
  const rw = 1 - sstep(7, 11, Math.abs(pz));
  if (rw > 0 && px < 0) {
    const k = clamp01((-78 - px) / (-78 + 12));
    d = Math.max(d, P.depth * k * rw);
  }
  return d;
}

function finalHeight(x, z, fine) {
  let h = flatten(x, z, rawHeight(x, z, fine));
  if (fine) h -= pitDepth(x, z);
  return h;
}

/** Fine detail (≤ ~8 m wavelengths and small pocks), evaluated analytically where needed. */
export function detail(x, z) {
  let h = nE(x / 7.5, z / 7.5) * 0.22 + nF(x / 3.1, z / 3.1) * 0.07 + nA(x / 1.2, z / 1.2) * 0.022;
  h += randomCraters(x, z, 9, 0.5, 0.35, 2.6, 0.2, 307);
  const B = SITE.base;
  const db = Math.hypot(x - B.x, z - B.z);
  if (db < B.r) h *= 0.45 + 0.55 * sstep(B.r - 20, B.r, db);
  const P = SITE.pad;
  if (Math.hypot(x - P.x, z - P.z) < P.r) h *= 0.15;
  return h;
}

const curv = (x, z) => (x * x + z * z) / (2 * MOON_RADIUS);

let grids = null;

/** Build (once per session) the core and far height grids. */
export function heightGrids() {
  if (grids) return grids;
  baseH0 = rawHeight(SITE.base.x, SITE.base.z, true);
  padH0 = rawHeight(SITE.pad.x, SITE.pad.z, true) + 0.0;
  // Broad relief on a 16 m lattice, upsampled; the fine part evaluated on the 4 m core lattice.
  const R = 4;
  const bn = (CORE.n - 1) / R + 1;
  const broad = new Float32Array(bn * bn);
  for (let j = 0; j < bn; j++) for (let i = 0; i < bn; i++) broad[j * bn + i] = broadHeight(CORE.min + i * CORE.step * R, CORE.min + j * CORE.step * R);
  const core = new Float32Array(CORE.n * CORE.n);
  for (let j = 0; j < CORE.n; j++) {
    const z = CORE.min + j * CORE.step;
    const bj = Math.min(bn - 2, Math.floor(j / R));
    const tz = j / R - bj;
    for (let i = 0; i < CORE.n; i++) {
      const x = CORE.min + i * CORE.step;
      const bi = Math.min(bn - 2, Math.floor(i / R));
      const tx = i / R - bi;
      const k = bj * bn + bi;
      const a = broad[k] + (broad[k + 1] - broad[k]) * tx;
      const b = broad[k + bn] + (broad[k + bn + 1] - broad[k + bn]) * tx;
      core[j * CORE.n + i] = a + (b - a) * tz + fineHeight(x, z);
    }
  }
  stampCraters(core, CORE);
  for (let j = 0; j < CORE.n; j++) {
    const z = CORE.min + j * CORE.step;
    for (let i = 0; i < CORE.n; i++) {
      const x = CORE.min + i * CORE.step;
      const k = j * CORE.n + i;
      core[k] = flatten(x, z, core[k]) - pitDepth(x, z);
    }
  }
  const far = new Float32Array(FAR.n * FAR.n);
  for (let j = 0; j < FAR.n; j++) {
    const z = FAR.min + j * FAR.step;
    for (let i = 0; i < FAR.n; i++) far[j * FAR.n + i] = finalHeight(FAR.min + i * FAR.step, z, false);
  }
  grids = { core, far };
  return grids;
}

function bilinear(arr, g, x, z) {
  let fx = (x - g.min) / g.step;
  let fz = (z - g.min) / g.step;
  const m = g.n - 1.0001;
  fx = fx < 0 ? 0 : fx > m ? m : fx;
  fz = fz < 0 ? 0 : fz > m ? m : fz;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const k = j * g.n + i;
  const a = arr[k] + (arr[k + 1] - arr[k]) * tx;
  const b = arr[k + g.n] + (arr[k + g.n + 1] - arr[k + g.n]) * tx;
  return a + (b - a) * tz;
}

const CORE_LIM = -CORE.min - CORE.step * 1.5;
/** Smooth (grid) height with lunar curvature: the base surface every LOD level is built from. */
export function gridHeight(x, z) {
  const g = grids;
  const h = Math.abs(x) < CORE_LIM && Math.abs(z) < CORE_LIM ? bilinear(g.core, CORE, x, z) : bilinear(g.far, FAR, x, z);
  return h - curv(x, z);
}

/** Exact grid node value on the core lattice (used by the 4 m LOD ring, no interpolation). */
export function coreNode(i, j) {
  const x = CORE.min + i * CORE.step;
  const z = CORE.min + j * CORE.step;
  return grids.core[j * CORE.n + i] - curv(x, z);
}

export const EARTH_AZIMUTH = EARTH_AZ;
