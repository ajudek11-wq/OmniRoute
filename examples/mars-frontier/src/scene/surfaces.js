/**
 * Material system for MARS: FRONTIER V2.
 *
 *  - Global aerial perspective (height-dependent dust haze + sun-side forward scattering),
 *    installed by overriding three's fog shader chunks.
 *  - Procedural PBR surface textures (painted panels, MLI insulation, brushed metal, gold foil,
 *    composite, sintered regolith, rubber, solar cells) packed into one RGBA map each:
 *       R albedo ratio (0.5 = neutral)  G roughness ratio  B grime/cavity  A height (bump)
 *  - `surface()` builds MeshStandardMaterials that sample those maps triplanar in object space
 *    (consistent texel density on any primitive) and add a physically motivated dust layer:
 *    up-facing surfaces and the lowest metre collect Martian dust, which also kills metalness.
 *  - Terrain and boulder materials built on photographic CC0 texture sets (see /public/textures).
 */
import * as THREE from "three";
import { mulberry32, createNoise2D } from "./noise.js";

// ── Aerial perspective ─────────────────────────────────────────
export const ATMO = {
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunColor: { value: new THREE.Color(0, 0, 0) },
};

THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogView;
#endif`;
THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogView = mvPosition.xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogSunDir;
  uniform vec3 fogSunColor;
  varying float vFogDepth;
  varying vec3 vFogView;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float fogDist = length( vFogView );
  vec3 fogDirW = normalize( ( vec4( vFogView, 0.0 ) * viewMatrix ).xyz );
  #ifdef FOG_EXP2
    // Dust haze thins with altitude (scale height ~650 m): integrate exp(-y/H) along the ray.
    float fogH = 650.0;
    float fogY0 = cameraPosition.y;
    float fogDy = fogDirW.y * fogDist;
    float fogHInt = abs( fogDy ) > 2.0 ? fogH * ( exp( -fogY0 / fogH ) - exp( -( fogY0 + fogDy ) / fogH ) ) / fogDy : exp( -fogY0 / fogH );
    float fogFactor = 1.0 - exp( - fogDensity * fogDist * max( fogHInt, 0.0 ) );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 fogCol = fogColor + fogSunColor * pow( max( dot( fogDirW, fogSunDir ), 0.0 ), 6.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;

/** Hook a material into the shared atmosphere uniforms (safe to call repeatedly). */
export function installAtmosphere(mat) {
  if (!mat || mat.userData.atmo || mat.isShaderMaterial || mat.isRawShaderMaterial) return;
  mat.userData.atmo = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.fogSunDir = ATMO.sunDir;
    shader.uniforms.fogSunColor = ATMO.sunColor;
  };
  mat.customProgramCacheKey = () => `atmo|${prevKey}`;
  mat.needsUpdate = true;
}

// ── Procedural surface textures ────────────────────────────────
function fbmField(S, rand, octaves = [8, 16, 32, 64]) {
  const h = new Float32Array(S * S);
  for (const cells of octaves) {
    const g = new Float32Array(cells * cells).map(() => rand());
    const amp = 1 / Math.sqrt(cells);
    for (let y = 0; y < S; y++) {
      const fy = (y / S) * cells;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < S; x++) {
        const fx = (x / S) * cells;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = g[(y0 % cells) * cells + (x0 % cells)];
        const b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
        const c = g[((y0 + 1) % cells) * cells + (x0 % cells)];
        const d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
        h[y * S + x] += (a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) + c * (1 - sx) * sy + d * sx * sy) * amp;
      }
    }
  }
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of h) {
    mn = Math.min(mn, v);
    mx = Math.max(mx, v);
  }
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - mn) / (mx - mn);
  return h;
}

/** Each generator fills alb/rough/grime/height in [0,1] for pixel (x,y). */
const GENERATORS = {
  // Painted aluminium panels with seams, fasteners and soot/grime streaks.
  panel(S, rand) {
    const n = fbmField(S, rand, [4, 8, 16]);
    const col = fbmField(S, rand, [8, 16]);
    const cols = 4;
    const rows = 2;
    const tone = Array.from({ length: cols * rows }, () => 0.95 + rand() * 0.08);
    const pw = S / cols;
    return (x, y) => {
      const u = (x / S) * cols;
      const v = (y / S) * rows;
      const cu = Math.floor(u);
      const cv = Math.floor(v);
      const fu = u - cu;
      const fv = v - cv;
      const edge = Math.min(fu, 1 - fu, (fv * rows) / cols, ((1 - fv) * rows) / cols) * pw;
      const seam = 1 - Math.min(1, Math.max(0, (edge - 1) / 2));
      const bevel = Math.min(1, edge / 6);
      const along = (fu * pw) % (pw / 6);
      const rivet = edge > 4 && edge < 7 && along > 4 && along < 7 ? 1 : 0;
      // Grime runs down from each panel's upper seam, varying smoothly across the panel.
      const streak = Math.max(0, col[x] - 0.45) * Math.pow(1 - fv, 2) * 0.8;
      const nv = n[y * S + x];
      return {
        alb: tone[cv * cols + cu] * 0.5 * (1 - seam * 0.3) - streak * 0.1 + (nv - 0.5) * 0.03 + rivet * 0.02,
        rough: 0.5 + nv * 0.08 + streak * 0.2 + seam * 0.2,
        grime: Math.max(seam * 0.8, streak * 0.5),
        height: 0.5 * bevel * (1 - seam) + rivet * 0.25 + nv * 0.04,
      };
    };
  },
  // Quilted multilayer insulation / ceramic-cloth blankets.
  mli(S, rand) {
    const n = fbmField(S, rand, [8, 16]);
    const cells = 4;
    return (x, y) => {
      const u = ((x / S) * cells) % 1;
      const v = ((y / S) * cells) % 1;
      const cush = Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
      const stitch = u < 0.03 || u > 0.97 || v < 0.03 || v > 0.97 ? 1 : 0;
      const nv = n[y * S + x];
      return {
        alb: 0.5 + (nv - 0.5) * 0.05 - stitch * 0.06 + cush * 0.02,
        rough: 0.75 + nv * 0.1 - cush * 0.08,
        grime: stitch * 0.5,
        height: Math.pow(cush, 0.6) * 0.8 + nv * 0.12,
      };
    };
  },
  // Brushed / machined metal.
  brushed(S, rand) {
    const raw = new Float32Array(S).map(() => rand());
    const lines = raw.map((_, i) => (raw[i] + raw[(i + 1) % S] + raw[(i + 2) % S] + raw[(i + S - 1) % S]) / 4);
    const n = fbmField(S, rand, [8, 16]);
    return (x, y) => {
      const l = lines[y] * 0.5 + lines[(y + 1) % S] * 0.5;
      const nv = n[y * S + x];
      return { alb: 0.47 + l * 0.06 + nv * 0.02, rough: 0.32 + l * 0.18 + nv * 0.08, grime: nv * 0.15, height: l * 0.25 };
    };
  },
  // Crinkled gold/kapton foil.
  foil(S, rand) {
    const pts = Array.from({ length: 28 }, () => [rand() * S, rand() * S, rand()]);
    return (x, y) => {
      let d1 = 1e9;
      let d2 = 1e9;
      let val = 0;
      for (const [px, py, v] of pts) {
        let dx = Math.abs(x - px);
        let dy = Math.abs(y - py);
        dx = Math.min(dx, S - dx);
        dy = Math.min(dy, S - dy);
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          val = v;
        } else if (d < d2) d2 = d;
      }
      const ridge = Math.sqrt(d2) - Math.sqrt(d1);
      return { alb: 0.45 + val * 0.1, rough: 0.22 + val * 0.18, grime: ridge < 2 ? 0.2 : 0, height: Math.min(1, ridge / 14) * 0.5 + val * 0.3 };
    };
  },
  // Carbon / glass-fibre composite twill.
  composite(S, rand) {
    const n = fbmField(S, rand, [32, 64]);
    const w = 16;
    return (x, y) => {
      const a = Math.floor((x + y) / w) % 2;
      const t = ((x + y) % w) / w;
      const ridge = Math.sin(t * Math.PI);
      const nv = n[y * S + x];
      return { alb: 0.46 + a * 0.05 + nv * 0.03, rough: 0.42 + a * 0.12, grime: 0.05, height: ridge * 0.4 + a * 0.15 };
    };
  },
  // Sintered regolith pavers / concrete.
  sintered(S, rand) {
    const n = fbmField(S, rand, [4, 8, 16, 32]);
    const tiles = 2;
    return (x, y) => {
      const u = ((x / S) * tiles) % 1;
      const v = ((y / S) * tiles) % 1;
      const joint = u < 0.012 || u > 0.988 || v < 0.012 || v > 0.988 ? 1 : 0;
      const nv = n[y * S + x];
      const pit = nv < 0.18 ? 1 : 0;
      return { alb: 0.5 + (nv - 0.5) * 0.3 - joint * 0.12 - pit * 0.08, rough: 0.85 + nv * 0.1, grime: joint * 0.6 + pit * 0.4, height: joint ? 0 : 0.5 + nv * 0.5 - pit * 0.3 };
    };
  },
  // Tyre rubber / elastomer.
  rubber(S, rand) {
    const n = fbmField(S, rand, [32, 64, 128]);
    return (x, y) => {
      const nv = n[y * S + x];
      return { alb: 0.5 + (nv - 0.5) * 0.1, rough: 0.85 + nv * 0.1, grime: nv * 0.2, height: nv * 0.5 };
    };
  },
  // Solar module: cells with silver busbars and fingers.
  solar(S, rand) {
    const cells = 4;
    const n = fbmField(S, rand, [16, 32]);
    return (x, y) => {
      const u = ((x / S) * cells) % 1;
      const v = ((y / S) * cells) % 1;
      const gap = u < 0.03 || u > 0.97 || v < 0.03 || v > 0.97;
      const bus = Math.abs(u - 0.33) < 0.012 || Math.abs(u - 0.66) < 0.012;
      const finger = (y % Math.round(S / cells / 24)) === 0;
      const nv = n[y * S + x];
      if (gap) return { alb: 0.92, rough: 0.5, grime: 0.2, height: 0.2 };
      if (bus) return { alb: 0.85, rough: 0.3, grime: 0, height: 0.6 };
      return { alb: 0.42 + nv * 0.05 + (finger ? 0.06 : 0), rough: 0.12 + nv * 0.06, grime: 0, height: 0.5 };
    };
  },
};

const surfaceTexCache = new Map();

export function surfaceTexture(kind, size = 256, anisotropy = 4) {
  const key = `${kind}:${size}`;
  if (surfaceTexCache.has(key)) return surfaceTexCache.get(key);
  const rand = mulberry32(kind.length * 977 + size);
  const f = GENERATORS[kind](size, rand);
  const data = new Uint8Array(size * size * 4);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = f(x, y);
      const i = (y * size + x) * 4;
      data[i] = c(s.alb);
      data[i + 1] = c(s.rough);
      data[i + 2] = c(s.grime);
      data[i + 3] = c(s.height);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  surfaceTexCache.set(key, t);
  return t;
}

// ── Triplanar surface material ─────────────────────────────────
export const DUST_COLOR = new THREE.Color("#a5623b");

const SURFACE_VERT_PARS = /* glsl */ `
varying vec3 vSObjPos;
varying vec3 vSObjNrm;
varying vec3 vSWNrm;`;
const SURFACE_FRAG_PARS = /* glsl */ `
uniform sampler2D uSurfTex;
uniform float uSurfScale;
uniform float uSurfMix;
uniform float uGrime;
uniform float uBump;
uniform float uDustTop;
uniform float uDustBase;
uniform float uDustHeight;
uniform vec3 uDustColor;
varying vec3 vSObjPos;
varying vec3 vSObjNrm;
varying vec3 vSWNrm;
vec4 triSample( vec3 p, vec3 n ) {
  vec3 w = pow( abs( n ), vec3( 4.0 ) );
  w /= ( w.x + w.y + w.z + 1e-5 );
  return texture2D( uSurfTex, p.zy * uSurfScale ) * w.x
       + texture2D( uSurfTex, p.xz * uSurfScale ) * w.y
       + texture2D( uSurfTex, p.xy * uSurfScale ) * w.z;
}
vec3 sPerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir ) {
  vec3 vSigmaX = normalize( dFdx( surf_pos ) );
  vec3 vSigmaY = normalize( dFdy( surf_pos ) );
  vec3 R1 = cross( vSigmaY, surf_norm );
  vec3 R2 = cross( surf_norm, vSigmaX );
  float fDet = dot( vSigmaX, R1 ) * faceDir;
  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
  return normalize( abs( fDet ) * surf_norm - vGrad );
}`;

function patchSurfaceShader(shader, u) {
  Object.assign(shader.uniforms, u);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${SURFACE_VERT_PARS}`)
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      vSObjPos = position;
      vSObjNrm = normal;
      #ifdef USE_INSTANCING
        vSWNrm = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );
      #else
        vSWNrm = normalize( mat3( modelMatrix ) * objectNormal );
      #endif`
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${SURFACE_FRAG_PARS}`)
    .replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      vec4 sTex = triSample( vSObjPos, vSObjNrm );
      diffuseColor.rgb *= mix( 1.0, sTex.r * 2.0, uSurfMix ) * ( 1.0 - sTex.b * uGrime );`
    )
    .replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      float sDust = smoothstep( 0.35, 0.95, vSWNrm.y ) * uDustTop
                  + ( 1.0 - smoothstep( 0.0, uDustHeight, vSObjPos.y ) ) * uDustBase;
      sDust = clamp( sDust * ( 0.55 + sTex.a * 0.9 ), 0.0, 1.0 );
      diffuseColor.rgb = mix( diffuseColor.rgb, uDustColor, sDust );`
    )
    .replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
      roughnessFactor = clamp( roughnessFactor * ( 0.55 + sTex.g * 0.9 ), 0.04, 1.0 );
      roughnessFactor = mix( roughnessFactor, 0.95, sDust );`
    )
    .replace(
      "#include <metalnessmap_fragment>",
      `#include <metalnessmap_fragment>
      metalnessFactor *= 1.0 - sDust;`
    )
    .replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
      normal = sPerturb( -vViewPosition, normal, vec2( dFdx( sTex.a ), dFdy( sTex.a ) ) * uBump, faceDirection );`
    );
}

let SURF_SIZE = 256;
let SURF_ANISO = 4;
export function configureSurfaces({ size, anisotropy }) {
  SURF_SIZE = size;
  SURF_ANISO = anisotropy;
}

/**
 * PBR material with procedural detail + dust weathering.
 * opts: color, roughness, metalness, kind, scale (tiles per metre), mix, grime, bump,
 *       dustTop, dustBase, dustHeight, plus any MeshStandardMaterial params (emissive…).
 */
export function surface(opts) {
  const {
    kind = "panel",
    scale = 0.4,
    mix = 1,
    grime = 0.25,
    bump = 0.5,
    dustTop = 0.55,
    dustBase = 0.6,
    dustHeight = 1.4,
    ...params
  } = opts;
  const mat = new THREE.MeshStandardMaterial(params);
  const uniforms = {
    uSurfTex: { value: surfaceTexture(kind, SURF_SIZE, SURF_ANISO) },
    uSurfScale: { value: scale },
    uSurfMix: { value: mix },
    uGrime: { value: grime },
    uBump: { value: bump },
    uDustTop: { value: dustTop },
    uDustBase: { value: dustBase },
    uDustHeight: { value: dustHeight },
    uDustColor: { value: DUST_COLOR },
  };
  mat.userData.surface = uniforms;
  mat.onBeforeCompile = (shader) => patchSurfaceShader(shader, uniforms);
  mat.customProgramCacheKey = () => "surface-v2";
  return mat;
}

// ── Photographic terrain + boulder textures ───────────────────
const loader = new THREE.TextureLoader();
function loadTex(url, anisotropy) {
  return new Promise((resolve) => {
    loader.load(
      url,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.NoColorSpace; // packed linear data
        t.anisotropy = anisotropy;
        resolve(t);
      },
      undefined,
      () => resolve(null)
    );
  });
}

/** Procedural stand-in used if the photographic sets fail to load (offline, blocked). */
function fallbackSet(seed, size) {
  const rand = mulberry32(seed);
  const n = createNoise2D(seed);
  const det = new Uint8Array(size * size * 4);
  const nr = new Uint8Array(size * size * 4);
  const h = fbmField(size, rand, [8, 16, 32, 64, 128]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const v = h[i];
      const g = Math.round((0.4 + v * 0.2 + n(x * 0.3, y * 0.3) * 0.02) * 255);
      det.set([g, g, g, 255], i * 4);
      const dx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
      const dy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
      nr.set([Math.round((0.5 - dx * 4) * 255), Math.round((0.5 - dy * 4) * 255), 235, 255], i * 4);
    }
  }
  const mk = (d) => {
    const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  return { detail: mk(det), nr: mk(nr) };
}

export async function loadGroundSets(size, anisotropy, onProgress) {
  const base = `${import.meta.env.BASE_URL}textures/`;
  const names = ["regolith", "bedrock", "strata"];
  const out = {};
  let done = 0;
  let failed = false;
  await Promise.all(
    names.map(async (n, idx) => {
      const [detail, nr] = await Promise.all([
        loadTex(`${base}${n}_detail_${size}.jpg`, anisotropy),
        loadTex(`${base}${n}_nr_${size}.jpg`, anisotropy),
      ]);
      if (!detail || !nr) {
        failed = true;
        out[n] = fallbackSet(31 + idx * 17, 256);
      } else out[n] = { detail, nr };
      onProgress?.(++done / names.length);
    })
  );
  out.fallback = failed;
  return out;
}

/** Macro variation (very low frequency) to break any remaining repetition. */
function macroTexture() {
  const S = 256;
  const h = fbmField(S, mulberry32(404), [4, 8, 16, 32, 64]);
  const h2 = fbmField(S, mulberry32(505), [6, 12, 24]);
  const d = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) d.set([Math.round(h[i] * 255), Math.round(h2[i] * 255), 0, 255], i * 4);
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * Layered-rock helpers shared by the terrain walls and the rock material.
 *  - rkHash: sin-free hash (stable on mobile GPUs at large arguments).
 *  - rkNoise: cheap 3D value noise for macro tone variation (ALU only, no texture fetch).
 *  - rkBands: sedimentary bedding that follows height. Returns (tone, bedding line, AA weight).
 *    Bed thickness varies with height; the thin dark lines are faded out once they get thinner than a
 *    few pixels so distant walls never moiré. LANDMARK_BANDS in landmarks.js mirrors this formula.
 */
const LAYERS_GLSL = /* glsl */ `
float rkHash( float p ) { p = fract( p * 0.1031 ); p *= p + 33.33; p *= p + p; return fract( p ); }
float rkNoise( vec3 p ) {
  vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  float n = dot( i, vec3( 1.0, 57.0, 113.0 ) );
  return mix( mix( mix( rkHash( n ), rkHash( n + 1.0 ), f.x ), mix( rkHash( n + 57.0 ), rkHash( n + 58.0 ), f.x ), f.y ),
              mix( mix( rkHash( n + 113.0 ), rkHash( n + 114.0 ), f.x ), mix( rkHash( n + 170.0 ), rkHash( n + 171.0 ), f.x ), f.y ), f.z );
}
vec2 rkRot( vec2 p, float a ) { float c = cos( a ), s = sin( a ); return vec2( c * p.x - s * p.y, s * p.x + c * p.y ); }
// x: per-bed tone, y: bedding-plane line (0..1), z: bed index
vec3 rkBands( float y, float period, out float aa ) {
  float u = y / period + 0.25 * sin( y * 1.9 / period );
  float L = floor( u );
  float f = u - L;
  aa = 1.0 - smoothstep( 0.035, 0.18, fwidth( u ) );
  float line = max( 1.0 - smoothstep( 0.0, 0.085, f ), smoothstep( 0.93, 1.0, f ) );
  return vec3( 0.84 + 0.28 * rkHash( L + 17.0 ), line, L );
}`;

const TERRAIN_VERT_PARS = /* glsl */ `
attribute vec2 aSurf;
varying vec2 vSurf;
varying vec3 vTWPos;
varying vec3 vTWNrm;`;

const TERRAIN_FRAG_PARS = /* glsl */ `
uniform sampler2D tRegD; uniform sampler2D tRegN;
uniform sampler2D tRockD; uniform sampler2D tRockN;
uniform sampler2D tStrD; uniform sampler2D tStrN;
uniform sampler2D tMacro;
varying vec2 vSurf;
varying vec3 vTWPos;
varying vec3 vTWNrm;
vec2 rot2( vec2 p, float a ) { float c = cos( a ), s = sin( a ); return vec2( c * p.x - s * p.y, s * p.x + c * p.y ); }
${LAYERS_GLSL}`;

export function terrainMaterial(sets, { low = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const uniforms = {
    tRegD: { value: sets.regolith.detail },
    tRegN: { value: sets.regolith.nr },
    tRockD: { value: sets.bedrock.detail },
    tRockN: { value: sets.bedrock.nr },
    tStrD: { value: sets.strata.detail },
    tStrN: { value: sets.strata.nr },
    tMacro: { value: macroTexture() },
  };
  if (low) mat.defines = { TERRAIN_LOW: "" };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${TERRAIN_VERT_PARS}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vSurf = aSurf;
        vTWPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
        vTWNrm = normalize( mat3( modelMatrix ) * objectNormal );`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${TERRAIN_FRAG_PARS}`)
      .replace(
        "#include <map_fragment>",
        /* glsl */ `#include <map_fragment>
        vec3 tN = normalize( vTWNrm );
        vec2 tp = vTWPos.xz;
        vec4 macro = texture2D( tMacro, tp / 420.0 );
        float slope = 1.0 - tN.y;
        // Regolith: two scales, the second rotated, blended by a macro mask → no visible tiling.
        vec3 rD1 = texture2D( tRegD, tp / 2.7 ).rgb;
        vec3 rN1 = texture2D( tRegN, tp / 2.7 ).rgb;
        #ifndef TERRAIN_LOW
          vec2 tp2 = rot2( tp, 0.73 ) / 9.5;
          vec3 rD2 = texture2D( tRegD, tp2 ).rgb;
          vec3 rN2 = texture2D( tRegN, tp2 ).rgb;
          float m2 = 0.3 + macro.g * 0.4;
          rD1 = mix( rD1, rD2, m2 );
          rN1 = mix( rN1, rN2, m2 );
        #endif
        // Bedrock on rough / rocky ground, horizontal strata on steep walls.
        float rockW = clamp( smoothstep( 0.1, 0.32, slope ) + vSurf.x * 0.9 + smoothstep( 0.62, 0.9, macro.r ) * 0.25, 0.0, 1.0 );
        vec3 bD = texture2D( tRockD, rot2( tp, 1.9 ) / 6.5 ).rgb;
        vec3 bN = texture2D( tRockN, rot2( tp, 1.9 ) / 6.5 ).rgb;
        vec2 sideUV = abs( tN.x ) > abs( tN.z ) ? vTWPos.zy : vTWPos.xy;
        float strW = smoothstep( 0.32, 0.55, slope );
        vec3 sD = texture2D( tStrD, sideUV / vec2( 14.0, 7.0 ) ).rgb;
        vec3 sN = texture2D( tStrN, sideUV / vec2( 14.0, 7.0 ) ).rgb;
        // The cliff photo has blown-out highlights; compress them so steep faces never streak white.
        sD = min( 0.5 + ( sD - 0.5 ) * 0.8, vec3( 0.66 ) );
        vec3 tDet = mix( mix( rD1, bD, rockW ), sD, strW );
        vec3 tNR = mix( mix( rN1, bN, rockW ), sN, strW );
        // Distant terrain converges to its average so mip noise never shimmers.
        float tFar = smoothstep( 120.0, 900.0, length( vTWPos - cameraPosition ) );
        tDet = clamp( ( tDet - 0.5 ) * mix( 1.55, 1.3, strW ) + 0.5, 0.0, 1.0 );
        // Mid-scale structure (tens of metres) so the ground still reads from orbit distance.
        float midL = dot( texture2D( tRockD, rot2( tp, 0.4 ) / 46.0 ).rgb, vec3( 0.333 ) );
        tDet *= mix( 1.0, midL * 2.0, 0.42 );
        tDet = mix( tDet, vec3( 0.5 ), tFar * 0.6 );
        // Rock exposures are darker and cooler than dust; dust brightens with the macro mask.
        vec3 rockTint = mix( vec3( 1.0 ), vec3( 0.62, 0.55, 0.52 ), rockW * 0.75 + strW * 0.3 );
        // Sedimentary bedding on walls and rock exposures follows world height (warped gently over
        // hundreds of metres), with per-bed tone/hue and thin darker bedding planes.
        float twY = vTWPos.y + 1.6 * sin( dot( vTWPos.xz, vec2( 0.021, 0.013 ) ) ) + 0.8 * sin( dot( vTWPos.xz, vec2( -0.011, 0.034 ) ) );
        float tbAA;
        vec3 tb = rkBands( twY, 4.2, tbAA );
        vec3 tbHue = mix( vec3( 1.0 ), vec3( 1.08, 0.96, 0.85 ), rkHash( tb.z + 3.0 ) * 0.8 );
        vec3 tBand = mix( vec3( 1.0 ), tb.x * tbHue * ( 1.0 - tb.y * 0.32 ), tbAA );
        tBand = mix( vec3( 1.0 ), tBand, clamp( strW * 0.95 + rockW * 0.3, 0.0, 1.0 ) * ( 1.0 - tFar * 0.7 ) );
        diffuseColor.rgb *= tDet * 2.0 * rockTint * tBand * ( 0.9 + macro.r * 0.2 );`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp( 0.72 + tNR.b * 0.32, 0.6, 1.0 );
        // Rock faces are matte: no glints from the perturbed normals on steep walls.
        roughnessFactor = mix( roughnessFactor, max( roughnessFactor, 0.92 ), clamp( strW + rockW * 0.6, 0.0, 1.0 ) );`
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `#include <normal_fragment_maps>
        {
          // Strong relief on open ground; much gentler on slopes, where the top-projected perturbation
          // used to tilt normals past the sun and produce bright streaks.
          vec2 nt = ( tNR.rg * 2.0 - 1.0 ) * ( 1.0 - tFar ) * mix( 2.1, 0.6, smoothstep( 0.1, 0.45, slope ) );
          // Top projection perturbs along world X/Z; side strata perturb along the wall plane.
          vec3 topP = vec3( nt.x, 0.0, nt.y );
          vec3 sideP = abs( tN.x ) > abs( tN.z ) ? vec3( 0.0, nt.y, nt.x ) : vec3( nt.x, nt.y, 0.0 );
          vec3 tPert = mix( topP, sideP, strW );
          tPert -= tN * dot( tPert, tN ); // keep the perturbation in the surface plane
          vec3 nW = normalize( tN + tPert );
          normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
        }`
      );
  };
  mat.customProgramCacheKey = () => `terrain-v2${low ? "-low" : ""}`;
  return mat;
}

/**
 * Rock material for boulders (instanced) and landmarks (`{ landmark: true }`).
 * Texture fetches per fragment: boulders 6 (bedrock triplanar at two scales, the second rotated);
 * landmarks 6 (bedrock triplanar 3 + cliff-strata biplanar 2 + one coarse top-down bedrock).
 * Large-scale structure (macro tone, bedding, height gradient, dust) is procedural ALU.
 */
export function rockMaterial(sets, { landmark = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: landmark });
  // x: fine tiles per object unit, y: coarse tiles per unit, z: macro noise frequency.
  const scale = landmark ? new THREE.Vector3(1 / 3.2, 1 / 15, 1 / 9) : new THREE.Vector3(2.2, 0.62, 1.3);
  const uniforms = {
    tRockD: { value: sets.bedrock.detail },
    tStrD: { value: sets.strata.detail },
    uRockScale: { value: scale },
    uDustColor: { value: DUST_COLOR },
  };
  if (landmark) mat.defines = { ROCK_LANDMARK: "" };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRP; varying vec3 vRN; varying float vRUp;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vRP = position; vRN = normal;
        #ifdef USE_INSTANCING
          // Offset each instance's texture space by its position so no two boulders match.
          vRP += instanceMatrix[3].xyz * 0.173;
          vRUp = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal ).y;
        #else
          vRUp = normalize( mat3( modelMatrix ) * objectNormal ).y;
        #endif`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D tRockD; uniform sampler2D tStrD; uniform vec3 uRockScale; uniform vec3 uDustColor;
        varying vec3 vRP; varying vec3 vRN; varying float vRUp;
        ${LAYERS_GLSL}`
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        vec3 rw = pow( abs( vRN ), vec3( 4.0 ) ); rw /= rw.x + rw.y + rw.z + 1e-5;
        vec3 p1 = vRP * uRockScale.x;
        vec3 rd = texture2D( tRockD, p1.zy ).rgb * rw.x + texture2D( tRockD, p1.xz ).rgb * rw.y + texture2D( tRockD, p1.xy ).rgb * rw.z;
        vec3 p2 = vRP * uRockScale.y;
        #ifdef ROCK_LANDMARK
          // Bedding follows (gently warped) height, like the layered rock the landmark was carved from.
          float yw = vRP.y + 1.4 * sin( dot( vRP.xz, vec2( 0.13, 0.09 ) ) ) + 0.8 * sin( dot( vRP.xz, vec2( -0.07, 0.19 ) ) );
          // Coarse layer: cliff strata on the sides (biplanar, v = height) + one rotated top-down bedrock.
          vec2 sS = vec2( 1.0 / 14.0, 1.0 / 5.5 );
          float sW = rw.x + rw.z + 1e-5;
          vec3 c2 = ( texture2D( tStrD, vec2( vRP.z, yw ) * sS ).rgb * rw.x + texture2D( tStrD, vec2( vRP.x, yw ) * sS ).rgb * rw.z ) / sW;
          c2 = min( 0.5 + ( c2 - 0.5 ) * 0.8, vec3( 0.68 ) ); // tame the photo's blown highlights
          c2 = mix( c2, texture2D( tRockD, rkRot( p2.xz, 2.1 ) ).rgb, rw.y );
        #else
          vec3 c2 = texture2D( tRockD, rkRot( p2.zy, 0.9 ) ).rgb * rw.x + texture2D( tRockD, rkRot( p2.xz, 2.1 ) ).rgb * rw.y + texture2D( tRockD, rkRot( p2.xy, -1.3 ) ).rgb * rw.z;
        #endif
        // Fine detail rides on coarse structure (ratio maps multiply), then macro tone/hue noise.
        vec3 rRatio = ( 1.0 + ( rd * 2.0 - 1.0 ) * 0.7 ) * ( 1.0 + ( c2 * 2.0 - 1.0 ) * 0.6 );
        vec3 mp = vRP * uRockScale.z;
        float rM = rkNoise( mp ) * 0.65 + rkNoise( mp * 2.7 + 11.0 ) * 0.35;
        rRatio *= ( 0.8 + 0.4 * rM ) * mix( vec3( 1.0 ), vec3( 1.06, 0.97, 0.88 ), smoothstep( 0.55, 0.8, rM ) );
        float rLine = 0.0;
        #ifdef ROCK_LANDMARK
          float bAA;
          vec3 bnd = rkBands( yw, 2.6, bAA );
          vec3 bHue = mix( vec3( 1.0 ), vec3( 1.07, 0.96, 0.86 ), rkHash( bnd.z + 3.0 ) * 0.85 );
          rLine = bnd.y * bAA * ( 1.0 - rw.y );
          rRatio *= mix( vec3( 1.0 ), bnd.x * bHue, bAA * ( 1.0 - rw.y * 0.5 ) ) * ( 1.0 - rLine * 0.4 );
          // Broad units + height gradient: darker base, paler wind-scoured upper rock.
          rRatio *= ( 0.8 + 0.24 * clamp( vRP.y / 44.0, 0.0, 1.0 ) ) * ( 0.94 + 0.08 * sin( yw * 0.23 + 0.5 ) );
        #endif
        diffuseColor.rgb *= rRatio;
        // Overhangs and undersides see less sky.
        diffuseColor.rgb *= 0.74 + 0.26 * smoothstep( -0.75, -0.05, vRUp );
        float rLum = dot( rRatio, vec3( 0.333 ) );
        float rDust = smoothstep( 0.5, 0.93, vRUp ) * 0.75;
        #ifdef ROCK_LANDMARK
          rDust = max( rDust, ( 1.0 - smoothstep( 0.0, 1.6 + 2.2 * rM, vRP.y ) ) * 0.6 );
        #endif
        rDust = clamp( rDust * ( 1.45 - rLum * 0.45 - rM * 0.3 ), 0.0, 1.0 ); // dust settles in darker hollows first
        diffuseColor.rgb = mix( diffuseColor.rgb, uDustColor * ( rLum * 0.8 + 0.25 ), rDust );`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp( 0.86 + ( 0.5 - rLum * 0.5 ) * 0.18 + rDust * 0.1, 0.78, 1.0 );`
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 sX = dFdx( -vViewPosition ); vec3 sY = dFdy( -vViewPosition );
          float rView = length( vViewPosition );
          // (1) Analytic relief (macro lumps, bedding notches): smooth functions, so a scale-correct
          //     bump (heights in metres, Mikkelsen's unnormalised form) is alias-free at any distance.
          #ifdef ROCK_LANDMARK
            float aH = rM * 0.4 - rLine * 0.09;
          #else
            float aH = rM * 0.1;
          #endif
          vec3 R1 = cross( sY, normal ); vec3 R2 = cross( normal, sX );
          float fD = dot( sX, R1 ) * faceDirection;
          normal = normalize( abs( fD ) * normal - sign( fD ) * ( dFdx( aH ) * R1 + dFdy( aH ) * R2 ) );
          // (2) Photographic micro relief: screen-space bump at low gain, faded out with distance
          //     (the photo's full-frequency content must never be treated as metres of relief).
          #ifdef ROCK_LANDMARK
            float tH = dot( rd * 0.6 + c2 * 0.4, vec3( 0.333 ) ) * 0.42 * ( 1.0 - smoothstep( 20.0, 110.0, rView ) );
          #else
            float tH = dot( rd * 0.6 + c2 * 0.4, vec3( 0.333 ) ) * 0.5 * ( 1.0 - smoothstep( 10.0, 60.0, rView ) );
          #endif
          vec3 nX = normalize( sX ); vec3 nY = normalize( sY );
          R1 = cross( nY, normal ); R2 = cross( normal, nX );
          fD = dot( nX, R1 ) * faceDirection;
          normal = normalize( abs( fD ) * normal - sign( fD ) * ( dFdx( tH ) * R1 + dFdy( tH ) * R2 ) );
        }`
      );
  };
  mat.customProgramCacheKey = () => (landmark ? "rock-v3-landmark" : "rock-v3");
  return mat;
}
