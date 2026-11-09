import * as THREE from "three";
import { createNoise2D } from "../../../scene/noise.js";
import { textLabel } from "../../../xr/panel.js";
import { Batch, hw } from "./kit.js";
import { rockGeometry, rockMaterial } from "./props.js";
import { SITE } from "./layout.js";

/**
 * Skylight pit and lava tube. The pit (carved into the terrain height model) has a talus ramp on its
 * west side; at its east end a cave mouth opens into a lava tube running ~140 m under the surface,
 * ending in a breakdown pile where a (fictional) research cache is hidden. The tube interior is
 * pitch dark: the helmet lamp switches on automatically.
 */
export async function createTube(api) {
  const { scene, T, terrain, surfaceAt, overrides, discover, SCI, ctx, feet } = api;
  const TU = SITE.tube;
  const P = SITE.pit;
  const n = createNoise2D(919);
  const F = surfaceAt(TU.x0 - 4, TU.z); // pit floor at the mouth
  terrain.setTubeFloor(F);
  const group = new THREE.Group();
  group.name = "lava-tube";
  scene.add(group);
  const xs = TU.x0 + 2; // shell start (inside the cut-away pit wall)
  const xe = TU.x1;
  const halfW = (x) => TU.halfW * (1 + 0.12 * n(x / 23, 0.5)) * (x > xe - 18 ? 1 - ((x - (xe - 18)) / 18) * 0.35 : 1);
  const height = (x) => TU.height * (1 + 0.1 * n(x / 31, 2.5)) * (x > xe - 18 ? 1 - ((x - (xe - 18)) / 18) * 0.5 : 1);
  const floorAt = (x, z) => F + 0.25 * n(x / 6, z / 6) + 0.06 * n(x / 1.7, z / 1.7) + Math.max(0, (Math.abs(z - TU.z) - halfW(x) * 0.7)) * 0.35;

  // ── Vault shell (normals point inward) ──
  const segX = Math.ceil((xe - xs) / 1.5);
  const segA = 28;
  const pos = [];
  const uv = [];
  for (let j = 0; j <= segX; j++) {
    const x = xs + ((xe - xs) * j) / segX;
    const hw0 = halfW(x);
    const h0 = height(x);
    for (let i = 0; i <= segA; i++) {
      const ph = (i / segA) * Math.PI; // 0 = south foot, π = north foot
      const r = 1 + 0.07 * n(x / 3.3, ph * 2.1) + 0.035 * n(x / 1.1, ph * 6.3);
      const z = TU.z + Math.cos(ph) * hw0 * r;
      const y = F - 0.6 + Math.sin(ph) * (h0 + 0.6) * r;
      pos.push(x, y, z);
      uv.push(x / 4, (ph * (hw0 + h0)) / 4);
    }
  }
  const idx = [];
  for (let j = 0; j < segX; j++) {
    for (let i = 0; i < segA; i++) {
      const a = j * (segA + 1) + i;
      const b = a + 1;
      const c = a + segA + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const vault = new THREE.BufferGeometry();
  vault.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  vault.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  vault.setIndex(idx);
  vault.computeVertexNormals();
  // Make sure normals face the tube axis (inward).
  {
    const p = vault.attributes.position;
    const nn = vault.attributes.normal;
    let dot = 0;
    for (let i = 0; i < p.count; i += 7) dot += (TU.z - p.getZ(i)) * nn.getZ(i) + (F + 5 - p.getY(i)) * nn.getY(i);
    if (dot < 0) {
      const ix = vault.index.array;
      for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
      vault.computeVertexNormals();
    }
  }
  const wallMat = rockMaterial(T, { color: 0x9a958d });
  const shell = new THREE.Mesh(vault, wallMat);
  shell.receiveShadow = true;
  group.add(shell);

  // End wall: a breakdown pile closing the explored section.
  const B = new Batch();
  const capR = new THREE.CircleGeometry(1, 24, 0, Math.PI);
  B.add(wallMat, capR, { p: [xe - 0.2, F - 0.6, TU.z], r: [0, -Math.PI / 2, 0], s: [halfW(xe) + 0.5, height(xe) + 1.2, 1] });

  // Floor ribbon (regolith, same material as the terrain so the pit floor flows inside).
  const fl = new THREE.PlaneGeometry(xe - xs + 1, TU.halfW * 2 + 3, Math.ceil((xe - xs + 1) / 1.2), 16).rotateX(-Math.PI / 2);
  {
    const p = fl.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + (xs - 1 + xe) / 2;
      const z = p.getZ(i) + TU.z;
      p.setXYZ(i, x, floorAt(x, z), z);
    }
    fl.computeVertexNormals();
  }
  const floor = new THREE.Mesh(fl, terrain.mats[0]);
  floor.receiveShadow = true;
  group.add(floor);

  // Mouth facade: rock face around the arch, covering the cut in the pit wall.
  {
    const s = new THREE.Shape();
    s.moveTo(-TU.halfW - 6, -2);
    s.lineTo(TU.halfW + 6, -2);
    s.lineTo(TU.halfW + 6, TU.height + 8);
    s.lineTo(-TU.halfW - 6, TU.height + 8);
    s.lineTo(-TU.halfW - 6, -2);
    const hole = new THREE.Path();
    const hw0 = halfW(xs) * 0.97;
    const h0 = height(xs) * 0.97;
    hole.moveTo(hw0, -0.5);
    for (let i = 0; i <= 24; i++) {
      const ph = (i / 24) * Math.PI;
      hole.lineTo(Math.cos(ph) * hw0, -0.6 + Math.sin(ph) * (h0 + 0.6));
    }
    hole.lineTo(hw0, -0.5);
    s.holes.push(hole);
    const geo = new THREE.ShapeGeometry(s, 24);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, 0.8 * n(p.getX(i) / 2.2, p.getY(i) / 2.2));
    geo.computeVertexNormals();
    const uvs = geo.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, p.getX(i) / 4, p.getY(i) / 4);
    // Shape is in XY facing +Z; turn it to face −X (toward the pit), with shape x → world −z.
    B.add(wallMat, geo, { p: [xs + 0.4, F, TU.z], r: [0, -Math.PI / 2, 0] });
  }

  // Breakdown blocks on the floor and a rubble pile at the end.
  const rgeo = [rockGeometry(101, 1), rockGeometry(103, 1, { flat: 0.55 }), rockGeometry(107, 2)];
  const rocks = [
    [670, 384, 1.2],
    [688, 374, 0.8],
    [700, 386, 1.6],
    [722, 377, 0.7],
    [741, 383, 1.1],
    [756, 375, 0.9],
    [784, 380, 3.2],
    [788, 375, 2.4],
    [787, 386, 2.6],
    [780, 384, 1.4],
    [778, 374, 1.2],
    [662, 373, 1.0],
  ];
  rocks.forEach(([x, z, s], i) => B.add(wallMat, rgeo[i % 3], { p: [x, floorAt(x, z) - s * 0.2, z], r: [i, i * 2.1, 0], s: [s, s * 0.8, s * 1.1] }));

  // ── The hidden research cache (fiction) ──
  const M = {
    case: hw({ kind: "panel", color: 0xd8d3c8, roughness: 0.5 }),
    orange: hw({ kind: "panel", color: 0xe0661b, roughness: 0.5 }),
    dark: hw({ kind: "brushed", color: 0x34373b, roughness: 0.5, metalness: 0.7 }),
  };
  const cx = 772;
  const cz = 383.5;
  const cy = floorAt(cx, cz);
  B.add(M.case, new THREE.BoxGeometry(1.4, 0.7, 0.9), { p: [cx, cy + 0.35, cz], r: [0, 0.3, 0] });
  B.add(M.orange, new THREE.BoxGeometry(1.44, 0.12, 0.94), { p: [cx, cy + 0.62, cz], r: [0, 0.3, 0] });
  B.add(M.dark, new THREE.BoxGeometry(0.5, 0.45, 0.5), { p: [cx - 1.2, cy + 0.22, cz - 0.6], r: [0, -0.4, 0] });
  B.add(M.dark, new THREE.CylinderGeometry(0.02, 0.02, 1.6, 5), { p: [cx + 0.9, cy + 0.8, cz - 0.4] });
  B.build(group);
  const blink = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0x5cff9a, toneMapped: false }));
  blink.position.set(cx + 0.9, cy + 1.62, cz - 0.4);
  group.add(blink);
  const cachePick = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.8), new THREE.MeshBasicMaterial({ visible: false }));
  cachePick.position.set(cx - 0.3, cy + 0.7, cz - 0.2);
  group.add(cachePick);

  const label = textLabel("Lava tube", { size: 0.5, sub: "the pit is real science · the tube beyond is a hypothesis" });
  label.position.set(TU.x0 - 12, F + 9, TU.z);
  label.rotation.y = -Math.PI / 2;
  group.add(label);

  // ── Ground / colliders ──
  const inTube = (x, z) => x > xs - 0.5 && x < xe && Math.abs(z - TU.z) < halfW(x) + 0.5;
  overrides.push((x, z, fy) => {
    if (!inTube(x, z)) return undefined;
    if (fy > F + 9) return undefined; // walking on the surface above the tube
    return floorAt(x, z);
  });
  const walls = [];
  for (let x = xs; x <= xe; x += 0.8) {
    const w = halfW(x) * 0.88;
    walls.push({ x, z: TU.z - w - 0.3, r: 0.6 }, { x, z: TU.z + w + 0.3, r: 0.6 });
  }
  for (let z = TU.z - TU.halfW; z <= TU.z + TU.halfW; z += 0.8) walls.push({ x: xe - 6, z, r: 0.9 });
  walls.push({ x: cx, z: cz, r: 0.85 });
  for (const [x, z, s] of rocks) if (s > 0.9) walls.push({ x, z, r: s * 0.6 });
  const insideFn = (p) => inTube(p.x, p.z) && p.y < F + 13;

  let blinkT = 0;
  let wasNear = false;
  return {
    group,
    floorY: F,
    interactables: [{ object: cachePick, label: "Research cache", onSelect: () => discover(SCI.cache) }],
    colliders: (fy) => (fy < F + 6 ? walls : []),
    inside: insideFn,
    update(dt, t, head) {
      blinkT += dt;
      blink.visible = blinkT % 1.6 < 0.12;
      label.visible = Math.hypot(head.x - TU.x0, head.z - TU.z) < 140;
      const dP = Math.hypot((head.x - P.x) / P.a, (head.z - P.z) / P.b);
      const near = dP < 1.6;
      if (near && !wasNear) discover(SCI.pit);
      wasNear = near;
      if (insideFn(head) && head.x > xs + 6) discover(SCI.tube);
      if (feet && Math.hypot(head.x - cx, head.z - cz) < 3) discover(SCI.cache);
      return false;
    },
    dispose() {},
  };
}
