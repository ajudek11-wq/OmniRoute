import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { earth, planet, rings as ringSystem } from "../common.js";
import { surface } from "../../scene/surfaces.js";
import { canvasTex, europaTexture, titanTexture, rockGeometry, glowSprite, placeScaled, smooth, clamp } from "./kit.js";
import { cruiseRange } from "./flight.js";

/**
 * The departure and cruise legs in one "space frame" (metres): the survey ship Meridian (fiction)
 * sits at the origin in high Earth orbit with its hangar bay open toward −Z; the Earth spans ~30°.
 * The destination lies along TARGET_DIR; its range shrinks logarithmically during cruise, so it
 * grows from a dot to a disk. Distances are compressed (labelled on the displays).
 */

export const SUN_DIR = new THREE.Vector3(-0.5, 0.35, 0.8).normalize();
const EARTH_R = 6.371e6;
const EARTH_DIST = EARTH_R / Math.tan((30 * Math.PI) / 360);
export const EARTH_POS = new THREE.Vector3(0.75, -0.45, -0.45).normalize().multiplyScalar(EARTH_DIST);
export const TARGET_DIR = new THREE.Vector3(-0.5, 0.15, -1).normalize();
/** Where the ship ends the undock leg (out of the bay and clear of the hull). */
export const UNDOCK_END = new THREE.Vector3(0, 6, -110);

/** Body for each destination: radius (m) and how it is drawn. */
export const BODY = {
  moon: { r: 1.737e6, tex: "moon" },
  orbit: { station: true },
  venus: { r: 6.052e6, tex: "venus_atmos", atmo: { color: "#ffe2a8", power: 2.2, intensity: 1.2, scale: 1.03 } },
  mars: { r: 3.39e6, tex: "mars", atmo: { color: "#f0a07a", power: 3.2, intensity: 0.8, scale: 1.02 } },
  asteroids: { r: 900, rock: true },
  jupiter: { r: 6.99e7, tex: "jupiter", atmo: { color: "#e8d2b0", power: 3, intensity: 0.5, scale: 1.015 } },
  europa: { r: 1.56e6, tex: "europa", parent: { tex: "jupiter", r: 6.99e7, off: new THREE.Vector3(0.9, 0.25, -0.4), dist: 6.71e8 } },
  saturn: { r: 5.82e7, tex: "saturn", rings: true },
  titan: { r: 2.575e6, tex: "titan", atmo: { color: "#f0a040", power: 1.6, intensity: 1.6, scale: 1.12 }, parent: { tex: "saturn", r: 5.82e7, off: new THREE.Vector3(0.7, 0.3, -0.6), dist: 1.22e9, rings: true } },
  deep: { fold: true },
};

function hullBuilder() {
  const parts = new Map();
  return {
    add(mat, g, p = [0, 0, 0], r = [0, 0, 0]) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(1, 1, 1));
      let geo = g.clone().applyMatrix4(m);
      if (!geo.index) {
        geo = geo.toNonIndexed();
        geo.setIndex([...Array(geo.attributes.position.count).keys()]);
      }
      for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(k)) geo.deleteAttribute(k);
      if (!parts.has(mat)) parts.set(mat, []);
      parts.get(mat).push(geo);
    },
    build(group) {
      for (const [mat, list] of parts) group.add(new THREE.Mesh(mergeGeometries(list, false), mat));
    },
  };
}

/** The Meridian: hangar bay around the docked shuttle, the hull, nav-deck ring, radiators and arrays. */
function buildMeridian(env) {
  const g = new THREE.Group();
  const clean = { dustTop: 0, dustBase: 0 };
  const em = (m, k) => ((m.envMap = env), (m.envMapIntensity = k), m);
  const white = em(surface({ kind: "composite", color: 0xd8dcdf, roughness: 0.55, metalness: 0.05, scale: 0.25, grime: 0.18, bump: 0.3, ...clean }), 0.2);
  const bayWall = em(surface({ kind: "panel", color: 0x3c4249, roughness: 0.6, metalness: 0.4, scale: 0.35, grime: 0.25, bump: 0.4, ...clean, side: THREE.DoubleSide }), 0.3);
  const metal = em(surface({ kind: "brushed", color: 0x8d969f, roughness: 0.35, metalness: 0.85, scale: 0.6, grime: 0.15, ...clean }), 0.5);
  const foil = em(surface({ kind: "foil", color: 0xc9a14a, roughness: 0.35, metalness: 0.9, scale: 0.4, grime: 0.1, ...clean }), 0.4);
  const solar = em(surface({ kind: "solar", color: 0x1a2a4a, roughness: 0.25, metalness: 0.4, scale: 0.3, ...clean }), 0.6);
  const radiator = em(surface({ kind: "panel", color: 0xe9ecef, roughness: 0.5, metalness: 0.1, scale: 0.15, grime: 0.05, ...clean }), 0.2);
  const lightStrip = new THREE.MeshBasicMaterial({ color: 0xcfe8ff, toneMapped: false });
  const amber = new THREE.MeshBasicMaterial({ color: 0xffb04a, toneMapped: false });
  const windowsGlow = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, toneMapped: false });
  const B = hullBuilder();

  // Hangar bay: 18 m wide, 10 m tall, from z = +12 to the mouth at z = −26. Ship floor sits at y = 0.
  const W = 18;
  const H = 10;
  const yF = -3.4;
  const z0 = 12;
  const z1 = -26;
  const L = z0 - z1;
  const zc = (z0 + z1) / 2;
  B.add(bayWall, new THREE.BoxGeometry(W, 0.4, L), [0, yF - 0.2, zc]);
  B.add(bayWall, new THREE.BoxGeometry(W, 0.4, L), [0, yF + H + 0.2, zc]);
  B.add(bayWall, new THREE.BoxGeometry(0.4, H, L), [-W / 2 - 0.2, yF + H / 2, zc]);
  B.add(bayWall, new THREE.BoxGeometry(0.4, H, L), [W / 2 + 0.2, yF + H / 2, zc]);
  B.add(bayWall, new THREE.BoxGeometry(W, H, 0.4), [0, yF + H / 2, z0 + 0.2]);
  for (let z = z1 + 2; z < z0; z += 4) {
    // ribs and ceiling light bars
    B.add(metal, new THREE.BoxGeometry(0.5, H, 0.5), [-W / 2 + 0.25, yF + H / 2, z]);
    B.add(metal, new THREE.BoxGeometry(0.5, H, 0.5), [W / 2 - 0.25, yF + H / 2, z]);
    B.add(metal, new THREE.BoxGeometry(W, 0.5, 0.5), [0, yF + H - 0.25, z]);
    B.add(lightStrip, new THREE.BoxGeometry(5, 0.06, 0.3), [0, yF + H - 0.52, z + 2]);
    B.add(amber, new THREE.BoxGeometry(0.08, 0.08, 1.2), [-W / 2 + 0.55, yF + 0.6, z + 2]);
    B.add(amber, new THREE.BoxGeometry(0.08, 0.08, 1.2), [W / 2 - 0.55, yF + 0.6, z + 2]);
  }
  // Floor guide lines leading to the mouth
  for (const x of [-3.2, 3.2]) B.add(amber, new THREE.BoxGeometry(0.12, 0.02, L - 2), [x, yF + 0.02, zc]);
  // Docking cradle under the shuttle and two clamp arms
  B.add(metal, new THREE.BoxGeometry(4.5, 0.6, 9), [0, yF + 0.3, 2]);
  for (const sx of [-1, 1]) {
    B.add(metal, new THREE.BoxGeometry(0.4, 2.6, 0.4), [sx * 2.0, yF + 1.6, 1.5]);
    B.add(metal, new THREE.BoxGeometry(0.4, 2.6, 0.4), [sx * 2.0, yF + 1.6, 4.5]);
  }
  // Wall-mounted equipment, tanks, catwalk
  for (const sx of [-1, 1]) {
    B.add(metal, new THREE.BoxGeometry(1.2, 0.12, L - 4), [sx * (W / 2 - 1.1), yF + 4.2, zc + 1]);
    B.add(metal, new THREE.CylinderGeometry(0.03, 0.03, L - 4, 6).rotateX(Math.PI / 2), [sx * (W / 2 - 1.65), yF + 5.2, zc + 1]);
    for (let i = 0; i < 3; i++) B.add(foil, new THREE.CylinderGeometry(0.6, 0.6, 2.2, 20), [sx * (W / 2 - 1.2), yF + 1.1, 8 - i * 1.6]);
    B.add(bayWall, new THREE.BoxGeometry(0.6, 1.8, 3), [sx * (W / 2 - 0.5), yF + 2.2, -6]);
  }

  // Hull: a long body behind the bay, the bay mouth cut into its front face.
  const R = 26;
  const front = new THREE.Shape();
  front.absarc(0, 0, R, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.moveTo(-W / 2, yF);
  hole.lineTo(W / 2, yF);
  hole.lineTo(W / 2, yF + H);
  hole.lineTo(-W / 2, yF + H);
  hole.closePath();
  front.holes.push(hole);
  B.add(white, new THREE.ExtrudeGeometry(front, { depth: 1.2, bevelEnabled: false, curveSegments: 48 }), [0, 0, z1 - 0.6]);
  B.add(white, new THREE.CylinderGeometry(R, R, 180, 48, 1, true).rotateX(Math.PI / 2), [0, 0, z1 + 90]);
  B.add(amber, new THREE.TorusGeometry(R + 0.1, 0.18, 6, 64), [0, 0, z1 - 0.7]);
  // Bay mouth light frame
  B.add(lightStrip, new THREE.BoxGeometry(W + 0.6, 0.25, 0.3), [0, yF - 0.2, z1 - 0.9]);
  B.add(lightStrip, new THREE.BoxGeometry(W + 0.6, 0.25, 0.3), [0, yF + H + 0.2, z1 - 0.9]);
  // Navigation deck (the hub): a disc with a ring of windows on top of the hull
  B.add(white, new THREE.CylinderGeometry(13, 14, 5, 48), [0, R + 4.5, 20]);
  B.add(windowsGlow, new THREE.CylinderGeometry(13.05, 13.05, 1.4, 48, 1, true), [0, R + 5.2, 20]);
  B.add(white, new THREE.CylinderGeometry(9, 13, 2.5, 48), [0, R + 8.2, 20]);
  B.add(metal, new THREE.CylinderGeometry(4, 6, 4, 24), [0, R + 1.5, 20]);
  B.add(metal, new THREE.CylinderGeometry(0.3, 0.3, 14, 8), [0, R + 15, 20]);
  // Radiators and solar wings
  for (const sx of [-1, 1]) {
    B.add(metal, new THREE.BoxGeometry(40, 1.2, 1.2), [sx * (R + 20), 0, 60]);
    B.add(solar, new THREE.BoxGeometry(36, 0.2, 22), [sx * (R + 22), 0, 46]);
    B.add(solar, new THREE.BoxGeometry(36, 0.2, 22), [sx * (R + 22), 0, 74]);
    B.add(radiator, new THREE.BoxGeometry(0.2, 18, 30), [sx * (R + 3), -R * 0.5, 120]);
  }
  for (let z = z1 + 10; z < z1 + 180; z += 12) B.add(metal, new THREE.TorusGeometry(R + 0.2, 0.35, 6, 48), [0, 0, z]);
  B.add(foil, new THREE.CylinderGeometry(R * 0.9, R * 0.6, 20, 32).rotateX(Math.PI / 2), [0, 0, z1 + 190]);
  B.build(g);

  // Bay floor markings
  const mark = canvasTex(512, 1024, (c, w, h) => {
    c.fillStyle = "#2b3036";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#e8c24a";
    c.lineWidth = 10;
    c.setLineDash([40, 30]);
    c.strokeRect(70, 60, w - 140, h - 120);
    c.setLineDash([]);
    c.fillStyle = "#e8c24a";
    c.font = "700 90px system-ui";
    c.textAlign = "center";
    c.fillText("BAY 2", w / 2, h * 0.86);
    c.font = "600 40px system-ui";
    c.fillText("PATHFINDER", w / 2, h * 0.92);
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 16), new THREE.MeshStandardMaterial({ map: mark, roughness: 0.7, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, yF + 0.03, -2);
  g.add(floor);
  const nameTex = canvasTex(1024, 128, (c, w, h) => {
    c.fillStyle = "rgba(0,0,0,0)";
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#1d2a38";
    c.font = "800 96px system-ui";
    c.textAlign = "center";
    c.fillText("MERIDIAN", w / 2, 100);
  });
  const name = new THREE.Mesh(new THREE.PlaneGeometry(26, 3.25), new THREE.MeshStandardMaterial({ map: nameTex, transparent: true, roughness: 0.6 }));
  name.position.set(0, yF + H + 4.5, z1 - 1.3);
  name.rotation.y = Math.PI;
  g.add(name);
  // Beacon lights
  const beacons = [];
  for (const [x, y, z] of [[-W / 2 - 1, yF - 1, z1 - 1], [W / 2 + 1, yF - 1, z1 - 1], [0, R + 22, 20], [-(R + 40), 0, 60], [R + 40, 0, 60]]) {
    const s = glowSprite(x < 0 ? "#ff5040" : "#60ff90", 2.5);
    s.position.set(x, y, z);
    g.add(s);
    beacons.push(s);
  }
  return { group: g, beacons, bay: { yF, z1 } };
}

/** Build the departure + cruise scenery. */
export function buildSpace(ctx, env) {
  const { tier } = ctx;
  const to = ctx.opts?.to ?? "moon";
  const group = new THREE.Group(); // near objects (frame coordinates), moved by the ship's inverse pose
  const sky = new THREE.Group(); // scaled-space bodies, placed each frame
  const mer = buildMeridian(env);
  group.add(mer.group);

  const sunDir = SUN_DIR.clone();
  const E = earth(1000, { tier, sunDir });
  E.group.rotation.set(0.35, 2.4, 0.15);
  sky.add(E.group);
  const bodies = [{ obj: E.group, pos: EARTH_POS.clone(), r: EARTH_R, setSun: (d) => E.setSun(d) }];

  // Target body
  const def = BODY[to] ?? BODY.moon;
  const range0 = cruiseRange(to, 0);
  const targetPos = UNDOCK_END.clone().addScaledVector(TARGET_DIR, range0);
  if (def.station) {
    // Low Earth orbit: aim at a point 400 km above the Earth, on the side facing us.
    const n = EARTH_POS.clone().negate().normalize().add(new THREE.Vector3(0, 0.45, 0)).normalize();
    targetPos.copy(EARTH_POS).addScaledVector(n, EARTH_R + 4.0e5);
  }
  const tex = def.tex === "europa" ? europaTexture() : def.tex === "titan" ? titanTexture() : def.tex;
  let body = null;
  if (def.rock) {
    const m = new THREE.Mesh(rockGeometry(9, 4, 0.35), new THREE.MeshStandardMaterial({ color: 0x8a7c6c, roughness: 0.92, metalness: 0.15 }));
    body = { group: m, setSun() {} };
  } else if (def.tex) {
    body = planet(1000, { tex, tier, segments: 96, atmosphere: def.atmo ?? null, sunDir });
  }
  if (body) {
    sky.add(body.group);
    bodies.push({ obj: body.group, pos: targetPos, r: def.r, setSun: (d) => body.setSun?.(d), target: true });
    if (def.tex === "saturn" || def.rings) {
      const rg = ringSystem(1000, { sunDir });
      rg.mesh.rotation.x = 0.45;
      body.group.add(rg.mesh);
      bodies[bodies.length - 1].rings = rg;
      body.group.rotation.z = 0.3;
    }
  }
  if (def.parent) {
    const p = planet(1000, { tex: def.parent.tex, tier, segments: 96, sunDir });
    sky.add(p.group);
    const pp = targetPos.clone().addScaledVector(def.parent.off.clone().normalize(), def.parent.dist);
    const entry = { obj: p.group, pos: pp, r: def.parent.r, setSun: () => {} };
    if (def.parent.rings) {
      const rg = ringSystem(1000, { sunDir });
      rg.mesh.rotation.x = 0.4;
      p.group.add(rg.mesh);
      entry.rings = rg;
    }
    bodies.push(entry);
  }
  // A glint so distant targets show as a bright dot before they resolve into a disk.
  const glint = glowSprite(def.station ? "#ffffff" : "#fff2dc", 1, 1);
  sky.add(glint);

  // Dust motes streaking past (only during cruise): short additive line segments.
  const N = tier === "low" ? 220 : 420;
  const mg = new THREE.BufferGeometry();
  const mp = new Float32Array(N * 6);
  const mc = new Float32Array(N * 6);
  mg.setAttribute("position", new THREE.BufferAttribute(mp, 3));
  mg.setAttribute("color", new THREE.BufferAttribute(mc, 3));
  const motes = new THREE.LineSegments(mg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  motes.frustumCulled = false;
  const seeds = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) seeds[i] = (Math.random() * 2 - 1) * 60;

  const tmp = new THREE.Vector3();
  const state = { targetPos, def, bodies, range0 };

  return {
    group,
    sky,
    motes,
    state,
    meridian: mer,
    sunDir,
    /** Ship position along the cruise at progress s. */
    cruisePos(s, out = new THREE.Vector3()) {
      const rng = def.station ? null : cruiseRange(to, s);
      if (def.station) {
        // straight line from UNDOCK_END to 4 km short of the station, distance shrinking logarithmically
        const total = UNDOCK_END.distanceTo(targetPos);
        const d = total * Math.pow(4000 / total, s * s * (3 - 2 * s) * 0.35 + s * 0.65);
        return out.copy(targetPos).addScaledVector(tmp.copy(targetPos).sub(UNDOCK_END).normalize(), -d);
      }
      return out.copy(targetPos).addScaledVector(TARGET_DIR, -rng);
    },
    /** Direction from UNDOCK_END toward the target. */
    targetDir() {
      return tmp.copy(targetPos).sub(UNDOCK_END).normalize().clone();
    },
    update(ship, dt, { cruiseK = 0, speed = 0, t = 0 }) {
      for (const b of bodies) {
        const d = placeScaled(b.obj, b.pos, b.r, ship);
        b.q0 ??= b.obj.quaternion.clone();
        b.obj.quaternion.copy(ship.qInv).multiply(b.q0);
        if (b.target) state.dist = d - b.r;
        b.rings?.update(b.obj.getWorldPosition(tmp), tmp.copy(sunDir).applyQuaternion(ship.qInv));
      }
      E.update(dt);
      // glint at the target direction; fades as the body resolves
      tmp.copy(targetPos).sub(ship.pos).applyQuaternion(ship.qInv);
      const d = tmp.length();
      const angR = def.r ? def.r / d : 0;
      glint.position.copy(tmp).multiplyScalar(LIM_GLINT / d);
      glint.scale.setScalar(LIM_GLINT * 0.012);
      glint.material.opacity = def.fold ? 0 : clamp(1 - angR / 0.004, 0, 1) * 0.9;
      state.dist = def.r ? d - def.r : d;
      for (const s of mer.beacons) s.material.opacity = 0.4 + 0.6 * (Math.sin(t * 3 + s.position.x) > 0.6 ? 1 : 0.15);
      // motes
      motes.visible = cruiseK > 0.01;
      if (motes.visible) {
        const v = Math.min(70, speed);
        const len = 0.5 + v * 0.07;
        for (let i = 0; i < N; i++) {
          let z = seeds[i * 3 + 2] + v * dt;
          if (z > 60) z -= 120;
          seeds[i * 3 + 2] = z;
          const x = seeds[i * 3];
          const y = seeds[i * 3 + 1];
          mp.set([x, y, z, x, y, z - len], i * 6);
          const r = Math.hypot(x, y, z);
          const b = cruiseK * smooth((r - 3) / 10) * (1 - smooth((r - 40) / 20)) * 0.75;
          mc.set([b, b * 0.95, b * 0.9, 0, 0, 0], i * 6);
        }
        mg.attributes.position.needsUpdate = true;
        mg.attributes.color.needsUpdate = true;
      }
    },
    setSun(d) {
      for (const b of bodies) b.setSun?.(d);
    },
  };
}
const LIM_GLINT = 5.0e4;
