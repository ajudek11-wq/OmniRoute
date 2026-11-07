import * as THREE from "three";
import { smoothstep, mulberry32 } from "./noise.js";

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
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uNightZenith;
uniform vec3 uNightHorizon;
uniform vec3 uBlue;
uniform vec3 uHalo;
uniform vec3 uStormCol;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 s = normalize(uSunDir);
  float h = d.y;
  float mu = dot(d, s);
  vec3 day = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.9, h), 0.65));
  day = mix(day, uStormCol, uStorm * 0.75);
  vec3 night = mix(uNightHorizon, uNightZenith, smoothstep(-0.05, 0.55, h));
  vec3 col = mix(night, day, uDay);
  float twilight = smoothstep(-0.2, 0.0, s.y) * (1.0 - smoothstep(0.02, 0.32, s.y));
  float halo = pow(max(mu, 0.0), 10.0);
  col += uHalo * halo * (0.5 * uDay + 0.25 * twilight) * (1.0 - uStorm * 0.6);
  // Mars sunsets are blue: fine dust forward-scatters blue light near the sun.
  float blue = pow(max(mu, 0.0), 4.0) * twilight * (1.0 - uStorm * 0.7);
  col = mix(col, uBlue, clamp(blue, 0.0, 0.9));
  float disk = smoothstep(0.99955, 0.99975, mu) * step(-0.03, h);
  float glow = pow(max(mu, 0.0), 260.0);
  col += vec3(1.0, 0.97, 0.92) * (disk * 6.0 + glow * 1.4) * (1.0 - uStorm * 0.85) * smoothstep(-0.1, 0.02, s.y);
  col *= mix(0.6, 1.0, smoothstep(-0.3, 0.0, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const COL = {
  zenith: new THREE.Color("#8c5a3c"),
  horizon: new THREE.Color("#d8a982"),
  nightZenith: new THREE.Color("#04050a"),
  nightHorizon: new THREE.Color("#13121a"),
  blue: new THREE.Color("#7f9fc7"),
  halo: new THREE.Color("#f3dcc0"),
  storm: new THREE.Color("#a8693f"),
  sunHigh: new THREE.Color("#fff0de"),
  sunLow: new THREE.Color("#ffad74"),
  hemiDay: new THREE.Color("#e3b48d"),
  hemiNight: new THREE.Color("#55658a"),
  groundDay: new THREE.Color("#6b3520"),
  groundNight: new THREE.Color("#2a1c18"),
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

export function createWorld(canvas, quality) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality.antialias,
    powerPreference: "high-performance",
    stencil: false,
  });
  renderer.setPixelRatio(quality.dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = quality.shadows > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(COL.horizon.clone(), 0.0008);
  scene.background = COL.horizon.clone();

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.3, 9000);
  camera.position.set(0, 1500, 900);

  // ── Sky dome ──
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uDay: { value: 1 },
      uStorm: { value: 0 },
      uZenith: { value: COL.zenith },
      uHorizon: { value: COL.horizon },
      uNightZenith: { value: COL.nightZenith },
      uNightHorizon: { value: COL.nightHorizon },
      uBlue: { value: COL.blue },
      uHalo: { value: COL.halo },
      uStormCol: { value: COL.storm },
    },
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  // ── Stars ──
  const starCount = quality.stars;
  const rand = mulberry32(5);
  const sp = new Float32Array(starCount * 3);
  const sc = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const u = rand();
    const v = rand() * 0.98 + 0.02;
    const th = u * Math.PI * 2;
    const y = v;
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

  // Earth: the brightest "star" in the Martian sky.
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
    const S = 135;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 1200 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = quality.shadows >= 2048 ? 0.12 : 0.25;
  }
  scene.add(sun, sun.target);
  // Faint cool fill for night (sky glow + Phobos) so the terrain still reads in the dark.
  const nightFill = new THREE.DirectionalLight(new THREE.Color("#8fa6d6"), 0);
  nightFill.position.set(-300, 400, -200);
  scene.add(nightFill);

  // ── Airborne dust ──
  const dustCount = quality.particles;
  const dp = new Float32Array(dustCount * 3);
  const dv = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dp.set([(rand() - 0.5) * 160, rand() * 30, (rand() - 0.5) * 160], i * 3);
    dv[i] = 0.5 + rand();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  const dustMat = new THREE.PointsMaterial({
    size: 0.32,
    map: glowTexture(),
    color: new THREE.Color("#e7b892"),
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  const fogColor = new THREE.Color();
  const tmp = new THREE.Color();
  const shadowCenter = new THREE.Vector3();
  const env = { day: 1, night: 0, sinEl: 1, storm: 0, sunDir: new THREE.Vector3(0, 1, 0) };

  function updateEnvironment({ sunDir, tau, focus, time, dt, frame }) {
    env.sunDir.set(sunDir.x, sunDir.y, sunDir.z).normalize();
    const sinEl = env.sunDir.y;
    const day = smoothstep(-0.14, 0.14, sinEl);
    const storm = smoothstep(1.2, 4.5, tau);
    env.day = day;
    env.night = 1 - smoothstep(-0.12, 0.06, sinEl);
    env.sinEl = sinEl;
    env.storm = storm;

    skyMat.uniforms.uSunDir.value.copy(env.sunDir);
    skyMat.uniforms.uDay.value = day;
    skyMat.uniforms.uStorm.value = storm;
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    starMat.opacity = env.night * (1 - storm * 0.9);
    stars.rotation.y = time * 0.00002;

    // Earth sits low in the west in the evening sky (stylised).
    earth.position.set(camera.position.x - 620, camera.position.y + 260, camera.position.z - 300);
    earthMat.opacity = env.night * 0.9 * (1 - storm);

    const lightK = smoothstep(-0.03, 0.22, sinEl) * (1 - storm * 0.72);
    sun.intensity = 3.4 * lightK;
    sun.color.copy(COL.sunLow).lerp(COL.sunHigh, smoothstep(0.02, 0.5, sinEl));
    hemi.intensity = 0.75 + 0.4 * day - storm * 0.15;
    nightFill.intensity = env.night * 0.55;
    hemi.color.copy(COL.hemiNight).lerp(COL.hemiDay, day);
    hemi.groundColor.copy(COL.groundNight).lerp(COL.groundDay, day);
    renderer.toneMappingExposure = 1.02 + env.night * 0.35;

    fogColor.copy(COL.nightHorizon).lerp(tmp.copy(COL.horizon).lerp(COL.storm, storm * 0.75), day);
    scene.fog.color.copy(fogColor);
    // Thinner haze when looking down from altitude (less air along the line of sight).
    scene.fog.density = (0.00068 * (1 + storm * 2.4)) / (1 + Math.max(0, camera.position.y) / 260);
    scene.background.copy(fogColor);

    // Shadow frustum follows the camera focus, snapped to texels to avoid shimmer.
    if (sun.castShadow) {
      const snap = 4;
      shadowCenter.set(Math.round(focus.x / snap) * snap, 0, Math.round(focus.z / snap) * snap);
      sun.target.position.copy(shadowCenter);
      sun.position.copy(shadowCenter).addScaledVector(env.sunDir, 500);
      if (sinEl > 0 && frame % quality.shadowEvery === 0) renderer.shadowMap.needsUpdate = true;
    } else {
      sun.position.copy(env.sunDir).multiplyScalar(500);
    }

    // Dust drift around the focus point
    const arr = dustGeo.attributes.position.array;
    const wind = 2.5 + storm * 9;
    for (let i = 0; i < dustCount; i++) {
      const k = i * 3;
      arr[k] += wind * dv[i] * dt;
      arr[k + 2] += wind * 0.35 * dv[i] * dt;
      arr[k + 1] += Math.sin(time * 0.6 + i) * 0.15 * dt;
      if (arr[k] > 80) arr[k] -= 160;
      if (arr[k + 2] > 80) arr[k + 2] -= 160;
    }
    dustGeo.attributes.position.needsUpdate = true;
    dust.position.set(focus.x, Math.max(0, focus.y - 6), focus.z);
    dustMat.opacity = 0.18 + storm * 0.5;
    return env;
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.fov = w < h ? 58 : 48;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  return { renderer, scene, camera, sun, hemi, env, updateEnvironment, resize };
}
