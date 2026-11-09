import * as THREE from "three";
import { mulberry32 } from "../scene/noise.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/**
 * Shared building blocks for every destination: texture loading by graphics tier, the star sky,
 * planets (with day/night, clouds and atmosphere shells), ring systems with the planet's shadow,
 * and sun glare. Celestial bodies are placed at "sky distance" (kilometres, not millions of km)
 * with their true angular size, so depth precision stays good in VR.
 */

const loader = new THREE.TextureLoader();
const cache = new Map();

/** Planet texture by name ("earth_day", "jupiter", …) at 4k on High/Ultra, 2k otherwise. */
export function planetTex(name, tier = "balanced", { color = true, maxAniso = 8, renderer = null } = {}) {
  const big = tier === "high" || tier === "ultra";
  const avail4k = ["earth_day", "earth_night", "earth_clouds", "moon", "jupiter", "saturn", "mars", "venus_atmos"];
  const size = name === "milky_way" ? (big ? 8 : 4) : big && avail4k.includes(name) ? 4 : 2;
  const url = name === "saturn_ring" ? "./planets/saturn_ring.png" : `./planets/${name}_${size}k.jpg`;
  if (cache.has(url)) return cache.get(url);
  const t = loader.load(url);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = Math.min(maxAniso, renderer?.capabilities.getMaxAnisotropy?.() ?? 4);
  t.wrapS = THREE.RepeatWrapping;
  cache.set(url, t);
  return t;
}

/** Angular-size helper: the distance at which a body of `radius` subtends `deg` degrees. */
export function distanceForAngle(radius, deg) {
  return radius / Math.tan((deg * Math.PI) / 360);
}

// ── Star sky ─────────────────────────────────────────────────
/**
 * A camera-following sky: the Milky Way panorama plus point stars with realistic colour temperatures.
 * Call sky.follow(cameraWorldPos) every frame. `brightness` dims it (e.g. daylight on Mars / Titan haze).
 */
export function starSky({ tier = "balanced", radius = 9.0e6, count = null, brightness = 1, milkyWay = true, seed = 7 } = {}) {
  const group = new THREE.Group();
  group.name = "star-sky";
  const n = count ?? { low: 2500, balanced: 5000, high: 9000, ultra: 14000 }[tier] ?? 5000;
  let mwMat = null;
  if (milkyWay) {
    const tex = planetTex("milky_way", tier);
    mwMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false, transparent: true, opacity: 0.55 * brightness });
    mwMat.color.setScalar(0.85);
    const mw = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mwMat);
    // Tilt the galactic plane so it arcs across the sky instead of lying on the horizon.
    mw.rotation.set(0.9, 0.4, 1.1);
    mw.renderOrder = -10;
    group.add(mw);
  }
  const rand = mulberry32(seed);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const temps = [
    [0.62, 0.72, 1.0],
    [0.8, 0.86, 1.0],
    [1.0, 1.0, 1.0],
    [1.0, 0.95, 0.85],
    [1.0, 0.85, 0.65],
    [1.0, 0.72, 0.5],
  ];
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const R = radius * 0.98;
    pos.set([Math.cos(th) * r * R, u * R, Math.sin(th) * r * R], i * 3);
    const t = temps[Math.min(temps.length - 1, Math.floor(Math.pow(rand(), 0.8) * temps.length))];
    // Magnitude distribution: many faint, few bright.
    const m = Math.pow(rand(), 6);
    const b = 0.25 + m * 1.6;
    col.set([t[0] * b, t[1] * b, t[2] * b], i * 3);
    size[i] = 1.0 + m * 3.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("size", new THREE.BufferAttribute(size, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uB: { value: brightness }, uPx: { value: 1 } },
    vertexShader: `attribute float size; varying vec3 vC; uniform float uPx; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * uPx; }`,
    fragmentShader: `varying vec3 vC; uniform float uB; void main(){ vec2 d = gl_PointCoord - 0.5; float a = exp(-dot(d,d) * 18.0); gl_FragColor = vec4(vC * uB * a, 1.0); }`,
    vertexColors: true,
    fog: false,
  });
  const stars = new THREE.Points(g, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  group.add(stars);
  return {
    group,
    setBrightness(b) {
      starMat.uniforms.uB.value = b;
      if (mwMat) mwMat.opacity = 0.55 * b;
    },
    setPixelScale(px) {
      starMat.uniforms.uPx.value = px;
    },
    follow(p) {
      group.position.copy(p);
    },
  };
}

// ── Sun ──────────────────────────────────────────────────────
function glowTexture(stops) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, s] of stops) g.addColorStop(o, s);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The Sun as seen from a destination: a bright disc plus a soft glare halo.
 * `angDeg` is its true angular size there (0.53° from Earth, 0.35° Mars, 0.1° Jupiter, 0.056° Saturn).
 */
export function sun({ dir, distance = 8.0e6, angDeg = 0.53, color = "#fff6e8", glare = 1, haze = 0 }) {
  const group = new THREE.Group();
  const d = new THREE.Vector3().copy(dir).normalize();
  const discR = Math.max(distance * Math.tan((angDeg * Math.PI) / 360), distance * 0.0016);
  const disc = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture([[0, "rgba(255,255,255,1)"], [0.45, "rgba(255,255,255,1)"], [0.55, "rgba(255,248,235,0.6)"], [1, "rgba(255,240,220,0)"]]), color, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending })
  );
  disc.scale.setScalar(discR * 2.6);
  disc.material.color.multiplyScalar(3);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture([[0, "rgba(255,240,215,0.55)"], [0.2, "rgba(255,225,190,0.18)"], [0.5, "rgba(255,210,170,0.05)"], [1, "rgba(255,200,160,0)"]]), depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending, opacity: 0.9 * glare })
  );
  halo.scale.setScalar(distance * (0.09 + haze * 0.25));
  group.add(halo, disc);
  group.position.copy(d).multiplyScalar(distance);
  group.renderOrder = -8;
  return {
    group,
    dir: d,
    follow(p) {
      group.position.copy(d).multiplyScalar(distance).add(p);
    },
  };
}

// ── Planets ──────────────────────────────────────────────────
const ATMO_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main(){
  vec4 w = modelMatrix * vec4(position,1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const ATMO_FRAG = /* glsl */ `
uniform vec3 uColor; uniform vec3 uSun; uniform float uPower; uniform float uK; uniform float uNight;
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main(){
  float rim = pow(1.0 - abs(dot(vN, vV)), uPower);
  float lit = smoothstep(-0.25, 0.45, dot(vN, uSun));
  float fwd = pow(max(0.0, dot(-vV, uSun)), 6.0);
  vec3 c = uColor * (lit + uNight) * (1.0 + fwd * 2.0);
  gl_FragColor = vec4(c * rim * uK, rim * uK * (lit + uNight));
}`;

export function atmosphereShell(radius, { color = "#6fa8ff", power = 3.2, intensity = 1.2, scale = 1.025, night = 0.02, sunDir = new THREE.Vector3(1, 0, 0), segments = 96 } = {}) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    uniforms: { uColor: { value: new THREE.Color(color) }, uSun: { value: sunDir.clone().normalize() }, uPower: { value: power }, uK: { value: intensity }, uNight: { value: night } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
    fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius * scale, segments, segments / 2), mat);
  m.userData.sunUniform = mat.uniforms.uSun;
  return m;
}

const EARTH_FRAG = /* glsl */ `
uniform sampler2D uDay; uniform sampler2D uNight; uniform sampler2D uClouds; uniform vec3 uSun; uniform float uCloudShift; uniform float uTime;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  vec3 day = texture2D(uDay, vUv).rgb;
  vec3 night = texture2D(uNight, vUv).rgb;
  float cl = texture2D(uClouds, vUv + vec2(uCloudShift, 0.0)).r;
  float cs = texture2D(uClouds, vUv + vec2(uCloudShift - 0.0015, 0.0008)).r;
  float ndl = dot(vN, uSun);
  float dayK = smoothstep(-0.12, 0.18, ndl);
  // Oceans: darker, bluer, with a sun glint.
  float ocean = smoothstep(0.08, 0.02, abs(day.b - day.g) + max(0.0, day.r - day.b) * 2.0) * step(day.r, day.b);
  vec3 H = normalize(uSun + vV);
  float spec = pow(max(dot(vN, H), 0.0), 60.0) * ocean * 1.6;
  vec3 lit = day * max(ndl, 0.0) * 1.35 * (1.0 - cs * 0.45) + vec3(1.0, 0.92, 0.8) * spec * (1.0 - cl);
  vec3 cloudCol = vec3(1.0) * cl * max(ndl + 0.05, 0.0) * 1.25;
  vec3 col = mix(night * vec3(1.0, 0.82, 0.55) * 1.6 * (1.0 - cl * 0.8), lit, dayK);
  col = col * (1.0 - cl * dayK * 0.9) + cloudCol;
  // Terminator warmth
  col += vec3(0.9, 0.35, 0.1) * smoothstep(0.18, 0.0, abs(ndl)) * 0.12 * (0.5 + cl);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The Earth with real day, night-lights and cloud imagery, ocean sun glint and drifting clouds. */
export function earth(radius, { tier = "balanced", sunDir = new THREE.Vector3(1, 0, 0), segments = 128 } = {}) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: EARTH_FRAG,
    uniforms: {
      uDay: { value: planetTex("earth_day", tier) },
      uNight: { value: planetTex("earth_night", tier) },
      uClouds: { value: planetTex("earth_clouds", tier, { color: false }) },
      uSun: { value: sunDir.clone().normalize() },
      uCloudShift: { value: 0 },
      uTime: { value: 0 },
    },
  });
  const group = new THREE.Group();
  const globe = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments / 2), mat);
  group.add(globe);
  const atmo = atmosphereShell(radius, { color: "#5c9cff", power: 2.4, intensity: 1.6, scale: 1.022, sunDir, segments });
  group.add(atmo);
  return {
    group,
    globe,
    setSun(d) {
      mat.uniforms.uSun.value.copy(d).normalize();
      atmo.userData.sunUniform.value.copy(d).normalize();
    },
    update(dt) {
      mat.uniforms.uCloudShift.value = (mat.uniforms.uCloudShift.value + dt * 0.0006) % 1;
    },
  };
}

/** A lit planet from an equirectangular map (Moon, Mars, Jupiter, Saturn, Venus …). */
export function planet(radius, { tex, tier = "balanced", segments = 128, roughness = 1, atmosphere = null, sunDir = new THREE.Vector3(1, 0, 0), emissive = 0 } = {}) {
  const map = typeof tex === "string" ? planetTex(tex, tier) : tex;
  const mat = new THREE.MeshStandardMaterial({ map, roughness, metalness: 0, fog: false });
  if (emissive) {
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveMap = map;
    mat.emissiveIntensity = emissive;
  }
  const group = new THREE.Group();
  const globe = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments / 2), mat);
  group.add(globe);
  let atmo = null;
  if (atmosphere) {
    atmo = atmosphereShell(radius, { sunDir, segments: Math.min(96, segments), ...atmosphere });
    group.add(atmo);
  }
  return {
    group,
    globe,
    material: mat,
    setSun(d) {
      atmo?.userData.sunUniform.value.copy(d).normalize();
    },
  };
}

// ── Rings ────────────────────────────────────────────────────
const RING_FRAG = /* glsl */ `
uniform sampler2D uTex; uniform float uInner; uniform float uOuter; uniform vec3 uSun; uniform vec3 uPlanet; uniform float uPR; uniform vec3 uTint;
varying vec3 vW; varying vec3 vL; varying vec3 vV;
void main(){
  float r = length(vL.xz);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  vec4 s = texture2D(uTex, vec2(t, 0.5));
  // Planet shadow: does the ray from this point toward the Sun hit the planet?
  vec3 oc = vW - uPlanet;
  float b = dot(oc, uSun);
  float c = dot(oc, oc) - uPR * uPR;
  float h = b * b - c;
  float shadow = (h > 0.0 && b < 0.0) ? smoothstep(0.0, uPR * uPR * 0.004, h) : 0.0;
  shadow = 1.0 - shadow * 0.92;
  // Particles brighten when back-lit (forward scattering) and when the sun is high on the ring plane.
  float fwd = pow(max(0.0, dot(normalize(-vV), uSun)), 8.0);
  float lit = 0.35 + 0.65 * abs(uSun.y) + fwd * 1.6;
  vec3 col = s.rgb * uTint * lit * shadow;
  gl_FragColor = vec4(col, s.a * 0.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** A ring system in the planet's local XZ plane, shadowed by the planet. */
export function rings(planetRadius, { inner = 1.24, outer = 2.27, tint = "#f2e2c4", sunDir = new THREE.Vector3(1, 0.3, 0) } = {}) {
  const tex = planetTex("saturn_ring", "balanced");
  tex.wrapS = THREE.ClampToEdgeWrapping;
  const mat = new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vW; varying vec3 vL; varying vec3 vV; void main(){ vL = position; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: RING_FRAG,
    uniforms: {
      uTex: { value: tex },
      uInner: { value: planetRadius * inner },
      uOuter: { value: planetRadius * outer },
      uSun: { value: sunDir.clone().normalize() },
      uPlanet: { value: new THREE.Vector3() },
      uPR: { value: planetRadius },
      uTint: { value: new THREE.Color(tint) },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const geo = new THREE.RingGeometry(planetRadius * inner, planetRadius * outer, 256, 4).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  return {
    mesh,
    update(planetWorldPos, sunWorldDir) {
      mat.uniforms.uPlanet.value.copy(planetWorldPos);
      mat.uniforms.uSun.value.copy(sunWorldDir).normalize();
    },
  };
}

/** Distance fade for a group of meshes: nothing pops in or out. */
export function fadeByDistance(obj, cam, near, far) {
  const d = obj.position.distanceTo(cam);
  const k = 1 - Math.min(1, Math.max(0, (d - near) / (far - near)));
  obj.visible = k > 0.01;
  return k;
}

/** A simple world adapter for a flat deck / platform (stations, cockpits, observation decks). */
export function flatGround(y, shape) {
  return (x, z) => (shape(x, z) ? y : null);
}

/**
 * Image-based lighting for interiors (stations, cockpits, habitats): a soft studio-like room
 * prefiltered once and shared. Metals and glass need something to reflect or they render black.
 */
let envCache = null;
export function interiorEnvironment(renderer) {
  if (envCache) return envCache;
  const pm = new THREE.PMREMGenerator(renderer);
  envCache = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  envCache.userData.shared = true;
  pm.dispose();
  return envCache;
}
