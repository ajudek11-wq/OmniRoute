import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { createNoise2D, mulberry32 } from "../../../scene/noise.js";
import { gridHeight, detail, hash, pitDepth } from "./heights.js";
import { moonify } from "./shade.js";
import { SITE } from "./layout.js";

/** Angular, faceted boulder geometry with planar UVs per face (no seams on a face). */
export function rockGeometry(seed, detailLevel = 1, { flat = 0.75, rough = 0.28 } = {}) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detailLevel).deleteAttribute("uv").deleteAttribute("normal"));
  const n = createNoise2D(seed);
  const rand = mulberry32(seed);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  // A few random cutting planes give the fractured, blocky look of ejecta blocks.
  const planes = Array.from({ length: 5 }, () => ({ n: new THREE.Vector3(rand() - 0.5, rand() - 0.4, rand() - 0.5).normalize(), d: 0.62 + rand() * 0.3 }));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + n(v.x * 1.7 + v.y * 0.6, v.z * 1.7 - v.y * 0.4) * rough + n(v.x * 4.3, v.z * 4.3 + v.y) * rough * 0.35;
    v.multiplyScalar(k);
    for (const pl of planes) {
      const dd = v.dot(pl.n);
      if (dd > pl.d) v.addScaledVector(pl.n, pl.d - dd);
    }
    v.y *= v.y < 0 ? 0.55 : flat;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const ng = g.toNonIndexed();
  const pos = ng.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const fn = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    fn.subVectors(c, b).cross(b.clone().sub(a)).normalize();
    const ax = Math.abs(fn.x);
    const ay = Math.abs(fn.y);
    const az = Math.abs(fn.z);
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, i + k);
      const [s, t] = ay >= ax && ay >= az ? [v.x, v.z] : ax >= az ? [v.z, v.y] : [v.x, v.y];
      uv[(i + k) * 2] = s * 0.45 + seed * 0.13;
      uv[(i + k) * 2 + 1] = t * 0.45;
    }
  }
  ng.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return ng;
}

export function rockMaterial(T, { color = 0xc9c5bd } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: T.rock, normalMap: T.rockN, normalScale: new THREE.Vector2(1.2, 1.2), color, roughness: 0.96, metalness: 0 });
  return moonify(m, { ls: true, key: "rock" });
}

const groundY = (x, z) => gridHeight(x, z) + detail(x, z);

/** The boulder catalogue: ejecta fields, crater rims, pit breakdown and scattered blocks. */
function boulderCatalogue() {
  const rand = mulberry32(4242);
  const list = [];
  const keepOut = (x, z, s = 1) =>
    Math.hypot(x - SITE.base.x, z - SITE.base.z) < (s < 0.4 ? 24 : SITE.base.r + 10) ||
    Math.hypot(x - SITE.pad.x, z - SITE.pad.z) < SITE.pad.r + 8 ||
    (Math.abs(z - SITE.pit.z) < 10 && x > SITE.pit.x - 85 && x < SITE.tube.x1);
  const add = (x, z, s) => {
    if (keepOut(x, z, s) || Math.hypot(x, z) > 2400) return;
    list.push({ x, z, s, rot: rand() * Math.PI * 2, tilt: (rand() - 0.5) * 0.5 });
  };
  const F = SITE.fresh;
  for (let i = 0; i < 520; i++) {
    const r = F.R * (0.75 + Math.pow(rand(), 1.8) * 3.2);
    const a = rand() * Math.PI * 2;
    add(F.x + Math.cos(a) * r, F.z + Math.sin(a) * r, 0.25 + Math.pow(rand(), 3.2) * (r < F.R * 1.5 ? 3.4 : 1.6));
  }
  const C = SITE.psr;
  for (let i = 0; i < 260; i++) {
    const r = C.R * (0.55 + rand() * 0.75);
    const a = rand() * Math.PI * 2;
    add(C.x + Math.cos(a) * r, C.z + Math.sin(a) * r, 0.3 + Math.pow(rand(), 3) * 3.5);
  }
  const P = SITE.pit;
  for (let i = 0; i < 220; i++) {
    const a = rand() * Math.PI * 2;
    const e = rand() < 0.55 ? 1.05 + rand() * 0.6 : rand() * 0.7;
    add(P.x + Math.cos(a) * P.a * e, P.z + Math.sin(a) * P.b * e, 0.3 + Math.pow(rand(), 2.6) * (e < 0.8 ? 3.2 : 2.0));
  }
  for (let i = 0; i < 3600; i++) {
    const x = (rand() * 2 - 1) * 1700;
    const z = (rand() * 2 - 1) * 1700;
    // Clumped: denser where a slow noise is high.
    if (hash(Math.floor(x / 60), Math.floor(z / 60), 9) < 0.45) continue;
    add(x, z, 0.12 + Math.pow(rand(), 4) * 2.2);
  }
  // Small stones close around the base (in the trampled zone, kept off the paths).
  for (let i = 0; i < 260; i++) {
    const a = rand() * Math.PI * 2;
    const r = 26 + rand() * 40;
    add(Math.cos(a) * r, Math.sin(a) * r, 0.08 + Math.pow(rand(), 3) * 0.3);
  }
  // A few landmark blocks.
  for (const [x, z, s] of [
    [-40, -96, 3.6],
    [70, 64, 2.6],
    [-150, 40, 4.4],
    [230, -260, 5.2],
    [-380, -380, 6.5],
    [420, 210, 3.8],
  ])
    add(x, z, s);
  for (const b of list) b.y = groundY(b.x, b.z) - b.s * 0.22 - pitDepth(b.x, b.z) * 0;
  return list;
}

/** Instanced boulders around the player (small ones near, big ones far). */
export function createBoulders(ctx, T) {
  const tier = ctx.tier;
  const cat = boulderCatalogue();
  const mat = rockMaterial(T);
  const smallGeos = [rockGeometry(3, 1), rockGeometry(7, 1, { flat: 0.6 }), rockGeometry(13, 1, { rough: 0.38 })];
  const bigGeos = [rockGeometry(21, 2), rockGeometry(29, 2, { flat: 0.62, rough: 0.33 })];
  const group = new THREE.Group();
  group.name = "boulders";
  const cap = { low: 500, balanced: 900, high: 1400 }[tier] ?? 900;
  const mk = (geo, n) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.count = 0;
    m.castShadow = tier !== "low";
    m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
    return m;
  };
  const small = smallGeos.map((g) => mk(g, Math.ceil(cap / 3)));
  const big = bigGeos.map((g) => mk(g, 260));
  const nearR = { low: 150, balanced: 220, high: 280 }[tier] ?? 220;
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const E = new THREE.Euler();
  const S = new THREE.Vector3();
  const P = new THREE.Vector3();
  let last = { x: 1e9, z: 1e9 };
  function refresh(px, pz) {
    last = { x: px, z: pz };
    for (const m of [...small, ...big]) m.count = 0;
    let i = 0;
    for (const b of cat) {
      const d = Math.hypot(b.x - px, b.z - pz);
      const isBig = b.s > 1.1;
      if (isBig ? d > 1800 : d > nearR) continue;
      const arr = isBig ? big : small;
      const m = arr[i++ % arr.length];
      if (m.count >= m.instanceMatrix.count) continue;
      E.set(b.tilt, b.rot, b.tilt * 0.6);
      Q.setFromEuler(E);
      S.set(b.s, b.s * 0.9, b.s * (0.8 + (b.rot % 0.4)));
      P.set(b.x, b.y, b.z);
      M.compose(P, Q, S);
      m.setMatrixAt(m.count++, M);
    }
    for (const m of [...small, ...big]) m.instanceMatrix.needsUpdate = true;
  }
  const colliders = cat.filter((b) => b.s > 0.9).map((b) => ({ x: b.x, z: b.z, r: b.s * 0.62 }));
  return {
    group,
    catalogue: cat,
    colliders,
    material: mat,
    update(px, pz) {
      if (Math.hypot(px - last.x, pz - last.z) > 40) {
        refresh(px, pz);
        return true;
      }
      return false;
    },
  };
}

/** Bootprint texture: a ribbed tread pressed into fine regolith. */
export function bootprintTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 160;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 64, 160);
  const path = new Path2D();
  path.ellipse(32, 44, 24, 38, 0, 0, Math.PI * 2);
  path.ellipse(32, 122, 19, 30, 0, 0, Math.PI * 2);
  g.save();
  g.clip(path);
  g.fillStyle = "rgba(60,58,55,0.75)";
  g.fillRect(0, 0, 64, 160);
  g.fillStyle = "rgba(180,176,168,0.55)";
  for (let y = 8; y < 160; y += 9) g.fillRect(4, y, 56, 3.2);
  g.restore();
  g.strokeStyle = "rgba(205,200,190,0.5)";
  g.lineWidth = 2.5;
  g.stroke(path);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ground decals (bootprints / tyre tracks) as one instanced quad. */
export function createPrints(texture, capacity, { w = 0.13, l = 0.32, opacity = 1 } = {}) {
  const geo = new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2);
  const mat = moonify(
    new THREE.MeshStandardMaterial({ map: texture, transparent: true, opacity, depthWrite: false, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    { ls: true, key: "print" }
  );
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  let next = 0;
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3();
  const qy = new THREE.Quaternion();
  return {
    mesh,
    add(x, y, z, yaw, normal = up, scale = 1) {
      n.copy(normal);
      Q.setFromUnitVectors(up, n);
      qy.setFromAxisAngle(up, yaw);
      Q.multiply(qy);
      M.compose(new THREE.Vector3(x, y, z), Q, new THREE.Vector3(scale, 1, scale));
      mesh.setMatrixAt(next, M);
      next = (next + 1) % capacity;
      mesh.count = Math.min(capacity, Math.max(mesh.count, next === 0 ? capacity : next));
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Frost glints on the floor of the permanently shadowed crater: they sparkle in the suit light. */
export function createFrost(ctx, surfaceAt, count) {
  const C = SITE.psr;
  const rand = mulberry32(777);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rand()) * C.R * 0.5;
    const a = rand() * Math.PI * 2;
    const x = C.x + Math.cos(a) * r;
    const z = C.z + Math.sin(a) * r;
    pos.set([x, groundY(x, z) + 0.03, z], i * 3);
    seed[i] = rand();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
  const uniforms = { uLamp: { value: 0 }, uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, 0, -1) }, uPx: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float seed; uniform vec3 uCam; uniform vec3 uDir; uniform float uLamp; uniform float uTime; uniform float uPx;
      varying float vB;
      void main(){
        vec3 d = position - uCam; float dist = length(d);
        float cone = smoothstep(0.82, 0.95, dot(d / dist, uDir));
        float tw = pow(max(0.0, sin(seed * 91.0 + uTime * (2.0 + seed * 5.0) + dist * 1.7)), 24.0);
        vB = uLamp * cone * (0.2 + 2.6 * tw) * clamp(30.0 / (dist * dist), 0.0, 1.5);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (1.5 + 3.0 * tw) * clamp(8.0 / dist, 0.4, 2.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vB;
      void main(){ vec2 q = gl_PointCoord - 0.5; float a = exp(-dot(q,q) * 30.0) + max(0.0, 1.0 - abs(q.x) * 14.0) * max(0.0, 1.0 - abs(q.y) * 2.0) * 0.4 + max(0.0, 1.0 - abs(q.y) * 14.0) * max(0.0, 1.0 - abs(q.x) * 2.0) * 0.4;
        gl_FragColor = vec4(vec3(0.85, 0.93, 1.0) * vB * a, 1.0); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return { points: pts, uniforms };
}
