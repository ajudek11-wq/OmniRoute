import * as THREE from "three";
import { SITE, BOUNDS, SPAWN, SUN_AZ, SUN_EL, EARTH_AZ, EARTH_EL, EARTH_ANG, dirFromAzEl } from "./moon/layout.js";
import { bakeShadows, shadeUniforms } from "./moon/shade.js";
import { createTerrain, loadMoonTextures } from "./moon/terrain.js";
import { createBoulders, createPrints, bootprintTexture, createFrost } from "./moon/props.js";
import { createSamples } from "./moon/samples.js";
import { MOON_SCIENCE as SCI } from "./moon/science.js";
import { createBase } from "./moon/base.js";
import { createRover } from "./moon/rover.js";
import { createTube } from "./moon/tube.js";

/**
 * The Moon · Shackleton rim. An airless south-pole landscape: the Sun 1.5° above the horizon,
 * kilometre-long shadows, a black sky, the Earth low over a far massif, a rim-top research base,
 * a drivable rover, a permanently shadowed crater with frost and a skylight pit into a lava tube.
 */
export async function build(ctx) {
  const { renderer, xr, tier, common } = ctx;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const sunDir = dirFromAzEl(SUN_AZ, SUN_EL);
  const earthDir = dirFromAzEl(EARTH_AZ, EARTH_EL);
  const T = loadMoonTextures(renderer);
  const terrain = createTerrain(ctx, T);
  const shadows = bakeShadows(sunDir, SUN_EL);
  scene.add(terrain.group);

  // Terrain height the player stands on (overridden inside the habitat and the lava tube).
  let overrides = [];
  const surfaceAt = terrain.surfaceAt;
  const feet = { y: 0 };
  const groundAt = (x, z) => {
    for (const o of overrides) {
      const g = o(x, z, feet.y);
      if (g !== undefined) return g;
    }
    return surfaceAt(x, z);
  };

  // ── Sky: black, faint stars (eyes adapted to sunlit ground), the Sun and the Earth ──
  const sky = common.starSky({ tier, brightness: 0.16, radius: 4.4e6 });
  scene.add(sky.group);
  const sunGfx = common.sun({ dir: sunDir, distance: 4.0e6, angDeg: 0.53, glare: 0.45 });
  scene.add(sunGfx.group);
  const earthDist = 3.0e6;
  const earthR = earthDist * Math.tan((EARTH_ANG * Math.PI) / 360);
  const earth = common.earth(earthR, { tier, sunDir });
  earth.group.rotation.set(0.12, -1.9, 0.0);
  scene.add(earth.group);

  // ── Lights: the Sun (one shadow map following the player) + faint earthshine. No sky light. ──
  const prevShadow = { enabled: renderer.shadowMap.enabled, auto: renderer.shadowMap.autoUpdate, type: renderer.shadowMap.type };
  const shadowsOn = tier !== "low";
  renderer.shadowMap.enabled = shadowsOn;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const sun = new THREE.DirectionalLight(0xfff6ea, 3.1);
  sun.castShadow = shadowsOn;
  if (shadowsOn) {
    const s = tier === "high" ? 2048 : 1024;
    sun.shadow.mapSize.set(s, s);
    const c = sun.shadow.camera;
    c.left = -70;
    c.right = 70;
    c.top = 26;
    c.bottom = -16;
    c.near = 1;
    c.far = 700;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.06;
  }
  scene.add(sun, sun.target);
  const earthshine = new THREE.DirectionalLight(0x9fb6ff, 0.035);
  earthshine.position.copy(earthDir).multiplyScalar(100);
  scene.add(earthshine, earthshine.target);

  // Suit light: a helmet lamp that switches on in darkness (pit, tube, shadowed craters).
  const lamp = new THREE.SpotLight(0xfff1dc, 0, 70, 0.5, 0.55, 1.4);
  lamp.position.set(0.0, 0.05, 0.05);
  lamp.target.position.set(0, -0.25, -1);
  xr.camera.add(lamp, lamp.target);

  // ── Props ──
  const boulders = createBoulders(ctx, T);
  scene.add(boulders.group);
  const frost = createFrost(ctx, surfaceAt, { low: 900, balanced: 1800, high: 3000 }[tier] ?? 1800);
  scene.add(frost.points);
  const prints = createPrints(bootprintTexture(), 2200);
  scene.add(prints.mesh);

  const discover = (e) => ctx.discover({ ...e, dest: "moon" });
  let dropped = false;
  const samples = createSamples(ctx, T, {
    groundAt,
    discover,
    science: SCI,
    onFirstDrop: () => {
      if (!dropped) {
        dropped = true;
        setTimeout(() => discover(SCI.gravity), 1400);
      }
    },
  });
  scene.add(samples.group);

  const staticColliders = [...boulders.colliders];
  const api = { scene, ctx, T, groundAt, surfaceAt, terrain, shadows, sunDir, earthDir, discover, SCI, prints, feet, overrides, colliders: () => staticColliders };
  const base = await createBase(api);
  const tube = await createTube(api);
  api.colliders = () => [...staticColliders, ...base.colliders(feet.y)];
  const rover = await createRover(api);

  // ── Per-frame state ──
  const head = new THREE.Vector3();
  const look = new THREE.Vector3();
  const lightC = new THREE.Vector3(1e9, 0, 0);
  let lookUpT = 0;
  let lookEarthT = 0;
  let walked = 0;
  let lastPrint = null;
  let printSide = 1;
  let shadowDirty = true;
  let time = 0;

  const world = {
    title: "Moon · Shackleton rim",
    scene,
    spawn: { ...SPAWN, y: undefined },
    near: 0.05,
    far: 5.0e6,
    groundAt,
    bounds: BOUNDS,
    get colliders() {
      return [...staticColliders, ...base.colliders(feet.y), ...tube.colliders(feet.y), ...rover.colliders()];
    },
    get interactables() {
      return [...samples.interactables, ...base.interactables, ...tube.interactables, ...rover.interactables];
    },
    get lockMove() {
      return rover.seated;
    },
    get lockTurn() {
      return rover.seated;
    },
    get eye() {
      return rover.seated ? 1.25 : undefined;
    },
    onEnter() {
      xr.headWorld(head);
      terrain.update(head.x, head.z);
      boulders.update(head.x, head.z);
      shadowDirty = true;
    },
    update(dt, t) {
      time += dt;
      xr.headWorld(head);
      feet.y = xr.rig.position.y;
      sky.follow(head);
      sunGfx.follow(head);
      earth.group.position.copy(earthDir).multiplyScalar(earthDist).add(head);
      earth.update(dt);

      if (terrain.update(head.x, head.z)) shadowDirty = true;
      if (boulders.update(head.x, head.z)) shadowDirty = true;

      // Shadow-map window follows the player (snapped, refreshed only when something moved).
      if (shadowsOn) {
        if (head.distanceTo(lightC) > 3) {
          lightC.set(Math.round(head.x / 2) * 2, Math.round(head.y / 2) * 2, Math.round(head.z / 2) * 2);
          sun.target.position.copy(lightC);
          sun.position.copy(lightC).addScaledVector(sunDir, 350);
          sun.target.updateMatrixWorld();
          shadowDirty = true;
        }
      }
      earthshine.target.position.copy(head);
      earthshine.position.copy(head).addScaledVector(earthDir, 100);

      if (samples.update(dt)) shadowDirty = true;
      if (base.update(dt, time, head)) shadowDirty = true;
      if (tube.update(dt, time, head)) shadowDirty = true;
      if (rover.update(dt, time, head)) shadowDirty = true;
      if (shadowsOn && shadowDirty) {
        renderer.shadowMap.needsUpdate = true;
        shadowDirty = false;
      }

      // Suit lamp: on when the helmet is in terrain shadow (and not inside the lit habitat).
      const S = shadows.shadowHeight(head.x, head.z);
      const dark = head.y < S - 0.3 || tube.inside(head) ? 1 : 0;
      const want = base.inside(head) ? 0 : dark * 260;
      lamp.intensity += (want - lamp.intensity) * Math.min(1, dt * 4);
      frost.uniforms.uLamp.value = lamp.intensity / 260;
      frost.uniforms.uTime.value = time;
      frost.uniforms.uCam.value.copy(head);
      xr.camera.getWorldDirection(look);
      frost.uniforms.uDir.value.copy(look);
      frost.uniforms.uPx.value = renderer.getPixelRatio() * (xr.presenting ? 1.5 : 1);

      // Discoveries from looking and walking.
      if (!base.inside(head) && look.y > 0.42) lookUpT += dt;
      if (lookUpT > 1.4) discover(SCI.blackSky);
      if (look.angleTo(earthDir) < 0.12) lookEarthT += dt;
      if (lookEarthT > 1.2) discover(SCI.earth);
      const C = SITE.psr;
      const dC = Math.hypot(head.x - C.x, head.z - C.z);
      if (dC < C.R * 0.65 && head.y < S - 3) {
        discover(SCI.psr);
        if (dC < C.R * 0.5 && lamp.intensity > 100) discover(SCI.ice);
      }

      // Bootprints in the regolith as you walk.
      if (!rover.seated && !base.inside(head) && !tube.inside(head)) {
        if (!lastPrint) lastPrint = head.clone();
        const d = Math.hypot(head.x - lastPrint.x, head.z - lastPrint.z);
        if (d > 0.72 && d < 6) {
          const yaw = Math.atan2(-(head.x - lastPrint.x), -(head.z - lastPrint.z));
          const ox = Math.cos(yaw) * 0.13 * printSide;
          const oz = -Math.sin(yaw) * 0.13 * printSide;
          const px = head.x + ox;
          const pz = head.z + oz;
          const gy = groundAt(px, pz);
          if (gy !== null) prints.add(px, gy + 0.012, pz, yaw, undefined, 1);
          printSide = -printSide;
          walked += d;
          lastPrint.copy(head);
          if (walked > 18) discover(SCI.regolith);
        } else if (d >= 6) lastPrint.copy(head);
      } else lastPrint = null;
    },
    dispose() {
      xr.camera.remove(lamp, lamp.target);
      lamp.dispose();
      shadows.dispose();
      base.dispose?.();
      rover.dispose?.();
      tube.dispose?.();
      renderer.shadowMap.enabled = prevShadow.enabled;
      renderer.shadowMap.autoUpdate = prevShadow.auto;
      renderer.shadowMap.type = prevShadow.type;
      renderer.shadowMap.needsUpdate = true;
    },
  };
  world.spawn = { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw };
  world.debug = { terrain, shadows, shadeUniforms, rover, base, tube, boulders };
  return world;
}
