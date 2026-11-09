import * as THREE from "three";
import { CORE, FAR, gridHeight } from "./heights.js";

/**
 * Airless lighting for every Moon material.
 *
 *  - Terrain self-shadowing from a Sun 1.5° above the horizon is baked once into "shadow height"
 *    maps in a Sun-aligned frame: for each point, the height below which the Sun is hidden by the
 *    terrain upwind. A fragment compares its own world height against it, so objects standing in a
 *    shadowed hollow are dark too, while a mast tip above it still catches the light.
 *  - Regolith (terrain, boulders) uses a Lommel-Seeliger-like photometric term instead of pure
 *    Lambert: the lunar surface stays bright at grazing illumination and has no limb darkening.
 *  - Nothing else: no sky light and no fog. Shadow interiors only get the faint earthshine light.
 */

export const shadeUniforms = {
  uShCore: { value: null },
  uShFar: { value: null },
  uShCoreG: { value: new THREE.Vector4() },
  uShFarG: { value: new THREE.Vector4() },
  uSunU: { value: new THREE.Vector2(1, 0) },
};

const VERT_PARS = /* glsl */ `
varying vec3 vMoonW;`;
const VERT_MAIN = /* glsl */ `
{
  vec4 mw = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    mw = instanceMatrix * mw;
  #endif
  vMoonW = ( modelMatrix * mw ).xyz;
}`;

const FRAG_PARS = /* glsl */ `
varying vec3 vMoonW;
uniform sampler2D uShCore;
uniform sampler2D uShFar;
uniform vec4 uShCoreG;
uniform vec4 uShFarG;
uniform vec2 uSunU;
float moonFetch( sampler2D t, vec2 p, float n ) {
  vec2 q = clamp( p, vec2( 0.0 ), vec2( n - 1.001 ) );
  ivec2 i = ivec2( floor( q ) );
  vec2 f = q - vec2( i );
  float a = texelFetch( t, i, 0 ).r;
  float b = texelFetch( t, i + ivec2( 1, 0 ), 0 ).r;
  float c = texelFetch( t, i + ivec2( 0, 1 ), 0 ).r;
  float d = texelFetch( t, i + ivec2( 1, 1 ), 0 ).r;
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
float moonSunVis() {
  #ifdef MOON_INDOOR
    return 0.0;
  #endif
  vec2 uv = vec2( dot( vMoonW.xz, uSunU ), dot( vMoonW.xz, vec2( -uSunU.y, uSunU.x ) ) );
  vec2 pc = ( uv - uShCoreG.x ) / uShCoreG.y;
  float S;
  if ( pc.x > 2.0 && pc.y > 2.0 && pc.x < uShCoreG.z - 3.0 && pc.y < uShCoreG.z - 3.0 ) S = moonFetch( uShCore, pc, uShCoreG.z );
  else S = moonFetch( uShFar, ( uv - uShFarG.x ) / uShFarG.y, uShFarG.z );
  return smoothstep( S - 0.9, S - 0.15, vMoonW.y );
}
float moonPhoto( vec3 L, vec3 N, vec3 V ) {
  #ifdef MOON_LS
    float mu0 = max( dot( N, L ), 0.0 );
    float mu = max( dot( N, V ), 0.0 );
    return 1.5 / ( mu0 + mu + 0.1 );
  #else
    return 1.0;
  #endif
}`;

const LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace(
  "getDirectionalLightInfo( directionalLight, directLight );",
  `getDirectionalLightInfo( directionalLight, directLight );
		directLight.color *= moonPhoto( directLight.direction, geometryNormal, geometryViewDir );
		if ( UNROLLED_LOOP_INDEX == 0 ) directLight.color *= moonSunVis();`
);

/** Patch a standard material for Moon lighting. `ls`: regolith photometry. `extra`: more patches. */
export function moonify(mat, { ls = false, indoor = false, extra = null, key = "" } = {}) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey?.() ?? "";
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, shadeUniforms);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${VERT_PARS}`).replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${ls ? "#define MOON_LS" : ""}\n${indoor ? "#define MOON_INDOOR" : ""}\n${FRAG_PARS}`)
      .replace("#include <lights_fragment_begin>", LIGHTS);
    extra?.(shader);
  };
  mat.customProgramCacheKey = () => `moon${ls ? "-ls" : ""}${indoor ? "-in" : ""}-${key}|${prevKey}`;
  return mat;
}

/**
 * Bake the shadow-height maps for a Sun at azimuth `sunDir` (horizontal part) and elevation `el`.
 * Sun frame: u along the horizontal Sun direction, v perpendicular to it.
 */
export function bakeShadows(sunDir, elDeg) {
  const sx0 = sunDir.x;
  const sz0 = sunDir.z;
  const l = Math.hypot(sx0, sz0);
  const sx = sx0 / l;
  const sz = sz0 / l;
  const tanEl = Math.tan((elDeg * Math.PI) / 180);
  const sweep = (g, init) => {
    const n = g.n;
    const out = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const v = g.min + j * g.step;
      // Start at the sunward edge (largest u) and walk away from the Sun.
      let S = init ? init(g.min + (n - 1) * g.step, v) : -1e9;
      let hPrev = -1e9;
      for (let i = n - 1; i >= 0; i--) {
        const u = g.min + i * g.step;
        const x = u * sx - v * sz;
        const z = u * sz + v * sx;
        const h = gridHeight(x, z);
        if (i < n - 1) S = Math.max(S, hPrev) - g.step * tanEl;
        out[j * n + i] = S;
        hPrev = h;
      }
    }
    return out;
  };
  const far = sweep(FAR, null);
  const sampleFar = (u, v) => {
    const fi = Math.min(FAR.n - 1.001, Math.max(0, (u - FAR.min) / FAR.step));
    const fj = Math.min(FAR.n - 1.001, Math.max(0, (v - FAR.min) / FAR.step));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const a = far[j * FAR.n + i] + (far[j * FAR.n + i + 1] - far[j * FAR.n + i]) * (fi - i);
    const b = far[(j + 1) * FAR.n + i] + (far[(j + 1) * FAR.n + i + 1] - far[(j + 1) * FAR.n + i]) * (fi - i);
    return a + (b - a) * (fj - j);
  };
  const core = sweep(CORE, sampleFar);
  const tex = (data, g) => {
    const t = new THREE.DataTexture(data, g.n, g.n, THREE.RedFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  shadeUniforms.uShCore.value = tex(core, CORE);
  shadeUniforms.uShFar.value = tex(far, FAR);
  shadeUniforms.uShCoreG.value.set(CORE.min, CORE.step, CORE.n, 0);
  shadeUniforms.uShFarG.value.set(FAR.min, FAR.step, FAR.n, 0);
  shadeUniforms.uSunU.value.set(sx, sz);
  // CPU-side query (for the suit light and gameplay): is this world point in terrain shadow?
  const coreLim = -CORE.min - CORE.step * 3;
  return {
    shadowHeight(x, z) {
      const u = x * sx + z * sz;
      const v = -x * sz + z * sx;
      if (Math.abs(u) < coreLim && Math.abs(v) < coreLim) {
        const fi = (u - CORE.min) / CORE.step;
        const fj = (v - CORE.min) / CORE.step;
        const i = Math.floor(fi);
        const j = Math.floor(fj);
        const n = CORE.n;
        const a = core[j * n + i] + (core[j * n + i + 1] - core[j * n + i]) * (fi - i);
        const b = core[(j + 1) * n + i] + (core[(j + 1) * n + i + 1] - core[(j + 1) * n + i]) * (fi - i);
        return a + (b - a) * (fj - j);
      }
      return sampleFar(u, v);
    },
    dispose() {
      shadeUniforms.uShCore.value?.dispose();
      shadeUniforms.uShFar.value?.dispose();
    },
  };
}
