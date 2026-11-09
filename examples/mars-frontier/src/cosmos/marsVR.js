import * as THREE from "three";
import { heightAt } from "../scene/terrain.js";
import { textLabel } from "../xr/panel.js";

/**
 * Mars in VR: turns the settlement's walk interactions into things you can point at or reach for,
 * and hands the XR system the terrain, colliders and scene. The App keeps simulating Mars; this only
 * replaces the desktop walker while a headset session is live.
 */
export function createMarsVR(app) {
  const scene = app.world.scene;
  const group = new THREE.Group();
  group.name = "mars-vr-targets";
  group.visible = false;
  scene.add(group);
  const items = [];
  for (const it of app.interactables) {
    const target = new THREE.Group();
    const pick = new THREE.Mesh(new THREE.SphereGeometry(it.sample ? 0.7 : 1.1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    target.add(pick);
    const label = textLabel(it.label, { size: 0.11 });
    label.position.y = it.sample ? 0.9 : 1.4;
    target.add(label);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.6, toneMapped: false, depthWrite: false }));
    ring.position.y = -1.15;
    if (!it.sample) target.add(ring);
    group.add(target);
    const entry = {
      it,
      target,
      label,
      interact: {
        object: pick,
        label: it.label,
        enabled: () => target.visible,
        onSelect: () => it.act(),
        onHover: (on) => label.scale.setScalar(on ? 1.25 : 1),
      },
    };
    items.push(entry);
  }

  const adapter = {
    scene,
    groundAt: (x, z) => heightAt(x, z),
    get colliders() {
      return app.walker.colliders;
    },
    bounds: { x: 0, z: 0, r: 2900 },
    interactables: [],
  };

  const head = new THREE.Vector3();
  return {
    adapter,
    group,
    /** Place the player on Mars (feet on the terrain) facing `yaw`. */
    place(x, z, yaw = 0) {
      app.xr.update(0, adapter);
      app.xr.place(x, z, yaw, heightAt(x, z));
    },
    update(dt) {
      group.visible = true;
      app.xr.camera.getWorldPosition(head);
      const list = [];
      for (const e of items) {
        let x = e.it.x;
        let z = e.it.z;
        if (e.it.dyn) {
          x = app.rover.pos.x;
          z = app.rover.pos.z;
        }
        const hidden = e.it.hidden?.() ?? false;
        const d = Math.hypot(head.x - x, head.z - z);
        e.target.visible = !hidden && d < 28;
        if (!e.target.visible) continue;
        e.target.position.set(x, heightAt(x, z) + (e.it.sample ? 0.4 : 1.2), z);
        e.label.lookAt(head);
        e.label.material.opacity = Math.min(1, Math.max(0, (28 - d) / 8));
        list.push(e.interact);
      }
      adapter.interactables = list;
      app.xr.update(dt, adapter);
      // Keep the desktop camera on the head so LOD, audio and effects follow the player.
      const cam = app.world.camera;
      app.xr.camera.getWorldPosition(cam.position);
      app.xr.camera.getWorldQuaternion(cam.quaternion);
    },
    hide() {
      group.visible = false;
    },
  };
}
