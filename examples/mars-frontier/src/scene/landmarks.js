import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { createNoise2D, mulberry32 } from "./noise.js";
import { heightAt } from "./terrain.js";
import { rockMaterial } from "./surfaces.js";
import { glowTexture } from "./world.js";
import { LANDMARKS } from "../data/layout.js";
import { SAMPLES } from "../game/discoveries.js";

/** Landmark rock takes the Mars tone the terrain gets from its vertex colours. */
function landmarkRock(sets) {
  const m = rockMaterial(sets, { landmark: true });
  m.color.set("#b27752");
  return m;
}

/** Fallen blocks use the boulder variant of the rock shader (instanced, no vertex colours). */
function talusRock(sets) {
  const m = rockMaterial(sets);
  m.color.set("#a8714d");
  return m;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Sedimentary bedding, mirrored from rkBands() in surfaces.js (same warp, period and bed thickness
 * modulation) so the shader's dark bedding planes sit exactly in the geometric notches.
 * Returns the radial relief in metres: resistant beds jut out, the soft rock under them is recessed.
 */
const BED_PERIOD = 2.6;
function bedRelief(x, y, z) {
  const yw = y + 1.4 * Math.sin(x * 0.13 + z * 0.09) + 0.8 * Math.sin(-x * 0.07 + z * 0.19);
  const u = yw / BED_PERIOD + 0.25 * Math.sin((yw * 1.9) / BED_PERIOD);
  const L = Math.floor(u);
  const f = u - L;
  const hard = 0.5 + 0.5 * Math.sin(L * 2.399 + 1.3);
  const e = smooth(0, 0.1, f) * (1 - smooth(0.5, 0.86, f));
  return (e - 0.45) * (0.3 + 0.7 * hard);
}

/** Vertex colours as baked cavity occlusion: recessed rock and the ground contact are darker. */
function bakeCavity(g, base, gain, groundY = 0) {
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = Math.min(1, Math.max(0.5, 0.9 + base[i] * gain)) * (0.72 + 0.28 * smooth(groundY - 1, groundY + 3.5, p.getY(i)));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

/**
 * Lathe-turned column, weathered: two octaves of angular/vertical noise, bedding ledges, optional
 * wind-carved flutes, a gently sinuous axis and a closed (optionally broken) crown.
 */
function weatheredColumn(profile, segs, seed, amp, { flutes = 0, fluteDepth = 0, lean = 0, crown = 0, ledge = 0.42 } = {}) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.05, r), y));
  let g = new THREE.LatheGeometry(pts, segs, 0, Math.PI * 2);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g, 1e-4); // weld the lathe seam so normals stay smooth across it
  const top = pts[pts.length - 1].y;
  const n1 = createNoise2D(seed);
  const n2 = createNoise2D(seed + 7);
  const n3 = createNoise2D(seed + 13);
  const p = g.attributes.position;
  const relief = new Float32Array(p.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const rad = Math.hypot(v.x, v.z);
    let dr = 0;
    if (rad > 0.06) {
      const ang = Math.atan2(v.z, v.x);
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const k = amp * (n1(ca * 1.6 + v.y * 0.05, sa * 1.6) * 0.6 + n2(ang * 4, v.y * 0.4) * 0.28 + n3(ca * 5 + v.y * 0.21, sa * 5) * 0.12);
      // Ledges erode unevenly around the column: some beds jut out on one side only.
      const ledgeK = 0.3 + 0.7 * smooth(-0.45, 0.45, n3(ca * 1.2 + v.y * 0.13, sa * 1.2 - v.y * 0.09));
      dr = rad * k + bedRelief(v.x, v.y, v.z) * ledge * ledgeK * Math.min(1, rad / 3);
      if (flutes) {
        const gph = Math.abs(Math.sin(ang * flutes * 0.5 + n1(v.y * 0.03, ca + sa) * 0.9));
        dr -= fluteDepth * (1 - smooth(0, 0.42, gph)) * smooth(3, 14, v.y) * Math.min(1, rad / 2.5);
      }
      const nr = Math.max(0.1, rad + dr);
      v.x *= nr / rad;
      v.z *= nr / rad;
    }
    if (crown && v.y > top - 3.5) {
      // Broken crown: the last few metres are shattered to a jagged, uneven top.
      const a = Math.atan2(v.z, v.x);
      v.y += (n2(Math.cos(a) * 1.3, Math.sin(a) * 1.3) * 0.75 + n3(Math.cos(a) * 3.1, Math.sin(a) * 3.1) * 0.25) * crown * smooth(top - 3.5, top, v.y);
    }
    if (lean) {
      const h = Math.max(0, v.y) / top;
      v.x += lean * Math.sin(v.y * 0.06 + 0.4) * h;
      v.z += lean * 0.75 * Math.sin(v.y * 0.045 + 1.7) * h;
    }
    relief[i] = dr;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  bakeCavity(g, relief, 0.75);
  return g;
}

/** Close a lathe profile with a low dome so the top is never an open ring. */
function capProfile(profile, h) {
  const [r, y] = profile[profile.length - 1];
  profile.push([r * 0.72, y + h * 0.55], [r * 0.3, y + h * 0.9], [0.05, y + h]);
  return profile;
}

/** A free-standing eroded spire: bedding ledges, flutes, a broken top, a talus base. */
export function buildSpire(sets) {
  const H = 46;
  const ROWS = 132; // ~0.36 m rows so bedding ledges are real geometry
  const profile = [];
  for (let i = 0; i <= ROWS; i++) {
    const t = i / ROWS;
    const y = -1.5 + t * (H + 1.5);
    const r = 8.6 * Math.pow(1 - t, 0.85) + 1.1 + 0.55 * Math.sin(t * 13) * (1 - t) + (t > 0.94 ? -0.6 : 0);
    profile.push([r, y]);
  }
  capProfile(profile, 1.2);
  const g = weatheredColumn(profile, 56, 11, 0.1, { flutes: 9, fluteDepth: 0.45, lean: 1.1, crown: 2.2 });
  const mesh = new THREE.Mesh(g, landmarkRock(sets));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const grp = new THREE.Group();
  grp.add(mesh);
  // Talus: a ring of fallen blocks around the foot.
  const rand = mulberry32(31);
  const talus = new THREE.InstancedMesh(talusGeometry(), talusRock(sets), 26);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const d = 9.5 + rand() * 6;
    const s = 0.8 + rand() * 2.6;
    e.set(rand(), rand() * 3, rand());
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(Math.cos(a) * d, -0.2 + s * 0.2, Math.sin(a) * d), q, new THREE.Vector3(s, s * 0.6, s));
    talus.setMatrixAt(i, m4);
  }
  talus.castShadow = true;
  talus.receiveShadow = true;
  grp.add(talus);
  return { group: grp, colliders: [{ r: 9 }] };
}

/** Angular fallen block: a noise-displaced icosahedron (80 triangles), flat-ish faces kept. */
function talusGeometry() {
  let g = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  const n = createNoise2D(57);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(1 + n(v.x * 1.2 + v.z, v.y * 1.2) * 0.22);
    // Planar fractures: clamp to a few cut planes so blocks read as broken bedrock, not pebbles.
    v.y = Math.min(v.y, 0.62);
    v.x = Math.max(v.x, -0.8);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g = g.toNonIndexed(); // faceted shading suits fractured rock
  g.computeVertexNormals();
  return g;
}

/** A natural arch: two weathered, ledged piers and a spanning bridge of the same layered rock. */
export function buildArch(sets) {
  const H = 34;
  const ROWS = 96;
  const pierProfile = [];
  for (let i = 0; i <= ROWS; i++) {
    const t = i / ROWS;
    pierProfile.push([7.2 - 1.8 * t + 0.4 * Math.sin(t * 9), -2 + t * (H + 2)]);
  }
  capProfile(pierProfile, 1.6);
  const grp = new THREE.Group();
  const mat = landmarkRock(sets);
  const span = 21;
  for (const s of [-1, 1]) {
    const pier = new THREE.Mesh(weatheredColumn(pierProfile, 40, s > 0 ? 5 : 9, 0.09, { flutes: 7, fluteDepth: 0.3, lean: 0.5 * s }), mat);
    pier.position.x = s * span;
    pier.castShadow = true;
    pier.receiveShadow = true;
    grp.add(pier);
  }
  // Bridge: a rough arc of rock spanning the piers, displaced along its normals.
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push(new THREE.Vector3(-span + t * 2 * span, H - 4 + Math.sin(t * Math.PI) * 17, Math.sin(t * Math.PI * 3) * 0.6));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  let bridgeGeo = new THREE.TubeGeometry(curve, 140, 4.2, 16, false);
  const nrm = bridgeGeo.attributes.normal.clone();
  bridgeGeo.deleteAttribute("uv");
  const n = createNoise2D(41);
  const nB = createNoise2D(43);
  const p = bridgeGeo.attributes.position;
  const relief = new Float32Array(p.count);
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    nv.fromBufferAttribute(nrm, i);
    // Two octaves of lumpiness, flatter deck on top, bedding ledges where the arch is near vertical.
    let dr = 4.2 * (0.13 * n(v.x * 0.2, v.y * 0.2 + v.z) + 0.05 * nB(v.x * 0.7 + v.z, v.y * 0.7));
    dr -= Math.max(0, nv.y - 0.55) * 1.6;
    dr += bedRelief(v.x, v.y, v.z) * 0.35 * (1 - Math.abs(nv.y));
    v.addScaledVector(nv, dr);
    relief[i] = dr - 4.2 * 0.05;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  bridgeGeo.deleteAttribute("normal");
  // Weld the tube's radial seam (the relief array is per original vertex, so weld after colouring).
  bakeCavity(bridgeGeo, relief, 0.5, -100);
  bridgeGeo = mergeVertices(bridgeGeo, 1e-3);
  bridgeGeo.computeVertexNormals();
  const bridge = new THREE.Mesh(bridgeGeo, mat);
  bridge.castShadow = true;
  bridge.receiveShadow = true;
  grp.add(bridge);
  return { group: grp, colliders: [{ x: -span, r: 7 }, { x: span, r: 7 }] };
}

/** Place a landmark on the terrain; returns its collider circles in world space. */
export function placeLandmarks(sets, scene) {
  const out = [];
  for (const L of LANDMARKS) {
    const built = L.kind === "spire" ? buildSpire(sets) : buildArch(sets);
    built.group.position.set(L.x, heightAt(L.x, L.z), L.z);
    if (L.kind === "arch") built.group.rotation.y = 0.5;
    scene.add(built.group);
    for (const c of built.colliders) {
      const dx = c.x ?? 0;
      const rot = L.kind === "arch" ? 0.5 : 0;
      const wx = L.x + Math.cos(rot) * dx;
      const wz = L.z - Math.sin(rot) * dx;
      out.push({ x: wx, z: wz, r: c.r });
    }
  }
  return out;
}

/** Collectible sample markers: amber crystal, ground ring and a soft beacon, visible in walk mode. */
export function buildSamples() {
  const grp = new THREE.Group();
  const crystalMat = new THREE.MeshStandardMaterial({ color: "#e0a050", roughness: 0.25, metalness: 0.1, emissive: new THREE.Color("#ff9a3c"), emissiveIntensity: 0.9 });
  const ringMat = new THREE.MeshBasicMaterial({ color: "#ffb35c", transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const beaconMat = new THREE.SpriteMaterial({ map: glowTexture(), color: "#ffb35c", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const items = SAMPLES.map((s) => {
    const g = new THREE.Group();
    g.position.set(s.x, heightAt(s.x, s.z), s.z);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), crystalMat);
    crystal.scale.set(1, 1.5, 1);
    crystal.position.y = 0.9;
    crystal.castShadow = true;
    g.add(crystal);
    const ringGeo = new THREE.RingGeometry(1.4, 1.75, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.12;
    g.add(ring);
    const beacon = new THREE.Sprite(beaconMat);
    beacon.scale.setScalar(4.2);
    beacon.position.y = 2.2;
    g.add(beacon);
    grp.add(g);
    return { id: s.id, g, crystal, ring, beacon, pop: 0, done: false };
  });
  return {
    group: grp,
    items,
    update(t, found) {
      for (const it of items) {
        const done = found.has(it.id);
        if (done && !it.done) {
          it.done = true;
          it.pop = 1;
        }
        if (it.pop > 0) it.pop = Math.max(0, it.pop - 0.02);
        it.crystal.position.y = 0.9 + Math.sin(t * 1.3 + it.g.position.x) * 0.12;
        it.crystal.rotation.y = t * 0.7;
        const s = done ? Math.max(0.05, 0.4 - it.pop * 0.4) : 1;
        it.crystal.scale.set(s, s * 1.5, s);
        it.ring.visible = !done;
        it.beacon.visible = !done;
        it.beacon.material.opacity = 0.5 + Math.sin(t * 2.4 + it.g.position.z) * 0.25;
        const ringS = 1 + Math.sin(t * 2.6) * 0.06;
        it.ring.scale.set(ringS, 1, ringS);
      }
    },
  };
}
