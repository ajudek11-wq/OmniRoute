import * as THREE from "three";
import { CORE, gridHeight, coreNode, detail, heightGrids } from "./heights.js";
import { moonify } from "./shade.js";
import { SITE } from "./layout.js";

/**
 * Terrain LOD: three nested levels that share one photographic regolith material.
 *   L0 — ~1 m mesh, 192 m across, re-centred on the player (analytic fine detail, casts shadows)
 *   L1 — 4 m mesh, 1 km across, re-centred on the player (core grid nodes)
 *   L2 — a static polar mesh from the base out to 34 km: the far terrain and the horizon
 * Coarser levels hide under finer ones: their vertices inside the finer footprint are pushed down
 * in the vertex shader, and polygon offset makes the finer level win where they overlap.
 */

const loader = new THREE.TextureLoader();
function tex(url, { color = true, aniso = 8 } = {}) {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}

export function loadMoonTextures(renderer) {
  const aniso = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
  return {
    reg: tex("./moon/regolith_diff.jpg", { aniso }),
    regN: tex("./moon/regolith_nor.jpg", { color: false, aniso }),
    grv: tex("./moon/gravel_diff.jpg", { aniso }),
    grvN: tex("./moon/gravel_nor.jpg", { color: false, aniso }),
    rock: tex("./moon/rock_diff.jpg", { aniso }),
    rockN: tex("./moon/rock_nor.jpg", { color: false, aniso }),
  };
}

const TERRAIN_VERT_PARS = /* glsl */ `
uniform vec4 uHole;
varying vec3 vTW;
varying vec3 vTN;`;
const TERRAIN_VERT = /* glsl */ `
if ( uHole.z > 0.0 && abs( transformed.x - uHole.x ) < uHole.z && abs( transformed.z - uHole.y ) < uHole.z ) transformed.y -= uHole.w;
vTW = transformed;
vTN = normalize( objectNormal );`;

const TERRAIN_FRAG_PARS = /* glsl */ `
uniform sampler2D tReg; uniform sampler2D tRegN; uniform sampler2D tGrv; uniform sampler2D tGrvN; uniform sampler2D tRock;
uniform vec4 uFresh; uniform vec4 uTubeCut; uniform float uTubeFloor;
varying vec3 vTW;
varying vec3 vTN;
float tMacro; float tGm; float tRk;`;

const TERRAIN_MAP = /* glsl */ `
{
  if ( vTW.x > uTubeCut.x && vTW.x < uTubeCut.x + 30.0 && abs( vTW.z - uTubeCut.y ) < uTubeCut.z && vTW.y < uTubeCut.w && vTW.y > uTubeFloor + 0.7 ) discard;
  vec2 p = vTW.xz;
  float dist = length( vTW - cameraPosition );
  vec3 c1 = texture2D( tReg, p * 0.29 ).rgb;
  vec3 c2 = texture2D( tReg, p * 0.071 + vec2( 0.37, 0.61 ) ).rgb;
  vec3 g1 = texture2D( tGrv, p * 0.16 + vec2( 0.13, 0.7 ) ).rgb;
  tMacro = texture2D( tGrv, p * 0.0037 ).r;
  float m2 = texture2D( tReg, p * 0.00083 + 0.5 ).r;
  float m3 = texture2D( tReg, p * 0.00011 ).r;
  tGm = smoothstep( 0.32, 0.62, tMacro + ( m2 - 0.5 ) * 0.7 );
  vec3 reg = mix( c1, c2, 0.42 );
  vec3 alb = mix( reg, g1, tGm * 0.6 );
  // Steep slopes expose rock (triplanar, so crater and pit walls do not stretch).
  float slope = 1.0 - clamp( vTN.y, 0.0, 1.0 );
  tRk = smoothstep( 0.3, 0.55, slope + ( tMacro - 0.5 ) * 0.3 );
  if ( tRk > 0.01 ) {
    vec3 bw = pow( abs( vTN ), vec3( 4.0 ) );
    bw /= ( bw.x + bw.y + bw.z );
    vec3 rc = texture2D( tRock, vTW.zy * 0.11 ).rgb * bw.x + texture2D( tRock, vTW.xz * 0.11 ).rgb * bw.y + texture2D( tRock, vTW.xy * 0.11 ).rgb * bw.z;
    alb = mix( alb, rc * 0.92, tRk );
  }
  // Mature (darker) vs fresh (brighter) regolith; a bright ejecta halo around the fresh crater.
  alb *= 0.78 + 0.34 * m2 + 0.22 * ( m3 - 0.5 );
  float fr = length( p - uFresh.xy ) / uFresh.z;
  alb *= 1.0 + uFresh.w * exp( -max( fr - 0.85, 0.0 ) * 1.7 ) * ( 0.65 + 0.7 * tMacro ) * smoothstep( 0.6, 1.0, fr + 0.3 );
  diffuseColor.rgb *= alb;
}`;

const TERRAIN_NORMAL = /* glsl */ `
{
  vec2 p = vTW.xz;
  float dist = length( vTW - cameraPosition );
  float nk = 1.0 - smoothstep( 6.0, 70.0, dist );
  float nk2 = 1.0 - smoothstep( 60.0, 420.0, dist );
  vec3 nW = normalize( vTN );
  if ( nk > 0.0 ) {
    vec3 t1 = texture2D( tRegN, p * 0.29 ).xyz * 2.0 - 1.0;
    vec3 t2 = texture2D( tGrvN, p * 0.16 + vec2( 0.13, 0.7 ) ).xyz * 2.0 - 1.0;
    vec3 tn = mix( t1, t2, tGm * 0.6 );
    vec3 Tw = normalize( vec3( 1.0, 0.0, 0.0 ) - nW * nW.x );
    vec3 Bw = normalize( cross( Tw, nW ) );
    nW = normalize( Tw * tn.x * nk * 1.2 + Bw * tn.y * nk * 1.2 + nW * max( tn.z, 0.2 ) );
  }
  if ( nk2 > 0.0 ) {
    // Larger lumps (~10 m) from the same maps at a coarser scale.
    vec3 t3 = texture2D( tRegN, p * 0.043 + vec2( 0.31, 0.17 ) ).xyz * 2.0 - 1.0;
    vec3 Tw2 = normalize( vec3( 1.0, 0.0, 0.0 ) - nW * nW.x );
    vec3 Bw2 = normalize( cross( Tw2, nW ) );
    nW = normalize( nW + ( Tw2 * t3.x + Bw2 * t3.y ) * nk2 * 0.5 );
  }
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
}`;

export function terrainMaterial(T, { hole = null, offset = 0 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uni = {
    tReg: { value: T.reg },
    tRegN: { value: T.regN },
    tGrv: { value: T.grv },
    tGrvN: { value: T.grvN },
    tRock: { value: T.rock },
    uHole: { value: hole ?? new THREE.Vector4(0, 0, 0, 0) },
    uFresh: { value: new THREE.Vector4(SITE.fresh.x, SITE.fresh.z, SITE.fresh.R, 0.32) },
    uTubeCut: { value: new THREE.Vector4(SITE.tube.x0 - 9, SITE.tube.z, SITE.tube.halfW + 0.6, 0) },
    uTubeFloor: { value: 0 },
  };
  mat.userData.uni = uni;
  moonify(mat, {
    ls: true,
    key: "terrain",
    extra: (shader) => {
      Object.assign(shader.uniforms, uni);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${TERRAIN_VERT_PARS}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${TERRAIN_VERT}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${TERRAIN_FRAG_PARS}`)
        .replace("#include <map_fragment>", TERRAIN_MAP)
        .replace("#include <normal_fragment_maps>", TERRAIN_NORMAL);
    },
  });
  if (offset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = offset;
    mat.polygonOffsetUnits = offset * 2;
  }
  return mat;
}

/** A square grid patch geometry with `cells`² quads (positions filled later). */
function gridGeometry(cells) {
  const n = cells + 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
  const idx = new (n * n > 65535 ? Uint32Array : Uint16Array)(cells * cells * 6);
  let k = 0;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Alternate the diagonal for a less directional look.
      if ((i + j) & 1) idx.set([a, c, b, b, c, d], k);
      else idx.set([a, c, d, a, d, b], k);
      k += 6;
    }
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Fill a grid patch from a height sampler (with a one-cell border for normals). */
function fillPatch(geo, cells, step, x0, z0, sample) {
  const n = cells + 1;
  const m = n + 2;
  const H = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) H[j * m + i] = sample(x0 + (i - 1) * step, z0 + (j - 1) * step, i - 1, j - 1);
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      const hc = H[(j + 1) * m + i + 1];
      pos[k] = x0 + i * step;
      pos[k + 1] = hc;
      pos[k + 2] = z0 + j * step;
      const dx = H[(j + 1) * m + i + 2] - H[(j + 1) * m + i];
      const dz = H[(j + 2) * m + i + 1] - H[j * m + i + 1];
      const nx = -dx;
      const ny = 2 * step;
      const nz = -dz;
      const l = Math.hypot(nx, ny, nz);
      nor[k] = nx / l;
      nor[k + 1] = ny / l;
      nor[k + 2] = nz / l;
    }
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.needsUpdate = true;
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
}

export function createTerrain(ctx, T) {
  heightGrids();
  const tier = ctx.tier;
  const L0cfg = { high: { cells: 192, step: 1 }, balanced: { cells: 120, step: 1.6 }, low: { cells: 96, step: 2 } }[tier] ?? { cells: 120, step: 1.6 };
  const L1cfg = tier === "low" ? { cells: 128, step: 8 } : { cells: 256, step: 4 };
  const half0 = (L0cfg.cells * L0cfg.step) / 2;
  const half1 = (L1cfg.cells * L1cfg.step) / 2;
  const group = new THREE.Group();
  group.name = "moon-terrain";

  const hole1 = new THREE.Vector4(0, 0, half0 - L1cfg.step * 2, 60);
  const hole2 = new THREE.Vector4(0, 0, half1 - 48, 120);
  const mat0 = terrainMaterial(T);
  const mat1 = terrainMaterial(T, { hole: hole1, offset: 2 });
  const mat2 = terrainMaterial(T, { hole: hole2, offset: 4 });
  const mats = [mat0, mat1, mat2];

  const geo0 = gridGeometry(L0cfg.cells);
  const geo1 = gridGeometry(L1cfg.cells);
  const m0 = new THREE.Mesh(geo0, mat0);
  const m1 = new THREE.Mesh(geo1, mat1);
  m0.castShadow = true;
  m0.receiveShadow = true;
  m1.receiveShadow = true;
  m0.frustumCulled = m1.frustumCulled = false;
  m0.renderOrder = -2;
  m1.renderOrder = -1;
  group.add(m0, m1);

  // Static far mesh (polar, centred on the base).
  const A = { high: 384, balanced: 320, low: 256 }[tier] ?? 320;
  const radii = [0];
  const k = tier === "low" ? 0.022 : 0.016;
  const r0 = tier === "low" ? 14 : 10;
  while (radii[radii.length - 1] < 34000) radii.push(radii[radii.length - 1] + r0 + k * radii[radii.length - 1]);
  const R = radii.length;
  const pos = new Float32Array(R * A * 3);
  const nor = new Float32Array(R * A * 3);
  for (let r = 0; r < R; r++) {
    const rad = radii[r];
    const e = Math.max(2, (r0 + k * rad) * 0.5);
    for (let a = 0; a < A; a++) {
      const th = (a / A) * Math.PI * 2;
      const x = Math.cos(th) * rad;
      const z = Math.sin(th) * rad;
      const o = (r * A + a) * 3;
      pos[o] = x;
      pos[o + 1] = gridHeight(x, z);
      pos[o + 2] = z;
      const dx = gridHeight(x + e, z) - gridHeight(x - e, z);
      const dz = gridHeight(x, z + e) - gridHeight(x, z - e);
      const l = Math.hypot(dx, 2 * e, dz);
      nor[o] = -dx / l;
      nor[o + 1] = (2 * e) / l;
      nor[o + 2] = -dz / l;
    }
  }
  const idx = new Uint32Array((R - 1) * A * 6);
  let q = 0;
  for (let r = 0; r < R - 1; r++) {
    for (let a = 0; a < A; a++) {
      const a1 = (a + 1) % A;
      const i0 = r * A + a;
      const i1 = r * A + a1;
      const i2 = (r + 1) * A + a;
      const i3 = (r + 1) * A + a1;
      idx.set([i0, i2, i1, i1, i2, i3], q);
      q += 6;
    }
  }
  const geo2 = new THREE.BufferGeometry();
  geo2.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo2.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo2.setIndex(new THREE.BufferAttribute(idx, 1));
  geo2.computeBoundingSphere();
  const m2 = new THREE.Mesh(geo2, mat2);
  m2.receiveShadow = true;
  m2.frustumCulled = false;
  group.add(m2);

  // ── Height queries ──
  const c0 = { x: 1e9, z: 1e9 };
  const c1 = { x: 1e9, z: 1e9 };
  const fade0 = (x, z) => {
    const d = Math.max(Math.abs(x - c0.x), Math.abs(z - c0.z));
    return Math.min(1, Math.max(0, (half0 - d) / 18));
  };
  /** Terrain surface height (what the near mesh shows). */
  const surfaceAt = (x, z) => gridHeight(x, z) + detail(x, z) * fade0(x, z);

  function rebuild0(px, pz) {
    const snap = 16;
    c0.x = Math.round(px / snap) * snap;
    c0.z = Math.round(pz / snap) * snap;
    const x0 = c0.x - half0;
    const z0 = c0.z - half0;
    fillPatch(geo0, L0cfg.cells, L0cfg.step, x0, z0, (x, z) => surfaceAt(x, z));
    hole1.x = c0.x;
    hole1.y = c0.z;
  }
  function rebuild1(px, pz) {
    const snap = 64;
    c1.x = Math.round(px / snap) * snap;
    c1.z = Math.round(pz / snap) * snap;
    const x0 = c1.x - half1;
    const z0 = c1.z - half1;
    const s = L1cfg.step;
    const i0 = Math.round((x0 - CORE.min) / CORE.step);
    const j0 = Math.round((z0 - CORE.min) / CORE.step);
    const ratio = s / CORE.step;
    fillPatch(geo1, L1cfg.cells, s, x0, z0, (x, z, i, j) => {
      const ii = i0 + i * ratio;
      const jj = j0 + j * ratio;
      if (ii >= 0 && jj >= 0 && ii < CORE.n && jj < CORE.n) return coreNode(ii, jj);
      return gridHeight(x, z);
    });
    hole2.x = c1.x;
    hole2.y = c1.z;
  }

  return {
    group,
    mats,
    meshes: [m0, m1, m2],
    surfaceAt,
    setTubeFloor(y) {
      for (const m of mats) {
        m.userData.uni.uTubeFloor.value = y;
        m.userData.uni.uTubeCut.value.w = y + SITE.tube.height + 0.5;
      }
    },
    /** Re-centre the moving levels on the player; returns true if the near mesh changed. */
    update(px, pz) {
      let changed = false;
      if (Math.hypot(px - c1.x, pz - c1.z) > 128) rebuild1(px, pz);
      if (Math.hypot(px - c0.x, pz - c0.z) > 32) {
        rebuild0(px, pz);
        changed = true;
      }
      return changed;
    },
    stats: { L0: L0cfg, L1: L1cfg, farRings: R, farSegs: A },
  };
}
