/**
 * Living-world ambience: small, purposeful motion layered over the settlement.
 *
 *  - Greenhouse crops sway in the circulation-fan airflow (vertex shader, zero CPU cost).
 *  - Four equipment screens show live readouts from the simulation (one canvas atlas,
 *    redrawn at most once per second, three draw calls for all of them).
 *  - A distant dust front builds, drifts and fades on the south-west horizon, stronger when
 *    the atmosphere is already dusty (one mesh, two texture taps per pixel).
 *  - Sun-glint motes: a handful of tiny grains near the eye that only show when backlit
 *    (positions wrap on the GPU, no per-frame buffer uploads).
 */
import * as THREE from "three";
import { heightAt } from "./terrain.js";
import { ATMO } from "./surfaces.js";
import { mulberry32 } from "./noise.js";
import { clockString, solNumber } from "../sim/engine.js";
import { p } from "../sim/constants.js";

// ═══ Pure helpers (unit-tested) ═══════════════════════════════

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Tileable value-noise fbm in [0,1], row-major w×h. Lattice periods must divide w and h. */
export function tileableFbm(w, h, seed = 1, periods = [4, 8, 16, 32]) {
  const rand = mulberry32(seed);
  const out = new Float32Array(w * h);
  let amp = 1;
  let total = 0;
  for (const per of periods) {
    const px = per;
    const py = Math.max(1, Math.round((per * h) / w));
    const g = new Float32Array(px * py).map(() => rand());
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * py;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % py) * px;
      const r1 = ((y0 + 1) % py) * px;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * px;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % px;
        const a = g[r0 + (x0 % px)] + (g[r0 + x1] - g[r0 + (x0 % px)]) * sx;
        const b = g[r1 + (x0 % px)] + (g[r1 + x1] - g[r1 + (x0 % px)]) * sx;
        out[y * w + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.55;
  }
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of out) {
    mn = Math.min(mn, v / total);
    mx = Math.max(mx, v / total);
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] / total - mn) / Math.max(1e-6, mx - mn);
  return out;
}

export const STORM_PERIOD = 380; // s of real time per build → drift → fade cycle

/**
 * Dust-front lifecycle. Returns { amount, cycle, progress }: amount 0..1 builds over ~2 min,
 * holds, then fades; the last ~50 s of each cycle are quiet so the front can reposition unseen.
 * Higher optical depth (tau) makes the front denser and taller.
 */
export function stormFront(time, tau = 0.5, period = STORM_PERIOD) {
  const cycle = Math.floor(time / period);
  const local = time - cycle * period;
  const env = smooth(0, 0.34 * period, local) * (1 - smooth(0.56 * period, 0.87 * period, local));
  const dusty = smooth(0.4, 2.6, tau);
  return { amount: env * (0.5 + 0.5 * dusty), cycle, progress: local / period };
}

const fmtInt = (v) => Math.round(v).toLocaleString("en-US");
function fmtSolsShort(sols) {
  if (!Number.isFinite(sols)) return "∞";
  if (sols >= 999) return "999+";
  return `${Math.max(0, Math.round(sols))}`;
}

/** Everything the screens print, derived from the simulation state (no DOM). */
export function screenReadouts(sim) {
  const f = sim.flows ?? {};
  const st = sim.stores;
  const cap = Math.max(1, sim.config.batteryKWh);
  const o2Net = (f.o2Prod ?? 0) - (f.o2Use ?? 0);
  const waterNet = (f.waterRecovered ?? 0) + (f.waterExtracted ?? 0) - (f.waterGross ?? 0);
  const foodNet = (f.foodProd ?? 0) - (f.foodUse ?? 0);
  const ledsOn = !!sim.systems.greenhouseLights && !sim.shed?.greenhouseLights;
  return {
    clock: clockString(sim),
    sol: solNumber(sim),
    life: [
      { key: "O₂", value: `${fmtInt(st.o2)} kg`, frac: clamp01(st.o2 / p("o2Capacity")), trend: Math.sign(Math.round(o2Net * 10)) },
      { key: "H₂O", value: `${(st.water / 1000).toFixed(1)} t`, frac: clamp01(st.water / p("waterCapacity")), trend: Math.sign(Math.round(waterNet)) },
      {
        key: "FOOD",
        value: `${fmtSolsShort(st.food / Math.max(1, f.foodUse ?? 1))} sol`,
        frac: clamp01(st.food / Math.max(1, (f.foodUse ?? 1) * 500)),
        trend: Math.sign(Math.round(foodNet)),
      },
    ],
    tau: f.tau ?? sim.config.tau ?? 0,
    transmission: f.transmission ?? 1,
    soc: clamp01(st.battery / cap),
    genKW: f.genKW ?? 0,
    loadKW: f.servedKW ?? f.demandKW ?? 0,
    solarKW: f.solarKW ?? 0,
    ledsOn,
    ledsShed: !!sim.shed?.greenhouseLights,
    foodProd: f.foodProd ?? 0,
    lightFactor: f.lightFactor ?? (ledsOn ? 1 : 0.2),
  };
}

// ═══ Palette (matches the HUD) ════════════════════════════════
const C = {
  bg: "#0b1016",
  panel: "#121a22",
  grid: "rgba(116,185,222,0.10)",
  dim: "#7f8c96",
  text: "#e8e4dc",
  orange: "#e2733a",
  amber: "#e7a94f",
  blue: "#74b9de",
  green: "#6cc58d",
  red: "#ff5a4a",
};
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", Roboto, Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';

// ═══ Live equipment screens ═══════════════════════════════════
const TILE_W = 256;
const TILE_H = 128;

/** Screen poses in each structure's local frame: face-plane point, facing yaw (0 = +z), size (m). */
const SCREENS = [
  // Habitat airlock end-cap, left of the hatch (the hatch slides to +x when it opens).
  { id: "habitat", title: "LIFE SUPPORT", accent: C.blue, pos: [-1.32, 2.02, 16.33], ry: 0, w: 0.64, h: 0.36 },
  // Lab sample-handling glovebox, south face — readable from the path below the deck.
  { id: "lab", title: "ATMOSPHERE", accent: C.orange, pos: [-9.1, 3.05, 1.5], ry: 0, w: 1.36, h: 0.7 },
  // Greenhouse vestibule, east face beside the door.
  { id: "greenhouse", title: "GREENHOUSE", accent: C.green, pos: [18.2, 1.58, 1.28], ry: Math.PI / 2, w: 0.86, h: 0.46 },
  // Battery inverter cabinet, local +z face (world east once the yard is rotated π/2).
  { id: "battery", title: "POWER", accent: C.amber, pos: [5.66, 1.36, 1.5], ry: 0, w: 1.0, h: 0.54 },
];

function haloTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(0.4, "rgba(255,255,255,0.32)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function createScreens(settlement, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_W * 2;
  canvas.height = TILE_H * 2;
  const g = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;

  const screenGeos = [];
  const bezelGeos = [];
  const haloGeos = [];
  const haloCol = new THREE.Color();
  const m4 = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const placed = [];

  SCREENS.forEach((s, i) => {
    const st = settlement.structures[s.id];
    if (!st) return;
    st.group.updateMatrixWorld(true);
    local.makeRotationY(s.ry).setPosition(s.pos[0], s.pos[1], s.pos[2]);
    m4.multiplyMatrices(st.group.matrixWorld, local);
    // Screen face: UVs mapped into this screen's atlas tile.
    const tx = i % 2;
    const ty = Math.floor(i / 2);
    const sg = new THREE.PlaneGeometry(s.w, s.h);
    const uv = sg.attributes.uv;
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, (tx + uv.getX(k)) / 2, 1 - (ty + 1 - uv.getY(k)) / 2);
    }
    sg.translate(0, 0, 0.064);
    sg.applyMatrix4(m4);
    screenGeos.push(sg);
    // Bezel + a small cable gland under it.
    const bg = new THREE.BoxGeometry(s.w + 0.1, s.h + 0.1, 0.06);
    bg.translate(0, 0, 0.03);
    bg.applyMatrix4(m4);
    bezelGeos.push(bg);
    const gland = new THREE.BoxGeometry(0.08, 0.12, 0.04);
    gland.translate(s.w * 0.32, -s.h / 2 - 0.1, 0.02);
    gland.applyMatrix4(m4);
    bezelGeos.push(gland);
    // Night-time light spill onto the surface around the screen.
    // Sized so the spill stays on each mounting face (habitat end-cap radius 1.95 m).
    const hg = new THREE.PlaneGeometry(s.w * 1.45, s.h * 1.9);
    hg.translate(0, 0, 0.006);
    hg.applyMatrix4(m4);
    haloCol.set(s.accent).lerp(new THREE.Color("#ffffff"), 0.35);
    const cols = new Float32Array(hg.attributes.position.count * 3);
    for (let k = 0; k < hg.attributes.position.count; k++) haloCol.toArray(cols, k * 3);
    hg.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    haloGeos.push(hg);
    placed.push({ ...s, tx, ty, world: new THREE.Vector3(0, 0, 0.1).applyMatrix4(m4) });
  });

  const group = new THREE.Group();
  group.name = "ambient-screens";
  const screenMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const screens = new THREE.Mesh(mergeInto(screenGeos), screenMat);
  screens.renderOrder = 1;
  const bezels = new THREE.Mesh(mergeInto(bezelGeos), settlement.materials.metalDark);
  bezels.castShadow = false;
  bezels.receiveShadow = true;
  const haloMat = new THREE.MeshBasicMaterial({
    map: haloTexture(),
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const halos = new THREE.Mesh(mergeInto(haloGeos), haloMat);
  halos.renderOrder = 2;
  group.add(bezels, screens, halos);

  // Short local histories for the sparklines, sampled in simulation time.
  const hist = { tau: [], soc: [] };
  let lastSampleT = -Infinity;
  const SAMPLE_SIM_S = 900; // one point per ~15 Mars-minutes
  const HIST_N = 40;
  let blink = false;
  let timer = 0;
  const every = quality.key === "low" ? 3 : 1;

  function header(x, y, title, accent, r) {
    g.fillStyle = C.bg;
    g.fillRect(x, y, TILE_W, TILE_H);
    g.fillStyle = C.panel;
    g.fillRect(x + 4, y + 4, TILE_W - 8, TILE_H - 8);
    g.fillStyle = accent;
    g.fillRect(x + 4, y + 4, 4, TILE_H - 8);
    g.font = `700 15px ${FONT}`;
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillStyle = accent;
    g.fillText(title, x + 16, y + 19);
    g.font = `600 15px ${MONO}`;
    g.textAlign = "right";
    g.fillStyle = C.dim;
    g.fillText(r.clock, x + TILE_W - 26, y + 19);
    g.fillStyle = blink ? accent : "rgba(255,255,255,0.12)";
    g.beginPath();
    g.arc(x + TILE_W - 15, y + 19, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = C.grid;
    g.fillRect(x + 12, y + 33, TILE_W - 24, 1);
  }

  function bar(x, y, w, h, frac, col) {
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(x, y, w, h);
    g.fillStyle = col;
    g.fillRect(x, y, Math.max(2, w * clamp01(frac)), h);
  }

  function spark(x, y, w, h, data, lo, hi, col) {
    if (data.length < 2) return;
    g.strokeStyle = C.grid;
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.beginPath();
    data.forEach((v, i) => {
      const px = x + 2 + (i / (HIST_N - 1)) * (w - 4);
      const py = y + h - 3 - clamp01((v - lo) / Math.max(1e-6, hi - lo)) * (h - 6);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.stroke();
  }

  const trendGlyph = (t) => (t > 0 ? "▲" : t < 0 ? "▼" : "■");
  const trendCol = (t, frac) => (frac < 0.15 ? C.red : t < 0 ? C.amber : C.green);

  function drawLife(x, y, r) {
    header(x, y, "LIFE SUPPORT", C.blue, r);
    r.life.forEach((row, i) => {
      const yy = y + 52 + i * 26;
      g.textAlign = "left";
      g.font = `700 17px ${FONT}`;
      g.fillStyle = C.text;
      g.fillText(row.key, x + 16, yy);
      bar(x + 70, yy - 5, 56, 10, row.frac, trendCol(row.trend, row.frac));
      g.textAlign = "right";
      g.font = `600 17px ${MONO}`;
      g.fillStyle = C.text;
      g.fillText(row.value, x + TILE_W - 32, yy);
      g.font = `700 12px ${FONT}`;
      g.fillStyle = trendCol(row.trend, row.frac);
      g.fillText(trendGlyph(row.trend), x + TILE_W - 14, yy);
    });
  }

  function drawAtmos(x, y, r) {
    header(x, y, "ATMOSPHERE", C.orange, r);
    g.textAlign = "left";
    g.font = `700 46px ${MONO}`;
    g.fillStyle = r.tau > 2 ? C.red : r.tau > 1.2 ? C.amber : C.text;
    g.fillText(`τ${r.tau.toFixed(2)}`, x + 14, y + 66);
    g.font = `700 14px ${FONT}`;
    g.fillStyle = C.dim;
    g.fillText("DUST OPACITY", x + 16, y + 98);
    g.fillText(`SOL ${r.sol}`, x + 16, y + 114);
    g.textAlign = "right";
    g.font = `700 22px ${MONO}`;
    g.fillStyle = C.amber;
    g.fillText(`${Math.round(r.transmission * 100)}%`, x + TILE_W - 14, y + 52);
    g.font = `700 12px ${FONT}`;
    g.fillStyle = C.dim;
    g.fillText("SUNLIGHT", x + TILE_W - 14, y + 70);
    spark(x + 150, y + 82, 92, 34, hist.tau, 0, Math.max(1.5, ...hist.tau) * 1.1, C.orange);
  }

  function drawGreenhouse(x, y, r) {
    header(x, y, "GREENHOUSE", C.green, r);
    const state = r.ledsOn ? ["GROW LEDS ON", C.green] : r.ledsShed ? ["LEDS SHED", C.amber] : ["LEDS OFF", C.dim];
    g.textAlign = "left";
    g.font = `700 15px ${FONT}`;
    g.fillStyle = state[1];
    g.fillText(state[0], x + 16, y + 50);
    g.font = `700 40px ${MONO}`;
    g.fillStyle = C.text;
    const k = r.foodProd >= 1000 ? `${(r.foodProd / 1000).toFixed(1)}k` : fmtInt(r.foodProd);
    g.fillText(k, x + 14, y + 86);
    g.font = `700 13px ${FONT}`;
    g.fillStyle = C.dim;
    g.fillText("KCAL / SOL", x + 16, y + 113);
    g.textAlign = "right";
    g.fillText("LIGHT", x + TILE_W - 14, y + 50);
    // Vertical light-level meter.
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(x + TILE_W - 40, y + 62, 24, 52);
    g.fillStyle = r.ledsOn ? "#ff58c8" : C.amber;
    const lh = 52 * clamp01(r.lightFactor);
    g.fillRect(x + TILE_W - 40, y + 114 - lh, 24, lh);
  }

  function drawPower(x, y, r) {
    header(x, y, "POWER", C.amber, r);
    const col = r.soc > 0.5 ? C.green : r.soc > 0.2 ? C.amber : C.red;
    g.textAlign = "left";
    g.font = `700 44px ${MONO}`;
    g.fillStyle = col;
    g.fillText(`${Math.round(r.soc * 100)}%`, x + 14, y + 64);
    g.font = `700 12px ${FONT}`;
    g.fillStyle = C.dim;
    g.fillText("BATTERY", x + 16, y + 90);
    bar(x + 16, y + 100, 108, 12, r.soc, col);
    g.textAlign = "right";
    g.font = `700 13px ${FONT}`;
    g.fillStyle = C.dim;
    g.fillText("GEN", x + 168, y + 50);
    g.fillText("LOAD", x + 168, y + 72);
    g.font = `700 18px ${MONO}`;
    g.fillStyle = C.text;
    g.fillText(r.genKW.toFixed(1), x + TILE_W - 14, y + 50);
    g.fillStyle = r.loadKW > r.genKW ? C.amber : C.text;
    g.fillText(r.loadKW.toFixed(1), x + TILE_W - 14, y + 72);
    spark(x + 140, y + 84, 102, 32, hist.soc, 0, 1, col);
  }

  const DRAW = { habitat: drawLife, lab: drawAtmos, greenhouse: drawGreenhouse, battery: drawPower };

  function redraw(sim) {
    const r = screenReadouts(sim);
    if (hist.tau.length === 0 || sim.t < lastSampleT) {
      // Start with a flat trace so the sparkline reads from the first frame.
      hist.tau = new Array(HIST_N).fill(r.tau);
      hist.soc = new Array(HIST_N).fill(r.soc);
      lastSampleT = sim.t;
    } else if (sim.t - lastSampleT >= SAMPLE_SIM_S) {
      lastSampleT = sim.t;
      hist.tau.push(r.tau);
      hist.soc.push(r.soc);
      if (hist.tau.length > HIST_N) hist.tau.shift();
      if (hist.soc.length > HIST_N) hist.soc.shift();
    }
    blink = !blink;
    for (const s of placed) DRAW[s.id](s.tx * TILE_W, s.ty * TILE_H, r);
    tex.needsUpdate = true;
  }

  return {
    group,
    placed,
    update(dt, env, sim) {
      haloMat.opacity = 0.04 + env.night * 0.45 + env.storm * 0.12;
      // Screens read slightly dimmer in full sun, full brightness after dark.
      screenMat.color.setScalar(0.82 + 0.18 * env.night);
      if (!sim) return;
      timer -= dt;
      if (timer > 0) return;
      timer = every;
      redraw(sim);
    },
    redraw,
  };
}

function mergeInto(geos) {
  // Small local merge (position/normal/uv/[color]) — avoids pulling BufferGeometryUtils into a hot path.
  const attrs = ["position", "normal", "uv", "color"].filter((n) => geos.every((g) => g.attributes[n]));
  const out = new THREE.BufferGeometry();
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  for (const n of attrs) {
    const size = geos[0].attributes[n].itemSize;
    const arr = new Float32Array(vCount * size);
    let o = 0;
    for (const g of geos) {
      arr.set(g.attributes[n].array, o);
      o += g.attributes[n].array.length;
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  const idx = new Uint32Array(iCount);
  let base = 0;
  let o = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[o++] = g.index.array[i] + base;
    else for (let i = 0; i < n; i++) idx[o++] = i + base;
    base += n;
    g.dispose();
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// ═══ Greenhouse crop sway ═════════════════════════════════════
/**
 * Circulation fans at both ends of the greenhouse push air along the racks: leaves lean
 * slightly downstream and flutter in a wave that travels along each row. Vertex-only.
 * Sets onBeforeCompile + customProgramCacheKey, so it must run BEFORE installAtmosphere().
 */
function installCropSway(mat, uTime) {
  if (!mat || mat.userData.cropSway) return;
  mat.userData.cropSway = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uSwayTime = uTime;
    shader.vertexShader = "uniform float uSwayTime;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>",
      /* glsl */ `#include <begin_vertex>
      {
        #ifdef USE_INSTANCING
          vec3 swayBase = instanceMatrix[3].xyz;
        #else
          vec3 swayBase = vec3( 0.0 );
        #endif
        // 0 at the soil line → 1 at the leaf tips (crop geometry spans y ≈ ±0.17 m).
        float swayH = clamp( ( position.y + 0.17 ) / 0.34, 0.0, 1.0 );
        swayH *= swayH;
        float swayPh = uSwayTime * 2.1 - swayBase.x * 0.7 + swayBase.z * 1.9;
        float swayGust = 0.6 + 0.4 * sin( uSwayTime * 0.41 + swayBase.z * 0.8 + swayBase.x * 0.05 );
        transformed.x += swayH * swayGust * ( 0.022 * sin( swayPh ) + 0.012 * sign( swayBase.x + 0.001 ) );
        transformed.z += swayH * swayGust * 0.014 * sin( swayPh * 1.37 + 1.7 );
      }`
    );
  };
  mat.customProgramCacheKey = () => "crop-sway-v1";
  mat.needsUpdate = true;
}

// ═══ Distant dust front ═══════════════════════════════════════
const STORM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vDir;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Output is mixed in the same space three's fog uses, so the front blends into the haze.
const STORM_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uAmount;
uniform vec3 uFog;
uniform vec3 uDark;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
varying vec2 vUv;
varying vec3 vDir;
void main() {
  // Broad billows (~1 km) shape the crest; a finer layer only modulates density, so the top
  // edge stays soft and rounded instead of combed into vertical streaks.
  float n0 = texture2D( uNoise, vec2( vUv.x * 1.3 + uTime * 0.0021, 0.37 + uTime * 0.0004 ) ).r;
  float n1 = texture2D( uNoise, vec2( vUv.x * 2.3 + uTime * 0.0035, vUv.y * 1.1 - uTime * 0.0014 ) ).r;
  float n = mix( n0, n1, 0.45 );
  // Crest rises as the front builds.
  float crest = 0.14 + uAmount * ( 0.3 + 0.5 * n0 );
  float body = 1.0 - smoothstep( crest - 0.3, crest + 0.06, vUv.y + ( n1 - 0.5 ) * 0.06 );
  float sides = smoothstep( 0.0, 0.28, vUv.x ) * ( 1.0 - smoothstep( 0.72, 1.0, vUv.x ) );
  float dens = body * sides * mix( 0.55, 1.0, n ) * uAmount;
  vec3 d = normalize( vDir );
  float fwd = pow( max( dot( d, uSunDir ), 0.0 ), 5.0 );
  float lit = smoothstep( 0.0, max( crest, 0.05 ), vUv.y ) * ( 0.4 + 0.6 * n );
  vec3 col = mix( uDark, uFog, 0.3 + 0.7 * lit ) + uSunCol * fwd * 1.6;
  gl_FragColor = vec4( col, clamp( dens * 0.78, 0.0, 0.8 ) );
}`;

function createStormFront() {
  const W = 128;
  const H = 64;
  const field = tileableFbm(W, H, 11, [4, 8, 16, 32]);
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = Math.round(field[i] * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const noise = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.magFilter = THREE.LinearFilter;
  noise.minFilter = THREE.LinearMipmapLinearFilter;
  noise.generateMipmaps = true;
  noise.needsUpdate = true;

  const uniforms = {
    uNoise: { value: noise },
    uTime: { value: 0 },
    uAmount: { value: 0 },
    uFog: { value: new THREE.Color() },
    uDark: { value: new THREE.Color() },
    uSunDir: ATMO.sunDir,
    uSunCol: ATMO.sunColor,
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: STORM_VERT,
    fragmentShader: STORM_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  // A 75° arc of open cylinder: 1 m radius (scaled), 720 m tall.
  const ARC = 1.3;
  const geo = new THREE.CylinderGeometry(1, 1, 720, 40, 1, true, -ARC / 2, ARC);
  geo.translate(0, 360 - 70, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.name = "ambient-dust-front";
  const BASE_AZ = Math.atan2(-0.55, 0.83); // toward the south-west, up the canyon
  const STORM_COL = new THREE.Color("#7a4529");

  return {
    mesh,
    update(time, env, tau, cameraPos, fogColor) {
      const f = stormFront(time, tau);
      const h = cameraPos ? 1 - smooth(260, 900, cameraPos.y) : 1;
      const amount = Math.max(f.amount, env.storm * 0.85) * h * (0.25 + 0.75 * smooth(-0.1, 0.1, env.sinEl));
      uniforms.uAmount.value = amount;
      mesh.visible = amount > 0.01;
      if (!mesh.visible) return;
      uniforms.uTime.value = time;
      // Each cycle approaches from a slightly different bearing and drifts across the horizon.
      const jitter = mulberry32(f.cycle * 977 + 3)() - 0.5;
      mesh.rotation.y = BASE_AZ + jitter * 0.9 + f.progress * 0.16;
      const r = 2350 - f.progress * 450;
      mesh.scale.set(r, 1, r);
      if (fogColor) {
        uniforms.uFog.value.copy(fogColor);
        uniforms.uDark.value.copy(fogColor).lerp(STORM_COL, 0.35).multiplyScalar(0.78);
      }
    },
  };
}

// ═══ Sun-glint motes ══════════════════════════════════════════
const MOTE_VERT = /* glsl */ `
uniform float uTime;
uniform float uBox;
uniform float uSize;
uniform float uAlpha;
uniform vec3 uCam;
uniform vec3 uWind;
uniform vec3 uSunDir;
varying float vAlpha;
void main() {
  vec3 s = position; // per-mote seed in [0,1)^3
  vec3 drift = vec3( sin( uTime * 0.31 + s.y * 23.0 ), sin( uTime * 0.23 + s.x * 17.0 ) * 0.8, cos( uTime * 0.27 + s.z * 13.0 ) ) * 0.35;
  vec3 rel = mod( s * uBox + uWind * uTime + drift - uCam, uBox ) - 0.5 * uBox;
  vec4 mv = viewMatrix * vec4( uCam + rel, 1.0 );
  gl_Position = projectionMatrix * mv;
  float d = length( rel );
  float edge = 1.0 - smoothstep( 0.3 * uBox, 0.48 * uBox, d );
  float nearFade = smoothstep( 0.5, 1.4, d );
  // Forward scattering: grains between the eye and the sun light up.
  float mu = max( dot( rel / max( d, 1e-3 ), uSunDir ), 0.0 );
  float glint = 0.12 + 1.6 * pow( mu, 4.0 );
  float tumble = 0.55 + 0.45 * sin( uTime * ( 1.3 + s.x * 2.2 ) + s.z * 40.0 );
  vAlpha = uAlpha * edge * nearFade * glint * tumble;
  gl_PointSize = clamp( uSize * ( 0.6 + s.y * 0.8 ) / max( -mv.z, 0.1 ), 1.0, 4.0 );
}`;

const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float a = 1.0 - smoothstep( 0.1, 0.5, length( gl_PointCoord - 0.5 ) );
  gl_FragColor = vec4( uColor, a * vAlpha );
}`;

function createMotes(count, renderer, camera) {
  const rand = mulberry32(23);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(seeds, 3));
  const uniforms = {
    uTime: { value: 0 },
    uBox: { value: 12 },
    uSize: { value: 40 },
    uAlpha: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector3(0.35, 0.03, 0.12) },
    uSunDir: ATMO.sunDir,
    uColor: { value: new THREE.Color("#fff0d8") },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = "ambient-motes";
  const buf = new THREE.Vector2();
  return {
    points,
    update(time, env, cameraPos) {
      const above = cameraPos.y - heightAt(cameraPos.x, cameraPos.z);
      const a = smooth(0.02, 0.18, env.sinEl) * (1 - env.storm * 0.6) * (1 - smooth(5, 18, above)) * 0.6;
      uniforms.uAlpha.value = a;
      points.visible = a > 0.005;
      if (!points.visible) return;
      uniforms.uTime.value = time;
      uniforms.uCam.value.copy(cameraPos);
      // Glints render as ~8 mm discs (sub-pixel beyond a few metres): pixels per metre at 1 m.
      renderer.getDrawingBufferSize(buf);
      const fov = camera ? (camera.fov * Math.PI) / 180 : 1;
      uniforms.uSize.value = (0.008 * buf.y) / (2 * Math.tan(fov / 2));
      uniforms.uWind.value.set(0.35 + env.storm * 2.5, 0.03, 0.12 + env.storm * 0.8);
    },
  };
}

// ═══ Assembly ═════════════════════════════════════════════════

/**
 * @param {{ scene: THREE.Scene, settlement: object, world: object, quality: { key: string } }} opts
 * Call after buildSettlement() and BEFORE the scene-wide installAtmosphere() pass.
 */
export function createAmbient({ scene, settlement, world, quality }) {
  const low = quality?.key === "low";
  const swayTime = { value: 0 };
  installCropSway(settlement.materials.crop, swayTime);

  const screens = createScreens(settlement, quality ?? { key: "balanced" });
  scene.add(screens.group);

  const storm = low ? null : createStormFront();
  if (storm) scene.add(storm.mesh);

  const moteCount = low ? 0 : quality?.key === "high" ? 120 : 80;
  const motes = moteCount ? createMotes(moteCount, world.renderer, world.camera) : null;
  if (motes) scene.add(motes.points);

  let shed = false;
  return {
    screens,
    storm,
    motes,
    /** Frame-governor hook: drop the storm front and motes, keep screens + sway. */
    degrade() {
      shed = true;
      if (storm) storm.mesh.visible = false;
      if (motes) motes.points.visible = false;
    },
    /** t: seconds (monotonic), dt: frame seconds, env: world.updateEnvironment() result. */
    update(t, dt, env, sim, cameraPos) {
      swayTime.value = t;
      screens.update(dt, env, sim);
      const cam = cameraPos ?? world.camera.position;
      if (shed) return;
      storm?.update(t, env, sim?.flows?.tau ?? 0.5, cam, scene.fog?.color);
      motes?.update(t, env, cam);
    },
  };
}
