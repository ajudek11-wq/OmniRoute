import * as THREE from "three";
import { makeMaterials } from "./orbit/kit.js";
import { buildRing, roomKit, ROOMS } from "./orbit/ring.js";
import { buildRingExterior, buildHubExterior } from "./orbit/exterior.js";
import { buildSky, ORBIT_SECONDS } from "./orbit/sky.js";
import { stationAudio } from "./orbit/audio.js";
import { furnishLounge } from "./orbit/lounge.js";
import { furnishRooms } from "./orbit/rooms.js";
import { buildEva } from "./orbit/eva.js";
import { RING_R, ringFloorY, orbitPeriod, sunrisesPerDay, earthAngularDiameter, gravityFraction } from "./orbit/physics.js";
import { DISCOVERIES } from "./orbit/discoveries.js";

/**
 * Meridian Station (fiction): a 450 m rotating-ring station in low Earth orbit, 400 km up.
 *
 * Frames: the world is the frame of whatever the player stands in.
 *  - "ring" mode: the world is the spinning ring (spin gravity, walkable). The non-rotating hub,
 *    the Earth, Sun and stars turn around the ring axis (+X through (0, R, 0)).
 *  - "hub" mode (airlock + EVA gantry, zero g): the world is the non-rotating hub frame shifted so
 *    the gantry deck is at y = 0; the ring turns around the player instead.
 */
const SPIN_SECONDS = 210; // displayed: one turn per 3.5 min (the real 2 rpm would be 30 s)
const HUB_SHIFT = 9; // hub frame → world offset in hub mode (deck at y = 0)

export async function build(ctx) {
  const { THREE: _T, common } = ctx;
  void _T;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.environment = common.interiorEnvironment?.(ctx.renderer) ?? null;
  scene.environmentIntensity = 0.3;
  const mats = makeMaterials();
  const sfx = stationAudio(ctx.audio);
  const SCI = ctx.SCI ?? {};

  // ── Discoveries ──
  const discover = (id) => {
    const d = DISCOVERIES[id];
    if (!d) return false;
    return ctx.discover({ id, dest: "orbit", ...d });
  };

  // ── Roots ──
  const ringRoot = new THREE.Group();
  ringRoot.name = "ring-root";
  ringRoot.matrixAutoUpdate = false;
  const hubRoot = new THREE.Group();
  hubRoot.name = "hub-root";
  hubRoot.matrixAutoUpdate = false;
  scene.add(ringRoot, hubRoot);

  // ── Sky ──
  const sky = buildSky(ctx);
  scene.add(...sky.group);

  let mode = "ring";
  let time = 0;
  let warp = 1;

  // ── Ring interior ──
  const ring = buildRing(ctx, mats, sfx);
  ringRoot.add(ring.group);
  const env = {
    ctx,
    mats,
    sfx,
    sci: SCI,
    discover,
    sky,
    restSurfaces: [],
    grabs: [],
    grabbable(obj, label) {
      const g = { obj, label, held: false, vy: 0 };
      env.grabs.push(g);
      ring.interactables.push({
        object: obj,
        label,
        grab: true,
        grabRadius: 0.2,
        onGrab: () => {
          g.held = true;
          sfx.beep(0);
        },
        onRelease: () => {
          g.held = false;
          g.vy = 0;
        },
      });
      return g;
    },
  };
  // ── Exterior ──
  const thL = (z) => Math.asin(z / RING_R);
  const ringExt = buildRingExterior(mats, { windowCut: [thL(-10 - 6.8), thL(-10 + 6.8), RING_R - 3.9, RING_R + 0.25] });
  ringRoot.add(ringExt.group);
  const hubExt = buildHubExterior(mats, ctx);
  hubRoot.add(hubExt.group);

  const info = {
    get mode() {
      return mode;
    },
    get warp() {
      return warp;
    },
    set warp(v) {
      warp = v;
    },
    get time() {
      return time;
    },
    sky,
    shuttle: hubExt.shuttleState,
    orbitSeconds: ORBIT_SECONDS,
    realPeriodMin: orbitPeriod() / 60,
    sunrisesPerDay: sunrisesPerDay(),
    earthDeg: earthAngularDiameter(),
    gFrac: gravityFraction(),
  };
  env.info = info;
  env.ringRootAdd = (o) => ringRoot.add(o);
  const lounge = ring.rooms.find((r) => r.id === "lounge");
  const loungeState = furnishLounge(lounge, roomKit(lounge, ring), env);
  const roomsApi = furnishRooms(ring, env);
  for (const r of ring.rooms) r.merger.build(mats, ringRoot, `room-${r.id}`);

  // ── Hub airlock + EVA gantry ──
  const eva = buildEva(ctx, mats, sfx, env, HUB_SHIFT);
  hubRoot.add(eva.group);

  // ── Lights ──
  const sunLight = new THREE.DirectionalLight(0xfff3e4, 3.2);
  scene.add(sunLight, sunLight.target);
  const hemi = new THREE.HemisphereLight(0xdde6f0, 0x3a4048, 0.32);
  scene.add(hemi);
  const pool = [0, 1, 2, 3].map(() => {
    const l = new THREE.PointLight(0xffffff, 0, 15, 1.5);
    scene.add(l);
    return l;
  });
  for (const a of ring.anchors) if (a.room?.anchorColor) a.color = a.room.anchorColor;
  const lightAnchors = [...ring.anchors];

  let inLoungeTime = 0;
  let nightLoungeTime = 0;
  const camPos = new THREE.Vector3();
  const headPos = new THREE.Vector3();
  const mHub = new THREE.Matrix4();
  const mRing = new THREE.Matrix4();
  const mTmp = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();
  const sunH = new THREE.Vector3();

  function frameMatrices(phi) {
    if (mode === "ring") {
      mRing.identity();
      mHub.makeTranslation(0, RING_R, 0).multiply(mTmp.makeRotationX(-phi));
    } else {
      mHub.makeTranslation(0, HUB_SHIFT, 0);
      mRing.copy(mHub).multiply(mTmp.makeRotationX(phi)).multiply(new THREE.Matrix4().makeTranslation(0, -RING_R, 0));
    }
    ringRoot.matrix.copy(mRing);
    hubRoot.matrix.copy(mHub);
    ringRoot.matrixWorldNeedsUpdate = true;
    hubRoot.matrixWorldNeedsUpdate = true;
  }


  // ── Mode switches (spoke lift ↔ hub airlock) ──
  const liftRoom = ring.rooms.find((r) => r.id === "lift");
  async function toHub() {
    if (mode === "hub") return;
    sfx.lift();
    await ctx.xr.fadeTo(1, 0.6);
    ctx.toast("Spoke lift · 205 m to the hub", "Spin gravity falls with radius (a = ω²r) until you float at the axis.", { tag: SCI.simplified, seconds: 5 });
    mode = "hub";
    sfx.setMode("airlock");
    frameMatrices((time * 2 * Math.PI) / SPIN_SECONDS);
    const s = eva.spawn;
    ctx.xr.place(s.x, s.z, s.yaw, 0);
    discover("orbit-freefall");
    await ctx.xr.fadeTo(0, 0.8);
  }
  async function toRing() {
    if (mode === "ring") return;
    sfx.lift();
    await ctx.xr.fadeTo(1, 0.6);
    mode = "ring";
    sfx.setMode("interior");
    eva.reset();
    frameMatrices((time * 2 * Math.PI) / SPIN_SECONDS);
    const p = roomKit(liftRoom, ring).world(7.5, 0);
    ctx.xr.place(p.x, p.z, liftRoom.side > 0 ? -Math.PI / 2 : Math.PI / 2, liftRoom.y0);
    ctx.toast("Back on the ring", "1 g again — from rotation, not from the Earth.", { seconds: 3 });
    await ctx.xr.fadeTo(0, 0.8);
  }
  env.toHub = toHub;
  env.toRing = toRing;

  // Spawn: in the lounge, facing the windows (+X).
  const sp = roomKit(lounge, ring).world(7.9, 0.0);
  const world = {
    title: "Earth orbit · Meridian Station",
    scene,
    spawn: { x: sp.x, z: sp.z, yaw: -Math.PI / 2 },
    near: 0.05,
    far: 1.2e7,
    get groundAt() {
      return mode === "ring" ? ring.groundAt : eva.groundAt;
    },
    get colliders() {
      return mode === "ring" ? ring.colliders : eva.colliders;
    },
    get interactables() {
      return mode === "ring" ? ring.interactables : eva.interactables;
    },
    get lockMove() {
      return mode === "hub";
    },
    lockTurn: false,
    info,
    /** Debug/QC hooks (scripts/orbit-qc.mjs). */
    qc: { env, toHub: () => toHub(), toRing: () => toRing(), cycleAirlock: () => eva.cycle?.(), skip: (s) => sky.advance(s) },
    onEnter() {
      sfx.setMode("interior");
      ctx.toast("Meridian Station · 400 km", "Rotating-ring station (fiction). Walk the ring; doors open with the green buttons.", { tag: SCI.fiction, seconds: 6 });
    },
    update(dt, t) {
      dt = Math.min(dt, 0.1);
      time += dt;
      const phi = (time * 2 * Math.PI) / SPIN_SECONDS;
      frameMatrices(phi);
      ctx.xr.camera.getWorldPosition(camPos);
      ctx.xr.headWorld?.(headPos) ?? headPos.copy(camPos);
      sky.advance(dt * warp);
      const sunW = sky.place(mHub, camPos);
      sunH.copy(sky.state.sunH);
      const lit = sky.state.lit;
      const eclipse = 1 - lit;
      // Sunlight: warm and dim as the Sun sets through the atmosphere.
      const edgeK = THREE.MathUtils.smoothstep(sky.state.angleFromNadir, sky.state.edge, sky.state.edge + 0.12);
      sunLight.intensity = 3.2 * lit;
      sunLight.color.setRGB(1, 0.62 + 0.33 * edgeK, 0.38 + 0.52 * edgeK);
      sunLight.target.position.copy(camPos);
      sunLight.position.copy(camPos).addScaledVector(sunW, 100);
      hemi.intensity = 0.18 + 0.14 * lit;
      // Sunlight enters the lounge only through its +X windows.
      const shade = loungeState.shadeState.t;
      mats.loungeSun.value = THREE.MathUtils.smoothstep(sunW.x, -0.05, 0.3) * (1 - shade * 0.95) * (mode === "ring" ? 1 : 0);
      // Interior light pool: nearest anchors.
      const anchors = mode === "ring" ? lightAnchors : eva.anchors;
      const sorted = anchors.map((a) => [a, tmpV.copy(a.p).applyMatrix4(mode === "ring" ? mRing : mHub).distanceToSquared(headPos)]).sort((a, b) => a[1] - b[1]);
      pool.forEach((l, i) => {
        const a = sorted[i]?.[0];
        if (!a) {
          l.intensity = 0;
          return;
        }
        l.position.copy(a.p).applyMatrix4(mode === "ring" ? mRing : mHub);
        l.color.set(a.color);
        // Eclipse: the lounge dims so the night side and city lights show through the glass.
        const dim = a.room?.lounge ? 1 - 0.55 * eclipse * (1 - shade) : 1;
        l.intensity = (a.k ?? 8) * dim * (a.on?.() ?? 1);
      });
      ring.update(dt, headPos);
      hubExt.update(dt, time, { sunH, eclipse });
      eva.update(dt, time, { eclipse });
      roomsApi.update(dt, time);
      // Dropped objects fall in the 1 g of spin gravity and land on surfaces.
      for (const g of env.grabs) {
        if (g.held || mode !== "ring") continue;
        const p = g.obj.getWorldPosition(tmpV);
        let rest = ring.groundAt(p.x, p.z);
        if (rest === null) {
          const room = ring.rooms.find((r) => Math.sign(p.x) === r.side && Math.abs(p.z - r.zc) < 7.2) ?? null;
          rest = room ? room.y0 : ringFloorY(p.z);
        }
        for (const s of env.restSurfaces) if (Math.hypot(p.x - s.x, p.z - s.z) < s.r && p.y >= s.y - 0.05) rest = Math.max(rest, s.y);
        const bottom = rest + 0.006;
        if (p.y > bottom + 0.001) {
          g.vy -= 9.87 * dt;
          const ny = Math.max(bottom, p.y + g.vy * dt);
          if (ny === bottom) {
            if (g.vy < -1) ctx.audio?.bump?.(0.3);
            g.vy = 0;
            g.obj.quaternion.slerp(new THREE.Quaternion(), 0.5);
          }
          g.obj.position.y += ny - p.y;
        }
      }
      // Discoveries that come from watching
      if (sky.state.sunrises > 0) discover("orbit-sunrise16");
      const inLounge = mode === "ring" && Math.sign(headPos.x) > 0 && Math.abs(headPos.z - lounge.zc) < 7 && Math.abs(headPos.x) > 2.4;
      inLoungeTime = inLounge ? inLoungeTime + dt : 0;
      nightLoungeTime = (inLounge || mode === "hub") && lit < 0.05 ? nightLoungeTime + dt : 0;
      if (nightLoungeTime > 4) discover("orbit-citylights");
      if (nightLoungeTime > 18) discover("orbit-aurora");
      if (inLoungeTime > 25) discover("orbit-limb");
      sfx.update(dt, { machinery: roomsApi.machinery?.(headPos) ?? 0 });
      if (env.tablet && Math.floor(time * 2) !== env.tablet.last) {
        env.tablet.last = Math.floor(time * 2);
        drawTablet(env.tablet.scr, info);
      }
    },
    dispose() {
      sfx.dispose();
      ctx.xr.fadeTo?.(0, 0.01);
    },
  };
  frameMatrices(0);
  return world;
}

function drawTablet(s, info) {
  const { g, W, H } = s;
  g.fillStyle = "#0b1622";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#8fd8ff";
  g.font = `700 ${H * 0.1}px system-ui, sans-serif`;
  g.fillText("MERIDIAN · CREW TABLET", W * 0.05, H * 0.15);
  const st = info.sky.state;
  const toNext = (() => {
    const per = info.orbitSeconds;
    const rate = (2 * Math.PI) / per;
    // phase of sunrise/sunset: angle from nadir crosses the shadow edge
    return { per, rate };
  })();
  void toNext;
  g.font = `500 ${H * 0.075}px system-ui, sans-serif`;
  g.fillStyle = "#e8edf2";
  const lines = [
    `Sun: ${st.lit > 0.5 ? "day side" : "orbital night (eclipse)"}`,
    `Over latitude ${st.latDeg.toFixed(1)}°   lon ${(st.lonDeg ?? 0).toFixed(0)}°`,
    `Sunrises seen this visit: ${st.sunrises}`,
    `Real orbit ${info.realPeriodMin.toFixed(1)} min · shown in ${(info.orbitSeconds / 60).toFixed(0)} min ×${info.warp}`,
    `Spin gravity 1.0 g · ring 2 rpm (shown slower)`,
    `Traffic: crew shuttle ${info.shuttle.phase}${info.shuttle.dist > 1 ? ` · ${info.shuttle.dist.toFixed(0)} m` : ""}`,
  ];
  lines.forEach((l, i) => g.fillText(l, W * 0.05, H * (0.32 + i * 0.11)));
  s.tex.needsUpdate = true;
}
