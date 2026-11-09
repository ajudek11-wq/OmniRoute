import * as THREE from "three";
import { createNoise2D, mulberry32 } from "./noise.js";
import { heightAt } from "./terrain.js";
import { rockMaterial } from "./surfaces.js";
import { glowTexture } from "./world.js";
import { LANDMARKS } from "../data/layout.js";
import { SAMPLES } from "../game/discoveries.js";

/** Landmark rock takes the Mars tone the terrain gets from its vertex colours. */
function landmarkRock(sets) {
  const m = rockMaterial(sets);
  m.color.set("#a8714d");
  return m;
}

/** Lathe-turned column with angular and vertical noise so no two sides match. */
function weatheredColumn(profile, segs, seed, amp) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.05, r), y));
  const g = new THREE.LatheGeometry(pts, segs, 0, Math.PI * 2);
  const n1 = createNoise2D(seed);
  const n2 = createNoise2D(seed + 7);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const rad = Math.hypot(v.x, v.z);
    if (rad > 0.05) {
      const ang = Math.atan2(v.z, v.x);
      const k = 1 + amp * (n1(Math.cos(ang) * 1.6 + v.y * 0.05, Math.sin(ang) * 1.6) * 0.65 + n2(ang * 4, v.y * 0.4) * 0.35);
      v.x *= k;
      v.z *= k;
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A free-standing eroded spire: flutes, a broken top, a talus base. */
export function buildSpire(sets) {
  const H = 46;
  const profile = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const y = -1.5 + t * (H + 1.5);
    const r = 8.6 * Math.pow(1 - t, 0.85) + 1.1 + 0.55 * Math.sin(t * 13) * (1 - t) + (t > 0.94 ? -0.6 : 0);
    profile.push([r, y]);
  }
  const g = weatheredColumn(profile, 40, 11, 0.09);
  const mesh = new THREE.Mesh(g, landmarkRock(sets));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const grp = new THREE.Group();
  grp.add(mesh);
  // Talus: a ring of fallen blocks around the foot.
  const rand = mulberry32(31);
  const blockGeo = new THREE.DodecahedronGeometry(1, 0);
  const talus = new THREE.InstancedMesh(blockGeo, landmarkRock(sets), 26);
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

/** A natural arch: two weathered piers and a spanning bridge of rock. */
export function buildArch(sets) {
  const H = 34;
  const pierProfile = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    pierProfile.push([7.2 - 1.8 * t + 0.4 * Math.sin(t * 9), -2 + t * (H + 2)]);
  }
  const grp = new THREE.Group();
  const mat = landmarkRock(sets);
  const span = 21;
  for (const s of [-1, 1]) {
    const pier = new THREE.Mesh(weatheredColumn(pierProfile, 32, s > 0 ? 5 : 9, 0.08), mat);
    pier.position.x = s * span;
    pier.castShadow = true;
    pier.receiveShadow = true;
    grp.add(pier);
  }
  // Bridge: a rough arc of rock spanning the piers.
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push(new THREE.Vector3(-span + t * 2 * span, H - 4 + Math.sin(t * Math.PI) * 17, Math.sin(t * Math.PI * 3) * 0.6));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const bridgeGeo = new THREE.TubeGeometry(curve, 80, 4.2, 10, false);
  const n = createNoise2D(41);
  const p = bridgeGeo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.12 * n(v.x * 0.2, v.y * 0.2 + v.z);
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
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
