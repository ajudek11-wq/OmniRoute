import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { heightAt } from "./terrain.js";
import { glowTexture } from "./world.js";
import { surface } from "./surfaces.js";
import { STRUCTURE_POS as P, PATHS, SURVEY_SITES } from "../data/layout.js";
import { mulberry32 } from "./noise.js";

const V2 = (x, y) => new THREE.Vector2(x, y);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ═══ Material library ═════════════════════════════════════════
export function createMaterials() {
  const glass = new THREE.MeshStandardMaterial({
    color: "#b9d2de",
    roughness: 0.05,
    metalness: 0.0,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    emissive: new THREE.Color("#ff6fd2"),
    emissiveIntensity: 0,
    side: THREE.DoubleSide,
  });
  // Fresnel: glazing turns mirror-like at grazing angles, clear when viewed head-on.
  glass.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `float gFr = pow( 1.0 - abs( dot( normalize( vViewPosition ), normal ) ), 3.0 );
       diffuseColor.a = mix( diffuseColor.a, 0.85, gFr );
       #include <opaque_fragment>`
    );
  };
  glass.customProgramCacheKey = () => "glass-fresnel";
  return {
    hull: surface({ kind: "panel", color: "#e7e2d9", roughness: 0.55, metalness: 0.05, scale: 0.36, bump: 0.6 }),
    hullDark: surface({ kind: "panel", color: "#a39d93", roughness: 0.6, metalness: 0.1, scale: 0.5 }),
    mli: surface({ kind: "mli", color: "#efebe3", roughness: 0.8, metalness: 0, scale: 0.9, bump: 0.9, grime: 0.15 }),
    foil: surface({ kind: "foil", color: "#d4a24a", roughness: 0.3, metalness: 0.95, scale: 0.7, bump: 0.8, dustTop: 0.35, dustBase: 0.4 }),
    metal: surface({ kind: "brushed", color: "#9aa0a7", roughness: 0.36, metalness: 0.88, scale: 1.2, bump: 0.6 }),
    metalDark: surface({ kind: "brushed", color: "#3b3f45", roughness: 0.45, metalness: 0.75, scale: 1.2, bump: 0.6 }),
    orange: surface({ kind: "panel", color: "#cf5c27", roughness: 0.5, metalness: 0.08, scale: 0.6 }),
    hazard: surface({ kind: "panel", color: "#d9a92c", roughness: 0.55, metalness: 0.05, scale: 0.6 }),
    composite: surface({ kind: "composite", color: "#30343a", roughness: 0.45, metalness: 0.25, scale: 3, bump: 0.8 }),
    radiator: surface({ kind: "brushed", color: "#f0eee8", roughness: 0.3, metalness: 0.15, scale: 2.2, bump: 0.5 }),
    regolith: surface({ kind: "rubber", color: "#9a5c3b", roughness: 1, scale: 0.25, mix: 1, bump: 0.4, dustTop: 0, dustBase: 0 }),
    bags: surface({ kind: "mli", color: "#a86d45", roughness: 0.95, scale: 1.4, mix: 0.9, bump: 0.8, dustTop: 0.45, dustBase: 0.3 }),
    sintered: surface({ kind: "sintered", color: "#857163", roughness: 0.95, scale: 0.25, dustTop: 0.35, dustBase: 0 }),
    rubber: surface({ kind: "rubber", color: "#1e1d1d", roughness: 0.9, scale: 3, dustTop: 0.6, dustBase: 0.9, dustHeight: 0.9 }),
    solar: surface({ kind: "solar", color: "#203250", roughness: 0.16, metalness: 0.4, scale: 1.0, grime: 0, bump: 0.6, dustTop: 0.05, dustBase: 0 }),
    glass,
    crop: new THREE.MeshStandardMaterial({ color: "#5c9a44", roughness: 0.7 }),
    soil: new THREE.MeshStandardMaterial({ color: "#3b2a22", roughness: 1 }),
    window: new THREE.MeshStandardMaterial({ color: "#10151b", roughness: 0.06, metalness: 0.3, emissive: new THREE.Color("#ffcf96"), emissiveIntensity: 0.3 }),
    grow: new THREE.MeshStandardMaterial({ color: "#331022", emissive: new THREE.Color("#ff58c8"), emissiveIntensity: 2 }),
    lampHead: new THREE.MeshStandardMaterial({ color: "#2a2a2a", emissive: new THREE.Color("#ffd7a6"), emissiveIntensity: 1 }),
    beaconRed: new THREE.MeshBasicMaterial({ color: "#ff3b2f", toneMapped: false }),
    led: new THREE.MeshBasicMaterial({ color: "#5ce08a", toneMapped: false }),
    cyan: new THREE.MeshBasicMaterial({ color: "#7fd6ff", toneMapped: false, transparent: true, opacity: 0.85 }),
  };
}

// ═══ Helpers ══════════════════════════════════════════════════
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
const box = (p, w, h, d, mat, x, y, z, o) => mesh(p, new THREE.BoxGeometry(w, h, d), mat, x, y, z, o);
const cyl = (p, r1, r2, h, seg, mat, x, y, z, o) => mesh(p, new THREE.CylinderGeometry(r1, r2, h, seg), mat, x, y, z, o);

const _a = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
function strut(parent, a, b, r, mat, o = {}) {
  _a.copy(b).sub(a);
  const len = _a.length();
  const m = mesh(parent, new THREE.CylinderGeometry(r, r, len, o.seg ?? 6), mat, 0, 0, 0, o);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_up, _a.normalize());
  return m;
}
function tube(parent, pts, r, mat, o = {}) {
  const curve = new THREE.CatmullRomCurve3(pts);
  return mesh(parent, new THREE.TubeGeometry(curve, o.seg ?? Math.max(8, pts.length * 6), r, o.radial ?? 6), mat, 0, 0, 0, o);
}
function ringAround(parent, axis, radius, tubeR, mat, x, y, z, arc = Math.PI * 2) {
  const g = new THREE.TorusGeometry(radius, tubeR, 6, 48, arc);
  if (axis === "y") g.rotateX(Math.PI / 2);
  if (axis === "x") g.rotateY(Math.PI / 2);
  return mesh(parent, g, mat, x, y, z);
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
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const key = `${o.material.uuid}|${o.castShadow}`;
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, geos: [] });
    buckets.get(key).geos.push(g);
    remove.push(o);
  });
  for (const o of remove) {
    o.parent.remove(o);
    o.geometry.dispose();
  }
  for (const { mat, cast, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
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

/** Light fixture: dark housing + emissive face (merges into lamp material buckets). */
function fixture(parent, M, x, y, z, ry = 0, w = 0.6) {
  box(parent, w, 0.16, 0.22, M.metalDark, x, y, z, { ry, cast: false });
  box(parent, w * 0.85, 0.05, 0.18, M.lampHead, x, y - 0.09, z, { ry, cast: false });
}

// ═══ Structures ═══════════════════════════════════════════════

function buildHabitat(M, quality) {
  const g = new THREE.Group();
  const R = 10;
  const WALL = 5;
  // Regolith fill behind a shielding wall of filled bags (radiation + micrometeoroid shielding).
  mesh(g, new THREE.LatheGeometry([V2(13.6, 0), V2(12.4, 1.2), V2(11.2, 2.3), V2(10.15, 2.75), V2(10.05, -0.4)], 56), M.regolith);
  const bagGeo = new THREE.CapsuleGeometry(0.34, 0.85, 3, 8);
  bagGeo.rotateZ(Math.PI / 2);
  bagGeo.scale(1, 0.72, 1);
  const courses = quality.key === "low" ? 2 : 4;
  const bagSpots = [];
  for (let c = 0; c < courses; c++) {
    const tc = (c + 0.5) / courses;
    const r = 13.6 - tc * 3.45 + 0.24;
    const y = tc * 2.75 + 0.18;
    const n = Math.floor((Math.PI * 2 * r) / 1.5);
    for (let i = 0; i < n; i++) bagSpots.push({ a: ((i + (c % 2) * 0.5) / n) * Math.PI * 2, r, y });
  }
  const bags = new THREE.InstancedMesh(bagGeo, M.bags, bagSpots.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const rand = mulberry32(7);
  bagSpots.forEach((b, i) => {
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.12, b.a, (rand() - 0.5) * 0.1));
    m4.compose(V3(Math.sin(b.a) * b.r, b.y, Math.cos(b.a) * b.r), q, V3(1 + rand() * 0.08, 1, 1));
    bags.setMatrixAt(i, m4);
  });
  bags.castShadow = true;
  bags.receiveShadow = true;
  bags.userData.dynamic = true;
  g.add(bags);
  // Pressure shell: insulated cylinder wall + structural frames.
  cyl(g, R, R, WALL, 48, M.mli, 0, WALL / 2, 0);
  for (const y of [0.4, 2.9, WALL]) ringAround(g, "y", R + 0.05, 0.14, M.metal, 0, y, 0);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    box(g, 0.22, WALL, 0.16, M.metal, Math.sin(a) * (R + 0.08), WALL / 2, Math.cos(a) * (R + 0.08), { ry: a });
  }
  ringAround(g, "y", R + 0.06, 0.24, M.orange, 0, 2.6, 0);
  // Dome: panelled rigid shell + meridian ribs.
  const prof = [V2(0.01, WALL + 6.6), V2(R, WALL)];
  const dome = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    dome.push(V2(R * Math.cos(a) + 0.001, WALL + 6.6 * Math.sin(a)));
  }
  mesh(g, new THREE.LatheGeometry(dome, 48), M.hull);
  void prof;
  for (let k = 0; k < 16; k++) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2) * 0.9;
      pts.push(V3((R + 0.1) * Math.cos(a), WALL + 6.7 * Math.sin(a), 0));
    }
    const rib = tube(g, pts, 0.12, M.hullDark, { seg: 14, radial: 5 });
    rib.rotation.y = (k / 16) * Math.PI * 2;
  }
  ringAround(g, "y", R * 0.62, 0.12, M.hullDark, 0, WALL + 5.2, 0);
  // Windows with frames and sunshades.
  const winGeo = new THREE.BoxGeometry(1.3, 0.9, 0.12);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const x = Math.sin(a) * (R + 0.1);
    const z = Math.cos(a) * (R + 0.1);
    mesh(g, winGeo, M.window, x, 3.75, z, { ry: a, cast: false });
    box(g, 1.6, 1.2, 0.08, M.metalDark, Math.sin(a) * (R + 0.02), 3.75, Math.cos(a) * (R + 0.02), { ry: a });
    box(g, 1.9, 0.08, 0.7, M.hullDark, Math.sin(a) * (R + 0.4), 4.45, Math.cos(a) * (R + 0.4), { ry: a });
  }
  // Airlock with hatch, suitports, ramp, handrails and status light.
  const AZ = 13.6;
  cyl(g, 1.8, 1.8, 6.4, 24, M.hull, 0, 2.0, AZ - 0.8, { rx: Math.PI / 2 });
  ringAround(g, "z", 1.85, 0.16, M.metal, 0, 2.0, AZ - 3.6);
  ringAround(g, "z", 1.85, 0.16, M.metal, 0, 2.0, AZ + 2.3);
  cyl(g, 1.95, 1.95, 0.35, 24, M.hullDark, 0, 2.0, AZ + 2.55, { rx: Math.PI / 2 });
  box(g, 1.25, 1.85, 0.14, M.metalDark, 0, 1.75, AZ + 2.76);
  ringAround(g, "z", 0.82, 0.07, M.metal, 0, 1.75, AZ + 2.8);
  box(g, 0.9, 0.12, 0.1, M.hazard, 0, 2.85, AZ + 2.8, { cast: false });
  // Suitport bulkhead on the airlock flank.
  box(g, 0.2, 1.8, 2.4, M.hullDark, 1.85, 1.9, AZ - 0.6);
  for (const dz of [-0.55, 0.55]) ringAround(g, "x", 0.38, 0.07, M.metal, 1.97, 2.1, AZ - 0.6 + dz);
  box(g, 3.8, 0.25, 4.2, M.sintered, 0, 0.12, AZ + 4.6);
  for (const s of [-1, 1]) {
    tube(g, [V3(s * 1.5, 1.1, AZ + 2.7), V3(s * 1.5, 1.1, AZ + 5.4), V3(s * 1.5, 0.3, AZ + 6.4)], 0.04, M.metal, { seg: 10, radial: 4 });
    for (const z of [AZ + 3.2, AZ + 5]) cyl(g, 0.035, 0.035, 1.0, 4, M.metal, s * 1.5, 0.6, z, { cast: false });
  }
  const airlockLight = mesh(g, new THREE.SphereGeometry(0.11, 8, 6), M.led.clone(), 0.8, 2.95, AZ + 2.8, { cast: false, dynamic: true });
  // Conduits down the wall into the berm.
  for (const a of [0.9, 2.6, 4.4]) {
    const x = Math.sin(a) * (R + 0.35);
    const z = Math.cos(a) * (R + 0.35);
    tube(g, [V3(x, 4.8, z), V3(x, 3.2, z), V3(x * 1.12, 2.2, z * 1.12)], 0.09, M.metalDark, { seg: 12, radial: 5 });
  }
  // Roof: cupola, radiator wings, comms whips, sensor boom, beacon.
  cyl(g, 1.9, 2.1, 1.0, 24, M.hullDark, 0, WALL + 6.9, 0);
  mesh(g, new THREE.SphereGeometry(1.55, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.window, 0, WALL + 7.35, 0, { cast: false });
  for (const s of [-1, 1]) {
    strut(g, V3(s * 4.2, WALL + 4.8, -2), V3(s * 6.2, WALL + 5.6, -2.6), 0.07, M.metal);
    box(g, 3.4, 0.05, 2.0, M.radiator, s * 7.3, WALL + 5.9, -2.9, { rz: s * 0.35 });
  }
  cyl(g, 0.06, 0.06, 4.2, 6, M.metal, 3.0, WALL + 7.4, 2.2);
  cyl(g, 0.02, 0.02, 2.2, 4, M.metal, -2.6, WALL + 7.2, 2.6, { cast: false });
  cyl(g, 0.02, 0.02, 1.6, 4, M.metal, -2.9, WALL + 6.9, 2.0, { cast: false });
  box(g, 0.9, 0.5, 0.6, M.foil, -3.4, WALL + 5.5, -1.2);
  strut(g, V3(-5.8, WALL + 2.4, 5.2), V3(-8.8, WALL + 3.6, 7.6), 0.05, M.metal);
  box(g, 0.45, 0.3, 0.3, M.hull, -8.9, WALL + 3.7, 7.7);
  const beacon = mesh(g, new THREE.SphereGeometry(0.2, 10, 8), M.beaconRed, 3.0, WALL + 9.6, 2.2, { cast: false, dynamic: true });
  // Exterior lights.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.5;
    fixture(g, M, Math.sin(a) * (R + 0.3), 4.85, Math.cos(a) * (R + 0.3), a);
  }
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.CylinderGeometry(14, 14, 13, 12), 6);
  return {
    group: g,
    hit,
    radius: 15,
    focus: { distance: 40, height: 5 },
    footprint: { w: 30, d: 30, round: true },
    update(t, env) {
      M.window.emissiveIntensity = 0.2 + env.night * 2.4;
      beacon.visible = Math.sin(t * 2.4) > 0.6;
      airlockLight.material.color.set(Math.sin(t * 0.25) > 0.85 ? "#ff5a3c" : "#5ce08a");
    },
  };
}

function buildLab(M) {
  const g = new THREE.Group();
  const y = 3.6;
  const L = 14;
  // Elevated steel deck on braced legs.
  box(g, L + 4, 0.2, 7.4, M.composite, 0, 1.0, 0);
  for (const x of [-7.5, -2.5, 2.5, 7.5]) {
    for (const z of [-3.2, 3.2]) {
      box(g, 0.28, 1.0, 0.28, M.metal, x, 0.5, z);
      box(g, 0.9, 0.1, 0.9, M.metalDark, x, 0.05, z);
    }
    strut(g, V3(x, 0.1, -3.2), V3(x, 0.95, 3.2), 0.05, M.metal, { cast: false });
  }
  // Pressure module with end domes and an insulation blanket section.
  mesh(g, new THREE.CylinderGeometry(3, 3, L, 32, 1, true), M.hull, 0, y, 0, { rz: Math.PI / 2 });
  mesh(g, new THREE.CylinderGeometry(3.07, 3.07, 6, 32, 1, true), M.mli, 1.5, y, 0, { rz: Math.PI / 2 });
  const cap = new THREE.SphereGeometry(3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  mesh(g, cap, M.hull, L / 2, y, 0, { rz: -Math.PI / 2, sv: V3(1, 0.45, 1) });
  mesh(g, cap, M.hull, -L / 2, y, 0, { rz: Math.PI / 2, sv: V3(1, 0.45, 1) });
  for (const x of [-L / 2, -4.6, -1.5, 4.5, L / 2]) ringAround(g, "x", 3.06, 0.13, x === -4.6 ? M.orange : M.metal, x, y, 0);
  // Window strip + access panels.
  box(g, 5.5, 0.55, 0.18, M.window, -4, y + 1.0, 2.84, { rx: -0.32, cast: false });
  for (const x of [-5.5, -2.5]) box(g, 1.2, 1.4, 0.1, M.hullDark, x, y - 1.2, 2.85, { rx: 0.38 });
  // Sample-handling glovebox at the west end.
  box(g, 2.2, 2.2, 3, M.hull, -L / 2 - 2.0, y - 0.6, 0);
  for (const z of [-0.7, 0.7]) ringAround(g, "x", 0.32, 0.07, M.metal, -L / 2 - 3.15, y - 0.2, z);
  box(g, 1.4, 0.8, 1.4, M.metalDark, -L / 2 - 2.0, y - 2.1, 0);
  // Roof equipment racks with access doors.
  box(g, 5, 1.2, 2.2, M.hullDark, 1.5, y + 3.2, 0);
  for (const x of [-0.4, 1.5, 3.4]) box(g, 1.6, 0.9, 0.06, M.hull, x, y + 3.2, 1.13);
  box(g, 1.6, 0.4, 1.6, M.foil, -3.6, y + 3.0, 0.4);
  // Radiator boom.
  cyl(g, 0.1, 0.1, 3.6, 6, M.metal, 1, y + 5.4, -1.4);
  box(g, 8, 2.4, 0.06, M.radiator, 1, y + 7.2, -1.4);
  box(g, 8.1, 0.12, 0.12, M.metal, 1, y + 6.0, -1.4);
  // UHF mast + small dish.
  cyl(g, 0.05, 0.05, 3.5, 6, M.metal, 5.8, y + 4.6, 0.8);
  mesh(g, new THREE.SphereGeometry(0.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), M.radiator, 5.8, y + 6.2, 0.8, { rx: -1.1 });
  // Weather mast with anemometer.
  cyl(g, 0.06, 0.06, 4, 6, M.metal, -4.5, y + 4.8, 1.2);
  box(g, 0.5, 0.3, 0.3, M.hull, -4.5, y + 5.9, 1.2);
  const anemo = new THREE.Group();
  anemo.position.set(-4.5, y + 6.9, 1.2);
  anemo.userData.dynamic = true;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    mesh(anemo, new THREE.BoxGeometry(0.7, 0.03, 0.03), M.metal, Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35, { ry: -a, cast: false });
    mesh(anemo, new THREE.SphereGeometry(0.11, 8, 6), M.hull, Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7, { cast: false });
  }
  g.add(anemo);
  // Stair to the deck.
  for (let i = 0; i < 4; i++) box(g, 1.4, 0.12, 0.45, M.composite, L / 2 + 1.6 + i * 0.45, 0.85 - i * 0.24, 2.8);
  fixture(g, M, -3, y + 2.95, 2.4, 0, 0.8);
  fixture(g, M, 4, y + 2.95, 2.4, 0, 0.8);
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(22, 10, 9), 4);
  return {
    group: g,
    hit,
    radius: 12,
    focus: { distance: 32, height: 3 },
    footprint: { w: 22, d: 9 },
    update(t, env, sim) {
      anemo.rotation.y += 0.05 + (sim?.flows?.tau ?? 0.5) * 0.02;
    },
  };
}

function buildGreenhouse(M) {
  const g = new THREE.Group();
  const R = 5.5;
  const L = 30;
  // Kerb walls of sintered regolith.
  for (const s of [-1, 1]) box(g, L + 0.6, 0.7, 0.5, M.sintered, 0, 0.35, s * (R + 0.1));
  const shell = new THREE.CylinderGeometry(R, R, L, 40, 1, true, 0, Math.PI);
  shell.rotateZ(Math.PI / 2);
  const glass = new THREE.Mesh(shell, M.glass);
  glass.position.y = 0.7;
  glass.renderOrder = 2;
  glass.userData.dynamic = true;
  g.add(glass);
  const capGeo = new THREE.CircleGeometry(R, 28, 0, Math.PI);
  capGeo.rotateY(Math.PI / 2);
  for (const x of [-L / 2, L / 2]) {
    const c = new THREE.Mesh(capGeo, M.glass);
    c.position.set(x, 0.7, 0);
    c.renderOrder = 2;
    c.userData.dynamic = true;
    g.add(c);
  }
  // Framing: arches + longitudinal purlins.
  const arch = new THREE.TorusGeometry(R + 0.03, 0.1, 6, 28, Math.PI);
  arch.rotateY(Math.PI / 2);
  for (let i = 0; i <= 15; i++) mesh(g, arch, M.metal, -L / 2 + (i * L) / 15, 0.7, 0);
  for (const a of [0.35, 0.8, 1.2, Math.PI / 2, Math.PI - 1.2, Math.PI - 0.8, Math.PI - 0.35]) {
    box(g, L, 0.1, 0.1, M.metal, 0, 0.7 + Math.sin(a) * (R + 0.05), Math.cos(a) * (R + 0.05));
  }
  // Vertical farming racks with grow lights.
  const cropGeo = new THREE.IcosahedronGeometry(0.28, 1);
  cropGeo.scale(1, 0.62, 1);
  const tiers = [0.95, 2.35];
  const rows = [-2.6, 0, 2.6];
  const per = 30;
  const crops = new THREE.InstancedMesh(cropGeo, M.crop, tiers.length * rows.length * per);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const rand = mulberry32(4);
  let n = 0;
  for (const z of rows) {
    for (const ty of tiers) {
      box(g, L - 4, 0.12, 1.3, M.metal, 0, ty, z);
      box(g, L - 4, 0.22, 1.2, M.soil, 0, ty + 0.17, z, { cast: false });
      box(g, L - 5, 0.06, 0.22, M.grow, 0, ty + 1.12, z, { cast: false });
      for (let i = 0; i < per; i++) {
        const s = 0.75 + rand() * 0.55;
        m4.makeScale(s, s * (0.7 + rand() * 0.6), s).setPosition(-L / 2 + 3 + i * 0.82, ty + 0.42, z + (rand() - 0.5) * 0.5);
        crops.setMatrixAt(n, m4);
        crops.setColorAt(n, col.setHSL(0.25 + rand() * 0.08, 0.45, 0.24 + rand() * 0.14));
        n++;
      }
    }
    for (const x of [-12, -4, 4, 12]) box(g, 0.08, 2.4, 1.3, M.metal, x, 1.6, z);
  }
  crops.castShadow = false;
  crops.receiveShadow = true;
  g.add(crops);
  // Environmental systems: ridge air duct, circulation fans, nutrient + water tanks.
  cyl(g, 0.38, 0.38, L - 2, 14, M.metal, 0, 4.9, 0, { rz: Math.PI / 2 });
  for (const x of [-L / 2 + 0.5, L / 2 - 0.5]) ringAround(g, "x", 0.9, 0.08, M.metalDark, x, 3.8, 0);
  for (const z of [-4.2, 4.2]) cyl(g, 0.45, 0.45, 1.6, 14, M.hull, -L / 2 + 1.2, 1.5, z);
  cyl(g, 0.25, 0.25, 1.2, 10, M.hazard, -L / 2 + 2.4, 1.3, 4.2);
  // Vestibule.
  box(g, 3.2, 3.6, 3.8, M.hull, L / 2 + 1.6, 1.8, 0);
  box(g, 0.1, 2.2, 1.3, M.metalDark, L / 2 + 3.22, 1.2, 0);
  fixture(g, M, L / 2 + 3.3, 2.7, 0, Math.PI / 2, 0.8);
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(34, 7, 12), 3);
  return {
    group: g,
    hit,
    radius: 18,
    focus: { distance: 36, height: 2 },
    footprint: { w: 34, d: 13 },
    update(t, env, sim) {
      const on = sim && sim.systems.greenhouseLights && !sim.shed.greenhouseLights;
      M.grow.emissiveIntensity = on ? 2.4 : 0.05;
      M.glass.emissiveIntensity = on ? 0.04 + env.night * 0.4 : 0;
    },
  };
}

const PANEL_ROWS = 8;
const PANEL_COLS = 12;
export const PANEL_AREA = 18;
function buildSolar(M) {
  const g = new THREE.Group();
  const max = PANEL_ROWS * PANEL_COLS;
  const cellsGeo = new THREE.BoxGeometry(2.9, 0.05, 5.9);
  // Aluminium frame around each module (single merged geometry).
  const fparts = [
    new THREE.BoxGeometry(3.06, 0.08, 0.08).translate(0, 0, 2.99),
    new THREE.BoxGeometry(3.06, 0.08, 0.08).translate(0, 0, -2.99),
    new THREE.BoxGeometry(0.08, 0.08, 6.06).translate(1.49, 0, 0),
    new THREE.BoxGeometry(0.08, 0.08, 6.06).translate(-1.49, 0, 0),
    new THREE.BoxGeometry(0.1, 0.1, 6.0).translate(0, -0.1, 0),
  ];
  const frameGeo = mergeGeometries(fparts.map((p) => p.toNonIndexed()));
  const panels = new THREE.InstancedMesh(cellsGeo, M.solar, max);
  const frames = new THREE.InstancedMesh(frameGeo, M.metal, max);
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 1.7, 8), M.metal, max);
  const motors = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.36, 0.5), M.hullDark, max);
  const pads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.18, 0.8), M.sintered, max);
  const slots = [];
  for (let r = 0; r < PANEL_ROWS; r++) {
    for (let c = 0; c < PANEL_COLS; c++) {
      slots.push({ x: (c - (PANEL_COLS - 1) / 2) * 4.6, z: (r - (PANEL_ROWS - 1) / 2) * 6.6 });
    }
  }
  slots.sort((a, b) => Math.hypot(a.x, a.z * 0.8) - Math.hypot(b.x, b.z * 0.8));
  const m4 = new THREE.Matrix4();
  slots.forEach((s, i) => {
    posts.setMatrixAt(i, m4.makeTranslation(s.x, 0.85, s.z));
    motors.setMatrixAt(i, m4.makeTranslation(s.x, 1.45, s.z + 0.35));
    pads.setMatrixAt(i, m4.makeTranslation(s.x, 0.06, s.z));
  });
  for (const im of [panels, frames, posts, motors]) {
    im.castShadow = true;
    im.receiveShadow = true;
    im.userData.dynamic = true;
  }
  pads.userData.dynamic = true;
  pads.receiveShadow = true;
  g.add(panels, frames, posts, motors, pads);
  // Torque tubes per column + cable trench + combiner boxes.
  for (let c = 0; c < PANEL_COLS; c++) {
    const x = (c - (PANEL_COLS - 1) / 2) * 4.6;
    cyl(g, 0.07, 0.07, PANEL_ROWS * 6.6, 6, M.metal, x, 1.62, 0, { rx: Math.PI / 2, cast: false });
  }
  box(g, 60, 0.12, 0.6, M.metalDark, 0, 0.06, -28, { cast: false });
  for (const x of [-30, -32.6]) box(g, 1.6, 1.6, 1.0, M.hull, x, 0.8, 0);
  box(g, 30, 0.15, 0.6, M.metalDark, -48, 0.08, 0, { cast: false });
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(58, 6, 56), 2);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = V3(1, 1, 1);
  const tpos = new THREE.Vector3();
  let tilt = 0;
  let first = true;
  return {
    group: g,
    hit,
    radius: 34,
    focus: { distance: 80, height: 1 },
    footprint: null,
    maxPanels: max,
    setCount(cnt) {
      const k = Math.max(0, Math.min(max, cnt));
      for (const im of [panels, frames, posts, motors, pads]) im.count = k;
    },
    update(t, env, sim) {
      // Settled dust visibly dulls the modules as the simulated cleanliness drops.
      M.solar.userData.surface.uDustTop.value = 0.04 + (sim ? 1 - sim.dust : 0) * 2.2;
      const sd = env.sunDir;
      const target = env.sinEl > 0.02 ? Math.max(-1.0, Math.min(1.0, -Math.atan2(sd.x, Math.max(0.05, sd.y)))) : 0;
      if (!first && Math.abs(target - tilt) < 0.002) return;
      first = false;
      tilt += (target - tilt) * 0.08;
      q.setFromEuler(e.set(0, 0, tilt));
      slots.forEach((s, i) => {
        tpos.set(s.x, 1.85, s.z);
        m4.compose(tpos, q, one);
        panels.setMatrixAt(i, m4);
        frames.setMatrixAt(i, m4);
      });
      panels.instanceMatrix.needsUpdate = true;
      frames.instanceMatrix.needsUpdate = true;
    },
  };
}

function buildBattery(M) {
  const g = new THREE.Group();
  const ledMat = M.led.clone();
  const leds = [];
  for (let i = 0; i < 4; i++) {
    const z = (i - 1.5) * 3.5;
    box(g, 7, 2.6, 2.5, M.hullDark, 0, 1.45, z);
    box(g, 7.1, 0.14, 2.6, M.metal, 0, 2.8, z);
    box(g, 7.2, 0.3, 2.7, M.sintered, 0, 0.15, z);
    // Thermal-control unit with fan rings on each roof.
    box(g, 1.9, 0.7, 1.6, M.hull, -2.2, 3.22, z);
    for (const dx of [-0.45, 0.45]) ringAround(g, "y", 0.32, 0.04, M.metalDark, -2.2 + dx, 3.6, z);
    // Doors with handles.
    for (const dx of [2.2, 3.1]) box(g, 0.85, 2.1, 0.06, M.hull, dx, 1.45, z + 1.27);
    box(g, 0.06, 0.4, 0.06, M.metal, 2.6, 1.45, z + 1.32, { cast: false });
    leds.push(mesh(g, new THREE.BoxGeometry(3.6, 0.1, 0.05), ledMat, -0.6, 2.4, z + 1.28, { cast: false, dynamic: true }));
  }
  // Transformer / inverter with cooling fins + cable trays.
  box(g, 2.2, 2.2, 3, M.hull, 5.6, 1.1, 0);
  for (let k = 0; k < 8; k++) box(g, 0.05, 1.6, 2.4, M.metal, 6.75 + k * 0.08, 1.1, 0, { cast: false });
  box(g, 0.4, 1.5, 6, M.metalDark, 5.6, 2.95, 0);
  box(g, 14, 0.12, 0.5, M.metalDark, -9, 0.06, 0, { cast: false });
  fixture(g, M, 4.4, 2.35, 1.55, 0, 0.6);
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(14, 5, 15), 2);
  const c = new THREE.Color();
  return {
    group: g,
    hit,
    radius: 10,
    focus: { distance: 28, height: 1.5 },
    footprint: { w: 15, d: 16 },
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
  const tops = legs.map(([x, z]) => V3(x * 0.55, H, z * 0.55));
  const bots = legs.map(([x, z]) => V3(x, 0, z));
  for (let i = 0; i < 4; i++) {
    strut(g, bots[i], tops[i], 0.12, M.metal);
    box(g, 0.8, 0.3, 0.8, M.sintered, bots[i].x, 0.15, bots[i].z);
    for (let k = 0; k < 5; k++) {
      const a = bots[i].clone().lerp(tops[i], k / 5);
      const b = bots[(i + 1) % 4].clone().lerp(tops[(i + 1) % 4], (k + 1) / 5);
      strut(g, a, b, 0.045, M.metal, { cast: false });
    }
  }
  box(g, 2.4, 0.3, 2.4, M.metalDark, 0, H, 0);
  // Guy wires to ground anchors.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    const anchor = V3(Math.cos(a) * 11, 0.2, Math.sin(a) * 11);
    strut(g, V3(Math.cos(a) * 0.9, H * 0.7, Math.sin(a) * 0.9), anchor, 0.018, M.metalDark, { cast: false, seg: 3 });
    box(g, 0.6, 0.3, 0.6, M.sintered, anchor.x, 0.15, anchor.z);
  }
  // Equipment shelter with radiator fins, a small relay dish and whip antennas.
  box(g, 2.6, 2.0, 1.8, M.hull, 3.2, 1.0, 0);
  for (let k = 0; k < 6; k++) box(g, 0.04, 1.4, 1.4, M.radiator, 4.55 + k * 0.08, 1.0, 0, { cast: false });
  box(g, 2.8, 0.25, 2.2, M.sintered, 3.2, 0.12, 0);
  mesh(g, new THREE.SphereGeometry(0.75, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), M.radiator, 2.6, 2.6, 0, { rx: -0.9 });
  cyl(g, 0.05, 0.05, 0.6, 6, M.metal, 2.6, 2.15, 0);
  for (const dz of [-0.6, 0.6]) cyl(g, 0.015, 0.015, 2.4, 4, M.metal, 4.1, 3.2, dz, { cast: false });
  fixture(g, M, 3.2, 2.15, 0.95, 0, 0.6);
  // Main dish assembly (tracks Earth).
  const head = new THREE.Group();
  head.position.set(0, H + 0.5, 0);
  head.userData.dynamic = true;
  const tiltG = new THREE.Group();
  head.add(tiltG);
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const r = (i / 14) * 3.4;
    pts.push(V2(r + 0.001, (r * r) / (4 * 1.75)));
  }
  const dishMat = M.radiator.clone();
  dishMat.side = THREE.DoubleSide;
  mesh(tiltG, new THREE.LatheGeometry(pts, 40), dishMat, 0, 0.7, 0);
  ringAround(tiltG, "y", 3.4, 0.06, M.metal, 0, 0.7 + (3.4 * 3.4) / 7, 0);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    strut(tiltG, V3(Math.cos(a) * 0.5, 0.55, Math.sin(a) * 0.5), V3(Math.cos(a) * 3.0, 0.62 + 9 / 7, Math.sin(a) * 3.0), 0.035, M.metal, { cast: false });
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    strut(tiltG, V3(Math.cos(a) * 3.0, 0.7 + 9 / 7, Math.sin(a) * 3.0), V3(0, 2.5, 0), 0.03, M.metal, { cast: false });
  }
  cyl(tiltG, 0.32, 0.2, 0.4, 14, M.metalDark, 0, 2.55, 0);
  cyl(tiltG, 0.25, 0.25, 0.8, 12, M.hull, 0, 0.35, 0);
  cyl(head, 0.5, 0.6, 0.9, 12, M.metal, 0, 0.1, 0);
  box(head, 1.4, 0.5, 0.8, M.hullDark, 0, -0.2, 0.5);
  g.add(head);
  const beacon = mesh(g, new THREE.SphereGeometry(0.2, 8, 6), M.beaconRed, 0, H + 0.4, 1.2, { cast: false, dynamic: true });
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.CylinderGeometry(6, 6, 20, 8), 9);
  return {
    group: g,
    hit,
    radius: 6,
    focus: { distance: 34, height: 9 },
    footprint: { w: 10, d: 8, round: true },
    update(t) {
      head.rotation.y = -1.9 + Math.sin(t * 0.03) * 0.25;
      tiltG.rotation.x = -0.75 + Math.sin(t * 0.05) * 0.05;
      beacon.visible = t % 1.6 < 0.18;
    },
  };
}

function buildWater(M) {
  const g = new THREE.Group();
  box(g, 18, 0.25, 7, M.sintered, 0, 0.12, 4);
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 5;
    cyl(g, 2.1, 2.1, 5.2, 28, M.hull, x, 3.0, 4);
    mesh(g, new THREE.SphereGeometry(2.1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.hull, x, 5.6, 4);
    ringAround(g, "y", 2.14, 0.1, M.orange, x, 4.4, 4);
    ringAround(g, "y", 2.14, 0.08, M.metal, x, 1.6, 4);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      box(g, 0.3, 0.8, 0.3, M.metal, x + Math.cos(a) * 1.8, 0.5, 4 + Math.sin(a) * 1.8);
    }
    // Ladder
    for (const s of [-0.25, 0.25]) box(g, 0.05, 5.2, 0.05, M.metal, x + s, 3.0, 6.2, { cast: false });
    for (let r = 0; r < 10; r++) box(g, 0.5, 0.04, 0.04, M.metal, x, 0.8 + r * 0.5, 6.2, { cast: false });
  }
  // Pipe rack between tanks and plant.
  for (const x of [-6, 0, 6]) box(g, 0.15, 2.4, 0.15, M.metal, x, 1.2, 0.6);
  box(g, 14, 0.12, 0.6, M.metal, 0, 2.4, 0.6);
  for (const dz of [-0.15, 0.15]) cyl(g, 0.12, 0.12, 14, 8, dz > 0 ? M.orange : M.metal, 0, 2.6, 0.6 + dz, { rz: Math.PI / 2 });
  // Ice extraction plant: housing, hopper, conveyor with rollers, vent stacks.
  box(g, 6, 3.4, 4.2, M.hull, 1, 1.7, -4);
  box(g, 6.2, 0.3, 4.4, M.hullDark, 1, 3.5, -4);
  box(g, 3, 1.6, 0.06, M.hullDark, 1, 1.4, -1.88);
  const vent = mesh(g, new THREE.BoxGeometry(1.2, 0.5, 0.1), M.lampHead.clone(), 1, 2.6, -1.85, { cast: false, dynamic: true });
  cyl(g, 0.3, 0.3, 2.4, 10, M.metal, -1, 4.6, -5);
  cyl(g, 0.3, 0.3, 1.6, 10, M.metal, 0.2, 4.2, -5);
  cyl(g, 1.8, 0.6, 2, 4, M.metal, -6, 3.8, -6, { ry: Math.PI / 4 });
  box(g, 1, 0.25, 8, M.rubber, -6, 1.6, -10.5, { rx: 0.42 });
  for (const z of [-7, -9.5, -12.5]) box(g, 0.2, 2.2, 0.2, M.metal, -6, 1, z);
  const drum = new THREE.Group();
  drum.position.set(5.4, 1.3, -4);
  drum.userData.dynamic = true;
  mesh(drum, new THREE.CylinderGeometry(1.1, 1.1, 2.6, 18), M.metal, 0, 0, 0, { rx: Math.PI / 2 });
  mesh(drum, new THREE.BoxGeometry(0.15, 2.3, 2.7), M.orange, 0, 0, 0);
  g.add(drum);
  // Insulated product line toward the habitat.
  const pipe = [V3(5, 1.2, 4), V3(10, 0.6, 7), V3(20, 0.5, 18), V3(26, 0.6, 24)];
  tube(g, pipe, 0.24, M.mli, { seg: 30, radial: 8 });
  for (let i = 1; i < 6; i++) {
    const p = new THREE.CatmullRomCurve3(pipe).getPoint(i / 6);
    box(g, 0.5, p.y, 0.5, M.metal, p.x, p.y / 2, p.z, { cast: false });
  }
  fixture(g, M, 1, 3.1, -1.85, 0, 0.8);
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(20, 8, 20), 3);
  return {
    group: g,
    hit,
    radius: 11,
    focus: { distance: 32, height: 2 },
    footprint: { w: 20, d: 22 },
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
  const shell = new THREE.CylinderGeometry(R, R, L, 32, 1, true, -Math.PI / 2, Math.PI);
  shell.rotateX(-Math.PI / 2);
  mesh(g, shell, M.hull);
  const inner = M.hullDark.clone();
  inner.side = THREE.BackSide;
  mesh(g, shell, inner, 0, 0, 0, { cast: false });
  const arch = new THREE.TorusGeometry(R + 0.06, 0.15, 6, 28, Math.PI);
  for (let i = 0; i <= 6; i++) mesh(g, arch, i === 3 ? M.orange : M.metal, 0, 0, -L / 2 + (i * L) / 6);
  mesh(g, new THREE.CircleGeometry(R, 28, 0, Math.PI), M.hullDark, 0, 0, -L / 2, { ry: Math.PI });
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
  mesh(g, new THREE.ShapeGeometry(frame, 18), M.hullDark, 0, 0, L / 2);
  const door = mesh(g, new THREE.BoxGeometry(5.3, 3.9, 0.15), M.hullDark, 0, 1.95, L / 2 + 0.12, { dynamic: true });
  box(g, 5.6, 0.18, 0.2, M.lampHead, 0, 4.1, L / 2 + 0.2, { cast: false });
  box(g, 7, 0.18, 10, M.sintered, 0, 0.09, L / 2 + 5, { cast: false });
  box(g, 4.5, 0.06, 0.25, M.lampHead, 0, 4.6, 0, { cast: false });
  // Charging post, tool racks, crates.
  box(g, 0.7, 1.8, 0.6, M.hull, 4.4, 0.9, L / 2 + 4);
  box(g, 0.3, 0.3, 0.05, M.led, 4.4, 1.5, L / 2 + 4.32, { cast: false });
  tube(g, [V3(4.4, 1.2, L / 2 + 4.3), V3(3.6, 0.4, L / 2 + 5.2), V3(2.4, 0.1, L / 2 + 5.6)], 0.04, M.rubber, { seg: 10, radial: 4 });
  for (const z of [-3, 0, 3]) box(g, 0.6, 2.4, 2.2, M.metalDark, -4.2, 1.2, z);
  const crate = new THREE.BoxGeometry(1.2, 1, 1.2);
  mesh(g, crate, M.orange, -6.6, 0.5, 2);
  mesh(g, crate, M.hullDark, -6.4, 0.5, 3.4, { ry: 0.3 });
  mesh(g, crate, M.hullDark, -6.5, 1.5, 2.6, { ry: -0.2 });
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(12, 7, 15), 3);
  let open = 0;
  return {
    group: g,
    hit,
    radius: 9,
    focus: { distance: 30, height: 2 },
    footprint: { w: 12, d: 15 },
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
  mesh(g, new THREE.CylinderGeometry(24, 25, 0.4, 64), M.sintered, 0, 0.2, 0);
  const ring = new THREE.RingGeometry(16.6, 17.6, 72);
  ring.rotateX(-Math.PI / 2);
  const paint = surface({ kind: "sintered", color: "#e9e4da", roughness: 0.8, scale: 0.25, dustTop: 0.45, dustBase: 0 });
  mesh(g, ring, paint, 0, 0.42, 0, { cast: false });
  const ring2 = new THREE.RingGeometry(22.6, 23.2, 72);
  ring2.rotateX(-Math.PI / 2);
  mesh(g, ring2, M.orange, 0, 0.42, 0, { cast: false });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    box(g, 0.8, 0.02, 4.5, paint, Math.cos(a) * 20, 0.42, Math.sin(a) * 20, { ry: -a + Math.PI / 2, cast: false });
  }
  // Blast scour marks.
  const scour = new THREE.RingGeometry(3, 9, 48);
  scour.rotateX(-Math.PI / 2);
  mesh(g, scour, surface({ kind: "sintered", color: "#4a3a33", roughness: 1, scale: 0.4, dustTop: 0.2, dustBase: 0 }), 0, 0.41, 0, { cast: false });
  // Ascent vehicle (generic) with insulation, RCS pods and shock-strut legs.
  const lv = new THREE.Group();
  lv.position.y = 3.4;
  cyl(lv, 2.4, 2.4, 9, 32, M.hull, 0, 4.5, 0);
  mesh(lv, new THREE.ConeGeometry(2.4, 4.2, 32), M.hull, 0, 11.1, 0);
  cyl(lv, 2.45, 2.45, 2.2, 32, M.mli, 0, 6.6, 0);
  ringAround(lv, "y", 2.45, 0.12, M.orange, 0, 2.2, 0);
  ringAround(lv, "y", 2.45, 0.1, M.metal, 0, 9, 0);
  cyl(lv, 0.9, 1.5, 1.6, 20, M.metalDark, 0, -0.8, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    box(lv, 0.5, 0.6, 0.5, M.hullDark, Math.cos(a) * 2.45, 8.4, Math.sin(a) * 2.45, { ry: -a });
    const top = V3(Math.cos(a) * 2.2, 1.4, Math.sin(a) * 2.2);
    const knee = V3(Math.cos(a) * 3.9, -0.8, Math.sin(a) * 3.9);
    const foot = V3(Math.cos(a) * 5, -3.0, Math.sin(a) * 5);
    strut(lv, top, knee, 0.17, M.metal);
    strut(lv, knee, foot, 0.12, M.metalDark);
    strut(lv, V3(Math.cos(a) * 2.3, 3.4, Math.sin(a) * 2.3), knee, 0.09, M.metal);
    cyl(lv, 0.7, 0.8, 0.2, 14, M.metal, foot.x, foot.y, foot.z);
  }
  box(lv, 1.3, 2.0, 0.2, M.metalDark, 0, 5.2, 2.36);
  g.add(lv);
  bakeStatic(g);
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
    focus: { distance: 64, height: 6 },
    footprint: null,
    update(t) {
      const headI = Math.floor(t * 8) % 20;
      for (let i = 0; i < 20; i++) lights.setColorAt(i, (i - headI + 20) % 20 < 3 ? cOn : cOff);
      lights.instanceColor.needsUpdate = true;
    },
  };
}

function buildFission(M) {
  const g = new THREE.Group();
  mesh(g, new THREE.LatheGeometry([V2(22, 0), V2(19.5, 1.8), V2(17.5, 2.6), V2(16.8, 2.4), V2(15.5, 0)], 56), M.regolith);
  const units = [];
  for (let i = 0; i < 6; i++) {
    const u = new THREE.Group();
    const a = (i / 6) * Math.PI * 2;
    u.position.set(Math.cos(a) * 8, 0, Math.sin(a) * 8);
    box(u, 3.2, 0.3, 3.2, M.sintered, 0, 0.15, 0);
    cyl(u, 1.2, 1.4, 1.3, 18, M.metalDark, 0, 0.95, 0);
    cyl(u, 0.55, 0.55, 1.6, 14, M.foil, 0, 2.3, 0);
    mesh(u, new THREE.ConeGeometry(1.9, 4.8, 20, 1, true), M.radiator, 0, 5.5, 0, { rx: Math.PI });
    for (let k = 0; k < 6; k++) box(u, 0.05, 4.4, 1.4, M.radiator, 0, 5.5, 0, { ry: (k / 6) * Math.PI });
    mesh(u, new THREE.SphereGeometry(0.15, 8, 6), M.led, 0, 8.1, 0, { cast: false });
    bakeStatic(u);
    u.userData.dynamic = true;
    g.add(u);
    units.push(u);
  }
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    cyl(g, 0.1, 0.1, 1.6, 6, k % 2 ? M.hazard : M.metalDark, Math.cos(a) * 23.5, 0.8, Math.sin(a) * 23.5);
  }
  box(g, 2.4, 1.8, 2, M.hull, 0, 0.9, 0);
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.CylinderGeometry(22, 22, 10, 12), 4);
  return {
    group: g,
    hit,
    radius: 22,
    focus: { distance: 58, height: 3 },
    footprint: null,
    setUnits(n) {
      units.forEach((u, i) => (u.visible = i < n));
    },
    update() {},
  };
}

function buildTunnel(M, a, b, y, r) {
  const g = new THREE.Group();
  const A = V3(a.x, y, a.z);
  const B = V3(b.x, y, b.z);
  strut(g, A, B, r, M.mli, { seg: 20 });
  const len = A.distanceTo(B);
  const n = Math.floor(len / 2.6);
  for (let i = 0; i <= n; i++) {
    const p = A.clone().lerp(B, i / n);
    const ring = mesh(g, new THREE.TorusGeometry(r + 0.05, 0.09, 6, 24), M.metal, p.x, p.y, p.z);
    ring.lookAt(B);
    if (i > 0 && i < n) {
      const leg = mesh(g, new THREE.BoxGeometry(0.25, Math.max(0.2, y - r), 0.25), M.metal, p.x, (y - r) / 2, p.z);
      leg.castShadow = false;
    }
  }
  return g;
}

function lampPositions() {
  const pts = [];
  for (const path of PATHS) {
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i];
      const [bx, bz] = path[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.floor(len / 16));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        pts.push([ax + (bx - ax) * t - ((bz - az) / len) * 2.8, az + (bz - az) * t + ((bx - ax) / len) * 2.8]);
      }
    }
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    pts.push([Math.cos(a) * 22, Math.sin(a) * 22]);
  }
  return pts;
}

function buildLamps(M) {
  const pts = lampPositions();
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
    size: 3.2,
    map: glowTexture(),
    color: new THREE.Color("#ffc58a"),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  group.add(new THREE.Points(glowGeo, glowMat));
  return {
    group,
    pts,
    update(t, env) {
      glowMat.opacity = env.night * 0.8;
      M.lampHead.emissiveIntensity = 0.3 + env.night * 2.6;
    },
  };
}

/** Radial gradient for contact shadows and light pools. */
function radialTexture(stops) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One merged mesh of ground-aligned quads (one draw call for all decals of a kind). */
function decalMesh(items, material) {
  const geos = items.map(({ x, z, w, d, ry = 0, y = 0.08 }) => {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.rotateY(ry);
    g.translate(x, heightAt(x, z) + y, z);
    return g.toNonIndexed();
  });
  const m = new THREE.Mesh(mergeGeometries(geos), material);
  m.renderOrder = 1;
  return m;
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
  mesh(g, new THREE.BoxGeometry(0.6, 0.4, 0.4), M.hull, 0, 1.2, 0);
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

export function buildSettlement(quality) {
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
  const rot = { water: 0.2, battery: Math.PI / 2, comms: 0.4 };
  const contacts = [];
  for (const [id, build] of Object.entries(builders)) {
    const s = build(M, quality);
    const pos = P[id];
    s.group.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
    s.group.rotation.y = rot[id] ?? 0;
    s.id = id;
    s.kind = "structure";
    s.center = new THREE.Vector3(pos.x, s.group.position.y, pos.z);
    s.hit.userData.pick = { kind: "structure", id };
    root.add(s.group);
    structures[id] = s;
    if (s.footprint) {
      const f = s.footprint;
      contacts.push({ x: pos.x, z: pos.z, w: f.w * 1.25, d: (f.round ? f.w : f.d) * 1.25, ry: rot[id] ?? 0 });
    }
  }
  // Pressurised, insulated tunnels between modules.
  const tunnels = [
    buildTunnel(M, { x: -9.4, z: 4 }, { x: -22, z: 4 }, 2.4, 1.25),
    buildTunnel(M, { x: 3, z: -9.6 }, { x: 3, z: -28.6 }, 1.8, 1.15),
    buildTunnel(M, { x: 7.5, z: 6.5 }, { x: 31, z: 13 }, 1.7, 1.0),
  ];
  for (const t of tunnels) {
    bakeStatic(t);
    root.add(t);
  }

  // Grounding: soft contact shadows under every structure (single draw call).
  const shadowMat = new THREE.MeshBasicMaterial({
    map: radialTexture([
      [0, "rgba(0,0,0,0.6)"],
      [0.55, "rgba(0,0,0,0.38)"],
      [1, "rgba(0,0,0,0)"],
    ]),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
  });
  root.add(decalMesh(contacts, shadowMat));

  const lamps = buildLamps(M);
  root.add(lamps.group);
  // Warm light pools under lamps and at doors — read as real light falloff at night.
  const poolMat = new THREE.MeshBasicMaterial({
    map: radialTexture([
      [0, "rgba(255,196,140,0.55)"],
      [0.4, "rgba(255,170,110,0.2)"],
      [1, "rgba(255,150,90,0)"],
    ]),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const pools = lamps.pts.map(([x, z]) => ({ x, z, w: 11, d: 11, y: 0.12 }));
  pools.push({ x: 0, z: 18.5, w: 9, d: 9, y: 0.3 }, { x: 36, z: 27, w: 10, d: 10, y: 0.25 }, { x: 22, z: -34, w: 8, d: 8, y: 0.2 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.5;
    pools.push({ x: Math.sin(a) * 14.6, z: Math.cos(a) * 14.6, w: 8, d: 8, y: 0.14 });
  }
  root.add(decalMesh(pools, poolMat));

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
      poolMat.opacity = env.night;
    },
  };
}
