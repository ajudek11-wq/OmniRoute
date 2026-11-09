import * as THREE from "three";
import { starSky, sun, planet } from "../common.js";
import { textLabel } from "../../xr/panel.js";

/** Temporary stand-in used until a destination's full environment lands: a platform facing the body. */
export function stubWorld(ctx, { tex = null, color = "#888", angle = 40 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0);
  const sky = starSky({ tier: ctx.tier });
  scene.add(sky.group);
  const sunDir = new THREE.Vector3(-0.5, 0.3, -0.8).normalize();
  const s = sun({ dir: sunDir });
  scene.add(s.group);
  scene.add(new THREE.DirectionalLight(0xffffff, 2.5).translateOnAxis(sunDir, 10), new THREE.HemisphereLight(0x8899aa, 0x222222, 0.4));
  if (tex) {
    const p = planet(1000, { tex, tier: ctx.tier });
    p.group.position.set(0, 0, -1000 / Math.tan((angle * Math.PI) / 360));
    scene.add(p.group);
  }
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.2, 48), new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.6, roughness: 0.4 }));
  deck.position.y = -0.1;
  scene.add(deck);
  const label = textLabel(ctx.dest?.name ?? "Destination", { size: 0.12, sub: "Environment loading in a later build" });
  label.position.set(0, 2, -2.5);
  scene.add(label);
  return {
    scene,
    spawn: { x: 0, z: 1, yaw: 0 },
    groundAt: (x, z) => (Math.hypot(x, z) < 3.8 ? 0 : null),
    interactables: [],
    update() {
      const c = ctx.xr.camera.getWorldPosition(new THREE.Vector3());
      sky.follow(c);
      s.follow(c);
    },
    dispose() {},
  };
}
