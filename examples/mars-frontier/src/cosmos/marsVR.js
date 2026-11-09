import * as THREE from "three";
import { heightAt } from "../scene/terrain.js";
import { OBSTACLES } from "../data/layout.js";
import { textLabel } from "../xr/panel.js";
import { Zones } from "./mars/zones.js";
import { SUN_K, createInfoCard } from "./mars/kit.js";
import { buildHabitatVR } from "./mars/habitat.js";

/**
 * Mars in VR. The App keeps simulating Mars; while a headset session is live this replaces the
 * desktop walker: walkable interiors (zones with doors), the FR-1 cab, grabbable samples, physical
 * control panels and the dust-storm lookout. Everything VR-only is built lazily on the first VR
 * frame and hidden again when the session ends, so desktop and phone behaviour is unchanged.
 */
export function createMarsVR(app) {
  const scene = app.world.scene;
  const root = new THREE.Group();
  root.name = "mars-vr";
  root.visible = false;
  scene.add(root);
  const card = createInfoCard();
  root.add(card.mesh);

  // ── Legacy pointer targets (labels) for interactions that have no physical panel yet ──
  const group = new THREE.Group();
  group.name = "mars-vr-targets";
  root.add(group);
  const items = [];
  const physical = new Set(["airlock", "rover"]);
  for (const it of app.interactables) {
    if (physical.has(it.id)) continue;
    const target = new THREE.Group();
    const pick = new THREE.Mesh(new THREE.SphereGeometry(it.sample ? 0.7 : 1.1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    target.add(pick);
    const label = textLabel(it.label, { size: 0.11 });
    label.position.y = it.sample ? 0.9 : 1.4;
    target.add(label);
    group.add(target);
    items.push({
      it,
      target,
      label,
      interact: { object: pick, label: it.label, enabled: () => target.visible, onSelect: () => it.act(), onHover: (on) => label.scale.setScalar(on ? 1.25 : 1) },
    });
  }

  // ── Walkable spaces ──
  const parts = [];
  const outsideFloor = (x, z) => {
    const t = heightAt(x, z);
    for (const p of parts) {
      if (!p.outsideFloor) continue;
      const v = p.outsideFloor(x, z, t);
      if (v === null) return null;
      if (v !== t) return v;
    }
    return t;
  };
  const zones = new Zones(outsideFloor, []);
  const adapter = {
    scene,
    groundAt: (x, z) => zones.groundAt(x, z),
    get colliders() {
      return zones.colliders();
    },
    bounds: { x: 0, z: 0, r: 2900 },
    interactables: [],
    lockMove: false,
    lockTurn: false,
  };

  let built = false;
  let habitat = null;
  const build = () => {
    if (built) return;
    built = true;
    const y0 = heightAt(0, 0);
    habitat = buildHabitatVR({ app, zones, audio: app.audio, card, y0 });
    root.add(habitat.group);
    parts.push(habitat);
    const base = app.staticColliders.filter((c) => c !== OBSTACLES[0]);
    zones.outsideColliders = [...base, ...parts.flatMap((p) => p.outsideCols ?? []), app.roverCollider];
  };

  let vrOn = false;
  const setVR = (on) => {
    if (vrOn === on) return;
    vrOn = on;
    for (const p of parts) p.setVR?.(on);
    if (!on) {
      for (const p of parts) p.setInside?.(false);
      setSealed(false);
    }
    app.renderer.shadowMap.needsUpdate = true;
  };
  // Inside sealed rooms below the berm nothing outside can be seen: skip drawing it.
  let sealedNow = false;
  const rocks = () => (app._vrRocks ??= scene.children.find((o) => o.userData?.colliders && o.isGroup));
  function setSealed(on) {
    if (on === sealedNow) return;
    sealedNow = on;
    if (app.terrain) app.terrain.visible = !on;
    const r = rocks();
    if (r) r.visible = !on;
    for (const [id, s] of Object.entries(app.settlement.structures)) if (id !== "habitat") s.group.visible = !on;
    app.renderer.shadowMap.needsUpdate = true;
  }

  const head = new THREE.Vector3();
  const zoneName = () => zones.current?.name ?? "Outside";
  return {
    adapter,
    group,
    root,
    zones,
    card,
    get zone() {
      return zones.current?.id ?? null;
    },
    zoneName,
    get habitat() {
      return habitat;
    },
    /** Place the player on Mars (feet on the floor of whatever zone is there) facing `yaw`. */
    place(x, z, yaw = 0, zoneId = undefined) {
      build();
      setVR(true);
      if (zoneId !== undefined) zones.set(zoneId);
      else zones.current = zones.zoneAt(x, z, null);
      app.xr.update(0, adapter);
      const y = zones.groundAt(x, z) ?? heightAt(x, z);
      app.xr.place(x, z, yaw, y);
    },
    update(dt) {
      build();
      setVR(true);
      root.visible = true;
      SUN_K.value = app.renderer.shadowMap.enabled && app.quality.shadows > 0 ? 1 : 0.12;
      app.xr.camera.getWorldPosition(head);
      zones.update(head.x, head.z);
      const zid = zones.current?.id ?? null;
      // Interiors: drawn only near them; exterior faces that block windows hidden while inside.
      for (const p of parts) {
        const inside = p.zoneIds?.includes(zid);
        p.group.visible = inside || head.distanceTo(p.center) < p.radius + 25;
        p.setInside?.(p.insideIds?.includes(zid));
      }
      setSealed((zid === "habGround" || zid === "airlock" || zid === "habBTunnel") && habitat.sealed());
      for (const p of parts) if (p.group.visible) p.update(dt, head);
      card.update(head);

      const list = [];
      for (const p of parts) {
        if (!p.group.visible) continue;
        for (const it of p.interactables) {
          const o = it.object;
          o.getWorldPosition(tmp);
          if (tmp.distanceToSquared(head) < 144) list.push(it);
        }
      }
      if (card.mesh.visible) list.push({ object: card.mesh, label: "Close", onSelect: () => card.hide() });
      for (const e of items) {
        let x = e.it.x;
        let z = e.it.z;
        if (e.it.dyn) {
          x = app.rover.pos.x;
          z = app.rover.pos.z;
        }
        const hidden = e.it.hidden?.() ?? false;
        const d = Math.hypot(head.x - x, head.z - z);
        e.target.visible = !hidden && d < 28 && !zid;
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
      root.visible = false;
      setVR(false);
      card.hide();
    },
  };
}
const tmp = new THREE.Vector3();
