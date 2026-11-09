import * as THREE from "three";
import { planet, earth as earthBody, rings as ringSystem, planetTex } from "../common.js";
import { terrain, terrainMaterial, craterField, fbm, skyDome, particles, glowSprite, canvasTex, track, ramp, win, clamp, smooth, europaTexture, placeScaled } from "./kit.js";
import { mulberry32 } from "../../scene/noise.js";

/**
 * Landing arrivals (atmospheric · powered · parachute). Frame: the landing pad at the origin, ground
 * at y ≈ 0, the ship approaching from +Z toward −Z. The cockpit floor rests GEAR m above the pad.
 */
export const GEAR = 2.6;

function padMesh(label = "PATHFINDER") {
  const g = new THREE.Group();
  const tex = canvasTex(1024, 1024, (c, w) => {
    c.fillStyle = "#5d5a55";
    c.fillRect(0, 0, w, w);
    const rand = mulberry32(3);
    for (let i = 0; i < 9000; i++) {
      c.fillStyle = `rgba(${rand() < 0.5 ? 0 : 255},${rand() < 0.5 ? 0 : 255},${rand() < 0.5 ? 0 : 255},0.04)`;
      c.fillRect(rand() * w, rand() * w, 2 + rand() * 6, 2 + rand() * 6);
    }
    for (let i = 0; i < 9; i++) {
      c.strokeStyle = "rgba(30,28,26,0.35)";
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo((i / 8) * w, 0);
      c.lineTo((i / 8) * w, w);
      c.moveTo(0, (i / 8) * w);
      c.lineTo(w, (i / 8) * w);
      c.stroke();
    }
    c.strokeStyle = "#e9e3d6";
    c.lineWidth = 22;
    c.beginPath();
    c.arc(w / 2, w / 2, w * 0.36, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 10;
    c.beginPath();
    c.arc(w / 2, w / 2, w * 0.46, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = "#e9a43a";
    c.font = "900 300px system-ui";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("P", w / 2, w / 2 + 10);
    c.fillStyle = "#e9e3d6";
    c.font = "700 44px system-ui";
    c.fillText(label, w / 2, w * 0.9);
    // scorch
    const grd = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w * 0.3);
    grd.addColorStop(0, "rgba(10,8,6,0.45)");
    grd.addColorStop(1, "rgba(10,8,6,0)");
    c.fillStyle = grd;
    c.fillRect(0, 0, w, w);
  });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(15, 15.6, 0.5, 64), [
    new THREE.MeshStandardMaterial({ color: 0x4d4a46, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.05 }),
    new THREE.MeshStandardMaterial({ color: 0x4d4a46, roughness: 0.9 }),
  ]);
  pad.position.y = 0.25;
  g.add(pad);
  const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: 0xffb04a, toneMapped: false }), 20);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    m.makeTranslation(Math.cos(a) * 15.3, 0.55, Math.sin(a) * 15.3);
    lights.setMatrixAt(i, m);
  }
  g.add(lights);
  return { group: g, lights };
}

/** Distant fictional base modules so the landing site reads at scale. */
function baseSilhouettes(color = 0xc9c3b8, seed = 4) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.5, metalness: 0.5 });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
  const rand = mulberry32(seed);
  for (let i = 0; i < 6; i++) {
    const a = -0.9 + i * 0.33 + rand() * 0.1;
    const d = 160 + rand() * 120;
    const x = Math.sin(a) * d;
    const z = -Math.cos(a) * d;
    if (i % 3 === 0) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(9 + rand() * 6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      dome.position.set(x, 0, z);
      g.add(dome);
    } else {
      const hab = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 16, 24).rotateZ(Math.PI / 2), mat);
      hab.position.set(x, 4.2, z);
      hab.rotation.y = rand() * 3;
      g.add(hab);
      const legs = new THREE.Mesh(new THREE.BoxGeometry(12, 1.2, 5), dark);
      legs.position.set(x, 0.6, z);
      legs.rotation.y = hab.rotation.y;
      g.add(legs);
    }
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), lamp);
    l.position.set(x, 9, z);
    g.add(l);
  }
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 30, 8), dark);
  tower.position.set(70, 15, -60);
  g.add(tower);
  const beacon = glowSprite("#ff5040", 6);
  beacon.position.set(70, 31, -60);
  g.add(beacon);
  return g;
}

/** Plasma sheath seen through the windows during atmospheric entry (ship frame). */
function plasmaShell(color = "#ff7a40", color2 = "#ff3ab0") {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uK: { value: 0 }, uA: { value: new THREE.Color(color) }, uB: { value: new THREE.Color(color2) } },
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform float uT, uK; uniform vec3 uA, uB; varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      float n3(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){ vec3 d = normalize(vP);
        float front = smoothstep(0.1, -0.9, d.z) * (0.55 + 0.45 * smoothstep(0.4, -0.6, d.y));
        vec3 q = d * 4.0 + vec3(0.0, 0.0, uT * 2.6);
        float f = n3(q) * 0.55 + n3(q * 2.3 + vec3(uT * 1.7)) * 0.3 + n3(q * 5.1 - vec3(uT * 3.1)) * 0.15;
        float a = front * smoothstep(0.25, 0.9, f) * uK;
        vec3 c = mix(uA, uB, smoothstep(0.4, 0.95, f)) * (1.2 + f);
        gl_FragColor = vec4(c * a, a);
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(3.2, 48, 24), mat);
  m.position.set(0, 1.2, 0);
  m.renderOrder = 3;
  return { mesh: m, u: mat.uniforms };
}

/** Parachute canopy with gores and risers (ship frame), seen through the upper windows. */
function parachute(len = 18) {
  const g = new THREE.Group();
  const tex = canvasTex(512, 256, (c, w, h) => {
    for (let i = 0; i < 16; i++) {
      c.fillStyle = i % 2 ? "#f2efe8" : "#e8692a";
      c.fillRect((i / 16) * w, 0, w / 16 + 1, h);
    }
    c.fillStyle = "rgba(0,0,0,0.15)";
    c.fillRect(0, h * 0.82, w, h * 0.18);
  });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(9, 32, 12, 0, Math.PI * 2, 0.12, Math.PI * 0.42), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.85 }));
  g.add(canopy);
  const rp = [];
  const attach = new THREE.Vector3(0, -len, 0);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = 9 * Math.sin(0.12 + Math.PI * 0.42);
    const y = 9 * Math.cos(0.12 + Math.PI * 0.42);
    rp.push(Math.cos(a) * r, y, Math.sin(a) * r, attach.x, attach.y, attach.z);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.Float32BufferAttribute(rp, 3));
  const risers = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xd8d2c4 }));
  g.add(risers);
  g.visible = false;
  return g;
}

/** Landing configurations per destination. */
function landingConfig(to, type) {
  const D = Math.PI / 180;
  if (type === "atmospheric") {
    const R = 3.3895e6;
    const n = fbm(11);
    const cr = craterField(21, { count: 120, area: 30000, rMin: 20, rMax: 1500, clearR: 400 });
    return {
      planetR: R,
      sunDir: new THREE.Vector3(-0.45, 0.62, -0.64).normalize(),
      sky: { top: "#c4876a", hor: "#e8b39a", below: "#8a5a40", sun: "#dfe8ff" },
      fog: { color: "#d7a088", near: 2000, far: 26000 },
      globe: { tex: "mars", atmo: { color: "#f0a07a", power: 3.2, intensity: 0.9, scale: 1.02 } },
      height: (x, z) => {
        const r = Math.hypot(x, z);
        const flat = smooth((r - 40) / 160);
        return (n(x / 2600, z / 2600) * 90 + n(x / 400, z / 400) * 12 + n(x / 60, z / 60) * 1.5 + cr(x, z) * 0.6) * flat;
      },
      color: (x, z, h, c) => {
        const v = n(x / 900 + 7, z / 900);
        c.setRGB(0.62 + v * 0.08 + h * 0.0005, 0.36 + v * 0.05, 0.22 + v * 0.03);
      },
      tint: 0xffffff,
      keys: [
        { s: 0, p: [0, 72000, 230000], pitch: -12 },
        { s: 0.18, p: [0, 42000, 120000], pitch: -12 },
        { s: 0.34, p: [0, 16000, 42000], pitch: -15 },
        { s: 0.5, p: [0, 3800, 9000], pitch: -24 },
        { s: 0.66, p: [0, 1100, 2400], pitch: -28 },
        { s: 0.8, p: [0, 260, 420], pitch: -22 },
        { s: 0.9, p: [0, 60, 40], pitch: -8 },
        { s: 0.97, p: [0, GEAR + 3, 2], pitch: 0 },
        { s: 1, p: [0, GEAR, 0], pitch: 0 },
      ],
      plasma: [0.02, 0.06, 0.24, 0.34],
      retro: [0.52, 0.56, 0.97, 1.0],
      dust: { color: "#b07a55", mode: "billow", h: 45 },
      stars: (alt) => clamp((alt - 15000) / 40000, 0.03, 1),
      skyK: (alt) => 1 - ramp(alt, 15000, 60000),
      base: true,
      wind: true,
    };
  }
  if (type === "parachute") {
    const R = 2.575e6;
    const n = fbm(31);
    const lake = (x, z) => n(x / 3000, z / 3000) * 0.7 + (z + 800) / 4000;
    return {
      planetR: R,
      sunDir: new THREE.Vector3(-0.3, 0.75, -0.5).normalize(),
      sky: { top: "#a5642a", hor: "#d89a52", below: "#6a4420", sun: "#ffe0a0" },
      fog: { color: "#c88a4a", near: 300, far: 3000 },
      height: (x, z) => {
        const r = Math.hypot(x, z);
        const flat = smooth((r - 30) / 120);
        const L = lake(x, z);
        const land = n(x / 1200, z / 1200) * 40 + n(x / 150, z / 150) * 4;
        return (L > 0 ? land * L + 6 : -4) * flat;
      },
      color: (x, z, h, c) => {
        const v = n(x / 300, z / 300);
        if (h < -1) c.setRGB(0.05, 0.035, 0.02);
        else c.setRGB(0.42 + v * 0.06, 0.28 + v * 0.04, 0.14 + v * 0.02);
      },
      lake: true,
      keys: [
        { s: 0, p: [0, 42000, 26000], pitch: -6 },
        { s: 0.22, p: [0, 30000, 16000], pitch: -6 },
        { s: 0.5, p: [0, 9000, 5000], pitch: -8 },
        { s: 0.72, p: [0, 1800, 1200], pitch: -10 },
        { s: 0.86, p: [0, 260, 140], pitch: -6 },
        { s: 0.96, p: [0, GEAR + 4, 3], pitch: 0 },
        { s: 1, p: [0, GEAR, 0], pitch: 0 },
      ],
      chute: [0.22, 0.86],
      retro: [0.84, 0.88, 0.97, 1.0],
      dust: { color: "#7a5a30", mode: "billow", h: 25 },
      stars: () => 0,
      skyK: () => 1,
      fogFar: (alt) => (alt > 12000 ? 900 : 900 + (12000 - alt) * 2.2),
      wind: true,
      skyBody: { tex: "saturn", r: 5.82e7, dir: new THREE.Vector3(0.3, 0.55, -0.78), dist: 1.22e9, rings: true, haze: true },
      base: true,
    };
  }
  // powered: Moon or Europa
  const europa = to === "europa";
  const R = europa ? 1.56e6 : 1.737e6;
  const n = fbm(europa ? 51 : 61);
  const cr = craterField(europa ? 9 : 17, europa ? { count: 60, area: 40000, rMin: 15, rMax: 400, clearR: 300 } : { count: 420, area: 40000, rMin: 6, rMax: 2500, clearR: 220 });
  return {
    planetR: R,
    sunDir: europa ? new THREE.Vector3(-0.55, 0.32, -0.6).normalize() : new THREE.Vector3(-0.82, 0.07, -0.56).normalize(),
    sky: null,
    height: europa
      ? (x, z) => {
          const r = Math.hypot(x, z);
          const flat = smooth((r - 40) / 200);
          const ridge = 1 - Math.abs(n(x / 1800, z / 700));
          const chaos = Math.max(0, n(x / 500 + 3, z / 500)) * 25;
          return (Math.pow(ridge, 6) * 60 + chaos + n(x / 90, z / 90) * 3 + cr(x, z) * 0.4) * flat;
        }
      : (x, z) => {
          const r = Math.hypot(x, z);
          const flat = smooth((r - 35) / 180);
          return (n(x / 5000, z / 5000) * 260 + n(x / 700, z / 700) * 30 + n(x / 70, z / 70) * 2 + cr(x, z)) * flat;
        },
    color: europa
      ? (x, z, h, c) => {
          const v = n(x / 600, z / 600);
          const line = Math.pow(1 - Math.abs(n(x / 1800, z / 700)), 8);
          c.setRGB(0.78 + v * 0.06 - line * 0.25, 0.76 + v * 0.05 - line * 0.38, 0.74 + v * 0.06 - line * 0.45);
        }
      : (x, z, h, c) => {
          const v = n(x / 1200 + 4, z / 1200) * 0.5 + n(x / 120, z / 120) * 0.2;
          const g = 0.36 + v * 0.1;
          c.setRGB(g, g * 0.98, g * 0.95);
        },
    detail: europa ? 0.35 : 0.65,
    keys: [
      { s: 0, p: [0, 15000, 62000], pitch: 8 },
      { s: 0.2, p: [0, 9000, 30000], pitch: 6 },
      { s: 0.38, p: [0, 3200, 9000], pitch: -6 },
      { s: 0.55, p: [0, 1200, 2800], pitch: -26 },
      { s: 0.72, p: [0, 300, 620], pitch: -26 },
      { s: 0.86, p: [0, 60, 60], pitch: -10 },
      { s: 0.96, p: [0, GEAR + 2, 2], pitch: 0 },
      { s: 1, p: [0, GEAR, 0], pitch: 0 },
    ],
    retro: [0.0, 0.04, 0.97, 1.0],
    dust: { color: europa ? "#e8f0ff" : "#9a968e", mode: "ballistic", h: 30, sparkle: europa },
    stars: () => 0.35,
    skyK: () => 0,
    skyBody: europa
      ? { tex: "jupiter", r: 6.99e7, dir: new THREE.Vector3(0.6, 0.35, -0.72), dist: 6.71e8 }
      : { earth: true, r: 6.371e6, dir: new THREE.Vector3(0.35, 0.03, -0.94), dist: 3.84e8 },
    base: true,
    baseColor: europa ? 0xd9dde2 : 0xc9c3b8,
  };
}

export function buildLanding(ctx, type, to) {
  const cfg = landingConfig(to, type);
  const { tier } = ctx;
  const group = new THREE.Group();
  const sky = new THREE.Group();
  const shipFx = new THREE.Group(); // things attached to the ship (plasma, chute)
  const sunDir = cfg.sunDir;
  const lo = tier === "low";
  const ground = terrain({
    radius: type === "atmospheric" ? 1.4e5 : 1.0e5,
    planetR: cfg.planetR,
    rings: lo ? 110 : 150,
    segs: lo ? 160 : 220,
    height: cfg.height,
    color: cfg.color,
    material: terrainMaterial({ detail: cfg.detail ?? 0.55 }),
  });
  group.add(ground);
  const pad = padMesh();
  group.add(pad.group);
  if (cfg.base) group.add(baseSilhouettes(cfg.baseColor, to.length));
  if (cfg.lake) {
    const lake = new THREE.Mesh(new THREE.CircleGeometry(60000, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x120c06, roughness: 0.08, metalness: 0.2 }));
    lake.position.y = -1.2;
    group.add(lake);
  }

  // Globe seen from high altitude (scaled space)
  const bodies = [];
  if (cfg.globe) {
    const gp = planet(1000, { tex: cfg.globe.tex, tier, segments: 128, atmosphere: cfg.globe.atmo, sunDir });
    sky.add(gp.group);
    bodies.push({ obj: gp.group, pos: new THREE.Vector3(0, -cfg.planetR, 0), r: cfg.planetR, globe: true, setSun: (d) => gp.setSun(d) });
  }
  if (cfg.skyBody) {
    const b = cfg.skyBody;
    const obj = b.earth ? earthBody(1000, { tier, sunDir }) : planet(1000, { tex: b.tex, tier, segments: 96, sunDir });
    sky.add(obj.group);
    const entry = { obj: obj.group, pos: b.dir.clone().normalize().multiplyScalar(b.dist), r: b.r, setSun: (d) => obj.setSun?.(d), upd: obj.update, haze: b.haze };
    if (b.rings) {
      const rg = ringSystem(1000, { sunDir });
      rg.mesh.rotation.x = 0.4;
      obj.group.add(rg.mesh);
      entry.rings = rg;
    }
    bodies.push(entry);
  }

  // Sky dome (atmospheres)
  let dome = null;
  if (cfg.sky) {
    dome = skyDome(5.0e4);
    dome.u.uTop.value.set(cfg.sky.top);
    dome.u.uHor.value.set(cfg.sky.hor);
    dome.u.uBelow.value.set(cfg.sky.below);
    dome.u.uSunCol.value.set(cfg.sky.sun);
    sky.add(dome.mesh);
  }

  // Effects
  const plasma = cfg.plasma ? plasmaShell() : null;
  if (plasma) shipFx.add(plasma.mesh);
  let chute = null;
  if (cfg.chute) {
    const at = new THREE.Vector3(0, 2.0, -1.6);
    const cp = new THREE.Vector3(0, 1.22 + 16, -12);
    const dir = at.clone().sub(cp);
    chute = parachute(dir.length());
    chute.position.copy(cp);
    chute.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
    shipFx.add(chute);
  }
  const groundGlow = glowSprite("#ffb36a", 30, 0);
  group.add(groundGlow);
  const nDust = lo ? 900 : 1800;
  const dust = particles(nDust, { color: cfg.dust.color, lit: 1 });
  group.add(dust.points);
  const g0 = type === "atmospheric" ? 3.71 : type === "parachute" ? 1.35 : to === "europa" ? 1.31 : 1.62;
  const path = track(cfg.keys);
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  let chuteK = 0;
  let lastS = 0;

  const info = {
    group,
    sky,
    shipFx,
    sunDir,
    path,
    target: new THREE.Vector3(0, GEAR, 0),
    landing: true,
    alt: 0,
    thrust: 0,
    plasma: 0,
    wind: 0,
    buffet: 0,
    contact: false,
    fog: null,
    starK: 1,
    space: false,
    update(s, dt, ship, t, scene) {
      const alt = Math.max(0, ship.pos.y - GEAR);
      info.alt = alt;
      for (const b of bodies) {
        placeScaled(b.obj, b.pos, b.r, ship);
        b.q0 ??= b.obj.quaternion.clone();
        b.obj.quaternion.copy(ship.qInv).multiply(b.q0);
        b.setSun?.(tmp.copy(sunDir).applyQuaternion(ship.qInv));
        b.upd?.(dt);
        b.rings?.update(b.obj.getWorldPosition(tmp2), tmp.copy(sunDir).applyQuaternion(ship.qInv));
        if (b.globe) b.obj.visible = alt > 22000;
        if (b.haze) b.obj.visible = alt > 30000 && false;
      }
      ground.visible = alt < 26000 || !cfg.globe;
      // Atmosphere: dome opacity, fog, star brightness
      const skyK = cfg.skyK(alt);
      if (dome) {
        dome.mesh.position.set(0, 0, 0);
        dome.u.uA.value = skyK;
        dome.u.uSun.value.copy(sunDir).applyQuaternion(ship.qInv);
        dome.u.uUp.value.set(0, 1, 0).applyQuaternion(ship.qInv);
        dome.mesh.visible = skyK > 0.01;
      }
      info.starK = cfg.stars(alt);
      if (cfg.fog) {
        const far = cfg.fogFar ? cfg.fogFar(alt) : cfg.fog.far * (0.6 + 0.4 * ramp(alt, 0, 8000)) + alt * 0.6;
        info.fog = { color: cfg.fog.color, near: Math.min(cfg.fog.near, far * 0.3), far: alt > 26000 && cfg.globe ? 1e8 : far };
      }
      // Engines
      const r = cfg.retro;
      info.thrust = r ? win(s, r[0], r[1], r[2], r[3]) : 0;
      if (type === "parachute") info.thrust = win(s, 0.84, 0.86, 0.985, 1.0);
      info.plasma = cfg.plasma ? win(s, ...cfg.plasma) * 0.9 : 0;
      info.wind = cfg.wind ? clamp(1 - alt / 40000, 0, 1) * 0.6 + info.plasma : 0;
      info.buffet = info.plasma * 0.7 + (chute ? win(s, 0.22, 0.24, 0.3, 0.4) * 0.6 : 0);
      if (plasma) {
        plasma.u.uK.value = info.plasma;
        plasma.u.uT.value = t;
        plasma.mesh.visible = info.plasma > 0.01;
      }
      if (chute) {
        const on = s > cfg.chute[0] && s < cfg.chute[1];
        chuteK += ((on ? 1 : 0) - chuteK) * Math.min(1, dt * (on ? 3.5 : 1.2));
        chute.visible = chuteK > 0.02;
        const snap = on ? 1 + Math.sin(Math.min(1, (s - cfg.chute[0]) * 60) * Math.PI) * 0.12 : 1;
        chute.scale.setScalar(Math.max(0.05, chuteK) * snap);
        chute.rotation.z = Math.sin(t * 0.6) * 0.04;
        if (!on && s > cfg.chute[1]) chute.position.y += dt * 6; // the released chute drifts away above
      }
      info.contact = s > 0.97 && s < 1.01;
      // Retro glow on the ground under the ship
      const gx = ship.pos.x;
      const gz = ship.pos.z;
      const gh = cfg.height(gx, gz);
      groundGlow.position.set(gx, gh + 0.5, gz);
      groundGlow.material.opacity = info.thrust * clamp(1 - alt / 140, 0, 1) * 0.9;
      groundGlow.scale.setScalar(12 + alt * 0.3);
      // Dust kicked up by the exhaust
      if (info.thrust > 0.05 && alt < cfg.dust.h) {
        const k = info.thrust * (1 - alt / cfg.dust.h);
        const rate = Math.floor((cfg.dust.mode === "ballistic" ? 900 : 380) * k * dt) + (Math.random() < k ? 1 : 0);
        for (let i = 0; i < rate; i++) {
          const a = Math.random() * Math.PI * 2;
          const rr = 2 + Math.random() * (4 + alt * 0.3);
          if (cfg.dust.mode === "ballistic") {
            const v = 18 + Math.random() * 40;
            dust.emit(gx + Math.cos(a) * rr, gh + 0.25, gz + Math.sin(a) * rr, Math.cos(a) * v, 0.4 + Math.random() * 2.2, Math.sin(a) * v, 1.6 + Math.random() * 1.6, 0.25 + Math.random() * 0.25);
          } else {
            const v = 7 + Math.random() * 12;
            dust.emit(gx + Math.cos(a) * rr, gh + 0.4, gz + Math.sin(a) * rr, Math.cos(a) * v, 0.5 + Math.random() * 2.5, Math.sin(a) * v, 3 + Math.random() * 3, 1.2 + Math.random() * 1.5);
          }
        }
      }
      const ballistic = cfg.dust.mode === "ballistic";
      const pos = dust.points.geometry.attributes.position.array;
      dust.step(dt, (i, tt, dtt, P, V) => {
        const j = i * 3;
        if (ballistic) {
          V[j + 1] -= g0 * dtt;
        } else {
          const drag = Math.exp(-dtt * 0.9);
          V[j] *= drag;
          V[j + 2] *= drag;
          V[j + 1] = V[j + 1] * drag + dtt * 0.6;
        }
        P[j] += V[j] * dtt;
        P[j + 1] += V[j + 1] * dtt;
        P[j + 2] += V[j + 2] * dtt;
        const hy = cfg.height(P[j], P[j + 2]) + 0.05;
        if (P[j + 1] < hy) {
          P[j + 1] = hy;
          V[j] *= 0.3;
          V[j + 2] *= 0.3;
          V[j + 1] = 0;
        }
        const st = dust.st;
        if (ballistic) return [(1 - tt) * 0.55 * (cfg.dust.sparkle ? 0.6 + 0.4 * Math.sin(i + t * 20) : 1), st.base[i]];
        return [Math.sin(Math.PI * Math.min(1, tt * 1.4 + 0.1)) * 0.5, st.base[i] * (1 + tt * 5)];
      });
      void pos;
      // Pad lights blink
      pad.lights.material.color.setHex(Math.sin(t * 4) > 0 ? 0xffb04a : 0x40280f);
      lastS = s;
    },
    dispose() {
      dust.points.geometry.dispose();
    },
  };
  void lastS;
  return info;
}

export { planetTex };
