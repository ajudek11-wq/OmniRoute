import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { heightAt } from "./terrain.js";
import { glowTexture } from "./world.js";
import { surface } from "./surfaces.js";
import { STRUCTURE_POS as P, PATHS, SURVEY_SITES, STRUCTURE_COLLIDERS, LINK_COLLIDERS } from "../data/layout.js";
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

/** Point on a vertical shell: bearing a (rad from +z toward +x), radius r, sideways offset lat, height y. */
function pp(a, r, y = 0, lat = 0) {
  return V3(Math.sin(a) * r + Math.cos(a) * lat, y, Math.cos(a) * r - Math.sin(a) * lat);
}
const put = (parent, geo, mat, v, o) => mesh(parent, geo, mat, v.x, v.y, v.z, o);
/** Thin open band hugging a vertical cylinder (panel seams, painted stripes). */
const band = (p, r, h, mat, y, seg = 40) => mesh(p, new THREE.CylinderGeometry(r, r, h, seg, 1, true), mat, 0, y, 0);
/** Light fixture whose housing shares the metalDark shadow-casting bucket. */
function lamp(parent, M, v, ry = 0, w = 0.6) {
  box(parent, w, 0.16, 0.22, M.metalDark, v.x, v.y, v.z, { ry });
  box(parent, w * 0.85, 0.05, 0.18, M.lampHead, v.x, v.y - 0.09, v.z, { ry, cast: false });
}
const BOLT = new THREE.CylinderGeometry(0.035, 0.035, 0.08, 6).rotateX(Math.PI / 2);
/** Bolt heads around a vertical shell at height y (skip(a) leaves gaps at openings). */
function boltRing(parent, mat, r, y, n, skip) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (!skip?.(a)) put(parent, BOLT, mat, pp(a, r, y), { ry: a });
  }
}
/** Bolt heads on a flange facing bearing ry, centred at c. */
function boltCircle(parent, mat, c, ry, r, n) {
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    mesh(parent, BOLT, mat, c.x + Math.cos(ry) * Math.cos(t) * r, c.y + Math.sin(t) * r, c.z - Math.sin(ry) * Math.cos(t) * r, { ry });
  }
}
/** Double-faced corrugated sheet in the XY plane (ridges run along y). */
function corrugatedGeo(w, h, pitch = 0.2, depth = 0.045) {
  const front = new THREE.PlaneGeometry(w, h, Math.max(4, Math.round((w / pitch) * 4)), 1);
  const p = front.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / pitch) * Math.PI * 2) * depth);
  front.computeVertexNormals();
  const back = front.clone().rotateY(Math.PI);
  const g = mergeGeometries([front.toNonIndexed(), back.toNonIndexed()]);
  front.dispose();
  back.dispose();
  return g;
}
/** Faceted prism (flat-shaded cylinder). */
function prismGeo(r, h, sides, start = 0) {
  const g = new THREE.CylinderGeometry(r, r, h, sides, 1, false, start).toNonIndexed();
  g.computeVertexNormals();
  return g;
}

/** Cargo container (length along local x): corrugated sides, corner posts, rails and door locking bars. */
const CONTAINER_SIDES = new Map();
function container(parent, M, mat, len, x, y, z, ry = 0) {
  const c = new THREE.Group();
  c.position.set(x, y, z);
  c.rotation.y = ry;
  parent.add(c);
  const H = 2.59;
  const W = 2.44;
  box(c, len - 0.1, H - 0.12, W - 0.16, mat, 0, H / 2, 0);
  if (!CONTAINER_SIDES.has(len)) CONTAINER_SIDES.set(len, corrugatedGeo(len - 0.34, H - 0.34, 0.27, 0.035));
  for (const s of [-1, 1]) mesh(c, CONTAINER_SIDES.get(len), mat, 0, H / 2, s * (W / 2 - 0.05));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(c, 0.17, H, 0.17, M.metalDark, sx * (len / 2 - 0.085), H / 2, sz * (W / 2 - 0.085));
    box(c, 0.14, 0.16, W, M.metalDark, sx * (len / 2 - 0.07), 0.08, 0);
    box(c, 0.14, 0.16, W, M.metalDark, sx * (len / 2 - 0.07), H - 0.08, 0);
  }
  for (const sz of [-1, 1]) {
    box(c, len, 0.16, 0.12, M.metalDark, 0, 0.08, sz * (W / 2 - 0.06));
    box(c, len, 0.14, 0.12, M.metalDark, 0, H - 0.07, sz * (W / 2 - 0.06));
  }
  // Door end (+x): two leaves, four locking bars with cam handles.
  box(c, 0.04, H - 0.4, 0.03, M.metalDark, len / 2 + 0.005, H / 2, 0);
  for (const bz of [-0.95, -0.4, 0.4, 0.95]) {
    cyl(c, 0.028, 0.028, H - 0.36, 5, M.metal, len / 2 + 0.04, H / 2, bz);
    box(c, 0.05, 0.05, 0.3, M.metal, len / 2 + 0.07, 1.1, bz + (bz > 0 ? -0.15 : 0.15));
  }
  return c;
}

/** Flexible, insulated bellows tunnel on cradle supports with a cable tray alongside. */
function buildBellows(M, a, b, y, r) {
  const g = new THREE.Group();
  const A = V3(a.x, y, a.z);
  const B = V3(b.x, y, b.z);
  const dir = B.clone().sub(A);
  const len = dir.length();
  dir.normalize();
  const ry = Math.atan2(dir.x, dir.z);
  const n = Math.round(len / 0.34) * 2;
  const prof = [];
  for (let i = 0; i <= n; i++) prof.push(V2(r + (i % 2 ? 0.075 : 0), (i / n) * len - len / 2));
  const bel = mesh(g, new THREE.LatheGeometry(prof, 20), M.mli, (A.x + B.x) / 2, y, (A.z + B.z) / 2);
  bel.quaternion.setFromUnitVectors(_up, dir);
  const along = (d, up = 0, lat = 0) => V3(A.x + dir.x * d + Math.cos(ry) * lat, y + up, A.z + dir.z * d - Math.sin(ry) * lat);
  // Clamp rings at the hard points + support cradles.
  for (const d of [1.0, len - 0.7]) strut(g, along(d - 0.25), along(d + 0.25), r + 0.16, M.metal, { seg: 20 });
  const supports = Math.max(2, Math.round(len / 3.2));
  for (let i = 1; i < supports; i++) {
    const d = (i / supports) * len;
    strut(g, along(d - 0.12), along(d + 0.12), r + 0.11, M.metalDark, { seg: 20 });
    const s = along(d, -r - 0.12, 0.3);
    box(g, 2 * r + 1.0, 0.18, 0.32, M.metal, s.x, s.y, s.z, { ry });
    for (const lat of [-(r - 0.25), r - 0.15]) {
      const f = along(d, 0, lat);
      const h = y - r - 0.2;
      box(g, 0.18, h, 0.18, M.metal, f.x, h / 2, f.z, { ry });
      box(g, 0.5, 0.08, 0.5, M.metalDark, f.x, 0.04, f.z, { ry });
    }
  }
  // Cable tray riding on the cradle arms, with a power conduit.
  const t0 = along(0.6, -r + 0.04, r + 0.6);
  const t1 = along(len - 0.6, -r + 0.04, r + 0.6);
  strut(g, t0, t1, 0.05, M.orange, { seg: 6 });
  const tm = t0.clone().add(t1).multiplyScalar(0.5);
  box(g, 0.36, 0.06, len - 1.2, M.metalDark, tm.x, tm.y - 0.08, tm.z, { ry });
  return g;
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
  const hatch = box(g, 1.25, 1.85, 0.14, M.metalDark, 0, 1.75, AZ + 2.76);
  hatch.userData.dynamic = true;
  let hatchOpen = 0;
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
    setHatch(open) {
      hatchOpen = open ? 1 : 0;
    },
    update(t, env) {
      M.window.emissiveIntensity = 0.2 + env.night * 2.4;
      beacon.visible = Math.sin(t * 2.4) > 0.6;
      airlockLight.material.color.set(Math.sin(t * 0.25) > 0.85 ? "#ff5a3c" : "#5ce08a");
      hatch.position.x += ((hatchOpen ? 1.4 : 0) - hatch.position.x) * 0.08;
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

const DEG = Math.PI / 180;
/** South end of the battery bank's cable tray, where Habitat B's trench joins it. */
const TRENCH_END = { x: 40, z: -6.3 };
const nearAngle = (a, list, tol) => list.some((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < tol);

/** Habitat B: a two-deck vertical module (medical bay below, command deck above). */
function buildHabitatB(M) {
  const g = new THREE.Group();
  const R = 4.6;
  const Y0 = 1.0; // underside of the pressure shell (levelling jacks below)
  const H = 8;
  const YT = Y0 + H;
  const TY = 2.4; // tunnel centreline
  const AY = 2.5; // airlock centreline
  const aPort = Math.atan2(P.habitat.x - P.habitatB.x, P.habitat.z - P.habitatB.z);
  const aAir = 40 * DEG;
  const aLad = 140 * DEG;
  const lowerPorts = [-25, 5, 115].map((d) => d * DEG);
  const conduits = [80, 86, 92].map((d) => d * DEG);

  // Footing: sintered pad, eight screw jacks with braces, bottom bulkhead.
  cyl(g, R + 1.7, R + 2.0, 0.24, 12, M.sintered, 0, 0.12, 0);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.39;
    const f = pp(a, R - 0.8, 0);
    box(g, 0.3, Y0 - 0.2, 0.3, M.metal, f.x, 0.24 + (Y0 - 0.2) / 2, f.z, { ry: a });
    cyl(g, 0.24, 0.24, 0.16, 10, M.metalDark, f.x, 0.62, f.z);
    box(g, 0.8, 0.1, 0.8, M.metalDark, f.x, 0.29, f.z, { ry: a });
    strut(g, pp(a + 0.21, R - 1.9, 0.3), pp(a, R - 0.85, Y0 - 0.05), 0.04, M.metal);
  }
  cyl(g, R - 0.12, R - 0.4, 0.36, 32, M.hullDark, 0, Y0 + 0.18, 0);
  // Pressure shell, deck frames, seam bands and a yellow identification band.
  mesh(g, new THREE.CylinderGeometry(R, R, H, 40, 1, true), M.hull, 0, Y0 + H / 2, 0);
  for (const y of [Y0 + 0.12, Y0 + H / 2, YT - 0.08]) ringAround(g, "y", R + 0.05, 0.12, M.metal, 0, y, 0);
  for (const y of [Y0 + H * 0.25, Y0 + H * 0.75]) band(g, R + 0.012, 0.05, M.hullDark, y);
  band(g, R + 0.02, 0.32, M.hazard, Y0 + H / 2 + 0.34);
  const openings = (a) => nearAngle(a, [aPort, aAir], 21 * DEG);
  boltRing(g, M.metalDark, R + 0.03, Y0 + H / 2 - 0.24, 48);
  boltRing(g, M.metalDark, R + 0.03, Y0 + 0.36, 40, openings);
  // Stringers: full height on the upper deck, gapped round openings on the lower deck.
  for (const d of [-35, -5, 25, 55, 85, 115, 160, 200, 250, 290]) {
    const a = d * DEG;
    const p = pp(a, R + 0.07);
    box(g, 0.2, H / 2 - 0.3, 0.12, M.metal, p.x, Y0 + H * 0.75, p.z, { ry: a });
    if (!openings(a) && !nearAngle(a, [...lowerPorts, ...conduits], 8 * DEG)) box(g, 0.2, H / 2 - 0.3, 0.12, M.metal, p.x, Y0 + H * 0.25, p.z, { ry: a });
  }
  // Command-deck windows with frames and sunshade eyebrows.
  const yW = Y0 + H * 0.72;
  const winGeo = new THREE.BoxGeometry(1.05, 0.8, 0.12);
  for (const d of [-50, -20, 10, 40, 70, 100]) {
    const a = d * DEG;
    put(g, winGeo, M.window, pp(a, R + 0.03, yW), { ry: a, cast: false });
    const f = pp(a, R - 0.01, yW);
    box(g, 1.35, 1.1, 0.1, M.metalDark, f.x, f.y, f.z, { ry: a });
    const s = pp(a, R + 0.3, yW + 0.66);
    box(g, 1.55, 0.06, 0.55, M.hullDark, s.x, s.y, s.z, { ry: a });
  }
  // Medical-bay portholes.
  const port = new THREE.CylinderGeometry(0.32, 0.32, 0.12, 16).rotateX(Math.PI / 2);
  const portRing = new THREE.TorusGeometry(0.37, 0.06, 6, 16);
  for (const a of lowerPorts) {
    put(g, port, M.window, pp(a, R + 0.02, 2.9), { ry: a, cast: false });
    put(g, portRing, M.metalDark, pp(a, R + 0.06, 2.9), { ry: a });
  }
  // Tunnel port: docking collar, flange and bolt circle.
  strut(g, pp(aPort, R - 0.3, TY), pp(aPort, R + 1.0, TY), 1.42, M.hullDark, { seg: 24 });
  strut(g, pp(aPort, R + 0.15, TY), pp(aPort, R + 0.42, TY), 1.45, M.hazard, { seg: 24 });
  put(g, new THREE.TorusGeometry(1.52, 0.1, 6, 32), M.metal, pp(aPort, R + 0.95, TY), { ry: aPort });
  boltCircle(g, M.metalDark, pp(aPort, R + 1.04, TY), aPort, 1.52, 18);
  lamp(g, M, pp(aPort, R + 0.25, TY + 1.75), aPort);
  // Airlock: cylinder, end bulkhead, hatch with handwheel, suitports with docked suits.
  strut(g, pp(aAir, R - 0.4, AY), pp(aAir, R + 3.0, AY), 1.3, M.hull, { seg: 24 });
  for (const r of [R + 0.5, R + 2.85]) put(g, new THREE.TorusGeometry(1.36, 0.1, 6, 32), M.metal, pp(aAir, r, AY), { ry: aAir });
  strut(g, pp(aAir, R + 3.0, AY), pp(aAir, R + 3.25, AY), 1.4, M.hullDark, { seg: 24 });
  boltCircle(g, M.metal, pp(aAir, R + 3.27, AY), aAir, 1.25, 16);
  const hf = pp(aAir, R + 3.27, 2.4);
  box(g, 1.25, 1.85, 0.05, M.metal, hf.x, hf.y, hf.z, { ry: aAir });
  const hatch = pp(aAir, R + 3.31, 2.4);
  box(g, 1.0, 1.6, 0.1, M.metalDark, hatch.x, hatch.y, hatch.z, { ry: aAir });
  put(g, new THREE.TorusGeometry(0.22, 0.03, 4, 14), M.metal, pp(aAir, R + 3.38, 2.5), { ry: aAir });
  const hz = pp(aAir, R + 3.3, 3.45);
  box(g, 1.2, 0.12, 0.06, M.hazard, hz.x, hz.y, hz.z, { ry: aAir });
  const led = pp(aAir, R + 3.3, 3.3, 0.72);
  box(g, 0.14, 0.14, 0.05, M.led, led.x, led.y, led.z, { ry: aAir, cast: false });
  lamp(g, M, pp(aAir, R + 3.2, 3.8), aAir, 0.7);
  const bulk = pp(aAir, R + 1.7, AY, 1.36);
  box(g, 0.24, 1.9, 2.0, M.hullDark, bulk.x, bulk.y, bulk.z, { ry: aAir });
  for (const dr of [-0.55, 0.55]) {
    put(g, new THREE.TorusGeometry(0.4, 0.07, 6, 18), M.metal, pp(aAir, R + 1.7 + dr, 2.6, 1.5), { ry: aAir + Math.PI / 2 });
    const pl = pp(aAir, R + 1.7 + dr, 2.45, 1.7);
    box(g, 0.32, 0.85, 0.62, M.hull, pl.x, pl.y, pl.z, { ry: aAir });
    const st = pp(aAir, R + 1.7 + dr, 2.95, 1.87);
    box(g, 0.04, 0.08, 0.5, M.hazard, st.x, st.y, st.z, { ry: aAir });
  }
  for (let i = 0; i < 3; i++) {
    const h = 1.5 - i * 0.5;
    const s = pp(aAir, R + 3.62 + i * 0.5, h / 2);
    box(g, 1.7, h, 0.5, M.metalDark, s.x, s.y, s.z, { ry: aAir });
  }
  const pad = pp(aAir, R + 5.7, 0.06);
  box(g, 2.6, 0.12, 2.2, M.sintered, pad.x, pad.y, pad.z, { ry: aAir });
  for (const s of [-1, 1]) {
    tube(g, [pp(aAir, R + 3.4, 2.55, s), pp(aAir, R + 4.6, 1.6, s), pp(aAir, R + 5.1, 1.05, s)], 0.035, M.metal, { seg: 8, radial: 4 });
    for (const [r, y0] of [
      [R + 3.62, 1.5],
      [R + 4.62, 0.5],
    ]) {
      const q = pp(aAir, r, y0 + 0.5, s);
      cyl(g, 0.03, 0.03, 1.0, 5, M.metal, q.x, q.y, q.z);
    }
  }
  // Exterior ladder with safety cage to the roof.
  for (const s of [-0.24, 0.24]) {
    const q = pp(aLad, R + 0.42, (0.3 + YT + 1.2) / 2, s);
    box(g, 0.06, YT + 0.9, 0.06, M.metal, q.x, q.y, q.z, { ry: aLad });
  }
  for (let y = 0.65; y < YT + 0.9; y += 0.32) {
    const q = pp(aLad, R + 0.42, y);
    box(g, 0.48, 0.035, 0.035, M.metal, q.x, q.y, q.z, { ry: aLad });
  }
  for (let y = 1.6; y < YT; y += 2.2) {
    const q = pp(aLad, R + 0.22, y);
    box(g, 0.56, 0.06, 0.42, M.metalDark, q.x, q.y, q.z, { ry: aLad });
  }
  const hoop = new THREE.TorusGeometry(0.42, 0.025, 4, 12, Math.PI).rotateX(Math.PI / 2);
  for (let y = 2.6; y < YT + 1.0; y += 1.0) put(g, hoop, M.metal, pp(aLad, R + 0.42, y), { ry: aLad });
  for (const [r, lat] of [
    [R + 0.84, 0],
    [R + 0.72, 0.3],
    [R + 0.72, -0.3],
  ]) {
    const q = pp(aLad, r, (2.6 + YT + 0.6) / 2, lat);
    box(g, 0.03, YT - 2.0, 0.03, M.metal, q.x, q.y, q.z, { ry: aLad });
  }
  // Radiator panels on stand-off struts with coolant manifolds.
  for (const d of [195, 232]) {
    const a = d * DEG;
    const c = pp(a, R + 1.05, Y0 + 4.2);
    box(g, 2.0, 4.4, 0.06, M.radiator, c.x, c.y, c.z, { ry: a });
    for (const y of [Y0 + 2.2, Y0 + 6.2]) {
      for (const lat of [-0.7, 0.7]) strut(g, pp(a, R + 0.05, y, lat), pp(a, R + 1.0, y, lat), 0.05, M.metal);
      strut(g, pp(a, R + 1.12, y, -1.05), pp(a, R + 1.12, y, 1.05), 0.06, M.metalDark);
    }
    tube(g, [pp(a, R + 1.12, Y0 + 2.2, 1.05), pp(a, R + 0.6, Y0 + 1.5, 1.2), pp(a, R + 0.06, Y0 + 1.3, 1.1)], 0.045, M.metalDark, { seg: 8, radial: 4 });
  }
  // Conduits down the shell into a junction box and a covered cable trench to the battery bank.
  conduits.forEach((a, i) => {
    tube(g, [pp(a, R + 0.18, YT - 0.4), pp(a, R + 0.18, 1.6), pp(a, R + 0.7, 0.55), pp(a, R + 1.25, 0.3)], 0.07, i === 1 ? M.orange : M.metalDark, { seg: 16, radial: 6 });
  });
  for (let y = 2.2; y < YT - 0.5; y += 1.6) {
    const q = pp(86 * DEG, R + 0.13, y);
    box(g, 0.62, 0.08, 0.14, M.metal, q.x, q.y, q.z, { ry: 86 * DEG });
  }
  const jb = pp(86 * DEG, R + 1.5, 0.45);
  box(g, 0.9, 0.7, 0.6, M.hullDark, jb.x, jb.y, jb.z, { ry: 86 * DEG });
  const t0 = pp(86 * DEG, R + 1.9, 0.07);
  const t1 = V3(TRENCH_END.x - P.habitatB.x, 0.07, TRENCH_END.z - P.habitatB.z);
  const tl = t0.distanceTo(t1);
  box(g, 0.62, 0.12, tl, M.metalDark, (t0.x + t1.x) / 2, 0.06, (t0.z + t1.z) / 2, { ry: Math.atan2(t1.x - t0.x, t1.z - t0.z) });
  // Roof: chamfered edge, handrail, hatch, life-support unit, antennas and beacon.
  mesh(g, new THREE.CylinderGeometry(R - 0.45, R, 0.5, 40), M.hull, 0, YT + 0.25, 0);
  put(g, new THREE.TorusGeometry(R - 0.7, 0.035, 4, 40).rotateX(Math.PI / 2), M.metal, V3(0, YT + 1.45, 0));
  for (let k = 0; k < 10; k++) {
    const q = pp((k / 10) * Math.PI * 2 + 0.1, R - 0.7, YT + 0.97);
    cyl(g, 0.03, 0.03, 0.95, 5, M.metal, q.x, q.y, q.z);
  }
  const rh = pp(aLad, R - 1.5, YT + 0.62);
  cyl(g, 0.62, 0.62, 0.26, 18, M.metalDark, rh.x, rh.y, rh.z);
  const ec = pp(250 * DEG, 1.6, YT + 0.95);
  box(g, 1.8, 0.9, 1.2, M.hullDark, ec.x, ec.y, ec.z, { ry: 250 * DEG });
  for (const lat of [-0.45, 0.45]) put(g, new THREE.TorusGeometry(0.27, 0.04, 6, 16).rotateX(Math.PI / 2), M.metalDark, pp(250 * DEG, 1.6, YT + 1.42, lat));
  const mb = pp(330 * DEG, 2.2, YT + 0.8);
  box(g, 1.0, 0.55, 0.7, M.mli, mb.x, mb.y, mb.z, { ry: 330 * DEG });
  const dm = pp(20 * DEG, 2.4, YT);
  cyl(g, 0.05, 0.05, 1.6, 6, M.metal, dm.x, YT + 1.3, dm.z);
  mesh(g, new THREE.SphereGeometry(0.55, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), M.radiator, dm.x, YT + 2.1, dm.z, { rx: -0.9, ry: 0.4 });
  const am = pp(160 * DEG, 2.6, YT);
  cyl(g, 0.05, 0.05, 3.2, 6, M.metal, am.x, YT + 2.1, am.z);
  for (const lat of [-0.5, 0.5]) {
    const q = pp(160 * DEG, 2.3, YT, lat);
    cyl(g, 0.018, 0.018, 2.2, 4, M.metal, q.x, YT + 1.6, q.z);
  }
  const beacon = mesh(g, new THREE.SphereGeometry(0.17, 10, 8), M.beaconRed, am.x, YT + 3.8, am.z, { cast: false, dynamic: true });
  lamp(g, M, pp(aLad + 0.45, R + 0.24, 5.4), aLad + 0.45);
  lamp(g, M, pp(-40 * DEG, R + 0.24, Y0 + H / 2 - 0.5), -40 * DEG);
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.CylinderGeometry(6.5, 6.5, 12, 12), 5.5);
  return {
    group: g,
    hit,
    radius: 7,
    focus: { distance: 26, height: 5 },
    footprint: { w: 12, d: 12, round: true },
    update(t) {
      beacon.visible = Math.sin(t * 2.4 + 1.3) > 0.6;
    },
  };
}

/** Storage & maintenance yard: open repair shelter, gantry crane, cargo containers and spares. */
function buildYard(M) {
  const g = new THREE.Group();
  const rand = mulberry32(91);
  box(g, 16.5, 0.14, 26.5, M.sintered, 0, 0.07, 0);
  // ── Mono-pitch portal-frame shelter, open to the west and south ──
  const fx = -0.6;
  const bx = 7.6;
  const hF = 6.2;
  const hB = 5.0;
  const slope = Math.atan2(hF - hB, bx - fx);
  const yr = (x) => 5.65 - (x - 3.5) * Math.tan(slope);
  for (const z of [-12.5, -9, -5.5, -2, 1.5]) {
    box(g, 0.32, hF, 0.32, M.metal, fx, hF / 2, z);
    box(g, 0.32, hB, 0.32, M.metal, bx, hB / 2, z);
    for (const x of [fx, bx]) {
      box(g, 0.7, 0.06, 0.7, M.metalDark, x, 0.17, z);
      for (const [dx, dz] of [
        [-0.24, -0.24],
        [0.24, -0.24],
        [0.24, 0.24],
        [-0.24, 0.24],
      ])
        mesh(g, BOLT, M.metalDark, x + dx, 0.22, z + dz, { rx: Math.PI / 2 });
    }
    box(g, Math.hypot(bx - fx, hF - hB) + 0.6, 0.34, 0.2, M.metal, 3.5, yr(3.5), z, { rz: -slope });
    strut(g, V3(fx, hF - 1.5, z), V3(fx + 1.3, yr(fx + 1.3) - 0.12, z), 0.05, M.metal);
    strut(g, V3(bx, hB - 1.3, z), V3(bx - 1.3, yr(bx - 1.3) - 0.12, z), 0.05, M.metal);
  }
  for (const x of [-1.1, 1.2, 3.5, 5.8, 8.1]) box(g, 0.12, 0.14, 14.6, M.metalDark, x, yr(x) + 0.24, -5.5);
  const roof = corrugatedGeo(14.8, 10.0, 0.2, 0.045);
  roof.rotateX(-Math.PI / 2).rotateY(Math.PI / 2).rotateZ(-slope).translate(3.5, yr(3.5) + 0.36, -5.5);
  mesh(g, roof, M.metal);
  const wall = corrugatedGeo(14.4, hB - 0.4);
  wall.rotateY(Math.PI / 2).translate(bx + 0.22, (hB - 0.4) / 2 + 0.35, -5.5);
  mesh(g, wall, M.metal);
  const endWall = corrugatedGeo(6.6, hB - 0.4);
  endWall.translate(4.3, (hB - 0.4) / 2 + 0.35, -12.72);
  mesh(g, endWall, M.metal);
  for (const y of [1.8, 3.6]) box(g, 0.1, 0.12, 14.4, M.metalDark, bx + 0.11, y, -5.5);
  box(g, 0.14, 0.42, 14.4, M.metalDark, bx + 0.2, 0.35, -5.5);
  box(g, 6.6, 0.42, 0.14, M.metalDark, 4.3, 0.35, -12.62);
  for (const z of [-9, -5.5, -2]) {
    box(g, 1.2, 0.1, 0.25, M.metalDark, 3.5, yr(3.5) - 0.32, z);
    box(g, 1.0, 0.04, 0.2, M.lampHead, 3.5, yr(3.5) - 0.39, z, { cast: false });
  }
  // Workbench, vice, tool chest, pegboard and parts shelving.
  box(g, 0.95, 0.08, 3.4, M.hullDark, 6.6, 0.95, -3.3);
  for (const [dx, dz] of [
    [-0.4, -1.6],
    [0.4, -1.6],
    [-0.4, 1.6],
    [0.4, 1.6],
  ])
    box(g, 0.07, 0.8, 0.07, M.metal, 6.6 + dx, 0.54, -3.3 + dz);
  box(g, 0.85, 0.04, 3.2, M.metalDark, 6.6, 0.36, -3.3);
  box(g, 0.32, 0.22, 0.26, M.metalDark, 6.35, 1.1, -4.6);
  cyl(g, 0.26, 0.26, 0.2, 14, M.metal, 6.6, 1.09, -2.8);
  box(g, 0.6, 1.0, 0.9, M.orange, 6.95, 0.64, -1.35);
  for (const y of [0.36, 0.62, 0.88]) box(g, 0.02, 0.025, 0.8, M.metalDark, 6.64, y, -1.35);
  box(g, 0.05, 1.4, 3.4, M.hullDark, bx - 0.2, 1.95, -3.3);
  for (let i = 0; i < 11; i++) {
    const z = -4.8 + i * 0.29 + (rand() - 0.5) * 0.06;
    const h = 0.25 + rand() * 0.3;
    box(g, 0.04, h, 0.06, M.metal, bx - 0.26, 2.2 - h / 2 + rand() * 0.3, z);
  }
  for (const z of [-9.2, -6.8]) for (const x of [6.7, 7.3]) box(g, 0.06, 2.4, 0.06, M.metal, x, 1.34, z);
  for (const y of [0.45, 1.25, 2.05]) {
    box(g, 0.7, 0.04, 2.5, M.metalDark, 7.0, y, -8.0);
    for (let i = 0; i < 4; i++) {
      const s = 0.3 + rand() * 0.25;
      box(g, 0.5, s, 0.48, [M.orange, M.hazard, M.hullDark][(i + Math.round(y)) % 3], 7.0, y + 0.02 + s / 2, -9.0 + i * 0.6 + rand() * 0.06);
    }
  }
  // Spare rover wheels (three stacked, one leaning), air compressor.
  const grouser = new THREE.BoxGeometry(0.06, 0.4, 0.08);
  for (let i = 0; i < 3; i++) {
    const y = 0.35 + i * 0.43;
    cyl(g, 0.55, 0.55, 0.4, 20, M.metalDark, 2.2, y, -10.6, { ry: i * 0.4 });
    cyl(g, 0.26, 0.26, 0.42, 12, M.metal, 2.2, y, -10.6);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + i * 0.3;
      mesh(g, grouser, M.metal, 2.2 + Math.sin(a) * 0.56, y, -10.6 + Math.cos(a) * 0.56, { ry: a });
    }
  }
  cyl(g, 0.55, 0.55, 0.4, 20, M.metalDark, 3.12, 0.56, -10.3, { rz: Math.PI / 2 + 0.22 });
  cyl(g, 0.26, 0.26, 0.42, 12, M.metal, 3.12, 0.56, -10.3, { rz: Math.PI / 2 + 0.22 });
  cyl(g, 0.32, 0.32, 1.3, 14, M.hazard, 1.6, 0.55, -6.2, { rz: Math.PI / 2 });
  for (const dx of [-0.45, 0.45]) box(g, 0.12, 0.25, 0.5, M.metalDark, 1.6 + dx, 0.26, -6.2);
  box(g, 0.5, 0.36, 0.4, M.metalDark, 1.5, 1.02, -6.2);
  put(g, new THREE.TorusGeometry(0.24, 0.035, 5, 14).rotateX(Math.PI / 2), M.metalDark, V3(2.25, 0.9, -6.2));
  // ── Gantry crane on rails over the container stacks ──
  for (const x of [-7.8, -2.8]) {
    box(g, 0.2, 0.12, 24, M.metalDark, x, 0.2, 0.5);
    for (const z of [-11.5, 12.5]) box(g, 0.34, 0.3, 0.2, M.hazard, x, 0.3, z);
    box(g, 0.5, 0.5, 3.4, M.hazard, x, 0.55, 3.0);
    for (const dz of [-1.2, 1.2]) cyl(g, 0.24, 0.24, 0.3, 12, M.metalDark, x, 0.36, 3 + dz, { rz: Math.PI / 2 });
    strut(g, V3(x, 0.8, 1.5), V3(x, 7.1, 3), 0.13, M.hazard, { seg: 8 });
    strut(g, V3(x, 0.8, 4.5), V3(x, 7.1, 3), 0.13, M.hazard, { seg: 8 });
    strut(g, V3(x, 3.0, 2.05), V3(x, 3.0, 3.95), 0.07, M.hazard);
    box(g, 0.6, 0.7, 1.3, M.hazard, x, 7.35, 3);
  }
  for (const dz of [-0.35, 0.35]) box(g, 5.6, 0.55, 0.28, M.hazard, -5.3, 7.35, 3 + dz);
  box(g, 1.3, 0.32, 0.02, M.hull, -5.3, 7.35, 3.5);
  const trolley = new THREE.Group();
  trolley.position.set(-5.3, 7.62, 3);
  box(trolley, 0.9, 0.3, 1.1, M.metalDark, 0, 0.15, 0);
  cyl(trolley, 0.22, 0.22, 0.8, 12, M.metalDark, 0, 0.47, 0, { rx: Math.PI / 2 });
  box(trolley, 0.5, 0.4, 0.4, M.hazard, 0.36, 0.5, 0);
  for (const dz of [-0.12, 0.12]) cyl(trolley, 0.018, 0.018, 3.0, 4, M.metalDark, 0, -1.55, dz);
  box(trolley, 0.32, 0.4, 0.42, M.hazard, 0, -3.25, 0);
  for (const [dx, dz] of [
    [-0.5, -0.45],
    [0.5, -0.45],
    [-0.5, 0.45],
    [0.5, 0.45],
  ])
    strut(trolley, V3(0, -3.45, 0), V3(dx, -4.4, dz), 0.015, M.metalDark, { seg: 3 });
  cyl(trolley, 0.55, 0.55, 1.4, 16, M.hull, 0, -4.9, 0, { rz: Math.PI / 2 });
  for (const dx of [-0.5, 0.5]) cyl(trolley, 0.57, 0.57, 0.12, 16, M.hazard, dx, -4.9, 0, { rz: Math.PI / 2 });
  bakeStatic(trolley);
  trolley.userData.dynamic = true;
  g.add(trolley);
  // ── Containers of varied size and colour, stacked two high ──
  container(g, M, M.orange, 6.06, -5.3, 0.14, -8.6, Math.PI / 2);
  container(g, M, M.hullDark, 6.06, -5.24, 2.73, -8.52, Math.PI / 2 + 0.025);
  container(g, M, M.hull, 6.06, -5.3, 0.14, -2.5, Math.PI / 2 - 0.012);
  container(g, M, M.hazard, 3.0, -5.36, 2.73, -3.9, Math.PI / 2 + 0.04);
  container(g, M, M.orange, 3.0, -5.6, 0.14, 7.6, 0.12);
  // Pressurised cargo pod on a lifting frame.
  box(g, 2.2, 0.2, 2.2, M.metalDark, -6.3, 0.24, 11.0);
  cyl(g, 0.95, 0.95, 1.9, 20, M.hull, -6.3, 1.29, 11.0);
  for (const y of [0.6, 1.95]) cyl(g, 0.98, 0.98, 0.14, 20, M.hazard, -6.3, y, 11.0);
  mesh(g, new THREE.SphereGeometry(0.95, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.hull, -6.3, 2.24, 11.0, { sv: V3(1, 0.35, 1) });
  for (const a of [0.4, 2.0, 3.6, 5.2]) box(g, 0.12, 0.3, 0.12, M.metalDark, -6.3 + Math.cos(a) * 0.6, 2.5, 11.0 + Math.sin(a) * 0.6);
  // Pallets with crates and drums.
  const pallet = (x, z, ry) => {
    const p = new THREE.Group();
    p.position.set(x, 0.14, z);
    p.rotation.y = ry;
    g.add(p);
    for (const dz of [-0.45, 0, 0.45]) box(p, 0.12, 0.1, 1.2, M.hullDark, dz, 0.05, 0);
    for (const dx of [-0.48, -0.16, 0.16, 0.48]) box(p, 0.24, 0.04, 1.2, M.hullDark, 0, 0.12, dx, { ry: Math.PI / 2 });
    return p;
  };
  const p1 = pallet(0.2, 7.0, 0.1);
  box(p1, 1.0, 1.0, 1.0, M.orange, 0, 0.64, 0);
  box(p1, 1.03, 0.06, 1.03, M.metalDark, 0, 0.5, 0);
  box(p1, 0.6, 0.55, 0.6, M.hullDark, 0.1, 1.42, -0.05, { ry: 0.3 });
  const p2 = pallet(0.4, 10.4, -0.15);
  for (const [dx, dz] of [
    [-0.3, -0.3],
    [0.3, -0.3],
    [-0.3, 0.3],
    [0.3, 0.3],
  ]) {
    cyl(p2, 0.27, 0.27, 0.85, 14, dx > 0 ? M.metal : M.orange, dx, 0.57, dz);
    cyl(p2, 0.28, 0.28, 0.04, 14, M.metalDark, dx, 0.7, dz);
  }
  // Spare tanks on saddles, gas-bottle rack, cable drum.
  for (const z of [5.45, 6.6]) {
    cyl(g, 0.55, 0.55, 2.4, 16, M.hull, 4.4, 0.85, z, { rz: Math.PI / 2 });
    for (const s of [-1, 1]) mesh(g, new THREE.SphereGeometry(0.55, 12, 8), M.hull, 4.4 + s * 1.2, 0.85, z, { sv: V3(0.45, 1, 1) });
    for (const dx of [-0.7, 0.7]) cyl(g, 0.57, 0.57, 0.12, 16, M.hazard, 4.4 + dx, 0.85, z, { rz: Math.PI / 2 });
  }
  for (const dx of [-0.8, 0.8]) box(g, 0.25, 0.32, 2.4, M.metalDark, 4.4 + dx, 0.3, 6.0);
  box(g, 1.5, 0.1, 0.5, M.metalDark, 4.8, 0.19, 9.6);
  for (const dx of [-0.75, 0.75]) box(g, 0.06, 1.3, 0.06, M.metal, 4.8 + dx, 0.85, 9.85);
  box(g, 1.56, 0.05, 0.04, M.metal, 4.8, 1.2, 9.86);
  for (let i = 0; i < 6; i++) {
    const x = 4.25 + i * 0.22;
    cyl(g, 0.1, 0.1, 1.3, 10, [M.hazard, M.metal, M.orange][i % 3], x, 0.9, 9.6);
    cyl(g, 0.04, 0.06, 0.16, 6, M.metalDark, x, 1.63, 9.6);
  }
  for (const dz of [-0.45, 0.45]) cyl(g, 0.85, 0.85, 0.08, 20, M.hullDark, 6.6, 0.9, 11.6 + dz, { rx: Math.PI / 2 });
  cyl(g, 0.62, 0.62, 0.84, 18, M.metalDark, 6.6, 0.9, 11.6, { rx: Math.PI / 2 });
  cyl(g, 0.12, 0.12, 1.1, 8, M.metal, 6.6, 0.9, 11.6, { rx: Math.PI / 2 });
  // Floodlight mast aimed into the yard.
  cyl(g, 0.1, 0.14, 7.5, 8, M.metal, 7.6, 3.89, 12.8);
  box(g, 0.6, 0.2, 0.6, M.metalDark, 7.6, 0.24, 12.8);
  box(g, 0.4, 0.6, 0.25, M.hullDark, 7.6, 1.2, 12.56);
  const heads = new THREE.Group();
  heads.position.set(7.6, 7.45, 12.8);
  heads.rotation.y = Math.atan2(-7.6, -12.8);
  g.add(heads);
  box(heads, 1.6, 0.1, 0.1, M.metal, 0, 0, 0);
  for (const dx of [-0.6, 0.6]) {
    box(heads, 0.5, 0.35, 0.3, M.metalDark, dx, -0.2, 0.12, { rx: 0.45 });
    box(heads, 0.42, 0.27, 0.04, M.lampHead, dx, -0.27, 0.27, { rx: 0.45, cast: false });
  }
  // Perimeter bollards, entrance sign.
  for (const [x, z] of [
    [-8.1, -13.1],
    [8.1, -13.1],
    [8.1, 2.5],
    [-8.1, 13.1],
    [-0.8, 13.1],
    [5.2, 13.1],
    [8.4, 8.0],
  ]) {
    cyl(g, 0.09, 0.09, 1.0, 8, M.hazard, x, 0.64, z);
    cyl(g, 0.1, 0.1, 0.2, 8, M.metalDark, x, 1.2, z);
  }
  for (const x of [1.4, 3.0]) cyl(g, 0.05, 0.05, 2.0, 6, M.metal, x, 1.0, 14.0);
  box(g, 2.0, 0.9, 0.06, M.hull, 2.2, 1.55, 14.0);
  box(g, 2.0, 0.2, 0.07, M.orange, 2.2, 1.95, 14.0);
  box(g, 2.0, 0.08, 0.07, M.hazard, 2.2, 1.15, 14.0);
  for (const [y, w] of [
    [1.72, 1.5],
    [1.56, 1.2],
    [1.4, 1.4],
  ])
    box(g, w, 0.05, 0.075, M.hullDark, 2.2 - (1.5 - w) / 2, y, 14.0);
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(17, 9, 27), 4);
  return {
    group: g,
    hit,
    radius: 15,
    focus: { distance: 40, height: 3 },
    footprint: { w: 17, d: 27 },
    update(t) {
      trolley.position.x = -5.3 + Math.sin(t * 0.11) * 1.3;
    },
  };
}

/** Propellant plant: electrolysis + Sabatier skids, compressors, cryogenic tank farm, pipe rack. */
function buildIsru(M) {
  const g = new THREE.Group();
  box(g, 23, 0.14, 16, M.sintered, 0, 0.07, 0.5);
  // Spill-containment bund round the tank farm.
  for (const z of [-7.25, -0.95]) box(g, 21.8, 0.55, 0.35, M.sintered, 0, 0.42, z);
  for (const x of [-10.9, 10.9]) box(g, 0.35, 0.55, 6.6, M.sintered, x, 0.42, -4.1);
  // Horizontal cryogenic tanks on saddles (LOX white, methane in orange foam), with top catwalk.
  const tank = (mat, x0, x1, z, r, y) => {
    const L = x1 - x0 - 2 * r * 0.6;
    const cx = (x0 + x1) / 2;
    cyl(g, r, r, L, 28, mat, cx, y, z, { rz: Math.PI / 2 });
    const cap = new THREE.SphereGeometry(r, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    mesh(g, cap, mat, cx + L / 2, y, z, { rz: -Math.PI / 2, sv: V3(1, 0.6, 1) });
    mesh(g, cap, mat, cx - L / 2, y, z, { rz: Math.PI / 2, sv: V3(1, 0.6, 1) });
    const bands = 4;
    for (let i = 0; i < bands; i++) mesh(g, new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.14, 28, 1, true), M.metal, cx - L / 2 + ((i + 0.5) / bands) * L, y, z, { rz: Math.PI / 2 });
    for (const sx of [-0.32, 0, 0.32]) {
      const x = cx + sx * L;
      const hS = y - r + 0.11 - 0.14;
      box(g, 0.45, hS, 2 * r * 0.9, M.metalDark, x, 0.14 + hS / 2, z);
      box(g, 0.85, 0.22, 2 * r + 0.4, M.sintered, x, 0.25, z);
    }
    cyl(g, 0.28, 0.28, 0.35, 12, M.metal, cx - L * 0.25, y + r + 0.1, z);
    for (const dx of [0.2, 0.5]) cyl(g, 0.05, 0.05, 0.8, 6, M.metal, cx + L * 0.2 + dx, y + r + 0.3, z - 0.3);
    cyl(g, 0.04, 0.04, 2.6, 6, M.metal, x1 - 0.05, y, z + 0.85);
    cyl(g, 0.16, 0.16, 0.5, 10, M.metalDark, x1 - 0.1, 0.39, z + 1.2);
    return { cx, L };
  };
  const TY = 2.1;
  const TR = 1.55;
  const t1 = tank(M.radiator, -9.35, 0.15, -4.1, TR, TY);
  const t2 = tank(M.orange, 1.45, 9.55, -4.1, TR, TY);
  const yC = TY + TR + 0.08;
  box(g, 18.6, 0.06, 0.8, M.metalDark, 0.1, yC, -4.1);
  for (const s of [-0.38, 0.38]) {
    box(g, 18.6, 0.04, 0.04, M.metal, 0.1, yC + 1.0, -4.1 + s);
    box(g, 18.6, 0.04, 0.04, M.metal, 0.1, yC + 0.5, -4.1 + s);
    for (let x = -9; x <= 9.4; x += 2.05) box(g, 0.04, 1.0, 0.04, M.metal, x, yC + 0.5, -4.1 + s);
  }
  for (const s of [-0.24, 0.24]) box(g, 0.06, yC + 1.0, 0.06, M.metal, 0.8, (yC + 1.0) / 2, -2.25 + s);
  for (let y = 0.45; y < yC; y += 0.32) box(g, 0.06, 0.035, 0.48, M.metal, 0.8, y, -2.25);
  box(g, 0.9, 0.06, 1.5, M.metalDark, 0.8, yC, -2.95);
  // Pipe rack spine (walkable underneath) with process lines and a cable tray.
  for (const x of [-10, -6, -2, 2, 6, 10]) {
    box(g, 0.24, 4.3, 0.24, M.metal, x, 2.29, 0.6);
    box(g, 0.2, 0.2, 2.2, M.metalDark, x, 3.15, 0.6);
    box(g, 0.2, 0.2, 2.2, M.metalDark, x, 4.25, 0.6);
    strut(g, V3(x, 2.4, 0.6), V3(x, 3.05, -0.35), 0.05, M.metal);
    strut(g, V3(x, 2.4, 0.6), V3(x, 3.05, 1.55), 0.05, M.metal);
    box(g, 0.6, 0.06, 0.6, M.metalDark, x, 0.17, 0.6);
    for (const [dx, dz] of [
      [-0.2, -0.2],
      [0.2, -0.2],
      [0.2, 0.2],
      [-0.2, 0.2],
    ])
      mesh(g, BOLT, M.metalDark, x + dx, 0.22, 0.6 + dz, { rx: Math.PI / 2 });
  }
  const line = (r, mat, y, z) => cyl(g, r, r, 21, 10, mat, 0, y, z, { rz: Math.PI / 2 });
  line(0.24, M.mli, 4.6, -0.1);
  line(0.12, M.orange, 4.47, 0.55);
  line(0.13, M.metal, 4.48, 1.05);
  line(0.09, M.hazard, 3.34, -0.05);
  line(0.11, M.metal, 3.36, 0.4);
  box(g, 21, 0.08, 0.5, M.metalDark, 0, 3.29, 1.25);
  // Drops: vapour/fill lines from the rack into each tank and the process skids.
  for (const x of [t1.cx + 1.2, t2.cx - 0.8]) tube(g, [V3(x, 4.6, -0.1), V3(x, 4.6, -1.4), V3(x, 4.15, -2.6), V3(x, 3.55, -3.3)], 0.13, M.mli, { seg: 14, radial: 8 });
  tube(g, [V3(-7.0, 3.36, 0.4), V3(-7.0, 3.36, 2.2), V3(-7.0, 2.6, 3.4), V3(-7.0, 1.6, 4.4)], 0.1, M.metal, { seg: 12, radial: 6 });
  tube(g, [V3(0.6, 4.47, 0.55), V3(0.6, 4.3, 2.4), V3(0.6, 2.6, 3.6), V3(0.6, 1.9, 4.6)], 0.11, M.orange, { seg: 12, radial: 6 });
  tube(g, [V3(4.0, 3.34, -0.05), V3(4.6, 3.3, 2.2), V3(5.0, 3.5, 3.8)], 0.08, M.hazard, { seg: 10, radial: 5 });
  // Electrolysis + Sabatier skid: reactor columns (one insulated), cell stack with fins, heat exchanger.
  box(g, 6.6, 0.25, 4.2, M.metalDark, -6.8, 0.27, 5.1);
  cyl(g, 0.55, 0.55, 5.0, 18, M.hull, -8.8, 2.9, 4.4);
  mesh(g, new THREE.SphereGeometry(0.55, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.hull, -8.8, 5.4, 4.4, { sv: V3(1, 0.5, 1) });
  cyl(g, 0.62, 0.62, 1.8, 18, M.mli, -8.8, 2.4, 4.4);
  for (const y of [1.2, 3.8, 4.9]) cyl(g, 0.58, 0.58, 0.1, 18, M.metal, -8.8, y, 4.4);
  cyl(g, 0.45, 0.45, 3.6, 16, M.radiator, -7.3, 2.2, 6.0);
  mesh(g, new THREE.SphereGeometry(0.45, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.radiator, -7.3, 4.0, 6.0, { sv: V3(1, 0.5, 1) });
  for (const s of [-0.22, 0.22]) box(g, 0.05, 4.6, 0.05, M.metal, -9.55, 2.7, 4.4 + s);
  for (let y = 0.7; y < 5.0; y += 0.32) box(g, 0.04, 0.035, 0.44, M.metal, -9.55, y, 4.4);
  for (const y of [1.5, 4.0]) box(g, 0.3, 0.05, 0.05, M.metal, -9.42, y, 4.4);
  box(g, 2.2, 1.5, 1.6, M.hull, -4.9, 1.15, 4.2);
  for (let k = 0; k < 8; k++) box(g, 0.04, 1.2, 1.7, M.radiator, -5.8 + k * 0.26, 1.15, 4.2);
  cyl(g, 0.35, 0.35, 2.6, 14, M.metal, -5.2, 1.1, 6.4, { rz: Math.PI / 2 });
  for (const dx of [-0.9, 0.9]) box(g, 0.2, 0.7, 0.5, M.metalDark, -5.2 + dx, 0.66, 6.4);
  // Compressor skid: two housings with motors, coolers and fans; accumulator bottle.
  box(g, 6.4, 0.25, 4.0, M.metalDark, 0.6, 0.27, 5.1);
  for (const x of [-1.0, 2.2]) {
    box(g, 1.9, 1.5, 1.4, M.hull, x, 1.15, 5.5);
    cyl(g, 0.4, 0.4, 1.3, 14, M.metal, x, 0.85, 4.15, { rx: Math.PI / 2 });
    box(g, 1.6, 0.3, 1.2, M.radiator, x, 2.05, 5.5);
    for (const dx of [-0.4, 0.4]) put(g, new THREE.TorusGeometry(0.28, 0.04, 6, 16).rotateX(Math.PI / 2), M.metalDark, V3(x + dx, 2.22, 5.5));
    for (let k = 0; k < 4; k++) box(g, 1.5, 0.04, 0.03, M.metalDark, x, 0.7 + k * 0.25, 6.21);
  }
  cyl(g, 0.3, 0.3, 1.6, 14, M.hazard, 3.3, 1.2, 3.7);
  mesh(g, new THREE.SphereGeometry(0.3, 12, 6), M.hazard, 3.3, 2.0, 3.7, { sv: V3(1, 0.5, 1) });
  // Radiator field: two rows of upright panels with manifolds.
  for (const z of [3.8, 6.4]) {
    for (const x of [5.6, 7.7, 9.8]) {
      box(g, 1.9, 2.6, 0.06, M.radiator, x, 2.1, z);
      for (const y of [0.78, 3.42]) cyl(g, 0.06, 0.06, 1.95, 6, M.metal, x, y, z, { rz: Math.PI / 2 });
      for (const dx of [-0.85, 0.85]) box(g, 0.08, 0.7, 0.08, M.metal, x + dx, 0.49, z);
    }
    cyl(g, 0.08, 0.08, 6.4, 8, M.metalDark, 7.7, 3.55, z, { rz: Math.PI / 2 });
  }
  // Vent stack with guy wires and an aviation light.
  cyl(g, 0.2, 0.24, 9, 10, M.metal, 11.6, 4.64, 1.2);
  cyl(g, 0.32, 0.28, 0.5, 10, M.metalDark, 11.6, 9.35, 1.2);
  for (const [ax, az] of [
    [15.1, 1.2],
    [11.0, 4.65],
    [11.0, -2.25],
  ]) {
    strut(g, V3(11.6, 6.5, 1.2), V3(ax, 0.3, az), 0.015, M.metalDark, { seg: 3 });
    box(g, 0.5, 0.3, 0.5, M.sintered, ax, 0.29, az);
  }
  const stackLight = mesh(g, new THREE.SphereGeometry(0.12, 8, 6), M.beaconRed, 11.6, 9.7, 1.2, { cast: false, dynamic: true });
  // Elevated pipe bridge to the ice/water plant next door.
  const b0x = 10.2;
  const b1 = V3(P.water.x - 7 * Math.cos(0.2) + 0.6 * Math.sin(0.2) - P.isru.x, 2.6, P.water.z + 7 * Math.sin(0.2) + 0.6 * Math.cos(0.2) - P.isru.z);
  for (const [dz, r, mat, y0] of [
    [-0.15, 0.11, M.metal, 3.36],
    [0.15, 0.09, M.orange, 3.34],
  ])
    strut(g, V3(b0x, y0, 0.4 + dz), V3(b1.x - 0.3, b1.y, b1.z + dz), r, mat, { seg: 8 });
  for (const x of [14, 19]) {
    const k = (x - b0x) / (b1.x - 0.3 - b0x);
    const y = 3.35 + (b1.y - 3.35) * k - 0.15;
    const z = 0.4 + (b1.z - 0.4) * k;
    box(g, 0.2, y, 0.2, M.metal, x, y / 2, z);
    box(g, 0.2, 0.12, 1.0, M.metalDark, x, y, z);
    box(g, 0.5, 0.06, 0.5, M.metalDark, x, 0.03, z);
  }
  // Control cabinet with lamp.
  box(g, 0.8, 1.7, 0.55, M.hull, -11.2, 0.99, 8.0);
  box(g, 0.02, 1.5, 0.5, M.metalDark, -10.79, 0.99, 8.0);
  box(g, 0.9, 0.08, 0.65, M.metalDark, -11.2, 1.88, 8.0);
  lamp(g, M, V3(-11.2, 2.05, 8.45), 0, 0.5);
  lamp(g, M, V3(0.1, yC + 1.4, -4.1), 0, 0.6);
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(24, 10, 17), 4);
  return {
    group: g,
    hit,
    radius: 13,
    focus: { distance: 36, height: 3 },
    footprint: { w: 24, d: 17 },
    update(t) {
      stackLight.visible = t % 2.0 < 0.25;
    },
  };
}

/** Geoscience field station: hard-shell lab pod, seismometer shield, weather mast, core drill. */
function buildFieldLab(M) {
  const g = new THREE.Group();
  const rand = mulberry32(57);
  const PR = 2.1;
  const PL = 7;
  const PY = 3.0;
  const PX = -0.2;
  const inR = PR * Math.cos(Math.PI / 8);
  // Octagonal hard-shell pod on four screw jacks.
  const pod = prismGeo(PR, PL, 8, Math.PI / 8).rotateZ(Math.PI / 2);
  mesh(g, pod, M.hull, PX, PY, 0);
  for (const x of [PX - PL / 2 + 0.1, PX + PL / 2 - 0.1]) mesh(g, prismGeo(PR + 0.12, 0.32, 8, Math.PI / 8).rotateZ(Math.PI / 2), M.hazard, x, PY, 0);
  for (const x of [PX - 1.2, PX + 1.2]) mesh(g, prismGeo(PR + 0.05, 0.14, 8, Math.PI / 8).rotateZ(Math.PI / 2), M.metalDark, x, PY, 0);
  const yB = PY - inR;
  for (const x of [PX - 2.6, PX + 2.6]) {
    for (const z of [-0.65, 0.65]) {
      box(g, 0.2, yB - 0.1, 0.2, M.metal, x, (yB - 0.1) / 2 + 0.1, z);
      cyl(g, 0.15, 0.15, 0.2, 10, M.metalDark, x, 0.55, z);
      box(g, 0.6, 0.1, 0.6, M.metalDark, x, 0.05, z);
    }
    strut(g, V3(x, 0.2, -0.65), V3(x, yB - 0.05, 0.65), 0.035, M.metal);
  }
  box(g, 2.4, 0.55, 1.4, M.hullDark, PX, yB - 0.27, 0);
  // Windows on both long faces.
  for (const [x, s] of [
    [-2.6, -1],
    [-1.3, -1],
    [0.0, -1],
    [-2.0, 1],
    [-0.7, 1],
  ]) {
    box(g, 1.0, 0.62, 0.1, M.window, PX + x, PY + 0.25, s * (inR + 0.03), { cast: false });
    box(g, 1.2, 0.82, 0.05, M.metalDark, PX + x, PY + 0.25, s * (inR + 0.005));
  }
  // Door, porch, steps and handrails at the east end.
  const xe = PX + PL / 2 + 0.06;
  box(g, 0.06, 1.9, 1.15, M.metal, xe + 0.02, 2.15, 0);
  box(g, 0.1, 1.7, 0.95, M.metalDark, xe + 0.07, 2.15, 0);
  box(g, 0.04, 0.12, 0.3, M.metal, xe + 0.14, 2.15, 0.3);
  box(g, 1.8, 0.1, 2.0, M.metalDark, PX + PL / 2 + 0.95, 1.25, 0);
  for (const dx of [0.1, 1.75]) for (const z of [-0.9, 0.9]) box(g, 0.08, 1.2, 0.08, M.metal, PX + PL / 2 + dx, 0.6, z);
  for (const z of [-0.95, 0.95]) {
    cyl(g, 0.03, 0.03, 1.0, 5, M.metal, PX + PL / 2 + 1.8, 1.8, z);
    box(g, 1.7, 0.04, 0.04, M.metal, PX + PL / 2 + 0.95, 2.3, z);
    tube(g, [V3(PX + PL / 2 + 1.8, 2.3, z * 0.58), V3(PX + PL / 2 + 3.2, 1.2, z * 0.58)], 0.03, M.metal, { seg: 4, radial: 4 });
  }
  [0.9, 0.6, 0.3].forEach((h, i) => box(g, 0.4, h, 1.0, M.metalDark, PX + PL / 2 + 2.05 + i * 0.4, h / 2, 0));
  lamp(g, M, V3(xe + 0.15, 3.35, 0), Math.PI / 2, 0.6);
  lamp(g, M, V3(PX - 1.2, PY + 1.7, -inR - 0.25), 0, 0.6);
  // Roof: radiator, tilted solar panel, antenna, vents.
  const yR = PY + inR;
  box(g, 3.0, 0.05, 1.5, M.radiator, PX - 1.6, yR + 0.42, 0);
  box(g, 2.0, 0.05, 1.3, M.solar, PX + 1.6, yR + 0.5, 0.1, { rx: 0.35 });
  for (const [x, z] of [
    [-2.9, -0.6],
    [-0.3, -0.6],
    [-2.9, 0.6],
    [-0.3, 0.6],
    [0.8, -0.4],
    [2.4, -0.4],
    [0.8, 0.5],
    [2.4, 0.5],
  ])
    cyl(g, 0.04, 0.04, 0.42, 5, M.metal, PX + x, yR + 0.21, z);
  cyl(g, 0.03, 0.03, 1.8, 5, M.metal, PX + 2.9, yR + 0.9, -0.62);
  box(g, 0.25, 0.25, 0.2, M.hullDark, PX + 2.9, yR + 0.12, -0.62);
  for (const x of [-3.2, 3.0]) box(g, 0.35, 0.22, 0.35, M.metalDark, PX + x, yR + 0.11, 0.55);
  // Seismometer under a gold-foil wind & thermal shield, tethered to the pod.
  cyl(g, 1.35, 1.45, 0.14, 20, M.sintered, -6.0, 0.07, 3.8);
  mesh(g, new THREE.SphereGeometry(0.95, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.foil, -6.0, 0.18, 3.8, { sv: V3(1, 0.8, 1) });
  cyl(g, 1.02, 1.04, 0.12, 20, M.hullDark, -6.0, 0.2, 3.8);
  tube(g, [V3(-5.0, 0.1, 3.4), V3(-4.0, 0.06, 2.4), V3(-2.8, 0.12, 0.7)], 0.03, M.metalDark, { seg: 10, radial: 4 });
  // Weather mast: booms with sensors, logger, guy wires, spinning anemometer.
  box(g, 0.9, 0.18, 0.9, M.sintered, -6.8, 0.09, -3.0);
  cyl(g, 0.06, 0.08, 8.0, 8, M.metal, -6.8, 4.18, -3.0);
  for (const y of [2.0, 4.5, 7.2]) {
    box(g, 1.3, 0.05, 0.05, M.metal, -6.15, y, -3.0);
    box(g, 0.22, 0.16, 0.16, M.hull, -5.5, y, -3.0);
    for (let k = 0; k < 4; k++) cyl(g, 0.09, 0.09, 0.03, 10, M.hull, -5.5, y - 0.15 - k * 0.06, -3.0);
  }
  box(g, 0.45, 0.6, 0.3, M.hull, -6.8, 1.1, -2.75);
  box(g, 0.6, 0.4, 0.03, M.solar, -6.8, 3.2, -2.75, { rx: 0.5 });
  for (const [ax, az] of [
    [-6.8, 0.0],
    [-9.2, -4.4],
    [-4.4, -4.4],
  ]) {
    strut(g, V3(-6.8, 5.5, -3.0), V3(ax, 0.2, az), 0.012, M.metalDark, { seg: 3 });
    box(g, 0.3, 0.2, 0.3, M.sintered, ax, 0.1, az);
  }
  const anemo = new THREE.Group();
  anemo.position.set(-6.8, 8.3, -3.0);
  anemo.userData.dynamic = true;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    mesh(anemo, new THREE.BoxGeometry(0.6, 0.03, 0.03), M.metal, Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3, { ry: -a });
    mesh(anemo, new THREE.SphereGeometry(0.09, 8, 6), M.hull, Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
  }
  bakeStatic(anemo);
  g.add(anemo);
  // Core racks: shelves of core liners under a sun cover.
  for (const x of [-2.35, -0.05]) for (const z of [4.5, 5.1]) box(g, 0.06, 1.5, 0.06, M.metal, x, 0.75, z);
  for (const y of [0.35, 0.8, 1.25]) {
    box(g, 2.4, 0.04, 0.65, M.metalDark, -1.2, y, 4.8);
    for (let i = 0; i < 4; i++) cyl(g, 0.05, 0.05, 2.1 - rand() * 0.4, 8, M.metal, -1.2 + (rand() - 0.5) * 0.15, y + 0.07, 4.6 + i * 0.13, { rz: Math.PI / 2 });
  }
  box(g, 2.6, 0.04, 0.9, M.hullDark, -1.2, 1.56, 4.8, { rx: 0.12 });
  // Core drill: tripod derrick, drill string, rotary head, power unit, pipe rack.
  box(g, 3.6, 0.12, 3.6, M.sintered, 5.8, 0.06, 5.2);
  const apex = V3(5.8, 6.2, 5.2);
  for (const a of [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6]) {
    const f = V3(5.8 + Math.cos(a) * 1.6, 0.12, 5.2 + Math.sin(a) * 1.6);
    strut(g, f, apex, 0.07, M.metal, { seg: 6 });
    box(g, 0.4, 0.08, 0.4, M.metalDark, f.x, 0.16, f.z);
  }
  box(g, 0.5, 0.4, 0.5, M.hazard, 5.8, 6.3, 5.2);
  cyl(g, 0.06, 0.06, 5.6, 8, M.metal, 5.8, 3.0, 5.2);
  box(g, 0.55, 0.6, 0.55, M.metalDark, 5.8, 2.4, 5.2);
  cyl(g, 0.16, 0.16, 0.5, 10, M.hazard, 6.15, 2.5, 5.2, { rz: Math.PI / 2 });
  cyl(g, 0.22, 0.26, 0.4, 12, M.metalDark, 5.8, 0.32, 5.2);
  box(g, 1.2, 1.0, 0.9, M.hull, 8.0, 0.62, 3.4, { ry: 0.3 });
  box(g, 1.22, 0.1, 0.92, M.hazard, 8.0, 1.0, 3.4, { ry: 0.3 });
  tube(g, [V3(7.5, 0.9, 3.7), V3(6.8, 0.3, 4.4), V3(6.0, 2.3, 5.0)], 0.035, M.metalDark, { seg: 10, radial: 4 });
  for (const x of [2.2, 3.8]) {
    strut(g, V3(x, 0.12, 6.6), V3(x, 0.75, 7.0), 0.04, M.metal);
    strut(g, V3(x, 0.12, 7.4), V3(x, 0.75, 7.0), 0.04, M.metal);
  }
  for (let i = 0; i < 6; i++) cyl(g, 0.05, 0.05, 2.6, 8, M.metal, 3.0, 0.82 + (i % 2) * 0.09, 6.85 + i * 0.06, { rz: Math.PI / 2 });
  // Survey flags and paver walkway toward the main habitat airlock.
  for (const [x, z] of [
    [-9.0, -5.5],
    [-9.4, 6.0],
    [9.6, -2.2],
    [8.8, 8.0],
    [-3.0, 8.4],
  ]) {
    cyl(g, 0.02, 0.02, 1.5, 4, M.metal, x, 0.75, z);
    box(g, 0.32, 0.18, 0.01, M.hazard, x + 0.16, 1.38, z);
  }
  for (let i = 0; i < 10; i++) {
    const k = i / 9;
    const x = 2.4 + k * 4.6 - Math.sin(k * Math.PI) * 0.6 + (rand() - 0.5) * 0.15;
    const z = -13 + k * 11.6;
    box(g, 1.3, 0.07, 0.9, M.sintered, x, 0.035, z, { ry: Math.atan2(4.6, 11.6) + (rand() - 0.5) * 0.12 });
  }
  bakeStatic(g);
  const hit = hitProxy(g, new THREE.BoxGeometry(18, 9, 14), 3.5);
  return {
    group: g,
    hit,
    radius: 10,
    focus: { distance: 28, height: 3 },
    footprint: { w: 18, d: 14 },
    update(t, env, sim) {
      anemo.rotation.y += 0.05 + (sim?.flows?.tau ?? 0.5) * 0.02;
    },
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
  // Drop any lamp that would stand inside or against an expansion structure.
  const solid = [...Object.values(STRUCTURE_COLLIDERS).flat(), ...LINK_COLLIDERS];
  return pts.filter(([x, z]) => !solid.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.2));
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
    habitatB: buildHabitatB,
    yard: buildYard,
    isru: buildIsru,
    fieldlab: buildFieldLab,
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
  // Bellows tunnel: main habitat wall → Habitat B docking collar.
  {
    const dx = P.habitatB.x - P.habitat.x;
    const dz = P.habitatB.z - P.habitat.z;
    const d = Math.hypot(dx, dz);
    const ux = dx / d;
    const uz = dz / d;
    const a = { x: P.habitat.x + ux * 9.4, z: P.habitat.z + uz * 9.4 };
    const b = { x: P.habitatB.x - ux * 5.5, z: P.habitatB.z - uz * 5.5 };
    tunnels.push(buildBellows(M, a, b, 2.4, 1.15));
  }
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
  // Expansion: Habitat B airlock, yard shelter, propellant-plant cabinet, field-station porch.
  pools.push(
    { x: P.habitatB.x + 6.2, z: P.habitatB.z + 7.4, w: 8, d: 8, y: 0.2 },
    { x: P.yard.x + 3.5, z: P.yard.z - 5.5, w: 12, d: 12, y: 0.2 },
    { x: P.isru.x - 11.2, z: P.isru.z + 8.6, w: 7, d: 7, y: 0.2 },
    { x: P.fieldlab.x + 6.0, z: P.fieldlab.z, w: 8, d: 8, y: 0.12 }
  );
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
