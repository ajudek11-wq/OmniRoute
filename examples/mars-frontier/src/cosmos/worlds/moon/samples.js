import * as THREE from "three";
import { rockGeometry } from "./props.js";
import { moonify } from "./shade.js";

export const LUNAR_G = 1.62;

/**
 * Hand-sized sample rocks you can pick up. Released, they keep the hand's velocity and fall on a
 * clean ballistic arc at 1.62 m/s² (no air, no drag), then settle with a dull, low bounce.
 */
export function createSamples(ctx, T, { groundAt, discover, science, onFirstDrop }) {
  const defs = [
    { x: 3.2, z: 7.4, s: 0.085, color: 0xe8e4dc, sci: science.anorthosite, seed: 41 },
    { x: -262, z: -270, s: 0.1, color: 0x8f8a82, sci: science.breccia, seed: 43 },
    { x: 11.5, z: 18.5, s: 0.07, color: 0xa29e96, sci: science.regolith, seed: 47 },
    { x: 545, z: 372, s: 0.09, color: 0x7f7b75, sci: science.breccia, seed: 53 },
    { x: -9, z: 30, s: 0.075, color: 0xd9d4ca, sci: science.anorthosite, seed: 59 },
  ];
  const group = new THREE.Group();
  group.name = "samples";
  const flagGeo = new THREE.BufferGeometry();
  const items = [];
  const stakeMat = moonify(new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.7, roughness: 0.4 }), { key: "stake" });
  const flagMat = moonify(new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.7, side: THREE.DoubleSide }), { key: "flag" });
  const stakeGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.55, 6).translate(0, 0.275, 0);
  const pennant = new THREE.PlaneGeometry(0.12, 0.07).translate(0.06, 0.5, 0);
  flagGeo.dispose();
  for (const d of defs) {
    const mat = moonify(new THREE.MeshStandardMaterial({ map: T.rock, normalMap: T.rockN, color: d.color, roughness: 0.92 }), { ls: true, key: "sample" });
    const mesh = new THREE.Mesh(rockGeometry(d.seed, 2, { rough: 0.3, flat: 0.8 }), mat);
    mesh.scale.setScalar(d.s);
    const y = groundAt(d.x, d.z) ?? 0;
    mesh.position.set(d.x, y + d.s * 0.55, d.z);
    mesh.rotation.y = d.seed;
    mesh.castShadow = true;
    group.add(mesh);
    // A small survey flag so the samples can be found.
    const stake = new THREE.Mesh(stakeGeo, stakeMat);
    stake.position.set(d.x + 0.35, y, d.z + 0.1);
    const fl = new THREE.Mesh(pennant, flagMat);
    stake.add(fl);
    stake.castShadow = true;
    group.add(stake);
    const it = {
      object: mesh,
      grab: true,
      grabRadius: 0.18,
      label: "Sample",
      state: { held: false, vel: new THREE.Vector3(), falling: false, hist: [] },
      onGrab() {
        it.state.held = true;
        it.state.falling = false;
        it.state.hist.length = 0;
        if (discover(d.sci)) ctx.audio?.tap?.();
      },
      onRelease() {
        it.state.held = false;
        const h = it.state.hist;
        if (h.length >= 2) {
          const a = h[0];
          const b = h[h.length - 1];
          const dt = Math.max(0.016, b.t - a.t);
          it.state.vel.set((b.p.x - a.p.x) / dt, (b.p.y - a.p.y) / dt, (b.p.z - a.p.z) / dt);
          if (it.state.vel.length() > 12) it.state.vel.setLength(12);
        } else it.state.vel.set(0, 0, 0);
        it.state.falling = true;
        onFirstDrop?.();
      },
    };
    items.push(it);
  }
  const wp = new THREE.Vector3();
  let clock = 0;
  return {
    group,
    interactables: items,
    /** Returns true while any sample is moving (for the shadow map refresh). */
    update(dt) {
      clock += dt;
      let moving = false;
      for (const it of items) {
        const s = it.state;
        if (s.held) {
          it.object.getWorldPosition(wp);
          s.hist.push({ p: wp.clone(), t: clock });
          while (s.hist.length > 6) s.hist.shift();
          moving = true;
          continue;
        }
        if (!s.falling) continue;
        moving = true;
        const o = it.object;
        s.vel.y -= LUNAR_G * dt;
        o.position.addScaledVector(s.vel, dt);
        o.rotation.x += s.vel.z * dt * 2;
        o.rotation.z -= s.vel.x * dt * 2;
        const g = groundAt(o.position.x, o.position.z) ?? -1e9;
        const r = o.scale.x * 0.55;
        if (o.position.y < g + r) {
          o.position.y = g + r;
          if (Math.abs(s.vel.y) < 0.35) {
            s.falling = false;
            s.vel.set(0, 0, 0);
          } else {
            s.vel.y = -s.vel.y * 0.25;
            s.vel.x *= 0.45;
            s.vel.z *= 0.45;
          }
        }
      }
      return moving;
    },
  };
}
