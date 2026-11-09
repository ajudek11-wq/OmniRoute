import * as THREE from "three";
import { byId, SCI } from "./destinations.js";
import { starSky, sun as sunSprite, interiorEnvironment } from "./common.js";
import { buildCockpit, EYE } from "./ship/cockpit.js";
import { DRAW } from "./ship/displays.js";
import { ShipSound } from "./ship/sound.js";
import { buildSpace, SUN_DIR, UNDOCK_END } from "./ship/space.js";
import { buildArrival } from "./ship/arrivals.js";
import { Mission, REAL_TRIP, FICTION_NOTE, UNDOCK_S, REJOIN_S, smooth, clamp } from "./ship/flight.js";
import { glowSprite, ramp } from "./ship/kit.js";

/**
 * The Pathfinder shuttle (fiction): the player is seated in the cockpit for the whole trip.
 * The cockpit never moves — it is the comfort reference frame — and the universe is moved around it
 * (an "outside" group carrying the inverse of the ship's pose, plus scaled-space celestial bodies).
 *
 * Legs: docked in the Meridian's bay → LAUNCH → undock → cruise (skippable) → arrival (per descent type,
 * optional free flight for orbit / rendezvous) → landed/docked → HATCH → ctx.go(to, { landed: true }).
 */

const PHASE_LABEL = { docked: "DOCKED", undock: "UNDOCKING", cruise: "CRUISE", arrival: "ARRIVAL", free: "FREE FLIGHT", rejoin: "AUTOPILOT", landed: "SECURED", exiting: "HATCH OPEN" };

const ARRIVAL_NOTES = {
  atmospheric: [["established", "Even Mars's thin CO₂ air heats an entering vehicle into a glowing plasma; Perseverance's heat shield reached about 1,300 °C."], ["established", "Fine dust makes the Martian daytime sky butterscotch-pink; sunsets there are blue."]],
  powered: [["established", "With no air to brake against, a lander must slow down entirely with its engines."], ["established", "Exhaust blows dust out on straight, ballistic paths: there is no air to make it billow."]],
  docking: [["established", "Spacecraft close the last metres to a station slowly, around 0.1 m/s, guided by cameras, lidar and alignment targets."], ["fiction", "Meridian Station is imagined."]],
  aerostat: [["established", "At about 55 km above Venus, pressure and temperature are close to Earth's at sea level."], ["hypothesis", "NASA's HAVOC study proposed crewed airships there; the gondola here is fiction."]],
  rendezvous: [["established", "Asteroids tumble: Bennu turns once every 4.3 hours. A visiting craft must match the rock's spin and drift."], ["simplified", "The rocks here are packed far closer than in the real belt."]],
  orbit: [["established", "Orbit insertion is a braking burn: Juno fired for 35 minutes at Jupiter (2016), Cassini for 96 minutes at Saturn (2004)."], ["fiction", "The observation platform is imagined."]],
  parachute: [["established", "Huygens drifted down under parachutes for about 2.5 hours through Titan's orange haze (2005)."], ["established", "Titan's dense air and low gravity make parachute landings gentle."]],
  jump: [["fiction", "The fold drive is invented: nothing known can cross light-years. This transition is a visual metaphor."]],
};

const ARRIVAL_LABEL = { atmospheric: "ENTRY", powered: "DESCENT", docking: "APPROACH", aerostat: "CLOUD DIVE", rendezvous: "RENDEZVOUS", orbit: "ORBIT INSERTION", parachute: "ENTRY", jump: "FOLD" };

export async function build(ctx) {
  const { renderer, xr, tier, audio } = ctx;
  const to = ctx.opts?.to && byId[ctx.opts.to] ? ctx.opts.to : "moon";
  const dest = byId[to];
  const type = dest.descent;
  const mission = new Mission({ to, descent: type });
  const snd = new ShipSound(audio);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 1e8, 2e8); // always present so fog changes never recompile shaders

  // ── Cockpit (fixed at the origin) ──
  const cp = buildCockpit({ renderer, tier });
  scene.add(cp.group);
  scene.add(cp.throttle.proxy, cp.stick.proxy);

  // ── Sky, Sun, light ──
  const stars = starSky({ tier });
  scene.add(stars.group);
  const sol = sunSprite({ dir: SUN_DIR, angDeg: 0.53, distance: 8.0e6 });
  scene.add(sol.group);
  const sunLight = new THREE.DirectionalLight(0xfff3e4, 3.0);
  scene.add(sunLight, sunLight.target);
  if (tier !== "low") {
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(tier === "high" ? 2048 : 1024, tier === "high" ? 2048 : 1024);
    const c = sunLight.shadow.camera;
    c.left = -2.4;
    c.right = 2.4;
    c.top = 2.4;
    c.bottom = -2.4;
    c.near = 0.5;
    c.far = 12;
    sunLight.shadow.bias = -0.0008;
    sunLight.shadow.normalBias = 0.02;
  }
  const hemi = new THREE.HemisphereLight(0x8fa4bc, 0x24211f, 0.35);
  scene.add(hemi);
  const fxLight = new THREE.PointLight(0xff9a50, 0, 80, 1.2); // plasma / retro-burn / bay floods
  scene.add(fxLight);
  renderer.shadowMap.needsUpdate = true;

  // ── Outside: departure + cruise scenery and the arrival ──
  const outside = new THREE.Group();
  scene.add(outside);
  const space = buildSpace(ctx, interiorEnvironment(renderer));
  outside.add(space.group);
  scene.add(space.sky, space.motes);
  const arrival = buildArrival(type, to, ctx);
  arrival.group.visible = false;
  arrival.sky.visible = false;
  outside.add(arrival.group);
  scene.add(arrival.sky, arrival.shipFx);
  arrival.shipFx.visible = false;

  // Flight markers: target ring and boresight (world-space so they are correct in stereo)
  const ringTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    g.strokeStyle = "#ffffff";
    g.lineWidth = 7;
    g.beginPath();
    g.arc(64, 64, 52, 0, Math.PI * 2);
    g.stroke();
    for (const a of [0, 1, 2, 3]) {
      g.save();
      g.translate(64, 64);
      g.rotate((a * Math.PI) / 2);
      g.fillStyle = "#fff";
      g.fillRect(-3, -64, 6, 18);
      g.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const mkMarker = (color) => new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
  const targetMark = mkMarker(0x7fffb0);
  const boreMark = mkMarker(0xffc27a);
  boreMark.material.rotation = Math.PI / 4;
  scene.add(targetMark, boreMark);
  const engineGlow = glowSprite("#ffb070", 3, 0); // seen in the lower windows during burns
  engineGlow.position.set(0, -2.2, -1.5);
  scene.add(engineGlow);

  // ── Ship state ──
  const ship = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), qInv: new THREE.Quaternion() };
  const prevQ = new THREE.Quaternion();
  const freeV = new THREE.Vector3();
  const manualQ = new THREE.Quaternion(); // attitude offset while manual in landing/docking legs
  const cruiseQ = new THREE.Quaternion(); // manual heading in cruise
  let rejoinFrom = null;
  let frame = "space";
  let throttle = 0;
  let thrTarget = 0;
  let thrHeld = false;
  let stickHeld = false;
  let stickIn = { x: 0, y: 0 };
  let skipHold = 0;
  let skipArmed = 0;
  let calibrated = false;
  let farT = 0;
  let screenT = 0;
  let shadowT = 0;
  let speed = 0;
  let vs = 0;
  let lastPos = new THREE.Vector3();
  let fading = false;
  let landedT = 0;
  let exiting = false;
  let msg = { title: "Pathfinder · Bay 2", text: "Press LAUNCH to undock." };
  let toastCool = 0;
  const lookAtQ = (dir, out = new THREE.Quaternion()) => out.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, new THREE.Vector3(0, 1, 0)));
  const cruiseBaseQ = lookAtQ(space.targetDir());
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tq = new THREE.Quaternion();

  function say(title, text = "", seconds = 4) {
    msg = { title, text };
    if (toastCool <= 0 || seconds > 4) ctx.toast(title, text, { seconds });
    toastCool = 1.2;
  }

  // ── Buttons ──
  const B = Object.fromEntries(cp.buttons.map((b) => [b.id, b]));
  function press(id) {
    const b = B[id];
    if (b) b.press = 1;
    let ok = true;
    switch (id) {
      case "launch":
        ok = mission.launch();
        if (ok) {
          say("Undocking", "Clamps released. Gentle thrust out of the bay.");
          snd.burst({ freq: 220, dur: 0.8, gain: 0.5 });
        }
        break;
      case "auto":
        ok = mission.flying;
        if (ok) {
          mission.setAuto(true);
          say("Autopilot engaged", mission.phase === "rejoin" ? "Returning to the approach path." : "The flight computer has the controls.");
        }
        break;
      case "manual":
        ok = mission.flying && mission.phase !== "undock";
        if (ok) {
          mission.setAuto(false);
          thrTarget = throttle;
          say("Manual control", mission.phase === "free" ? "Fly freely: stick or right thumbstick to turn, throttle to move. AUTOPILOT docks." : "Steer the amber diamond onto the green ring. Throttle sets the pace.");
        }
        break;
      case "land":
        ok = mission.phase === "arrival" || mission.phase === "free" || mission.phase === "rejoin";
        if (ok) {
          mission.land();
          say(ARRIVALS_WORD(type), "Computer flying the final approach.");
        }
        break;
      case "hatch":
        ok = mission.phase === "landed" && !exiting;
        if (ok) openHatch();
        break;
      case "skip":
        ok = mission.phase === "undock" || mission.phase === "cruise" || mission.phase === "arrival" || mission.phase === "free" || mission.phase === "rejoin";
        if (ok) {
          if (skipArmed > 0) doSkip();
          else {
            skipArmed = 3;
            say("Skip?", "Hold SKIP (or press it again) to jump ahead.");
          }
        }
        break;
      case "cabin":
        cabinOn = !cabinOn;
        cp.cabinSwitch.holder.rotation.x = (cabinOn ? 0.42 : 0.42) + (cabinOn ? 0 : 0.5);
        break;
      default:
        break;
    }
    snd.click(ok);
  }
  let cabinOn = true;
  const ARRIVALS_WORD = (t) => (["atmospheric", "powered", "parachute"].includes(t) ? "Landing" : "Docking");

  async function doSkip() {
    skipArmed = 0;
    skipHold = 0;
    if (fading) return;
    fading = true;
    await xr.fadeTo(1, 0.35);
    const wasCruise = mission.phase === "undock" || mission.phase === "cruise";
    mission.skip();
    if (wasCruise) enterArrival();
    await xr.fadeTo(0, 0.5);
    fading = false;
  }

  async function openHatch() {
    exiting = true;
    mission.phase = "exiting";
    snd.hatch();
    say("Hatch opening", to === "mars" ? "Welcome to Frontier Base." : `Welcome to ${dest.name}.`);
    cp.hatch.target = 1;
    setTimeout(() => ctx.go(to, { landed: true, from: "ship" }), 2600);
  }

  function enterArrival() {
    frame = "arrival";
    space.group.visible = false;
    space.sky.visible = false;
    space.motes.visible = false;
    arrival.group.visible = true;
    arrival.sky.visible = true;
    arrival.shipFx.visible = true;
    manualQ.identity();
    renderer.shadowMap.needsUpdate = true;
  }

  async function legTransition() {
    if (fading) return;
    fading = true;
    await xr.fadeTo(1, 0.4);
    enterArrival();
    say(ARRIVAL_LABEL[type] ?? "Arrival", dest.site);
    await xr.fadeTo(0, 0.7);
    fading = false;
  }

  // ── Interactables ──
  const interactables = [
    ...cp.buttons.map((b) => ({ object: b.pick, label: Array.isArray(b.label) ? b.label.join(" ") : b.label, poke: true, pokeRadius: 0.034, onPoke: () => press(b.id), onSelect: () => press(b.id) })),
    { object: cp.cabinSwitch.pick, label: "Cabin lights", poke: true, pokeRadius: 0.03, onPoke: () => press("cabin"), onSelect: () => press("cabin") },
    {
      object: cp.throttle.proxy,
      label: "Throttle",
      grab: true,
      grabRadius: 0.13,
      onGrab: () => {
        thrHeld = true;
        if (mission.flying && mission.auto && mission.phase !== "undock") press("manual");
      },
      onRelease: () => (thrHeld = false),
    },
    {
      object: cp.stick.proxy,
      label: "Flight stick",
      grab: true,
      grabRadius: 0.13,
      onGrab: () => {
        stickHeld = true;
        if (mission.flying && mission.auto && mission.phase !== "undock") press("manual");
      },
      onRelease: () => (stickHeld = false),
    },
  ];

  // Desktop keys: W/S throttle, arrows pitch/yaw, 1–6 buttons, Space hold = skip
  const keyIds = { Digit1: "launch", Digit2: "auto", Digit3: "manual", Digit4: "land", Digit5: "hatch", Digit6: "skip", KeyL: "launch" };
  const onKey = (e) => {
    if (e.repeat || xr.presenting) return;
    if (keyIds[e.code]) press(keyIds[e.code]);
  };
  addEventListener("keydown", onKey);

  // ── Per-frame helpers ──
  const knob = new THREE.Vector3();
  function updateLevers(dt) {
    const T = cp.throttle;
    const S = cp.stick;
    // Throttle: follow the hand along the lever's arc while held.
    if (thrHeld) {
      T.proxy.getWorldPosition(tmp);
      tmp.sub(T.pivot.position);
      const ang = clamp(Math.atan2(-tmp.z, Math.max(0.02, tmp.y)), -T.range, T.range);
      thrTarget = (ang + T.range) / (2 * T.range);
    } else if (mission.auto && mission.flying) {
      thrTarget = autoThrottle();
    }
    throttle += (thrTarget - throttle) * Math.min(1, dt * (thrHeld ? 20 : 3));
    T.pivot.rotation.x = -(throttle * 2 - 1) * T.range;
    if (!thrHeld) {
      T.proxy.position.copy(T.pivot.localToWorld(knob.set(0.022, 0.16, 0)));
      T.proxy.quaternion.identity();
    }
    // Stick: tilt toward the hand while held, spring back when released.
    if (stickHeld) {
      S.proxy.getWorldPosition(tmp);
      tmp.sub(S.pivot.position);
      stickIn.y = clamp(Math.atan2(-tmp.z, Math.max(0.02, tmp.y)) / S.range, -1, 1);
      stickIn.x = clamp(Math.atan2(tmp.x, Math.max(0.02, tmp.y)) / S.range, -1, 1);
    } else {
      stickIn.x *= Math.exp(-dt * 10);
      stickIn.y *= Math.exp(-dt * 10);
    }
    S.pivot.rotation.set(-stickIn.y * S.range, 0, -stickIn.x * S.range);
    if (!stickHeld) {
      S.proxy.position.copy(S.pivot.localToWorld(knob.set(0, 0.14, 0)));
      S.proxy.quaternion.identity();
    }
  }

  function autoThrottle() {
    if (mission.phase === "cruise") return 0.85;
    if (mission.phase === "arrival" || mission.phase === "rejoin") return 0.25 + arrival.thrust * 0.7;
    return 0.2;
  }

  /** Steering input −1..1 from the physical stick, thumbsticks or arrow keys. x = yaw right, y = nose down. */
  function steerInput(dt) {
    let x = stickIn.x;
    let y = stickIn.y;
    const R = xr.hands?.right?.pad;
    const L = xr.hands?.left?.pad;
    if (R && Math.abs(R.stick.x) + Math.abs(R.stick.y) > 0) {
      x += R.stick.x;
      y += R.stick.y;
    }
    if (L && mission.flying && !thrHeld && Math.abs(L.stick.y) > 0) thrTarget = clamp(thrTarget + L.stick.y * dt * 0.6, 0, 1);
    if (!xr.presenting && xr.keys) {
      const k = xr.keys;
      if (k.has("ArrowLeft")) x -= 1;
      if (k.has("ArrowRight")) x += 1;
      if (k.has("ArrowUp")) y += 1;
      if (k.has("ArrowDown")) y -= 1;
      if (k.has("KeyW")) thrTarget = clamp(thrTarget + dt * 0.5, 0, 1);
      if (k.has("KeyS")) thrTarget = clamp(thrTarget - dt * 0.5, 0, 1);
      if ((k.has("KeyW") || k.has("KeyS")) && mission.auto && mission.flying && mission.phase !== "undock" && mission.phase !== "free") {
        mission.setAuto(false);
        say("Manual control", "Throttle sets the pace. Arrow keys steer.");
      }
    }
    return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
  }

  const ROT_RATE = 0.26; // rad/s at full deflection (~15°/s, comfortable)
  function applyRotation(q, inp, dt, k = 1) {
    if (!inp.x && !inp.y) return;
    tq.setFromAxisAngle(tmp.set(0, 1, 0), -inp.x * ROT_RATE * dt * k);
    q.multiply(tq);
    tq.setFromAxisAngle(tmp.set(1, 0, 0), -inp.y * ROT_RATE * dt * k);
    q.multiply(tq);
    q.normalize();
  }

  // Undock path: back off the cradle, out of the bay, then turn toward the target.
  const undockPath = (s, pos, q) => {
    const a = smooth(clamp(s / 0.55, 0, 1));
    const b = smooth(clamp((s - 0.45) / 0.55, 0, 1));
    pos.set(0, 0.3 * smooth(s * 8), 0).lerp(tmp2.set(0, 2, -42), a * a);
    pos.lerp(UNDOCK_END, b);
    q.identity().slerp(cruiseBaseQ, smooth(clamp((s - 0.42) / 0.58, 0, 1)));
  };

  function shipPose(dt, inp) {
    const ph = mission.phase;
    if (frame === "space") {
      if (ph === "docked") {
        ship.pos.set(0, 0, 0);
        ship.q.identity();
      } else if (ph === "undock") undockPath(mission.s, ship.pos, ship.q);
      else if (ph === "cruise") {
        space.cruisePos(mission.s, ship.pos);
        if (mission.auto) cruiseQ.slerp(cruiseBaseQ, Math.min(1, dt * 0.6));
        else applyRotation(cruiseQ, inp, dt);
        ship.q.copy(cruiseQ);
      }
      return;
    }
    // Arrival frame
    if (ph === "free") {
      applyRotation(ship.q, inp, dt);
      const vmax = type === "orbit" ? 80 : 25;
      const fwd = tmp.set(0, 0, -1).applyQuaternion(ship.q);
      freeV.lerp(fwd.multiplyScalar(throttle * vmax), Math.min(1, dt * 0.8));
      ship.pos.addScaledVector(freeV, dt);
      const c = arrival.freeCenter ?? arrival.target;
      const R = arrival.freeRadius ?? 3000;
      tmp.copy(ship.pos).sub(c);
      if (tmp.length() > R) ship.pos.copy(c).addScaledVector(tmp.normalize(), R);
      return;
    }
    if (ph === "rejoin") {
      if (!rejoinFrom) rejoinFrom = { p: ship.pos.clone(), q: ship.q.clone() };
      const k = smooth(clamp(mission.t / REJOIN_S, 0, 1));
      const hs = arrival.hold ?? mission.s;
      arrival.path.pos(hs, tmp);
      arrival.path.quat(hs, tq);
      ship.pos.copy(rejoinFrom.p).lerp(tmp, k);
      ship.q.copy(rejoinFrom.q).slerp(tq, k);
      return;
    }
    rejoinFrom = null;
    const s = ph === "landed" || ph === "exiting" ? 1 : mission.s;
    arrival.path.pos(s, ship.pos);
    arrival.path.quat(s, ship.q);
    if (arrival.poseExtra) arrival.poseExtra(s, ship);
    // Manual trim: attitude offset that the computer phases out near the end.
    if (!mission.auto && ph === "arrival") applyRotation(manualQ, inp, dt, 0.6);
    else manualQ.slerp(tq.identity(), Math.min(1, dt * 0.8));
    const fade = 1 - ramp(s, 0.82, 0.96);
    tq.identity().slerp(manualQ, fade);
    ship.q.multiply(tq);
    freeV.set(0, 0, 0);
  }

  // ── Displays ──
  function displayState() {
    const ph = mission.phase;
    const inSpace = frame === "space";
    const targetW = inSpace ? space.state.targetPos : arrival.target;
    tmp.copy(targetW).sub(ship.pos).applyQuaternion(ship.qInv);
    const dist = inSpace ? space.state.dist ?? tmp.length() : tmp.length();
    const angle = tmp.angleTo(tmp2.set(0, 0, -1));
    // attitude relative to the frame's up (or the trajectory in space)
    const up = tmp2.set(0, 1, 0).applyQuaternion(ship.qInv);
    const pitch = Math.asin(clamp(up.z, -1, 1));
    const roll = Math.atan2(-up.x, up.y);
    const fwdW = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.q);
    let brief;
    if (ph === "docked") brief = [["info", "Press LAUNCH on the panel below the glare shield."], ["info", "AUTOPILOT can fly every leg. MANUAL: throttle (left), stick (right) or thumbsticks."], ["fiction", "The Pathfinder shuttle and the survey ship Meridian are imagined."]];
    else if (ph === "undock" || ph === "cruise") brief = [...(REAL_TRIP[to] ?? []).map((t) => ["established", t]), ["fiction", FICTION_NOTE], ["simplified", "Range shown is a typical Earth–destination distance."]];
    else brief = [...(ARRIVAL_NOTES[type] ?? []), ...(ph === "free" ? [["info", "Free flight: AUTOPILOT or LAND/DOCK finishes docking."]] : [])];
    const legLabel = ph === "cruise" ? (mission.auto ? "Autopilot cruise · hold SKIP to jump ahead" : "Manual · align the diamond with the ring") : "";
    return {
      phaseLabel: ph === "arrival" ? ARRIVAL_LABEL[type] : PHASE_LABEL[ph] ?? ph.toUpperCase(),
      auto: mission.auto,
      destName: dest.name,
      site: dest.site,
      target: { angle, dx: tmp.x, dy: tmp.y },
      pitch,
      roll,
      heading: Math.atan2(-fwdW.x, -fwdW.z),
      space: inSpace || !arrival.landing,
      brief,
      briefTitle: ph === "cruise" || ph === "undock" ? "REAL TRAVEL TIME" : ph === "docked" ? "MISSION" : "SCIENCE",
      range: ph === "docked" ? space.state.range0 : dist,
      rangeLabel: inSpace ? `TO ${dest.name.toUpperCase()}` : arrival.landing ? "TO PAD" : "TO PORT",
      eta: ph === "docked" || ph === "landed" ? NaN : ph === "free" ? NaN : mission.eta(),
      alt: !inSpace && arrival.landing ? arrival.alt : null,
      progress: mission.s,
      legLabel,
      speed,
      vs: !inSpace && arrival.landing ? vs : null,
      speedLabel: inSpace && ph === "cruise" ? "SPEED (FICTION)" : "SPEED",
      throttle,
      engine: arrival.contact && !inSpace ? "CONTACT" : (!inSpace && arrival.thrust > 0.1) || ph === "free" ? "BURN" : ph === "cruise" ? "CRUISE" : "SAFE",
      contact: !inSpace && arrival.contact,
      fiction: inSpace && ph === "cruise",
    };
  }

  function updateButtons(dt, t) {
    const ph = mission.phase;
    const blink = Math.sin(t * 5) > 0;
    const st = {
      launch: { on: ph === "docked" && blink, en: ph === "docked" },
      auto: { on: mission.flying && mission.auto, en: mission.flying },
      manual: { on: mission.flying && !mission.auto, en: mission.flying && ph !== "undock" },
      land: { on: (ph === "free" || (ph === "arrival" && arrival.hold != null && Math.abs(mission.s - arrival.hold) < 1e-5)) && blink, en: ph === "arrival" || ph === "free" || ph === "rejoin" },
      hatch: { on: ph === "landed" && blink, en: ph === "landed" },
      skip: { on: skipArmed > 0 || skipHold > 0, en: mission.flying },
    };
    for (const b of cp.buttons) {
      const s = st[b.id];
      b.led.material.color.copy(s.on ? b.ledColor : s.en ? tmp.set(0.12, 0.12, 0.12) : tmp.set(0.03, 0.03, 0.03));
      b.capMat.emissiveIntensity = s.en ? 0.5 : 0.12;
      b.press = Math.max(0, b.press - dt * 4);
      b.cap.position.z = 0.012 - Math.sin(Math.min(1, b.press) * Math.PI) * 0.006;
    }
  }

  // SKIP hold: a fingertip resting on the button, or Space held on desktop
  function updateSkip(dt) {
    if (skipArmed > 0) skipArmed -= dt;
    let held = false;
    if (!xr.presenting) held = !!xr.keys?.has("Space");
    else {
      B.skip.pick.getWorldPosition(tmp);
      for (const h of Object.values(xr.hands ?? {})) if (h.glove && h.glove.tipWorld(tmp2).distanceTo(tmp) < 0.045) held = true;
    }
    if (held && mission.flying) {
      skipHold += dt;
      B.skip.press = 0.6;
      if (skipHold > 1.2) doSkip();
    } else skipHold = 0;
  }

  // ── The world adapter ──
  const world = {
    title: `Pathfinder · to ${dest.name}`,
    scene,
    spawn: { x: 0, z: 0, yaw: 0, y: 0 },
    eye: EYE.y,
    near: 0.03,
    far: 2.0e7,
    lockMove: true,
    lockTurn: true,
    groundAt: (x, z) => (Math.abs(x) < 0.9 && z > -0.9 && z < 3 ? 0 : null),
    colliders: [],
    interactables,
    // QC hooks (scripts/ship-qc.mjs): inspect and jump through the mission.
    debug: {
      mission,
      press,
      get frame() {
        return frame;
      },
      jump(phase, s = 0, auto = true) {
        if (!["docked", "undock", "cruise"].includes(phase) && frame === "space") enterArrival();
        mission.phase = phase;
        mission.s = s;
        mission.t = 0;
        mission.auto = auto;
      },
      get throttle() {
        return throttle;
      },
    },
    onEnter() {
      say("Pathfinder · docked in Bay 2", `Destination: ${dest.name}. Press LAUNCH.`, 6);
    },
    update(dt, t) {
      toastCool -= dt;
      // Seat the VR player: put their head at the seated eye point once tracking is live.
      if (xr.presenting) {
        const cam = xr.camera.position;
        const head = xr.headWorld(tmp);
        const off = head.distanceTo(EYE);
        farT = off > 0.45 ? farT + dt : 0;
        if ((!calibrated && cam.y > 0.3) || farT > 2) {
          xr.place(EYE.x, EYE.z, 0, EYE.y - cam.y);
          calibrated = true;
          farT = 0;
        }
      } else calibrated = false;

      const inp = steerInput(dt);
      updateLevers(dt);
      updateSkip(dt);
      if (!fading) {
        // Mission progress
        const align = (() => {
          if (mission.phase !== "cruise") return 1;
          const d = tmp.copy(space.state.targetPos).sub(ship.pos).normalize();
          const f = tmp2.set(0, 0, -1).applyQuaternion(ship.q);
          return clamp((f.dot(d) - 0.5) / 0.5, 0, 1);
        })();
        const prevPhase = mission.phase;
        mission.update(dt, { throttle, align });
        for (const e of mission.drain()) onEvent(e);
        if (prevPhase === "cruise" && mission.phase === "arrival" && frame === "space") legTransition();
      }
      prevQ.copy(ship.q);
      lastPos.copy(ship.pos);
      shipPose(dt, inp);
      ship.qInv.copy(ship.q).invert();
      // Speeds (display): real motion of the ship in its frame; cruise speed from the range shrinking
      if (dt > 0) {
        const v = lastPos.distanceTo(ship.pos) / dt;
        if (v < 1e12) speed += (v - speed) * Math.min(1, dt * 3);
        vs += ((ship.pos.y - lastPos.y) / dt - vs) * Math.min(1, dt * 3);
      }
      // Outside transform = inverse ship pose
      outside.quaternion.copy(ship.qInv);
      outside.position.copy(ship.pos).negate().applyQuaternion(ship.qInv);
      stars.group.quaternion.copy(ship.qInv);
      const sunW = frame === "space" ? SUN_DIR : arrival.sunDir;
      const sunS = tmp.copy(sunW).applyQuaternion(ship.qInv);
      sol.group.position.copy(sunS).multiplyScalar(8.0e6);
      sunLight.position.copy(sunS).multiplyScalar(6).add(EYE);
      sunLight.target.position.copy(EYE);
      // Scenery
      if (frame === "space") {
        const inBay = mission.phase === "docked" || (mission.phase === "undock" && mission.s < 0.3);
        const bayK = mission.phase === "docked" ? 1 : mission.phase === "undock" ? 1 - ramp(mission.s, 0.12, 0.32) : 0;
        sunLight.intensity = 3.0 * (1 - bayK * 0.85);
        fxLight.color.set(0xd8e8ff);
        fxLight.intensity = bayK * 30;
        fxLight.position.set(0, 4, -2);
        space.setSun(sunS);
        space.update(ship, dt, { cruiseK: mission.phase === "cruise" ? Math.min(1, mission.t / 3) * (1 - ramp(mission.s, 0.9, 1)) : 0, speed: 20 + 60 * (mission.auto ? 1 : throttle), t });
        stars.setBrightness(1 - bayK * 0.7);
        snd.set("engine", mission.phase === "undock" ? 0.25 + 0.3 * Math.sin(Math.PI * mission.s) : mission.phase === "cruise" ? 0.18 + throttle * 0.25 : 0);
        snd.set("plasma", 0);
        snd.set("wind", 0);
        engineGlow.material.opacity = 0;
        void inBay;
      } else {
        arrival.update(mission.phase === "landed" || mission.phase === "exiting" ? 1 : mission.s, dt, ship, t, scene, mission.phase);
        sunLight.intensity = arrival.sunI ?? 3.0;
        hemi.intensity = arrival.hemiI ?? 0.35;
        stars.setBrightness(arrival.starK ?? 1);
        if (arrival.fog) {
          scene.fog.color.set(arrival.fog.color);
          scene.fog.near = arrival.fog.near;
          scene.fog.far = arrival.fog.far;
        } else {
          scene.fog.near = 1e8;
          scene.fog.far = 2e8;
        }
        const burn = arrival.thrust;
        const plasma = arrival.plasma ?? 0;
        fxLight.color.set(plasma > burn ? 0xff8040 : 0xffb070);
        fxLight.position.set(0, plasma > burn ? 0.5 : -3, plasma > burn ? -3 : -0.5);
        fxLight.intensity = plasma * (18 + 8 * Math.sin(t * 23) * Math.sin(t * 7.1)) + burn * 14;
        engineGlow.material.opacity = burn * 0.8;
        engineGlow.scale.setScalar(2.5 + burn * 2 + Math.sin(t * 40) * 0.2);
        snd.set("engine", Math.max(burn, mission.phase === "free" ? throttle * 0.6 : 0.05));
        snd.set("plasma", plasma);
        snd.set("wind", arrival.wind ?? 0);
        // Buffet: no camera shake — subtle vibration of the loose levers and haptics only.
        const bf = arrival.buffet ?? 0;
        if (bf > 0.02) {
          cp.stick.pivot.rotation.z += Math.sin(t * 37) * 0.01 * bf;
          cp.throttle.pivot.rotation.z = Math.sin(t * 29) * 0.006 * bf;
          if (xr.presenting && Math.random() < dt * 6) for (const h of Object.values(xr.hands ?? {})) h.source?.gamepad?.hapticActuators?.[0]?.pulse?.(0.15 * bf, 40)?.catch?.(() => {});
        }
      }
      // Markers
      const showMarks = mission.phase === "cruise" || mission.phase === "arrival" || mission.phase === "free" || mission.phase === "rejoin" || mission.phase === "undock";
      const targetW = frame === "space" ? space.state.targetPos : arrival.markTarget ?? arrival.target;
      tmp.copy(targetW).sub(ship.pos).applyQuaternion(ship.qInv);
      const td = tmp.length();
      const md = clamp(td * 0.5, 6, 250);
      targetMark.position.copy(tmp).multiplyScalar(md / Math.max(1e-3, td)).add(EYE);
      targetMark.scale.setScalar(md * 0.06);
      targetMark.visible = showMarks && !(frame !== "space" && arrival.landing && mission.s > 0.8);
      targetMark.material.opacity = mission.auto ? 0.35 : 0.95;
      boreMark.position.set(0, EYE.y, -md);
      boreMark.scale.setScalar(md * 0.035);
      boreMark.visible = showMarks && !mission.auto;
      // Comfort vignette from the ship's rotation (the view itself is never rotated by force).
      if (dt > 0) {
        const w = 2 * Math.acos(clamp(Math.abs(prevQ.dot(ship.q)), 0, 1)) / dt;
        const near = frame !== "space" || mission.phase === "undock" ? clamp(speed / 30, 0, 1) : 0;
        const k = Math.max(0, w - 0.08) * 0.35 + near * 0.2;
        if (k > 0) xr.artificial = (xr.artificial ?? 0) + dt * (0.4 + k / 0.22);
      }
      // Hatch animation and cabin lights
      const H = cp.hatch;
      H.open += (H.target - H.open) * Math.min(1, dt * 1.2);
      H.hinge.rotation.y = -H.open * 1.75;
      H.lamp.material.color.set(mission.phase === "landed" || exiting ? 0x5dff9a : 0xff4a3a);
      cp.lights.cabin.intensity = cabinOn ? 1.6 : 0.15;
      cp.lights.foot.intensity = cabinOn ? 0.5 : 0.1;
      updateButtons(dt, t);
      // Screens at ~8 Hz
      screenT -= dt;
      if (screenT <= 0) {
        screenT = 0.12;
        const st = displayState();
        cp.screens.forEach((s, i) => {
          DRAW[i](s, st);
          s.tex.needsUpdate = true;
        });
      }
      // Shadows only when the light direction actually changed
      shadowT -= dt;
      if (tier !== "low" && shadowT <= 0 && prevQ.angleTo(ship.q) > 1e-5) {
        renderer.shadowMap.needsUpdate = true;
        shadowT = 0.1;
      }
      if (mission.phase === "landed") {
        landedT += dt;
        if (landedT > 45 && !exiting) openHatch(); // accessibility: never strand a player who does not press HATCH
      }
      snd.update(dt);
    },
    dispose() {
      removeEventListener("keydown", onKey);
      snd.dispose();
      arrival.dispose?.();
      renderer.shadowMap.needsUpdate = true;
    },
  };

  function onEvent(e) {
    switch (e) {
      case "phase:cruise":
        cruiseQ.copy(ship.q);
        say("Cruise", `Course set for ${dest.name}. The real trip takes far longer; see the mission screen.`, 5);
        break;
      case "phase:free":
        say("Free flight", "Fly around as long as you like. AUTOPILOT or LAND/DOCK finishes docking.", 6);
        break;
      case "phase:rejoin":
        say("Autopilot", "Returning to the approach path.");
        break;
      case "phase:landed":
        if (arrival.landing) snd.thud();
        else snd.latch();
        say(arrival.landing ? "Touchdown" : "Docked", "Press HATCH to disembark.", 6);
        ctx.discover?.({ id: `ship-${to}-arrival`, title: `Pathfinder arrival: ${dest.name}`, short: arrival.landing ? "Touchdown" : "Docked", text: `You flew the Pathfinder shuttle to ${dest.site}. The shuttle and its speed are fiction.`, sci: "fiction", dest: to });
        break;
      case "entry":
        say("Atmospheric entry", "Plasma around the hull: the air ahead is compressed and heated.");
        break;
      case "sky":
        say("The sky turns pink", "Fine dust scatters sunlight. Heat shield away, preparing the retro-burn.");
        break;
      case "retro":
        say("Retro-burn", "Engines firing to slow the descent.");
        break;
      case "dust":
        say(type === "powered" ? "Dust sheet" : "Dust kick-up", type === "powered" ? "In vacuum the exhaust throws dust out on straight, ballistic paths." : "The exhaust raises a billowing dust cloud.");
        break;
      case "contact":
        say("Contact light", "Probes touching the surface.");
        snd.click(true);
        break;
      case "chute":
        snd.chuteSnap();
        say("Parachute deployed", "Look up through the upper windows.");
        break;
      case "pitchover":
        say("Pitch-over", "The landing site comes into view ahead.");
        break;
      case "deorbit":
        say("Powered descent", "Black sky, no air: braking with engines only.");
        break;
      default:
        arrival.event?.(e, snd, say);
    }
  }

  return world;
}
