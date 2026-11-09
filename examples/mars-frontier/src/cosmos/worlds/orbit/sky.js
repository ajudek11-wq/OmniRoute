import * as THREE from "three";
import { ALT, R_EARTH, shadowHalfAngle, sunlitFraction } from "./physics.js";

/**
 * The view outside: Earth 400 km below (scaled ×0.1 about the station, so the angular size is exact:
 * ~140° across), the Sun and the stars, all moving on a compressed orbit in the station's local
 * vertical / local horizontal (LVLH) frame. Everything here is expressed in the hub frame "H"
 * (ring spin axis = +X), then mapped to the world each frame by the caller.
 */
export const SKY_SCALE = 0.1;
export const ORBIT_SECONDS = 600; // simplified: one 92-minute orbit in 10 minutes
const D2R = Math.PI / 180;

// LVLH axes in the hub frame. Nadir is 55° off the spin axis so the Earth always fills the lounge windows.
export const NADIR = new THREE.Vector3(Math.cos(55 * D2R), -Math.sin(55 * D2R), 0).normalize();
export const VEL = new THREE.Vector3(0, 0, -1);
export const NORMAL = new THREE.Vector3().crossVectors(NADIR, VEL).negate().normalize(); // r × v
const BETA = 15 * D2R; // Sun elevation above the orbit plane
const INCL = 51.6 * D2R; // ISS-like inclination: angle between orbit normal and Earth's pole

const AURORA_FRAG = /* glsl */ `
uniform vec3 uSun; uniform float uTime;
varying vec3 vL; varying vec3 vN; varying vec3 vV;
float h(float n){ return fract(sin(n) * 43758.5453); }
float n1(float x){ float i = floor(x); float f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main(){
  vec3 p = normalize(vL);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float lon = atan(p.z, p.x);
  float al = abs(lat);
  // Auroral oval around 60–72° (brightened for visibility), wavy edge and moving curtains.
  float edge = 1.13 + 0.05 * sin(lon * 3.0 + 1.3) + 0.03 * sin(lon * 7.0 - uTime * 0.05);
  float band = smoothstep(edge - 0.07, edge, al) * (1.0 - smoothstep(edge + 0.03, edge + 0.12, al));
  float curtain = 0.45 + 0.55 * n1(lon * 38.0 + uTime * 0.3) * n1(lon * 11.0 - uTime * 0.12 + 4.0);
  float night = 1.0 - smoothstep(-0.18, 0.05, dot(vN, uSun));
  float rim = 0.35 + 0.9 * pow(1.0 - abs(dot(vN, vV)), 1.5);
  float a = band * curtain * night * rim;
  vec3 col = mix(vec3(0.15, 1.0, 0.45), vec3(0.9, 0.25, 0.45), smoothstep(0.75, 1.0, curtain) * 0.35);
  gl_FragColor = vec4(col * a * 0.9, a);
}`;

/** Longitude (°) of a unit vector in the globe frame, matching three's SphereGeometry UV layout. */
export const geoLon = (v) => ((((Math.atan2(v.z, -v.x) * 180) / Math.PI + 360) % 360) - 180);

export function buildSky(ctx) {
  const { common, tier } = ctx;
  const Re = R_EARTH * SKY_SCALE;
  const Dist = (R_EARTH + ALT) * SKY_SCALE;
  const seg = tier === "high" ? 256 : tier === "low" ? 128 : 192;

  const stars = common.starSky({ tier, brightness: 0.95 });
  const sunObj = common.sun({ dir: new THREE.Vector3(0, 1, 0), angDeg: 0.53, glare: 1.2 });
  const earthObj = common.earth(Re, { tier, segments: seg });
  for (const k of ["uDay", "uNight", "uClouds"]) {
    const t = earthObj.globe.material.uniforms[k]?.value;
    if (t) t.userData.shared = true;
  }
  const milky = stars.group.children.find((c) => c.isMesh)?.material?.map;
  if (milky) milky.userData.shared = true;
  // A thinner limb than the default shell: the visible atmosphere is a hair-thin blue line from orbit.
  const atmo = earthObj.group.children[1];
  if (atmo) {
    atmo.scale.setScalar(1.0065 / 1.022);
    atmo.material.uniforms.uPower.value = 3.4;
    atmo.material.uniforms.uK.value = 2.1;
  }
  const auroraMat = new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vL; varying vec3 vN; varying vec3 vV; void main(){ vL = position; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: AURORA_FRAG,
    uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const aurora = new THREE.Mesh(new THREE.SphereGeometry(Re * 1.004, seg, seg / 2), auroraMat);
  earthObj.globe.add(aurora);

  // Earth's pole: 51.6° from the orbit normal, tilted toward the velocity direction.
  const pole0 = NORMAL.clone().multiplyScalar(Math.cos(INCL)).addScaledVector(VEL, Math.sin(INCL)).normalize();
  const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pole0);
  const S0 = NADIR.clone().negate().multiplyScalar(Math.cos(BETA)).addScaledVector(NORMAL, Math.sin(BETA)).normalize();

  const state = {
    theta: 0.9, // orbit phase (0 = local noon)
    sunH: new THREE.Vector3(),
    skyRotH: new THREE.Quaternion(),
    lit: 1,
    angleFromNadir: Math.PI,
    edge: shadowHalfAngle(),
    spin: 0,
    sunrises: 0,
    sunsets: 0,
    latDeg: 0,
  };
  const qSpin = new THREE.Quaternion();
  const qTmp = new THREE.Quaternion();
  const vTmp = new THREE.Vector3();
  const worldSun = new THREE.Vector3();
  const qWorld = new THREE.Quaternion();
  const pWorld = new THREE.Vector3();
  const sWorld = new THREE.Vector3();

  return {
    stars,
    sunObj,
    earthObj,
    aurora,
    state,
    worldSun,
    group: [stars.group, sunObj.group, earthObj.group],
    /** Advance the orbit by dt seconds (already multiplied by any time warp). */
    advance(dt) {
      const prevLit = state.lit;
      state.theta = (state.theta + (dt * 2 * Math.PI) / ORBIT_SECONDS) % (2 * Math.PI);
      // Earth's own rotation, compressed by the same factor as the orbit (simplified).
      state.spin += (dt * 2 * Math.PI) / (86164 * (ORBIT_SECONDS / 5550));
      state.skyRotH.setFromAxisAngle(NORMAL, -state.theta);
      state.sunH.copy(S0).applyQuaternion(state.skyRotH);
      state.angleFromNadir = state.sunH.angleTo(NADIR);
      state.lit = sunlitFraction(state.angleFromNadir);
      if (prevLit < 0.5 && state.lit >= 0.5) state.sunrises++;
      if (prevLit >= 0.5 && state.lit < 0.5) state.sunsets++;
      earthObj.update(dt);
      auroraMat.uniforms.uTime.value += dt;
    },
    /** Sub-station point (lat, lon in degrees) at an orbit-phase offset (radians), for ground tracks. */
    subPoint(dTheta) {
      const th = state.theta + dTheta;
      const sr = new THREE.Quaternion().setFromAxisAngle(NORMAL, -th);
      const sp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.spin + dTheta * (5550 / 86164));
      const q = sr.multiply(tilt).multiply(sp).invert();
      const v = NADIR.clone().negate().applyQuaternion(q);
      return { lat: (Math.asin(Math.max(-1, Math.min(1, v.y))) * 180) / Math.PI, lon: geoLon(v) };
    },
    /** The Sun direction in the globe's own (geographic) frame. */
    sunGeo(target = new THREE.Vector3()) {
      const q = state.skyRotH.clone().multiply(tilt).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.spin)).invert();
      return target.copy(state.sunH).applyQuaternion(q);
    },
    /**
     * Place everything for this frame. `hubMatrix` maps hub-frame coordinates to the world.
     * Returns the world-space Sun direction.
     */
    place(hubMatrix, camPos) {
      hubMatrix.decompose(pWorld, qWorld, sWorld);
      // Sun & stars follow the camera, oriented by hub→world × LVLH sky rotation.
      qTmp.copy(qWorld).multiply(state.skyRotH);
      stars.group.quaternion.copy(qTmp);
      stars.follow(camPos);
      worldSun.copy(state.sunH).applyQuaternion(qWorld).normalize();
      sunObj.group.position.copy(worldSun).multiplyScalar(8.0e6).add(camPos);
      sunObj.group.visible = state.lit > 0.02;
      // Earth: centre along nadir, rotating with the sky (ground track) plus its own slow spin.
      vTmp.copy(NADIR).multiplyScalar(Dist).applyMatrix4(hubMatrix);
      earthObj.group.position.copy(vTmp);
      qSpin.setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.spin);
      earthObj.group.quaternion.copy(qTmp).multiply(tilt).multiply(qSpin);
      earthObj.setSun(worldSun);
      auroraMat.uniforms.uSun.value.copy(worldSun);
      // Sub-station latitude for the displays.
      const sub = vTmp.copy(NADIR).negate().applyQuaternion(qTmp.copy(state.skyRotH).multiply(tilt).multiply(qSpin).invert());
      state.latDeg = (Math.asin(Math.max(-1, Math.min(1, sub.y))) * 180) / Math.PI;
      state.lonDeg = geoLon(sub);
      return worldSun;
    },
  };
}
