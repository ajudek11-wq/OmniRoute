import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { heightAt } from "./terrain.js";
import { glowTexture } from "./world.js";
import { STRUCTURE_POS as P, PATHS, SURVEY_SITES } from "../data/layout.js";
import { mulberry32 } from "./noise.js";

const V2 = (x, y) => new THREE.Vector2(x, y);

function stripeTexture(lines, base = "#c9c3b8", line = "#a9a297", vertical = true) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = line;
  for (let i = 0; i < lines; i++) {
    const p = (i / lines) * 128;
    if (vertical) g.fillRect(p, 0, 2, 128);
    else g.fillRect(0, p, 128, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function solarTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#c8ccd2";
  g.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 6; x++) {
      const grd = g.createLinearGradient(0, y * 21, 0, y * 21 + 20);
      grd.addColorStop(0, "#1d3358");
      grd.addColorStop(1, "#142544");
      g.fillStyle = grd;
      g.fillRect(x * 21 + 2, y * 21 + 2, 19, 19);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    hull: std({ color: "#ddd8cf", roughness: 0.5, metalness: 0.08 }),
    hullPanel: std({ color: "#bdb6aa", roughness: 0.6, metalness: 0.1 }),
    metal: std({ color: "#55595f", roughness: 0.38, metalness: 0.75 }),
    metalDark: std({ color: "#2c2f34", roughness: 0.45, metalness: 0.7 }),
    gold: std({ color: "#c79a43", roughness: 0.32, metalness: 0.9 }),
    orange: std({ color: "#d1612b", roughness: 0.55, metalness: 0.05 }),
    regolith: std({ color: "#8f5536", roughness: 1 }),
    sintered: std({ color: "#7d675b", roughness: 0.95 }),
    white: std({ color: "#f0ede6", roughness: 0.45 }),
    container: std({ map: stripeTexture(24, "#b8b2a6", "#9b9488"), roughness: 0.6, metalness: 0.2 }),
    radiator: std({ map: stripeTexture(16, "#f2f0ea", "#d4d1c8", false), roughness: 0.35, metalness: 0.1 }),
    solar: std({ map: solarTexture(), roughness: 0.28, metalness: 0.55 }),
    glass: new THREE.MeshStandardMaterial({
      color: "#a8c8d8",
      roughness: 0.08,
      metalness: 0.3,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      emissive: new THREE.Color("#ff6fd2"),
      emissiveIntensity: 0,
      side: THREE.DoubleSide,
    }),
    crop: std({ color: "#4f8a3c", roughness: 0.8 }),
    soil: std({ color: "#3b2a22", roughness: 1 }),
    window: std({ color: "#1d1f22", roughness: 0.2, metalness: 0.4, emissive: new THREE.Color("#ffcf96"), emissiveIntensity: 0.3 }),
    grow: std({ color: "#331022", emissive: new THREE.Color("#ff58c8"), emissiveIntensity: 2 }),
    lampHead: std({ color: "#2a2a2a", emissive: new THREE.Color("#ffd7a6"), emissiveIntensity: 1 }),
    beaconRed: new THREE.MeshBasicMaterial({ color: "#ff3b2f", toneMapped: false }),
    led: new THREE.MeshBasicMaterial({ color: "#5ce08a", toneMapped: false }),
    hazard: std({ color: "#e0b030", roughness: 0.6 }),
    cyan: new THREE.MeshBasicMaterial({ color: "#7fd6ff", toneMapped: false, transparent: true, opacity: 0.85 }),
  };
}

function mesh(parent, geo, mat, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (o.rx) m.rotation.x = o.rx;
  if (o.ry) m.rotation.y = o.ry;
  if (o.rz) m.rotation.z = o.rz;
  if (o.s) m.scale.setScalar(o.s);
  if (o.sv) m.scale.copy(o.sv);
  m.castShadow = o.cast ?? true;
  m.receiveShadow = o.receive ?? true;
  if (o.dynamic) m.userData.dynamic = true;
  parent.add(m);
  return m;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
/** Cylinder strut between two points. */
function strut(parent, a, b, r, mat, o = {}) {
  _a.copy(b).sub(a);
  const len = _a.length();
  const m = mesh(parent, new THREE.CylinderGeometry(r, r, len, 6), mat, 0, 0, 0, o);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, _a.normalize());
  return m;
}

/**
 * Merge the static meshes of a group by material — cuts draw calls dramatically on mobile.
 * Meshes flagged userData.dynamic (and their children) are kept as-is.
 */
export function bakeStatic(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const remove = [];
  group.traverse((o) => {
    if (o === group) return;
    let p = o;
    while (p && p !== group) {
      if (p.userData.dynamic) return;
      p = p.parent;
    }
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const key = `${o.material.uuid}|${o.castShadow}`;
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, geos: [] });
    buckets.get(key).geos.push(g);
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  for (const { mat, cast, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
  }
}

function hitProxy(group, geo, y) {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
  m.position.y = y;
  m.userData.dynamic = true;
  group.add(m);
  return m;
}

// ═══ Structures ═══════════════════════════════════════════════

function buildHabitat(M) {
  const g = new THREE.Group();
  const R = 10;
  const berm = [V2(14, 0), V2(13.2, 0.7), V2(11.8, 1.8), V2(10.4, 2.5), V2(10.02, 2.55), V2(10.02, -0.5)];
  mesh(g, new THREE.LatheGeometry(berm, 48), M.regolith);
  const prof = [V2(0.01, 0), V2(R, 0)];
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * (Math.PI / 2);
    prof.push(V2(R * Math.cos(a) + 0.001, 4.2 + 7 * Math.sin(a)));
  }
  mesh(g, new THREE.LatheGeometry(prof, 48), M.hull);
  mesh(g, new THREE.TorusGeometry(R + 0.06, 0.16, 6, 64), M.hullPanel, 0, 4.2, 0, { rx: Math.PI / 2 });
  mesh(g, new THREE.TorusGeometry(R * 0.72, 0.12, 6, 48), M.hullPanel, 0, 9.05, 0, { rx: Math.PI / 2 });
  mesh(g, new THREE.TorusGeometry(R + 0.05, 0.22, 6, 64), M.orange, 0, 2.95, 0, { rx: Math.PI / 2 });
  // Meridian ribs
  for (let k = 0; k < 12; k++) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * (Math.PI / 2) * 0.93;
      const r = (R + 0.08) * Math.cos(a);
      pts.push(new THREE.Vector3(r, 4.2 + 7.08 * Math.sin(a), 0));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    mesh(g, new THREE.TubeGeometry(curve, 12, 0.11, 5), M.hullPanel, 0, 0, 0, { ry: (k / 12) * Math.PI * 2 });
  }
  // Window band
  const win = new THREE.BoxGeometry(1.5, 0.75, 0.18);
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2 + 0.17;
    const w = mesh(g, win, M.window, Math.sin(a) * R, 3.55, Math.cos(a) * R, { cast: false });
    w.rotation.y = a;
  }
  // Airlock (south)
  mesh(g, new THREE.CylinderGeometry(1.7, 1.7, 6, 20), M.hull, 0, 1.9, 12.4, { rx: Math.PI / 2 });
  mesh(g, new THREE.CylinderGeometry(1.85, 1.85, 0.3, 20), M.hullPanel, 0, 1.9, 15.4, { rx: Math.PI / 2 });
  mesh(g, new THREE.BoxGeometry(1.4, 2.0, 0.12), M.metalDark, 0, 1.6, 15.58);
  mesh(g, new THREE.BoxGeometry(1.6, 0.12, 0.14), M.lampHead, 0, 2.75, 15.6, { cast: false });
  mesh(g, new THREE.BoxGeometry(3.6, 0.3, 4.5), M.sintered, 0, 0.15, 17.6);
  // Cupola + roof equipment
  mesh(g, new THREE.CylinderGeometry(1.8, 1.9, 0.9, 24), M.hullPanel, 0, 11.3, 0);
  mesh(g, new THREE.SphereGeometry(1.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.window, 0, 11.7, 0, { cast: false });
  mesh(g, new THREE.CylinderGeometry(0.07, 0.07, 5, 6), M.metal, 3.2, 12, 1.5);
  mesh(g, new THREE.BoxGeometry(1.4, 0.6, 1), M.metal, -3.4, 10.6, -2.2);
  const beacon = mesh(g, new THREE.SphereGeometry(0.22, 10, 8), M.beaconRed, 3.2, 14.6, 1.5, { cast: false, dynamic: true });
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.CylinderGeometry(13, 13, 13, 12), 6);
  return {
    group: g,
    hit,
    radius: 15,
    focus: { distance: 38, height: 5 },
    update(t, env) {
      M.window.emissiveIntensity = 0.25 + env.night * 2.4;
      beacon.visible = Math.sin(t * 2.4) > 0.6;
    },
  };
}

function buildLab(M) {
  const g = new THREE.Group();
  const y = 3.4;
  const L = 14;
  mesh(g, new THREE.CylinderGeometry(3, 3, L, 28, 1, true), M.hull, 0, y, 0, { rz: Math.PI / 2 });
  const cap = new THREE.SphereGeometry(3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  mesh(g, cap, M.hull, L / 2, y, 0, { rz: -Math.PI / 2, sv: new THREE.Vector3(1, 0.45, 1) });
  mesh(g, cap, M.hull, -L / 2, y, 0, { rz: Math.PI / 2, sv: new THREE.Vector3(1, 0.45, 1) });
  for (const x of [-L / 2, -2.5, 2.5, L / 2]) {
    mesh(g, new THREE.TorusGeometry(3.04, 0.12, 6, 40), x === -2.5 ? M.orange : M.hullPanel, x, y, 0, { ry: Math.PI / 2 });
  }
  mesh(g, new THREE.BoxGeometry(L - 3, 0.55, 0.2), M.window, 0, y + 0.9, 2.86, { cast: false, rx: -0.3 });
  for (const x of [-5, 5]) {
    for (const z of [-1.8, 1.8]) {
      mesh(g, new THREE.BoxGeometry(0.35, 1.1, 0.35), M.metal, x, 0.55, z);
      mesh(g, new THREE.BoxGeometry(1, 0.12, 1), M.metalDark, x, 0.06, z);
    }
  }
  // Radiator boom
  mesh(g, new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), M.metal, 1, y + 4.4, 0);
  mesh(g, new THREE.BoxGeometry(8, 2.4, 0.08), M.radiator, 1, y + 5.6, 0);
  // Weather mast with anemometer
  mesh(g, new THREE.CylinderGeometry(0.06, 0.06, 4, 6), M.metal, -4.5, y + 4.5, 1.2);
  mesh(g, new THREE.BoxGeometry(0.5, 0.3, 0.3), M.white, -4.5, y + 5.6, 1.2);
  const anemo = new THREE.Group();
  anemo.position.set(-4.5, y + 6.6, 1.2);
  anemo.userData.dynamic = true;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    mesh(anemo, new THREE.BoxGeometry(0.7, 0.03, 0.03), M.metal, Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35, { ry: -a, cast: false });
    mesh(anemo, new THREE.SphereGeometry(0.11, 8, 6), M.white, Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7, { cast: false });
  }
  g.add(anemo);
  // Instrument rack outside
  mesh(g, new THREE.BoxGeometry(1.6, 1.2, 1.2), M.white, -9, 0.6, 3);
  mesh(g, new THREE.CylinderGeometry(0.5, 0.5, 0.12, 16), M.gold, -9, 1.3, 3);
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(19, 9, 8), 3.5);
  return {
    group: g,
    hit,
    radius: 11,
    focus: { distance: 30, height: 3 },
    update(t, env, sim) {
      anemo.rotation.y += 0.05 + (sim?.flows?.tau ?? 0.5) * 0.02;
    },
  };
}

function buildGreenhouse(M) {
  const g = new THREE.Group();
  const R = 5.5;
  const L = 30;
  const shell = new THREE.CylinderGeometry(R, R, L, 32, 1, true, 0, Math.PI);
  shell.rotateZ(Math.PI / 2);
  const glass = new THREE.Mesh(shell, M.glass);
  glass.renderOrder = 2;
  glass.userData.dynamic = true;
  g.add(glass);
  const capGeo = new THREE.CircleGeometry(R, 24, 0, Math.PI);
  capGeo.rotateY(Math.PI / 2);
  for (const x of [-L / 2, L / 2]) {
    const c = new THREE.Mesh(capGeo, M.glass);
    c.position.x = x;
    c.renderOrder = 2;
    c.userData.dynamic = true;
    g.add(c);
  }
  const arch = new THREE.TorusGeometry(R + 0.04, 0.13, 6, 28, Math.PI);
  arch.rotateY(Math.PI / 2);
  for (let i = 0; i <= 12; i++) mesh(g, arch, M.hullPanel, -L / 2 + (i * L) / 12, 0, 0);
  mesh(g, new THREE.BoxGeometry(L, 0.5, 0.3), M.hullPanel, 0, 0.25, R);
  mesh(g, new THREE.BoxGeometry(L, 0.5, 0.3), M.hullPanel, 0, 0.25, -R);
  mesh(g, new THREE.BoxGeometry(L, 0.15, 0.3), M.hullPanel, 0, R, 0);
  // Planters + crops
  const cropGeo = new THREE.SphereGeometry(0.34, 8, 6);
  const crops = new THREE.InstancedMesh(cropGeo, M.crop, 3 * 34);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const rand = mulberry32(4);
  let n = 0;
  for (const z of [-2.7, 0, 2.7]) {
    mesh(g, new THREE.BoxGeometry(L - 3, 0.7, 1.3), M.soil, 0, 0.35, z);
    for (let i = 0; i < 34; i++) {
      const s = 0.7 + rand() * 0.6;
      m4.makeScale(s, s * 0.8, s).setPosition(-L / 2 + 2 + i * 0.78, 0.85, z + (rand() - 0.5) * 0.5);
      crops.setMatrixAt(n, m4);
      crops.setColorAt(n, col.setHSL(0.27 + rand() * 0.07, 0.5, 0.25 + rand() * 0.12));
      n++;
    }
    mesh(g, new THREE.BoxGeometry(L - 4, 0.08, 0.25), M.grow, 0, 3.6 + Math.abs(z) * -0.3, z, { cast: false });
  }
  crops.castShadow = false;
  crops.receiveShadow = true;
  g.add(crops);
  // Vestibule
  mesh(g, new THREE.BoxGeometry(3.2, 3.4, 3.6), M.hull, L / 2 + 1.6, 1.7, 0);
  mesh(g, new THREE.BoxGeometry(0.1, 2.2, 1.3), M.metalDark, L / 2 + 3.22, 1.2, 0);
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(34, 7, 12), 3);
  return {
    group: g,
    hit,
    radius: 18,
    focus: { distance: 36, height: 2 },
    update(t, env, sim) {
      const on = sim && sim.systems.greenhouseLights && !sim.shed.greenhouseLights;
      M.grow.emissiveIntensity = on ? 2.4 : 0.05;
      M.glass.emissiveIntensity = on ? 0.06 + env.night * 0.45 : 0;
    },
  };
}

const PANEL_ROWS = 8;
const PANEL_COLS = 12;
export const PANEL_AREA = 18;
function buildSolar(M) {
  const g = new THREE.Group();
  const max = PANEL_ROWS * PANEL_COLS;
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.08, 6), M.solar, max);
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 1.6, 6), M.metal, max);
  const slots = [];
  const m4 = new THREE.Matrix4();
  for (let r = 0; r < PANEL_ROWS; r++) {
    for (let c = 0; c < PANEL_COLS; c++) {
      const x = (c - (PANEL_COLS - 1) / 2) * 4.6;
      const z = (r - (PANEL_ROWS - 1) / 2) * 7.2;
      slots.push({ x, z });
    }
  }
  // Fill from the centre outward so partial fields look intentional.
  slots.sort((a, b) => Math.hypot(a.x, a.z * 0.8) - Math.hypot(b.x, b.z * 0.8));
  slots.forEach((s, i) => {
    m4.makeTranslation(s.x, 0.8, s.z);
    posts.setMatrixAt(i, m4);
  });
  panels.castShadow = true;
  panels.receiveShadow = true;
  posts.castShadow = true;
  panels.userData.dynamic = true;
  posts.userData.dynamic = true;
  g.add(panels, posts);
  // Combiner boxes + cable trench
  mesh(g, new THREE.BoxGeometry(2, 1.6, 1.4), M.white, -32, 0.8, 0);
  mesh(g, new THREE.BoxGeometry(30, 0.15, 0.6), M.metalDark, -48, 0.08, 0, { cast: false });
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(58, 6, 60), 2);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const tpos = new THREE.Vector3();
  let tilt = 0;
  let frame = 0;
  return {
    group: g,
    hit,
    radius: 34,
    focus: { distance: 78, height: 1 },
    setCount(n) {
      panels.count = posts.count = Math.max(0, Math.min(max, n));
    },
    maxPanels: max,
    update(t, env, sim) {
      // Single-axis east–west trackers; stow flat at night.
      const dirt = sim ? 1 - sim.dust : 0;
      M.solar.color.setRGB(1 - dirt * 0.25, 1 - dirt * 0.45, 1 - dirt * 0.65);
      const sd = env.sunDir;
      const target = env.sinEl > 0.02 ? Math.max(-1.0, Math.min(1.0, -Math.atan2(sd.x, Math.max(0.05, sd.y)))) : 0;
      if (Math.abs(target - tilt) < 0.002 && frame > 2) return;
      tilt += (target - tilt) * 0.08;
      frame++;
      q.setFromEuler(e.set(0, 0, tilt));
      slots.forEach((s, i) => {
        tpos.set(s.x, 1.7, s.z);
        m4.compose(tpos, q, one);
        panels.setMatrixAt(i, m4);
      });
      panels.instanceMatrix.needsUpdate = true;
    },
  };
}

function buildBattery(M) {
  const g = new THREE.Group();
  const ledMat = M.led.clone();
  const leds = [];
  for (let i = 0; i < 4; i++) {
    const z = (i - 1.5) * 3.4;
    mesh(g, new THREE.BoxGeometry(7, 2.6, 2.5), M.container, 0, 1.3, z);
    mesh(g, new THREE.BoxGeometry(7.1, 0.12, 2.6), M.hullPanel, 0, 2.62, z);
    mesh(g, new THREE.BoxGeometry(0.6, 0.6, 2.55), M.metal, -3.2, 2.0, z);
    leds.push(mesh(g, new THREE.BoxGeometry(4.5, 0.12, 0.05), ledMat, 0.6, 2.2, z + 1.28, { cast: false, dynamic: true }));
  }
  mesh(g, new THREE.BoxGeometry(2.2, 2.2, 3), M.white, 5.5, 1.1, 0);
  mesh(g, new THREE.BoxGeometry(0.4, 1.4, 6), M.metalDark, 5.5, 2.9, 0);
  mesh(g, new THREE.BoxGeometry(14, 0.12, 0.5), M.metalDark, -9, 0.06, 0, { cast: false });
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(14, 5, 15), 2);
  const c = new THREE.Color();
  return {
    group: g,
    hit,
    radius: 10,
    focus: { distance: 28, height: 1.5 },
    update(t, env, sim) {
      if (!sim) return;
      const soc = sim.stores.battery / Math.max(1, sim.config.batteryKWh);
      c.set(soc > 0.5 ? "#5ce08a" : soc > 0.2 ? "#f0b04a" : "#ff4d3d");
      ledMat.color.copy(c);
      leds.forEach((l, i) => {
        l.scale.x = Math.max(0.04, Math.min(1, soc * 4 - i));
      });
    },
  };
}

function buildComms(M) {
  const g = new THREE.Group();
  const H = 13;
  const legs = [
    [-1.6, -1.6],
    [1.6, -1.6],
    [1.6, 1.6],
    [-1.6, 1.6],
  ];
  const top = 0.55;
  const tops = legs.map(([x, z]) => new THREE.Vector3(x * top, H, z * top));
  const bots = legs.map(([x, z]) => new THREE.Vector3(x, 0, z));
  for (let i = 0; i < 4; i++) {
    strut(g, bots[i], tops[i], 0.12, M.metal);
    for (let k = 0; k < 4; k++) {
      const f0 = k / 4;
      const f1 = (k + 1) / 4;
      const a = bots[i].clone().lerp(tops[i], f0);
      const b = bots[(i + 1) % 4].clone().lerp(tops[(i + 1) % 4], f1);
      strut(g, a, b, 0.05, M.metal, { cast: false });
    }
  }
  mesh(g, new THREE.BoxGeometry(2.2, 0.3, 2.2), M.metalDark, 0, H, 0);
  mesh(g, new THREE.BoxGeometry(2.4, 1.8, 1.6), M.white, 2.8, 0.9, 0);
  mesh(g, new THREE.BoxGeometry(2, 0.2, 2), M.sintered, 2.8, 0.05, 0);
  // Dish assembly
  const head = new THREE.Group();
  head.position.set(0, H + 0.5, 0);
  head.userData.dynamic = true;
  const tiltG = new THREE.Group();
  head.add(tiltG);
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const r = (i / 12) * 3.3;
    pts.push(V2(r + 0.001, (r * r) / (4 * 1.7)));
  }
  const dish = new THREE.Mesh(new THREE.LatheGeometry(pts, 36), M.white);
  dish.material = M.white.clone();
  dish.material.side = THREE.DoubleSide;
  dish.castShadow = true;
  dish.position.y = 0.6;
  tiltG.add(dish);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const s = new THREE.Vector3(Math.cos(a) * 2.9, 0.6 + 1.25, Math.sin(a) * 2.9);
    const f = new THREE.Vector3(0, 0.6 + 1.7, 0);
    strut(tiltG, s, f, 0.04, M.metal, { cast: false });
  }
  mesh(tiltG, new THREE.CylinderGeometry(0.22, 0.16, 0.5, 10), M.gold, 0, 2.4, 0);
  mesh(head, new THREE.CylinderGeometry(0.4, 0.5, 0.8, 10), M.metal, 0, 0.2, 0);
  g.add(head);
  const beacon = mesh(g, new THREE.SphereGeometry(0.2, 8, 6), M.beaconRed, 0, H + 0.4, 1.1, { cast: false, dynamic: true });
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.CylinderGeometry(5, 5, 20, 8), 9);
  return {
    group: g,
    hit,
    radius: 6,
    focus: { distance: 32, height: 9 },
    update(t) {
      head.rotation.y = -1.9 + Math.sin(t * 0.03) * 0.25;
      tiltG.rotation.x = -0.75 + Math.sin(t * 0.05) * 0.05;
      beacon.visible = (t % 1.6) < 0.18;
    },
  };
}

function buildWater(M) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 5;
    mesh(g, new THREE.CylinderGeometry(2.1, 2.1, 5.2, 24), M.white, x, 2.6 + 0.4, 4);
    mesh(g, new THREE.SphereGeometry(2.1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white, x, 5.6, 4);
    mesh(g, new THREE.TorusGeometry(2.14, 0.1, 6, 32), M.orange, x, 4.2, 4, { rx: Math.PI / 2 });
    mesh(g, new THREE.CylinderGeometry(2.3, 2.3, 0.4, 24), M.metalDark, x, 0.2, 4);
  }
  // Ice extraction plant
  mesh(g, new THREE.BoxGeometry(6, 3.4, 4.2), M.hull, 1, 1.7, -4);
  mesh(g, new THREE.BoxGeometry(6.2, 0.3, 4.4), M.hullPanel, 1, 3.5, -4);
  const vent = mesh(g, new THREE.BoxGeometry(1.2, 0.5, 0.1), M.lampHead, 1, 2.4, -1.85, { cast: false, dynamic: true });
  mesh(g, new THREE.CylinderGeometry(0.3, 0.3, 2.4, 10), M.metal, -1, 4.6, -5);
  mesh(g, new THREE.CylinderGeometry(0.3, 0.3, 1.6, 10), M.metal, 0.2, 4.2, -5);
  // Hopper + conveyor
  mesh(g, new THREE.CylinderGeometry(1.8, 0.6, 2, 4), M.metal, -6, 3.8, -6, { ry: Math.PI / 4 });
  mesh(g, new THREE.BoxGeometry(1, 0.3, 8), M.metalDark, -6, 1.6, -10.5, { rx: 0.42 });
  for (const z of [-7, -9.5, -12.5]) mesh(g, new THREE.BoxGeometry(0.2, 2.2, 0.2), M.metal, -6, 1, z);
  const drum = new THREE.Group();
  drum.position.set(5.4, 1.3, -4);
  drum.userData.dynamic = true;
  const dr = mesh(drum, new THREE.CylinderGeometry(1.1, 1.1, 2.6, 16), M.metal, 0, 0, 0, { rx: Math.PI / 2 });
  mesh(drum, new THREE.BoxGeometry(0.15, 2.3, 2.7), M.orange, 0, 0, 0);
  dr.castShadow = true;
  g.add(drum);
  // Pipes toward the habitat
  const pipe = new THREE.CatmullRomCurve3([
    new THREE.Vector3(5, 1.2, 4),
    new THREE.Vector3(10, 0.6, 7),
    new THREE.Vector3(20, 0.5, 18),
    new THREE.Vector3(26, 0.6, 24),
  ]);
  mesh(g, new THREE.TubeGeometry(pipe, 30, 0.22, 8), M.metal);
  mesh(g, new THREE.TubeGeometry(pipe, 30, 0.12, 6), M.orange, 0.6, 0.15, -0.3);
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(20, 8, 20), 3);
  return {
    group: g,
    hit,
    radius: 11,
    focus: { distance: 32, height: 2 },
    update(t, env, sim) {
      const on = sim && sim.systems.waterExtraction && !sim.shed.waterExtraction;
      if (on) drum.rotation.z += 0.03;
      vent.material.emissiveIntensity = on ? 1.6 : 0.1;
    },
  };
}

function buildGarage(M) {
  const g = new THREE.Group();
  const R = 5.2;
  const L = 13;
  const shell = new THREE.CylinderGeometry(R, R, L, 28, 1, true, -Math.PI / 2, Math.PI);
  shell.rotateX(-Math.PI / 2);
  mesh(g, shell, M.hull);
  const shellMat = M.hull.clone();
  shellMat.side = THREE.BackSide;
  mesh(g, shell, shellMat, 0, 0, 0, { cast: false });
  const arch = new THREE.TorusGeometry(R + 0.05, 0.14, 6, 24, Math.PI);
  for (let i = 0; i <= 6; i++) mesh(g, arch, i === 3 ? M.orange : M.hullPanel, 0, 0, -L / 2 + (i * L) / 6);
  const cap = new THREE.CircleGeometry(R, 24, 0, Math.PI);
  mesh(g, cap, M.hullPanel, 0, 0, -L / 2, { ry: Math.PI });
  // Door frame (open front facing +z)
  const frame = new THREE.Shape();
  frame.absarc(0, 0, R, 0, Math.PI, false);
  frame.lineTo(-R, 0);
  const hole = new THREE.Path();
  hole.moveTo(-2.6, 0);
  hole.lineTo(2.6, 0);
  hole.lineTo(2.6, 3.8);
  hole.lineTo(-2.6, 3.8);
  hole.lineTo(-2.6, 0);
  frame.holes.push(hole);
  mesh(g, new THREE.ShapeGeometry(frame, 16), M.hullPanel, 0, 0, L / 2);
  const door = mesh(g, new THREE.BoxGeometry(5.3, 3.9, 0.15), M.container, 0, 1.95, L / 2 + 0.12, { dynamic: true });
  mesh(g, new THREE.BoxGeometry(5.6, 0.18, 0.2), M.lampHead, 0, 4.1, L / 2 + 0.2, { cast: false });
  mesh(g, new THREE.BoxGeometry(7, 0.18, 10), M.sintered, 0, 0.09, L / 2 + 5, { cast: false });
  // Charging post + crates
  mesh(g, new THREE.BoxGeometry(0.7, 1.8, 0.6), M.white, 4.4, 0.9, L / 2 + 4);
  mesh(g, new THREE.BoxGeometry(0.3, 0.3, 0.05), M.led, 4.4, 1.5, L / 2 + 4.32, { cast: false });
  const crate = new THREE.BoxGeometry(1.2, 1, 1.2);
  mesh(g, crate, M.orange, -6.6, 0.5, 2);
  mesh(g, crate, M.hullPanel, -6.4, 0.5, 3.4, { ry: 0.3 });
  mesh(g, crate, M.hullPanel, -6.5, 1.5, 2.6, { ry: -0.2 });
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(12, 7, 15), 3);
  let open = 0;
  return {
    group: g,
    hit,
    radius: 9,
    focus: { distance: 30, height: 2 },
    door,
    setOpen(v) {
      open = v;
    },
    update() {
      door.position.y += ((open ? 5.9 : 1.95) - door.position.y) * 0.06;
    },
  };
}

function buildLanding(M) {
  const g = new THREE.Group();
  mesh(g, new THREE.CylinderGeometry(24, 25, 0.4, 56), M.sintered, 0, 0.2, 0);
  const ring = new THREE.RingGeometry(16.6, 17.6, 64);
  ring.rotateX(-Math.PI / 2);
  mesh(g, ring, M.white, 0, 0.42, 0, { cast: false });
  const ring2 = new THREE.RingGeometry(22.6, 23.2, 64);
  ring2.rotateX(-Math.PI / 2);
  mesh(g, ring2, M.orange, 0, 0.42, 0, { cast: false });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    mesh(g, new THREE.BoxGeometry(0.8, 0.02, 4.5), M.white, Math.cos(a) * 20, 0.42, Math.sin(a) * 20, { ry: -a + Math.PI / 2, cast: false });
  }
  // Lander / ascent vehicle (generic)
  const lv = new THREE.Group();
  lv.position.y = 3.2;
  mesh(lv, new THREE.CylinderGeometry(2.4, 2.4, 9, 28), M.white, 0, 4.5, 0);
  mesh(lv, new THREE.ConeGeometry(2.4, 4, 28), M.white, 0, 11, 0);
  mesh(lv, new THREE.CylinderGeometry(2.44, 2.44, 1.2, 28), M.metalDark, 0, 6.6, 0);
  mesh(lv, new THREE.CylinderGeometry(2.44, 2.44, 0.3, 28), M.orange, 0, 2.2, 0);
  mesh(lv, new THREE.CylinderGeometry(0.9, 1.5, 1.6, 16), M.metalDark, 0, -0.8, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const top = new THREE.Vector3(Math.cos(a) * 2.2, 1.4, Math.sin(a) * 2.2);
    const foot = new THREE.Vector3(Math.cos(a) * 5, -2.9, Math.sin(a) * 5);
    strut(lv, top, foot, 0.16, M.metal);
    mesh(lv, new THREE.CylinderGeometry(0.7, 0.8, 0.2, 12), M.metal, foot.x, foot.y, foot.z);
  }
  g.add(lv);
  bakeStatic(g);
  // Edge lights (chase sequence)
  const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.3, 0.45), new THREE.MeshBasicMaterial({ toneMapped: false }), 20);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    lights.setMatrixAt(i, m4.makeTranslation(Math.cos(a) * 24.4, 0.55, Math.sin(a) * 24.4));
    lights.setColorAt(i, new THREE.Color("#ffb347"));
  }
  lights.castShadow = false;
  lights.userData.dynamic = true;
  g.add(lights);
  const hit = hitProxy(g, new THREE.CylinderGeometry(25, 25, 18, 16), 6);
  const cOn = new THREE.Color("#ffc46b").multiplyScalar(2.2);
  const cOff = new THREE.Color("#3a2410");
  return {
    group: g,
    hit,
    radius: 25,
    focus: { distance: 62, height: 6 },
    update(t) {
      const head = Math.floor(t * 8) % 20;
      for (let i = 0; i < 20; i++) lights.setColorAt(i, (i - head + 20) % 20 < 3 ? cOn : cOff);
      lights.instanceColor.needsUpdate = true;
    },
  };
}

function buildFission(M) {
  const g = new THREE.Group();
  const berm = [V2(22, 0), V2(19.5, 1.8), V2(17.5, 2.6), V2(16.8, 2.4), V2(15.5, 0)];
  mesh(g, new THREE.LatheGeometry(berm, 48), M.regolith);
  const units = [];
  for (let i = 0; i < 6; i++) {
    const u = new THREE.Group();
    const a = (i / 6) * Math.PI * 2;
    u.position.set(Math.cos(a) * 8, 0, Math.sin(a) * 8);
    mesh(u, new THREE.CylinderGeometry(1.2, 1.4, 1.2, 16), M.metalDark, 0, 0.6, 0);
    mesh(u, new THREE.CylinderGeometry(0.55, 0.55, 1.6, 12), M.gold, 0, 2, 0);
    mesh(u, new THREE.ConeGeometry(1.9, 4.8, 18, 1, true), M.radiator, 0, 5.2, 0, { rx: Math.PI });
    for (let k = 0; k < 6; k++) {
      mesh(u, new THREE.BoxGeometry(0.06, 4.4, 1.4), M.radiator, 0, 5.2, 0, { ry: (k / 6) * Math.PI });
    }
    mesh(u, new THREE.SphereGeometry(0.15, 8, 6), M.led, 0, 7.8, 0, { cast: false });
    bakeStatic(u);
    u.userData.dynamic = true;
    g.add(u);
    units.push(u);
  }
  // Hazard posts
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    mesh(g, new THREE.CylinderGeometry(0.1, 0.1, 1.6, 6), k % 2 ? M.hazard : M.metalDark, Math.cos(a) * 23.5, 0.8, Math.sin(a) * 23.5);
  }
  mesh(g, new THREE.BoxGeometry(2.4, 1.8, 2), M.white, 0, 0.9, 0);
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.CylinderGeometry(22, 22, 10, 12), 4);
  return {
    group: g,
    hit,
    radius: 22,
    focus: { distance: 58, height: 3 },
    setUnits(n) {
      units.forEach((u, i) => (u.visible = i < n));
    },
    update() {},
  };
}

function buildTunnel(M, a, b, y, r) {
  const g = new THREE.Group();
  const A = new THREE.Vector3(a.x, y, a.z);
  const B = new THREE.Vector3(b.x, y, b.z);
  strut(g, A, B, r, M.hull);
  const len = A.distanceTo(B);
  const n = Math.floor(len / 3);
  for (let i = 1; i < n; i++) {
    const p = A.clone().lerp(B, i / n);
    const ring = mesh(g, new THREE.TorusGeometry(r + 0.04, 0.08, 5, 20), M.hullPanel, p.x, p.y, p.z);
    ring.lookAt(B);
    const leg = mesh(g, new THREE.BoxGeometry(0.3, y - r, 0.3), M.metal, p.x, (y - r) / 2, p.z);
    leg.castShadow = false;
  }
  return g;
}

function buildLamps(M) {
  const pts = [];
  for (const path of PATHS) {
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i];
      const [bx, bz] = path[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.floor(len / 16));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        pts.push([x + nx * 2.8, z + nz * 2.8]);
      }
    }
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    pts.push([Math.cos(a) * 21, Math.sin(a) * 21]);
  }
  const group = new THREE.Group();
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6), M.metal, pts.length);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.14, 0.34), M.lampHead, pts.length);
  const glowPos = new Float32Array(pts.length * 3);
  const m4 = new THREE.Matrix4();
  pts.forEach(([x, z], i) => {
    const y = heightAt(x, z);
    pole.setMatrixAt(i, m4.makeTranslation(x, y + 1.6, z));
    head.setMatrixAt(i, m4.makeTranslation(x, y + 3.25, z));
    glowPos.set([x, y + 3.05, z], i * 3);
  });
  pole.castShadow = true;
  group.add(pole, head);
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute("position", new THREE.BufferAttribute(glowPos, 3));
  const glowMat = new THREE.PointsMaterial({
    size: 5,
    map: glowTexture(),
    color: new THREE.Color("#ffc58a"),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Points(glowGeo, glowMat);
  group.add(glow);
  return {
    group,
    update(t, env) {
      glowMat.opacity = env.night * 0.85;
      M.lampHead.emissiveIntensity = 0.3 + env.night * 2.6;
    },
  };
}

function buildSite(M, site) {
  const g = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(4.2, 4.6, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = M.cyan.clone();
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.25;
  g.add(ring);
  mesh(g, new THREE.CylinderGeometry(0.07, 0.07, 4.5, 6), M.metal, 0, 2.25, 0);
  mesh(g, new THREE.BoxGeometry(0.6, 0.4, 0.4), M.white, 0, 1.2, 0);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), ringMat);
  light.position.y = 4.7;
  g.add(light);
  const hit = hitProxy(g, new THREE.CylinderGeometry(6, 6, 9, 10), 4);
  return {
    group: g,
    hit,
    radius: 6,
    focus: { distance: 26, height: 2 },
    setDone(done) {
      ringMat.color.set(done ? "#6cc28a" : "#7fd6ff");
    },
    update(t) {
      const s = 1 + Math.sin(t * 2 + site.x) * 0.06;
      ring.scale.set(s, 1, s);
      ringMat.opacity = 0.55 + Math.sin(t * 3) * 0.3;
    },
  };
}

// ═══ Assembly ═════════════════════════════════════════════════

export function buildSettlement() {
  const M = createMaterials();
  const root = new THREE.Group();
  const builders = {
    habitat: buildHabitat,
    lab: buildLab,
    greenhouse: buildGreenhouse,
    solar: buildSolar,
    battery: buildBattery,
    comms: buildComms,
    water: buildWater,
    garage: buildGarage,
    landing: buildLanding,
    fission: buildFission,
  };
  const structures = {};
  const rot = { lab: 0, greenhouse: 0, water: 0.2, battery: Math.PI / 2, garage: 0, comms: 0.4, solar: 0, landing: 0, fission: 0, habitat: 0 };
  for (const [id, build] of Object.entries(builders)) {
    const s = build(M);
    const pos = P[id];
    s.group.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
    s.group.rotation.y = rot[id] ?? 0;
    s.id = id;
    s.kind = "structure";
    s.center = new THREE.Vector3(pos.x, s.group.position.y, pos.z);
    s.hit.userData.pick = { kind: "structure", id };
    root.add(s.group);
    structures[id] = s;
  }
  // Pressurised tunnels
  root.add(buildTunnel(M, { x: -9.4, z: 4 }, { x: -22, z: 4 }, 2.3, 1.25));
  root.add(buildTunnel(M, { x: 3, z: -9.6 }, { x: 3, z: -28.6 }, 1.7, 1.15));
  root.add(buildTunnel(M, { x: 7.5, z: 6.5 }, { x: 31, z: 13 }, 1.6, 1.0));
  for (const t of root.children.slice(-3)) bakeStatic(t);

  const lamps = buildLamps(M);
  root.add(lamps.group);

  const sites = {};
  for (const site of SURVEY_SITES) {
    const s = buildSite(M, site);
    s.group.position.set(site.x, heightAt(site.x, site.z), site.z);
    s.id = site.id;
    s.kind = "site";
    s.center = s.group.position.clone();
    s.hit.userData.pick = { kind: "site", id: site.id };
    root.add(s.group);
    sites[site.id] = s;
  }

  const pickables = [...Object.values(structures), ...Object.values(sites)].map((s) => s.hit);

  return {
    root,
    materials: M,
    structures,
    sites,
    pickables,
    update(t, env, sim) {
      for (const s of Object.values(structures)) s.update(t, env, sim);
      for (const s of Object.values(sites)) s.update(t, env, sim);
      lamps.update(t, env);
    },
  };
}
