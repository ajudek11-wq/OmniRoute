import * as THREE from "three";
import { smoothstep, mulberry32 } from "./noise.js";
import { ATMO } from "./surfaces.js";

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uDay;
uniform float uStorm;
uniform float uDisk;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uNightZenith;
uniform vec3 uNightHorizon;
uniform vec3 uBlue;
uniform vec3 uHalo;
uniform vec3 uStormCol;
uniform vec3 uGround;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 s = normalize(uSunDir);
  float h = d.y;
  float mu = dot(d, s);
  // Daytime Martian sky: butterscotch near the horizon, deeper brown-pink towards the zenith.
  vec3 day = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.9, h), 0.6));
  // Horizon brightening from the thick low dust layer.
  day += uHorizon * 0.18 * exp(-max(h, 0.0) * 9.0);
  day = mix(day, uStormCol, uStorm * 0.75);
  vec3 night = mix(uNightHorizon, uNightZenith, smoothstep(-0.05, 0.55, h));
  vec3 col = mix(night, day, uDay);
  float twilight = smoothstep(-0.22, 0.0, s.y) * (1.0 - smoothstep(0.02, 0.3, s.y));
  // Warm afterglow band along the horizon at twilight, away from the sun too.
  col += vec3(0.42, 0.2, 0.1) * twilight * exp(-max(h, 0.0) * 6.0) * 0.35 * (1.0 - uStorm);
  float halo = pow(max(mu, 0.0), 10.0);
  col += uHalo * halo * (0.5 * uDay + 0.3 * twilight) * (1.0 - uStorm * 0.6);
  // Mars sunsets are blue: fine dust forward-scatters blue light near the sun.
  float blue = pow(max(mu, 0.0), 3.5) * twilight * (1.0 - uStorm * 0.7);
  col = mix(col, uBlue * (0.6 + uDay * 0.6), clamp(blue * 1.1, 0.0, 0.92));
  float disk = smoothstep(0.99955, 0.99975, mu) * step(-0.03, h);
  float glow = pow(max(mu, 0.0), 260.0);
  col += vec3(1.0, 0.97, 0.92) * (disk * 6.0 + glow * 1.4) * uDisk * (1.0 - uStorm * 0.85) * smoothstep(-0.1, 0.02, s.y);
  // Below the horizon (reflections only): regolith-coloured ground.
  col = mix(col, uGround * (0.15 + uDay * 0.85), smoothstep(0.0, -0.08, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const COL = {
  zenith: new THREE.Color("#8a5c40"),
  horizon: new THREE.Color("#d6a77f"),
  nightZenith: new THREE.Color("#040509"),
  nightHorizon: new THREE.Color("#121119"),
  blue: new THREE.Color("#7c9cc6"),
  halo: new THREE.Color("#f2dcc2"),
  storm: new THREE.Color("#a5673f"),
  ground: new THREE.Color("#6e3d26"),
  sunHigh: new THREE.Color("#fff1e2"),
  sunLow: new THREE.Color("#ff8a4c"),
  hemiDay: new THREE.Color("#e2b48f"),
  hemiNight: new THREE.Color("#55658a"),
  groundDay: new THREE.Color("#6b3520"),
  groundNight: new THREE.Color("#2a1c18"),
  inscatterDay: new THREE.Color("#ffd8b0"),
  inscatterTwilight: new THREE.Color("#9fb5d8"),
};

export function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TONE = {
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

export function createWorld(canvas, quality) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality.antialias,
    powerPreference: "high-performance",
    stencil: false,
  });
  renderer.setPixelRatio(quality.dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const tm = new URLSearchParams(location.search).get("tm");
  renderer.toneMapping = TONE[tm] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = quality.shadows > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(COL.horizon.clone(), 0.0008);
  scene.background = COL.horizon.clone();

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.25, 9000);
  camera.position.set(0, 1500, 900);

  // ── Sky dome ──
  const skyUniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uDay: { value: 1 },
    uStorm: { value: 0 },
    uDisk: { value: 1 },
    uZenith: { value: COL.zenith },
    uHorizon: { value: COL.horizon },
    uNightZenith: { value: COL.nightZenith },
    uNightHorizon: { value: COL.nightHorizon },
    uBlue: { value: COL.blue },
    uHalo: { value: COL.halo },
    uStormCol: { value: COL.storm },
    uGround: { value: COL.ground },
  };
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: skyUniforms,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  // ── Image-based lighting from the same sky (PMREM), refreshed as the sun moves ──
  let pmrem = null;
  let envRT = null;
  const envScene = new THREE.Scene();
  const envUniforms = { ...skyUniforms, uDisk: { value: 0.0 } };
  const envSky = new THREE.Mesh(
    new THREE.SphereGeometry(100, 32, 16),
    new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, uniforms: envUniforms })
  );
  envScene.add(envSky);
  const lastEnv = { dir: new THREE.Vector3(9, 9, 9), storm: -1, t: -1e9 };
  function refreshEnvironment(now, force = false) {
    if (!quality.envMap) return;
    const moved = lastEnv.dir.angleTo(skyUniforms.uSunDir.value) > 0.05;
    const stormChanged = Math.abs(lastEnv.storm - skyUniforms.uStorm.value) > 0.05;
    if (!force && (!(moved || stormChanged) || now - lastEnv.t < 1.2)) return;
    pmrem ??= new THREE.PMREMGenerator(renderer);
    const old = envRT;
    envRT = pmrem.fromScene(envScene, 0, 0.1, 400, { size: quality.envSize });
    scene.environment = envRT.texture;
    old?.dispose();
    lastEnv.dir.copy(skyUniforms.uSunDir.value);
    lastEnv.storm = skyUniforms.uStorm.value;
    lastEnv.t = now;
  }

  // ── Stars ──
  const starCount = quality.stars;
  const rand = mulberry32(5);
  const sp = new Float32Array(starCount * 3);
  const sc = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const th = rand() * Math.PI * 2;
    const y = rand() * 0.98 + 0.02;
    const r = Math.sqrt(1 - y * y);
    sp.set([Math.cos(th) * r * 900, y * 900, Math.sin(th) * r * 900], i * 3);
    const b = 0.35 + Math.pow(rand(), 3) * 0.9;
    const tint = rand();
    sc.set([b * (tint > 0.8 ? 1 : 0.85), b * 0.9, b * (tint < 0.2 ? 1 : 0.85)], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute("color", new THREE.BufferAttribute(sc, 3));
  const starMat = new THREE.PointsMaterial({
    size: 1.7,
    sizeAttenuation: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    fog: false,
    opacity: 0,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -9;
  stars.frustumCulled = false;
  scene.add(stars);

  // Earth: the brightest "star" in the Martian evening sky.
  const earthMat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: new THREE.Color("#9cc8ff"),
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    fog: false,
    opacity: 0,
  });
  const earth = new THREE.Sprite(earthMat);
  earth.scale.setScalar(9);
  earth.renderOrder = -8;
  scene.add(earth);

  // ── Lights ──
  const hemi = new THREE.HemisphereLight(COL.hemiDay, COL.groundDay, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(COL.sunHigh, 3);
  sun.castShadow = quality.shadows > 0;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(quality.shadows, quality.shadows);
    const S = 120;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 1200 });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = quality.shadows >= 2048 ? 0.1 : 0.22;
    sun.shadow.radius = 2;
  }
  scene.add(sun, sun.target);
  // Faint cool fill for night (sky glow + Phobos) so the terrain still reads in the dark.
  const nightFill = new THREE.DirectionalLight(new THREE.Color("#8fa6d6"), 0);
  nightFill.position.set(-300, 400, -200);
  scene.add(nightFill);

  // ── Fine airborne dust: few, small, slow — never a "snow" effect ──
  const dustCount = quality.particles;
  const dp = new Float32Array(dustCount * 3);
  const dv = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dp.set([(rand() - 0.5) * 160, rand() * 26, (rand() - 0.5) * 160], i * 3);
    dv[i] = 0.5 + rand();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  const glow = glowTexture();
  const dustMat = new THREE.PointsMaterial({
    size: 0.22,
    map: glow,
    color: new THREE.Color("#f0c9a4"),
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  // ── Dust devil wandering across the plain (balanced/high) ──
  let devil = null;
  if (quality.dustDevil) {
    const n = 420;
    const p = new Float32Array(n * 3);
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) seed.set([rand(), rand(), rand()], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({ size: 3.2, map: glow, color: new THREE.Color("#c99572"), transparent: true, opacity: 0.0, depthWrite: false });
    devil = { points: new THREE.Points(g, m), seed, n, mat: m };
    devil.points.frustumCulled = false;
    scene.add(devil.points);
  }

  const fogColor = new THREE.Color();
  const tmp = new THREE.Color();
  const shadowCenter = new THREE.Vector3();
  const env = { day: 1, night: 0, sinEl: 1, storm: 0, twilight: 0, sunDir: new THREE.Vector3(0, 1, 0) };

  function updateEnvironment({ sunDir, tau, focus, time, dt, frame }) {
    env.sunDir.set(sunDir.x, sunDir.y, sunDir.z).normalize();
    const sinEl = env.sunDir.y;
    const day = smoothstep(-0.14, 0.14, sinEl);
    // Ambient/sky brightness keeps falling until the sun is well up: low sun = contrasty light.
    const skyK = smoothstep(-0.16, 0.42, sinEl);
    const storm = smoothstep(1.2, 4.5, tau);
    const twilight = smoothstep(-0.2, 0.0, sinEl) * (1 - smoothstep(0.03, 0.3, sinEl));
    env.day = day;
    env.night = 1 - smoothstep(-0.12, 0.06, sinEl);
    env.sinEl = sinEl;
    env.storm = storm;
    env.twilight = twilight;

    skyUniforms.uSunDir.value.copy(env.sunDir);
    skyUniforms.uDay.value = 0.25 * day + 0.75 * skyK;
    skyUniforms.uStorm.value = storm;
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    starMat.opacity = env.night * (1 - storm * 0.9);
    stars.rotation.y = time * 0.00002;
    earth.position.set(camera.position.x - 620, camera.position.y + 260, camera.position.z - 300);
    earthMat.opacity = env.night * 0.9 * (1 - storm);

    // Direct sun: low sun is reddened by the long dusty path; storms suppress direct light.
    const lightK = smoothstep(-0.02, 0.2, sinEl) * (1 - storm * 0.78);
    // Thin air: direct sun dominates, so shadows stay deep and readable.
    sun.intensity = 3.9 * lightK;
    sun.color.copy(COL.sunLow).lerp(COL.sunHigh, smoothstep(0.03, 0.55, sinEl));
    // With image-based lighting the hemisphere light only tops up; without it, it carries ambient.
    const iblK = quality.envMap ? 0.45 : 1;
    hemi.intensity = (0.26 + 0.45 * skyK) * iblK + env.night * 0.45 + storm * 0.25;
    hemi.color.copy(COL.hemiNight).lerp(COL.hemiDay, day);
    hemi.groundColor.copy(COL.groundNight).lerp(COL.groundDay, day);
    scene.environmentIntensity = 0.1 + 0.62 * skyK;
    nightFill.intensity = env.night * 0.42;
    renderer.toneMappingExposure = 1.0 + env.night * 0.35 + twilight * 0.12;

    fogColor.copy(COL.nightHorizon).lerp(tmp.copy(COL.horizon).lerp(COL.storm, storm * 0.75), 0.3 * day + 0.7 * skyK);
    scene.fog.color.copy(fogColor);
    scene.fog.density = 0.00072 * (1 + storm * 2.6);
    scene.background.copy(fogColor);
    ATMO.sunDir.value.copy(env.sunDir);
    ATMO.sunColor.value
      .copy(COL.inscatterDay)
      .lerp(COL.inscatterTwilight, twilight)
      .multiplyScalar(0.35 * smoothstep(-0.12, 0.05, sinEl) * (1 - storm * 0.6));

    refreshEnvironment(time);

    if (sun.castShadow) {
      const snap = 4;
      shadowCenter.set(Math.round(focus.x / snap) * snap, 0, Math.round(focus.z / snap) * snap);
      sun.target.position.copy(shadowCenter);
      sun.position.copy(shadowCenter).addScaledVector(env.sunDir, 500);
      if (sinEl > 0 && frame % quality.shadowEvery === 0) renderer.shadowMap.needsUpdate = true;
    } else {
      sun.position.copy(env.sunDir).multiplyScalar(500);
    }

    const arr = dustGeo.attributes.position.array;
    const wind = 2.2 + storm * 9;
    for (let i = 0; i < dustCount; i++) {
      const k = i * 3;
      arr[k] += wind * dv[i] * dt;
      arr[k + 2] += wind * 0.33 * dv[i] * dt;
      arr[k + 1] += Math.sin(time * 0.6 + i) * 0.12 * dt;
      if (arr[k] > 80) arr[k] -= 160;
      if (arr[k + 2] > 80) arr[k + 2] -= 160;
    }
    dustGeo.attributes.position.needsUpdate = true;
    dust.position.set(focus.x, Math.max(0, focus.y - 6), focus.z);
    dustMat.opacity = (0.16 + storm * 0.45) * (0.4 + day * 0.6);

    if (devil) {
      // A ~20 s lifecycle every 90 s, drifting downwind ~600 m from the base.
      const cyc = (time % 90) / 20;
      const life = cyc < 1 ? Math.sin(cyc * Math.PI) : 0;
      devil.mat.opacity = life * 0.32 * day * (1 - storm);
      if (life > 0) {
        const cx = -420 + ((time / 90) % 1) * 60 + cyc * 70;
        const cz = 380 - cyc * 25;
        const ga = devil.points.geometry.attributes.position.array;
        for (let i = 0; i < devil.n; i++) {
          const [a, b, c] = [devil.seed[i * 3], devil.seed[i * 3 + 1], devil.seed[i * 3 + 2]];
          const hgt = ((b + time * 0.08) % 1) * 140;
          const rad = 3 + hgt * 0.12 + c * 4;
          const ang = a * Math.PI * 2 + time * (2.2 - hgt * 0.008);
          ga[i * 3] = cx + Math.cos(ang) * rad + Math.sin(hgt * 0.05 + time) * 4;
          ga[i * 3 + 1] = hgt;
          ga[i * 3 + 2] = cz + Math.sin(ang) * rad;
        }
        devil.points.geometry.attributes.position.needsUpdate = true;
      }
    }
    return env;
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.fov = w < h ? 58 : 46;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function setShadows(on) {
    sun.castShadow = on && quality.shadows > 0;
    renderer.shadowMap.needsUpdate = true;
  }

  return { renderer, scene, camera, sun, hemi, env, updateEnvironment, resize, refreshEnvironment, setShadows, quality };
}
