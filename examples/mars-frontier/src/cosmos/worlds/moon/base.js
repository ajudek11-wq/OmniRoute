import * as THREE from "three";
import { Panel, grid } from "../../../xr/panel.js";
import { Batch, hw, plain } from "./kit.js";
import { moonify } from "./shade.js";
import { SITE } from "./layout.js";

/**
 * Shackleton Rim base (fiction): a walk-in habitat module with an airlock and north-facing windows,
 * a second module buried under a regolith berm, three vertical solar arrays that turn to follow the
 * Sun around the horizon, a comms mast pointed at the Earth, a landing pad with a parked cargo lander,
 * cargo, power cables, bootprints and rover tracks.
 */

// Habitat H1 (enterable): axis along X.
const H = { x0: -16, x1: -4, z: -6, r: 2.3, deckDrop: 1.1 };
const AL = { x0: -4, x1: -1.4, halfW: 1.05, h: 2.5 }; // airlock vestibule
const DOOR_W = 1.1;

export async function createBase(api) {
  const { scene, ctx, groundAt, surfaceAt, overrides, discover, SCI, prints, sunDir, earthDir } = api;
  const tier = ctx.tier;
  const group = new THREE.Group();
  group.name = "moon-base";
  scene.add(group);
  const env = ctx.common.interiorEnvironment?.(ctx.renderer) ?? null;

  const gB = surfaceAt(SITE.base.x, SITE.base.z);
  const y0 = gB + 0.55; // habitat deck height
  const yc = y0 + H.deckDrop; // module axis height

  // ── Materials ──
  const M = {
    hull: hw({ kind: "panel", color: 0xe9e6df, roughness: 0.55, metalness: 0.05 }),
    hullDark: hw({ kind: "composite", color: 0x6d6f73, roughness: 0.6, metalness: 0.2 }),
    mli: hw({ kind: "mli", color: 0xd9d7d0, roughness: 0.45, metalness: 0.35 }),
    gold: hw({ kind: "foil", color: 0xc99a3a, roughness: 0.32, metalness: 0.9 }),
    metal: hw({ kind: "brushed", color: 0xb8bcc2, roughness: 0.38, metalness: 0.85 }),
    darkMetal: hw({ kind: "brushed", color: 0x3c3f44, roughness: 0.5, metalness: 0.7 }),
    solar: hw({ kind: "solar", color: 0x1b2a4a, roughness: 0.25, metalness: 0.5 }),
    bag: hw({ kind: "composite", color: 0x9c968c, roughness: 0.95, metalness: 0 }),
    sintered: hw({ kind: "sintered", color: 0x77736d, roughness: 0.95, metalness: 0 }),
    paint: plain({ color: 0xe8e2d4, roughness: 0.8 }),
    orange: hw({ kind: "panel", color: 0xd96a1c, roughness: 0.6 }),
    cable: plain({ color: 0x26272a, roughness: 0.7 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fb4c8, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.18, depthWrite: false }),
    // Interior: lit by the cabin lights and a soft environment, never by the Sun.
    liner: hw({ kind: "composite", color: 0xd6d2c8, roughness: 0.75 }, { indoor: true, env, envI: 0.45 }),
    deck: hw({ kind: "rubber", color: 0x4a4d52, roughness: 0.9 }, { indoor: true, env, envI: 0.35 }),
    rack: hw({ kind: "brushed", color: 0xa8acb2, roughness: 0.45, metalness: 0.7 }, { indoor: true, env, envI: 0.6 }),
    fabric: hw({ kind: "composite", color: 0x5a6f86, roughness: 0.9 }, { indoor: true, env, envI: 0.3 }),
    inPanel: hw({ kind: "panel", color: 0xefece4, roughness: 0.6 }, { indoor: true, env, envI: 0.5 }),
    led: new THREE.MeshBasicMaterial({ color: 0xfff1d8, toneMapped: false }),
    grow: new THREE.MeshBasicMaterial({ color: 0xff5ad8, toneMapped: false }),
    leaf: plain({ color: 0x3f7d3a, roughness: 0.8 }, { indoor: true, env, envI: 0.3 }),
  };
  M.glass = moonify(M.glass, { key: "glass" });

  const B = new Batch();
  const g = (x, z) => groundAt(x, z) ?? surfaceAt(x, z);

  // ── Habitat H1 hull with window cut-outs (north side) ──
  const L = H.x1 - H.x0;
  const windows = [-13.2, -9.8, -6.6].map((x) => ({ x, th: Math.PI * 0.5 - 0.18, w: 0.62, h: 0.42 })); // north-facing, at eye height
  const hullGeo = (() => {
    const segA = 40;
    const segL = 48;
    const pos = [];
    const nor = [];
    const uv = [];
    const idx = [];
    for (let j = 0; j <= segL; j++) {
      const x = H.x0 + (j / segL) * L;
      for (let i = 0; i <= segA; i++) {
        const th = (i / segA) * Math.PI * 2;
        // th: angle from +Y toward −Z (north)
        const ny = Math.cos(th);
        const nz = -Math.sin(th);
        pos.push(x, yc + ny * H.r, H.z + nz * H.r);
        nor.push(0, ny, nz);
        uv.push(j / 6, i / 8);
      }
    }
    const inWin = (x, th) => windows.some((w) => {
      let d = th - (w.th < 0 ? w.th + Math.PI * 2 : w.th);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      return ((x - w.x) / w.w) ** 2 + ((d * H.r) / w.h) ** 2 < 1;
    });
    for (let j = 0; j < segL; j++) {
      for (let i = 0; i < segA; i++) {
        const xc = H.x0 + ((j + 0.5) / segL) * L;
        const thc = ((i + 0.5) / segA) * Math.PI * 2;
        if (inWin(xc, thc)) continue;
        const a = j * (segA + 1) + i;
        const b = a + 1;
        const c = a + segA + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  })();
  // Winding check: faces should point outward for the exterior hull.
  const hullOut = new THREE.Mesh(hullGeo, M.hull);
  hullOut.castShadow = true;
  hullOut.receiveShadow = true;
  group.add(hullOut);
  const linerGeo = hullGeo.clone();
  {
    const p = linerGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setY(i, yc + (p.getY(i) - yc) * 0.955);
      p.setZ(i, H.z + (p.getZ(i) - H.z) * 0.955);
    }
  }
  const linerMat = M.liner.clone();
  linerMat.onBeforeCompile = M.liner.onBeforeCompile;
  linerMat.customProgramCacheKey = M.liner.customProgramCacheKey;
  linerMat.side = THREE.BackSide;
  const liner = new THREE.Mesh(linerGeo, linerMat);
  liner.receiveShadow = false;
  group.add(liner);
  // Ribs (frames) outside + window frames and glass.
  for (let k = 0; k <= 6; k++) B.add(M.hullDark, new THREE.TorusGeometry(H.r + 0.03, 0.05, 6, 40), { p: [H.x0 + 0.1 + (k * (L - 0.2)) / 6, yc, H.z], r: [0, Math.PI / 2, 0] });
  for (const w of windows) {
    const th = w.th;
    const ny = Math.cos(th);
    const nz = -Math.sin(th);
    const ring = new THREE.TorusGeometry(1, 0.07, 6, 28);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(w.x, yc + ny * H.r * 1.0, H.z + nz * H.r * 1.0),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, ny, nz)),
      new THREE.Vector3(w.w, w.h, 1.4)
    );
    B.add(M.darkMetal, ring, { m });
    const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 24), M.glass);
    glass.applyMatrix4(m);
    glass.renderOrder = 5;
    group.add(glass);
  }
  // End caps: west closed, east with the door into the airlock.
  const capShape = (hole) => {
    const s = new THREE.Shape();
    s.absarc(0, 0, H.r, 0, Math.PI * 2, false);
    if (hole) {
      const h = new THREE.Path();
      const yb = -H.deckDrop;
      h.moveTo(-DOOR_W / 2, yb);
      h.lineTo(-DOOR_W / 2, yb + 2.15);
      h.lineTo(DOOR_W / 2, yb + 2.15);
      h.lineTo(DOOR_W / 2, yb);
      h.lineTo(-DOOR_W / 2, yb);
      s.holes.push(h);
    }
    return new THREE.ShapeGeometry(s, 24);
  };
  B.add(M.hull, capShape(false), { p: [H.x0, yc, H.z], r: [0, -Math.PI / 2, 0] });
  B.add(M.liner, capShape(false), { p: [H.x0 + 0.08, yc, H.z], r: [0, Math.PI / 2, 0] });
  B.add(M.hull, capShape(true), { p: [H.x1, yc, H.z], r: [0, Math.PI / 2, 0] });
  B.add(M.liner, capShape(true), { p: [H.x1 - 0.08, yc, H.z], r: [0, -Math.PI / 2, 0] });
  // Cradles under the module.
  for (const x of [H.x0 + 1.5, (H.x0 + H.x1) / 2, H.x1 - 1.5]) {
    B.add(M.darkMetal, new THREE.BoxGeometry(0.3, 1.2, 3.6), { p: [x, gB + 0.3, H.z] });
    B.add(M.darkMetal, new THREE.BoxGeometry(0.9, 0.1, 4.0), { p: [x, gB + 0.05, H.z] });
  }
  // Regolith-filled bags shielding the south flank (partly shielded).
  {
    const bag = new THREE.CapsuleGeometry(0.28, 0.7, 3, 8).rotateZ(Math.PI / 2);
    for (let row = 0; row < 5; row++) {
      const th = -Math.PI * 0.5 - 0.6 + row * 0.3; // south flank, from low to high
      const ny = Math.cos(th);
      const nz = -Math.sin(th);
      for (let x = H.x0 + 0.6 + (row % 2) * 0.5; x < H.x1 - 0.5; x += 1.15)
        B.add(M.bag, bag, { p: [x, yc + ny * (H.r + 0.32), H.z + nz * (H.r + 0.32)], r: [-th, 0, 0], s: [1, 1, 1.15] });
    }
    for (let x = H.x0 + 0.4; x < H.x1; x += 1.15) B.add(M.bag, bag, { p: [x, gB + 0.3, H.z + H.r + 0.2], s: [1, 1, 1.2] });
  }
  // ── Airlock vestibule (box) ──
  const alC = (AL.x0 + AL.x1) / 2;
  const alL = AL.x1 - AL.x0;
  const wallT = 0.1;
  B.add(M.hull, new THREE.BoxGeometry(alL, wallT, AL.halfW * 2 + 0.2), { p: [alC, y0 + AL.h + 0.05, H.z] }); // roof
  B.add(M.hull, new THREE.BoxGeometry(alL, AL.h + 0.55, wallT), { p: [alC, y0 + AL.h / 2 - 0.25, H.z - AL.halfW - 0.05] });
  B.add(M.hull, new THREE.BoxGeometry(alL, AL.h + 0.55, wallT), { p: [alC, y0 + AL.h / 2 - 0.25, H.z + AL.halfW + 0.05] });
  B.add(M.inPanel, new THREE.BoxGeometry(alL, 0.04, AL.halfW * 2), { p: [alC, y0 + AL.h - 0.02, H.z] });
  // East face with the outer door frame.
  const sideW = (AL.halfW * 2 + 0.2 - DOOR_W) / 2;
  B.add(M.hull, new THREE.BoxGeometry(wallT, AL.h + 0.55, sideW), { p: [AL.x1, y0 + AL.h / 2 - 0.25, H.z - DOOR_W / 2 - sideW / 2] });
  B.add(M.hull, new THREE.BoxGeometry(wallT, AL.h + 0.55, sideW), { p: [AL.x1, y0 + AL.h / 2 - 0.25, H.z + DOOR_W / 2 + sideW / 2] });
  B.add(M.hull, new THREE.BoxGeometry(wallT, AL.h - 2.15, DOOR_W), { p: [AL.x1, y0 + 2.15 + (AL.h - 2.15) / 2, H.z] });
  B.add(M.darkMetal, new THREE.BoxGeometry(0.16, 2.25, 0.08), { p: [AL.x1 + 0.03, y0 + 1.1, H.z - DOOR_W / 2] });
  B.add(M.darkMetal, new THREE.BoxGeometry(0.16, 2.25, 0.08), { p: [AL.x1 + 0.03, y0 + 1.1, H.z + DOOR_W / 2] });
  B.add(M.darkMetal, new THREE.BoxGeometry(0.16, 0.08, DOOR_W + 0.16), { p: [AL.x1 + 0.03, y0 + 2.18, H.z] });
  // Floor of airlock + steps up from the ground.
  B.add(M.deck, new THREE.BoxGeometry(alL, 0.06, AL.halfW * 2), { p: [alC, y0 - 0.03, H.z] });
  B.add(M.darkMetal, new THREE.BoxGeometry(alL + 0.2, 0.55, AL.halfW * 2 + 0.2), { p: [alC, gB + 0.24, H.z] });
  const rampLen = 2.0;
  {
    const rg = new THREE.BoxGeometry(rampLen, 0.06, DOOR_W + 0.3);
    const ang = Math.atan2(0.55, rampLen);
    B.add(M.sintered, rg, { p: [AL.x1 + rampLen / 2, gB + 0.27, H.z], r: [0, 0, -ang] });
    for (const s of [-1, 1]) B.add(M.metal, new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6), { p: [AL.x1 + 1.2, gB + 0.8, H.z + s * (DOOR_W / 2 + 0.2)] });
    for (const s of [-1, 1]) B.add(M.metal, new THREE.CylinderGeometry(0.02, 0.02, 2.1, 6), { p: [AL.x1 + 1.0, gB + 1.15, H.z + s * (DOOR_W / 2 + 0.2)], r: [0, 0, Math.PI / 2 - ang] });
  }
  // Sliding outer door.
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.15, DOOR_W), M.hull);
  door.position.set(AL.x1 + 0.08, y0 + 1.075, H.z);
  door.castShadow = true;
  group.add(door);
  const doorWin = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), M.glass);
  doorWin.rotation.y = Math.PI / 2;
  doorWin.position.set(0.045, 0.45, 0);
  door.add(doorWin);
  // Door control panels (outside and inside), poke or trigger.
  const btnMat = new THREE.MeshBasicMaterial({ color: 0x3cff8a, toneMapped: false });
  const mkBtn = (x, z, ry) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.2), M.darkMetal);
    box.position.set(x, y0 + 1.25, z);
    box.rotation.y = ry;
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.045, 18), btnMat);
    b.position.set(0.032, 0.03, 0);
    b.rotation.y = Math.PI / 2;
    box.add(b);
    group.add(box);
    return box;
  };
  const btnOut = mkBtn(AL.x1 + 0.08, H.z + DOOR_W / 2 + 0.22, 0);
  const btnIn = mkBtn(AL.x1 - 0.1, H.z - DOOR_W / 2 - 0.25, Math.PI);
  const doorState = { open: 0, target: 0, timer: 0, cycling: 0 };
  const toggleDoor = () => {
    if (doorState.cycling > 0) return;
    if (doorState.target === 0) {
      doorState.cycling = 1.6;
      ctx.toast("Airlock", "Cycling… equalising pressure", { seconds: 2 });
      ctx.audio?.select?.();
    } else doorState.target = 0;
  };

  // ── Interior ──
  B.add(M.deck, new THREE.BoxGeometry(L - 0.2, 0.06, 4.0), { p: [(H.x0 + H.x1) / 2, y0 - 0.03, H.z] });
  // Ceiling LED strips.
  for (const s of [-0.55, 0.55]) B.add(M.led, new THREE.BoxGeometry(L - 1.2, 0.03, 0.09), { p: [(H.x0 + H.x1) / 2, yc + H.r * 0.93 - 0.04, H.z + s] });
  // Racks along the south wall.
  for (let x = H.x0 + 1.2; x < H.x1 - 1.5; x += 1.25) {
    B.add(M.rack, new THREE.BoxGeometry(1.1, 1.9, 0.55), { p: [x, y0 + 0.95, H.z + 1.55] });
    B.add(M.inPanel, new THREE.BoxGeometry(1.0, 0.3, 0.02), { p: [x, y0 + 1.4, H.z + 1.27] });
    B.add(M.darkMetal, new THREE.BoxGeometry(1.0, 0.5, 0.02), { p: [x, y0 + 0.55, H.z + 1.27] });
  }
  // Plant growth rack with pink LEDs.
  B.add(M.rack, new THREE.BoxGeometry(1.0, 1.6, 0.5), { p: [H.x0 + 0.9, y0 + 0.8, H.z - 1.2] });
  for (const yy of [0.5, 1.0, 1.45]) {
    B.add(M.grow, new THREE.BoxGeometry(0.9, 0.02, 0.06), { p: [H.x0 + 0.9, y0 + yy + 0.25, H.z - 1.2] });
    for (let k = 0; k < 6; k++) B.add(M.leaf, new THREE.IcosahedronGeometry(0.07, 0), { p: [H.x0 + 0.5 + k * 0.15, y0 + yy + 0.06, H.z - 1.2 + ((k % 2) - 0.5) * 0.15], s: [1, 0.7, 1] });
  }
  // Table and benches by the windows.
  B.add(M.inPanel, new THREE.BoxGeometry(2.2, 0.05, 0.8), { p: [-10.6, y0 + 0.74, H.z - 1.0] });
  B.add(M.rack, new THREE.CylinderGeometry(0.05, 0.05, 0.72, 8), { p: [-10.6, y0 + 0.36, H.z - 1.0] });
  B.add(M.fabric, new THREE.BoxGeometry(2.0, 0.45, 0.4), { p: [-10.6, y0 + 0.225, H.z + 0.0] });
  // Suit stand near the airlock.
  B.add(M.inPanel, new THREE.CapsuleGeometry(0.28, 0.7, 4, 10), { p: [-5.0, y0 + 1.15, H.z + 1.45] });
  B.add(M.gold, new THREE.SphereGeometry(0.17, 14, 10), { p: [-5.0, y0 + 1.82, H.z + 1.45] });
  // Info screen.
  const screen = new Panel({ width: 1.1, height: 0.62, ppm: 900, glow: "#9fd8ff" });
  screen.setContent({
    eyebrow: "Shackleton Rim base · concept (fiction)",
    title: "Habitat 1",
    titleSize: 64,
    lines: ["Crew 4 · pressure 101 kPa · O₂ 21%", "Outside: vacuum, −10 to −50 °C in sun, below −200 °C in permanent shadow", "Power: 3 vertical arrays tracking the Sun around the horizon", "Earth link: mast dish, ~1.3 light-seconds"],
    lineSize: 30,
  });
  screen.mesh.position.set(-8.4, y0 + 1.55, H.z - 1.85);
  screen.mesh.rotation.y = 0;
  screen.mesh.lookAt(-8.4, y0 + 1.55, H.z + 5);
  group.add(screen.mesh);
  // Cabin lights (always present so the light count never changes; dimmed when far away).
  const cabin = [new THREE.PointLight(0xffe6c8, 0, 7, 1.6), new THREE.PointLight(0xffe6c8, 0, 7, 1.6)];
  cabin[0].position.set(-13, yc + 1.2, H.z);
  cabin[1].position.set(-7, yc + 1.2, H.z);
  group.add(...cabin);
  const alLight = new THREE.PointLight(0xffffff, 0, 4, 1.6);
  alLight.position.set(alC, y0 + 2.2, H.z);
  group.add(alLight);

  // ── Buried module H2 under a regolith berm ──
  {
    const z2 = 6.5;
    B.add(M.hull, new THREE.CylinderGeometry(2.3, 2.3, 10, 32, 1), { p: [-10, yc, z2], r: [0, 0, Math.PI / 2] });
    const berm = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const bp = berm.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i);
      const z = bp.getZ(i);
      const y = bp.getY(i);
      const n = Math.sin(x * 9.1 + z * 3.7) * 0.03 + Math.sin(z * 11.3 - x * 5.1) * 0.025;
      bp.setXYZ(i, x * 7.4, Math.pow(y, 0.7) * 4.1 + n * 4, z * 4.0);
    }
    berm.computeVertexNormals();
    const bermMesh = new THREE.Mesh(berm, api.terrain.mats[0]);
    bermMesh.position.set(-10, gB - 0.4, z2);
    bermMesh.castShadow = true;
    bermMesh.receiveShadow = true;
    group.add(bermMesh);
    B.add(M.hullDark, new THREE.CylinderGeometry(1.0, 1.0, 1.4, 20), { p: [-2.4, yc - 0.4, z2], r: [0, 0, Math.PI / 2] });
    B.add(M.darkMetal, new THREE.BoxGeometry(0.1, 1.9, 0.9), { p: [-1.66, yc - 0.6, z2] });
  }

  // ── Vertical solar arrays ──
  const arrays = [];
  const arrayMast = 15;
  const panelW = 3.4;
  const panelH = 9.5;
  for (const [x, z] of [
    [40, 26],
    [44, -10],
    [36, 44],
  ]) {
    const gy = g(x, z);
    B.add(M.metal, new THREE.CylinderGeometry(0.16, 0.22, arrayMast, 12), { p: [x, gy + arrayMast / 2, z] });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const lx = x + Math.cos(a) * 1.6;
      const lz = z + Math.sin(a) * 1.6;
      const leg = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(lx, g(lx, lz), lz), new THREE.Vector3(x, gy + 2.0, z), new THREE.Vector3(0, 1, 0));
      m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      m.setPosition((lx + x) / 2, (g(lx, lz) + gy + 2.0) / 2, (lz + z) / 2);
      B.add(M.darkMetal, leg, { m });
      B.add(M.darkMetal, new THREE.CylinderGeometry(0.2, 0.25, 0.08, 10), { p: [lx, g(lx, lz) + 0.04, lz] });
    }
    B.add(M.hullDark, new THREE.BoxGeometry(0.7, 0.9, 0.7), { p: [x, gy + 0.9, z] });
    const head = new THREE.Group();
    head.position.set(x, gy, z);
    const pb = new Batch();
    pb.add(M.solar, new THREE.BoxGeometry(0.05, panelH, panelW), { p: [0.34, arrayMast - panelH / 2 - 0.8, 0] });
    pb.add(M.metal, new THREE.BoxGeometry(0.12, panelH + 0.2, 0.08), { p: [0.27, arrayMast - panelH / 2 - 0.8, panelW / 2] });
    pb.add(M.metal, new THREE.BoxGeometry(0.12, panelH + 0.2, 0.08), { p: [0.27, arrayMast - panelH / 2 - 0.8, -panelW / 2] });
    for (let k = 0; k <= 4; k++) pb.add(M.metal, new THREE.BoxGeometry(0.1, 0.06, panelW), { p: [0.27, arrayMast - 0.8 - (k * panelH) / 4, 0] });
    pb.add(M.darkMetal, new THREE.BoxGeometry(0.4, 0.4, 0.4), { p: [0, arrayMast - 0.6, 0] });
    pb.build(head);
    group.add(head);
    const az = Math.atan2(-sunDir.z, sunDir.x); // rotation.y that points local +X at the Sun
    arrays.push({ head, target: az, angle: az + 1.3 + arrays.length * 0.4, x, z });
  }

  // ── Comms mast with a dish pointed at the Earth ──
  const mastPos = { x: -30, z: -24 };
  {
    const gy = g(mastPos.x, mastPos.z);
    const Hm = 16;
    const legs = [0, 1, 2].map((k) => [Math.cos((k / 3) * Math.PI * 2) * 0.6, Math.sin((k / 3) * Math.PI * 2) * 0.6]);
    for (const [lx, lz] of legs) B.add(M.metal, new THREE.CylinderGeometry(0.035, 0.035, Hm, 6), { p: [mastPos.x + lx, gy + Hm / 2, mastPos.z + lz] });
    for (let y = 0.8; y < Hm; y += 1.0) {
      for (let k = 0; k < 3; k++) {
        const [ax, az] = legs[k];
        const [bx, bz] = legs[(k + 1) % 3];
        const len = Math.hypot(bx - ax, bz - az);
        const m = new THREE.Matrix4().makeRotationY(-Math.atan2(bz - az, bx - ax));
        m.multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2 + ((y * 7) % 2 ? 0.6 : -0.6)));
        m.setPosition(mastPos.x + (ax + bx) / 2, gy + y, mastPos.z + (az + bz) / 2);
        B.add(M.metal, new THREE.CylinderGeometry(0.015, 0.015, len * 1.15, 4), { m });
      }
    }
    const dish = new THREE.Group();
    dish.position.set(mastPos.x, gy + Hm + 0.6, mastPos.z);
    const db = new Batch();
    const prof = [];
    for (let i = 0; i <= 12; i++) {
      const r = (i / 12) * 1.25;
      prof.push(new THREE.Vector2(r, (r * r) / 2.4));
    }
    db.add(M.paint, new THREE.LatheGeometry(prof, 28).rotateX(Math.PI / 2), {});
    db.add(M.darkMetal, new THREE.CylinderGeometry(0.015, 0.015, 0.75, 4).rotateX(Math.PI / 2), { p: [0, 0, 0.37] });
    db.add(M.darkMetal, new THREE.BoxGeometry(0.12, 0.12, 0.2), { p: [0, 0, 0.78] });
    db.add(M.darkMetal, new THREE.BoxGeometry(0.3, 0.3, 0.4), { p: [0, 0, -0.25] });
    db.build(dish);
    dish.lookAt(dish.position.clone().add(earthDir));
    group.add(dish);
    B.add(M.hullDark, new THREE.BoxGeometry(0.5, 0.5, 0.5), { p: [mastPos.x, gy + Hm + 0.2, mastPos.z] });
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }));
  beacon.position.set(mastPos.x, g(mastPos.x, mastPos.z) + 17.4, mastPos.z);
  group.add(beacon);

  // ── Landing pad and cargo lander ──
  const P = SITE.pad;
  const pg = surfaceAt(P.x, P.z);
  {
    B.add(M.sintered, new THREE.CylinderGeometry(P.r, P.r + 0.6, 0.3, 64), { p: [P.x, pg - 0.12, P.z] });
    const ringTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 512;
      const x = c.getContext("2d");
      x.strokeStyle = "rgba(235,230,215,0.9)";
      x.lineWidth = 10;
      x.beginPath();
      x.arc(256, 256, 200, 0, Math.PI * 2);
      x.stroke();
      x.lineWidth = 22;
      x.beginPath();
      x.moveTo(176, 156);
      x.lineTo(176, 356);
      x.moveTo(336, 156);
      x.lineTo(336, 356);
      x.moveTo(176, 256);
      x.lineTo(336, 256);
      x.stroke();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const mk = new THREE.Mesh(new THREE.CircleGeometry(P.r * 0.95, 48).rotateX(-Math.PI / 2), moonify(new THREE.MeshStandardMaterial({ map: ringTex, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), { key: "padmark" }));
    mk.position.set(P.x, pg + 0.035, P.z);
    mk.receiveShadow = true;
    group.add(mk);
  }
  const lander = new THREE.Group();
  lander.position.set(P.x + 1.5, pg + 0.03, P.z - 1);
  lander.rotation.y = 0.5;
  {
    const lb = new Batch();
    const stageY = 2.0;
    // Octagonal descent stage wrapped in gold MLI.
    lb.add(M.gold, new THREE.CylinderGeometry(2.3, 2.3, 1.7, 8), { p: [0, stageY, 0], r: [0, Math.PI / 8, 0] });
    lb.add(M.mli, new THREE.CylinderGeometry(2.32, 2.32, 0.12, 8), { p: [0, stageY + 0.9, 0], r: [0, Math.PI / 8, 0] });
    lb.add(M.darkMetal, new THREE.CylinderGeometry(2.0, 2.2, 0.15, 8), { p: [0, stageY - 0.9, 0], r: [0, Math.PI / 8, 0] });
    // Tanks peeking out.
    for (let k = 0; k < 4; k++) lb.add(M.metal, new THREE.SphereGeometry(0.75, 16, 12), { p: [Math.cos((k * Math.PI) / 2 + 0.4) * 1.55, stageY + 0.15, Math.sin((k * Math.PI) / 2 + 0.4) * 1.55], s: [1, 0.9, 1] });
    // Engine bell.
    const bell = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      bell.push(new THREE.Vector2(0.22 + Math.pow(t, 1.6) * 0.62, -t * 1.25));
    }
    lb.add(M.darkMetal, new THREE.LatheGeometry(bell, 28), { p: [0, stageY - 0.95, 0] });
    lb.add(M.metal, new THREE.CylinderGeometry(0.3, 0.22, 0.35, 16), { p: [0, stageY - 0.85, 0] });
    // Upper cargo / crew module.
    lb.add(M.hull, new THREE.CylinderGeometry(1.5, 1.6, 2.6, 24), { p: [0, stageY + 2.25, 0] });
    lb.add(M.hull, new THREE.SphereGeometry(1.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), { p: [0, stageY + 3.55, 0], s: [1, 0.55, 1] });
    lb.add(M.mli, new THREE.CylinderGeometry(1.62, 1.62, 0.5, 24), { p: [0, stageY + 1.2, 0] });
    lb.add(M.glass, new THREE.CircleGeometry(0.25, 16), { p: [0, stageY + 2.7, 1.58] });
    lb.add(M.darkMetal, new THREE.TorusGeometry(0.27, 0.04, 6, 18), { p: [0, stageY + 2.7, 1.57] });
    // RCS quads and an antenna.
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      lb.add(M.darkMetal, new THREE.BoxGeometry(0.25, 0.25, 0.25), { p: [Math.cos(a) * 1.62, stageY + 3.0, Math.sin(a) * 1.62] });
      for (const [dx, dy, dz] of [
        [0.18, 0, 0],
        [0, 0.18, 0],
        [0, -0.18, 0],
      ])
        lb.add(M.darkMetal, new THREE.ConeGeometry(0.05, 0.12, 8), { p: [Math.cos(a) * (1.62 + dx), stageY + 3.0 + dy, Math.sin(a) * (1.62 + dx) + dz], r: [0, 0, dy > 0 ? 0 : dy < 0 ? Math.PI : -Math.PI / 2] });
    }
    lb.add(M.metal, new THREE.CylinderGeometry(0.02, 0.02, 1.4, 5), { p: [0.6, stageY + 4.2, 0.2] });
    lb.add(M.paint, new THREE.CylinderGeometry(0.35, 0.05, 0.12, 16), { p: [0.6, stageY + 4.9, 0.2], r: [0.5, 0, 0.3] });
    // Four landing legs: primary strut, two secondaries, footpad.
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const top = new THREE.Vector3(ca * 2.0, stageY + 0.6, sa * 2.0);
      const foot = new THREE.Vector3(ca * 4.0, 0.2, sa * 4.0);
      const strut = (p0, p1, r, mat) => {
        const d = p1.clone().sub(p0);
        const m = new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), new THREE.Vector3(1, d.length(), 1));
        lb.add(mat, new THREE.CylinderGeometry(r, r, 1, 8), { m });
      };
      strut(top, foot, 0.09, M.gold);
      strut(top.clone().lerp(foot, 0.35), foot, 0.055, M.metal); // shock absorber sleeve
      const side = new THREE.Vector3(-sa, 0, ca);
      for (const s of [-1, 1]) strut(new THREE.Vector3(ca * 1.8, stageY - 0.8, sa * 1.8).addScaledVector(side, s * 1.0), foot.clone().lerp(top, 0.3), 0.04, M.metal);
      lb.add(M.metal, new THREE.CylinderGeometry(0.45, 0.5, 0.12, 18), { p: [foot.x, 0.06, foot.z] });
      lb.add(M.metal, new THREE.SphereGeometry(0.12, 8, 6), { p: [foot.x, 0.2, foot.z] });
    }
    // Ladder on one leg.
    for (let y = 0.3; y < 2.6; y += 0.3) lb.add(M.metal, new THREE.BoxGeometry(0.5, 0.03, 0.04), { p: [2.6 + (2.6 - y) * 0.45, y, 2.6 + (2.6 - y) * 0.45], r: [0, -Math.PI / 4, 0] });
    lb.build(lander);
  }
  group.add(lander);

  // ── Cargo: crates, a tank on a cradle, pallets ──
  const cargoMats = [M.orange, M.paint, M.hullDark];
  const cargoSpots = [
    [P.x - 12, P.z + 11, 0.3],
    [P.x - 14, P.z + 9, -0.2],
    [P.x - 13, P.z + 12.8, 0.1],
    [8, -16, 0.4],
    [10, -18, 0.2],
    [-20, 12, -0.4],
  ];
  cargoSpots.forEach(([x, z, ry], i) => {
    const gy = g(x, z);
    const w = 1.2 + (i % 3) * 0.25;
    const h = 0.9 + (i % 2) * 0.3;
    B.add(cargoMats[i % 3], new THREE.BoxGeometry(w, h, 1.0), { p: [x, gy + h / 2, z], r: [0, ry, 0] });
    B.add(M.darkMetal, new THREE.BoxGeometry(w + 0.04, 0.06, 1.04), { p: [x, gy + h * 0.25, z], r: [0, ry, 0] });
    B.add(M.darkMetal, new THREE.BoxGeometry(w + 0.04, 0.06, 1.04), { p: [x, gy + h * 0.75, z], r: [0, ry, 0] });
    if (i === 0) B.add(M.paint, new THREE.BoxGeometry(0.9, 0.7, 0.8), { p: [x, gy + h + 0.35, z], r: [0, ry + 0.2, 0] });
  });
  {
    const tx = 18;
    const tz = -8;
    const gy = g(tx, tz);
    B.add(M.mli, new THREE.CapsuleGeometry(0.8, 3.0, 6, 18), { p: [tx, gy + 1.15, tz], r: [0, 0.2, Math.PI / 2] });
    for (const o of [-1, 1]) B.add(M.darkMetal, new THREE.BoxGeometry(0.2, 0.6, 1.4), { p: [tx + o * 1.0, gy + 0.3, tz + o * 0.2], r: [0, 0.2, 0] });
  }

  // ── Power cables from the arrays to the habitat ──
  const cablePts = (pts) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const n = Math.ceil(curve.getLength() / 0.6);
    const sp = curve.getSpacedPoints(n).map((p) => new THREE.Vector3(p.x, g(p.x, p.z) + 0.035, p.z));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sp), n, 0.028, 5, false);
  };
  for (const a of arrays) B.add(M.cable, cablePts([[a.x - 1, a.z], [a.x * 0.6, a.z * 0.6 + 3], [10, -2], [AL.x1 + 0.6, H.z - 1.6], [AL.x1 + 0.2, H.z - 1.3]]), {});
  B.add(M.cable, cablePts([[mastPos.x + 0.6, mastPos.z + 0.5], [-24, -14], [H.x0 + 2, H.z - 2.6]]), {});

  // ── Bootprint trails around the base (from earlier EVAs) ──
  const trail = (pts, seed) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const n = Math.ceil(curve.getLength() / 0.7);
    let side = 1;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const p = curve.getPointAt(t);
      const d = curve.getTangentAt(t);
      const yaw = Math.atan2(-d.x, -d.z);
      const j = Math.sin(i * 12.9898 + seed) * 0.05;
      const px = p.x + Math.cos(yaw) * 0.13 * side + j;
      const pz = p.z - Math.sin(yaw) * 0.13 * side;
      prints.add(px, g(px, pz) + 0.012, pz, yaw + j, undefined, 1);
      side = -side;
    }
  };
  trail([[AL.x1 + 2.2, H.z], [4, -2], [10, 8], [12, 18]], 1);
  trail([[AL.x1 + 2.2, H.z + 0.4], [12, -4], [30, 6], [38, 24]], 2);
  trail([[13, 20], [8, 26], [3.2, 9.0], [-2, 4]], 3);
  trail([[AL.x1 + 2, H.z - 0.5], [-10, -14], [-24, -22], [-28.5, -23]], 4);
  trail([[20, -10], [60, -24], [100, -36], [P.x - 12, P.z + 10]], 5);

  B.build(group);

  // ── Interior override: deck and ramp heights, colliders ──
  const inModule = (x, z) => x > H.x0 + 0.05 && x < H.x1 && Math.abs(z - H.z) < H.r - 0.2;
  const inLock = (x, z) => x >= H.x1 - 0.05 && x < AL.x1 && Math.abs(z - H.z) < AL.halfW + 0.1;
  overrides.push((x, z) => {
    if (inModule(x, z) || inLock(x, z)) return y0;
    if (x >= AL.x1 && x < AL.x1 + rampLen && Math.abs(z - H.z) < DOOR_W / 2 + 0.3) {
      const t = (x - AL.x1) / rampLen;
      return y0 * (1 - t) + surfaceAt(x, z) * t;
    }
    return undefined;
  });
  const wall = [];
  const chain = (ax, az, bx, bz, r = 0.3, gap = null) => {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.45);
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n;
      const z = az + ((bz - az) * i) / n;
      if (gap && gap(x, z)) continue;
      wall.push({ x, z, r });
    }
  };
  const wz = H.r - 0.15;
  chain(H.x0, H.z - wz, H.x1, H.z - wz);
  chain(H.x0, H.z + wz, H.x1, H.z + wz);
  chain(H.x0, H.z - wz, H.x0, H.z + wz);
  chain(H.x1, H.z - wz, H.x1, H.z + wz, 0.3, (x, z) => Math.abs(z - H.z) < 0.86);
  chain(H.x1, H.z - AL.halfW - 0.2, AL.x1, H.z - AL.halfW - 0.2, 0.25);
  chain(H.x1, H.z + AL.halfW + 0.2, AL.x1, H.z + AL.halfW + 0.2, 0.25);
  chain(AL.x1, H.z - AL.halfW - 0.2, AL.x1, H.z + AL.halfW + 0.2, 0.25, (x, z) => Math.abs(z - H.z) < 0.8);
  const doorCols = [-0.4, 0, 0.4].map((dz) => ({ x: AL.x1, z: H.z + dz, r: 0.3 }));
  // Interior furniture.
  for (let x = H.x0 + 1.2; x < H.x1 - 1.5; x += 1.25) wall.push({ x, z: H.z + 1.5, r: 0.45 });
  wall.push({ x: -10.6, z: H.z - 1.0, r: 0.5 }, { x: -11.5, z: H.z - 1.0, r: 0.4 }, { x: -9.7, z: H.z - 1.0, r: 0.4 }, { x: H.x0 + 0.9, z: H.z - 1.2, r: 0.5 });
  // Outside hardware.
  const outside = [
    { x: -10, z: 6.5, r: 3.4 },
    { x: -6, z: 6.5, r: 3.0 },
    { x: -14, z: 6.5, r: 3.0 },
    { x: mastPos.x, z: mastPos.z, r: 1.0 },
    { x: 18, z: -8, r: 2.0 },
    ...arrays.map((a) => ({ x: a.x, z: a.z, r: 1.9 })),
    ...cargoSpots.map(([x, z]) => ({ x, z, r: 0.85 })),
  ];
  // Lander legs and body.
  {
    const lp = lander.position;
    outside.push({ x: lp.x, z: lp.z, r: 2.5 });
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4 - lander.rotation.y;
      outside.push({ x: lp.x + Math.cos(a) * 4.0, z: lp.z + Math.sin(a) * 4.0, r: 0.55 });
    }
  }

  // ── Interactables ──
  const pick = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  const landerPick = pick(5, 6, 5);
  landerPick.position.set(lander.position.x, lander.position.y + 3, lander.position.z);
  group.add(landerPick);
  const arrayPick = arrays.map((a) => {
    const p = pick(1.5, 4, 1.5);
    p.position.set(a.x, g(a.x, a.z) + 2, a.z);
    group.add(p);
    return p;
  });
  const interactables = [
    { object: btnOut, label: "Airlock", poke: true, pokeRadius: 0.08, onPoke: toggleDoor, onSelect: toggleDoor },
    { object: btnIn, label: "Airlock", poke: true, pokeRadius: 0.08, onPoke: toggleDoor, onSelect: toggleDoor },
    { object: door, label: "Airlock door", onSelect: toggleDoor },
    { object: landerPick, label: "Cargo lander", onSelect: () => discover(SCI.lander) },
    ...arrayPick.map((o) => ({ object: o, label: "Solar array", onSelect: () => discover(SCI.arrays) })),
  ];

  // ── Habitat hum (cabin air handling), WebAudio, only while inside ──
  let hum = null;
  const ensureHum = () => {
    const a = ctx.audio;
    if (hum || !a?.ctx || !a.enabled) return;
    const ac = a.ctx;
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < len; i++) {
      b0 = 0.985 * b0 + 0.015 * (Math.random() * 2 - 1);
      d[i] = b0 * 6;
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const tone = ac.createOscillator();
    tone.frequency.value = 118;
    const tg = ac.createGain();
    tg.gain.value = 0.12;
    const out = ac.createGain();
    out.gain.value = 0;
    src.connect(lp).connect(out);
    tone.connect(tg).connect(out);
    out.connect(a.master);
    src.start();
    tone.start();
    hum = { out, src, tone };
  };

  const insideFn = (p) => (inModule(p.x, p.z) || inLock(p.x, p.z)) && p.y < y0 + 3.4 && p.y > y0 - 0.5;
  let beaconT = 0;
  let wasInside = false;
  return {
    group,
    interactables,
    inside: insideFn,
    colliders: () => (doorState.open < 0.85 ? [...wall, ...doorCols, ...outside] : [...wall, ...outside]),
    arrays,
    deckY: y0,
    door: doorState,
    update(dt, t, head) {
      let moved = false;
      // Door: cycle, open, auto-close after a while.
      if (doorState.cycling > 0) {
        doorState.cycling -= dt;
        alLight.color.set(0xff9a3a);
        if (doorState.cycling <= 0) {
          doorState.target = 1;
          doorState.timer = 9;
          alLight.color.set(0x8affb0);
        }
      }
      if (doorState.target === 1) {
        doorState.timer -= dt;
        const inDoorway = Math.abs(head.x - AL.x1) < 1.0 && Math.abs(head.z - H.z) < 0.9;
        if (doorState.timer <= 0 && !inDoorway) doorState.target = 0;
      }
      const prev = doorState.open;
      doorState.open += Math.sign(doorState.target - doorState.open) * Math.min(Math.abs(doorState.target - doorState.open), dt / 1.4);
      if (prev !== doorState.open) {
        door.position.z = H.z - doorState.open * (DOOR_W + 0.05);
        moved = true;
      }
      // Arrays slew toward the Sun, then hold (real tracking is ~0.5° per hour).
      for (const a of arrays) {
        const d = Math.atan2(Math.sin(a.target - a.angle), Math.cos(a.target - a.angle));
        if (Math.abs(d) > 0.0005) {
          a.angle += Math.sign(d) * Math.min(Math.abs(d), dt * 0.035);
          moved = true;
        }
        a.head.rotation.y = a.angle;
      }
      beaconT += dt;
      beacon.visible = beaconT % 2.0 < 0.18;
      // Cabin lights and hum.
      const dH = Math.hypot(head.x - (H.x0 + H.x1) / 2, head.z - H.z);
      const k = dH < 40 ? 1 : 0;
      cabin[0].intensity = cabin[1].intensity = 9 * k;
      alLight.intensity = 3 * k;
      const ins = insideFn(head);
      if (ins && !wasInside) discover(SCI.base);
      wasInside = ins;
      ensureHum();
      if (hum) hum.out.gain.setTargetAtTime(ins && ctx.audio.enabled ? 0.05 : 0, ctx.audio.ctx.currentTime, 0.4);
      return moved;
    },
    dispose() {
      if (hum) {
        try {
          hum.src.stop();
          hum.tone.stop();
          hum.out.disconnect();
        } catch {
          /* already stopped */
        }
      }
      screen.dispose?.();
    },
  };
}
