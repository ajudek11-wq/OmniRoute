/**
 * Pure manual-driving rules for the FR-1 rover. No THREE, no DOM: unit-tested in Node.
 *
 * Conventions match the rest of the world: +x east, −z north, heading 0 faces +z and
 * forward = (sin heading, cos heading). Steering right (+1) turns clockwise seen from above,
 * which LOWERS the heading (same as dragging the view right in the walker).
 *
 * Speeds are deliberately stylised. Real Mars rovers crawl at ~0.04 m/s (Perseverance tops out
 * near 0.12 m/s); at that pace a drive across the settlement would take an hour, so FR-1 is a
 * crewed-era utility rover tuned to ~7 m/s (25 km/h) — brisk on a phone, still heavy-feeling.
 */
import { resolveCircles } from "./movement.js";

export const DRIVE = {
  maxSpeed: 7, // m/s forward
  maxReverse: 2.6, // m/s backwards
  accel: 3.2, // m/s² motor acceleration at full throttle (0→7 m/s in ~2.5 s)
  brake: 7, // m/s² when the throttle opposes the motion
  coast: 2.2, // m/s² rolling resistance + regen braking when the stick is released
  turnRate: 0.95, // rad/s at full steer once rolling
  pivotRate: 0.6, // rad/s at full steer while standing still (skid-steer point turn)
  yawResponse: 6, // 1/s: how quickly the yaw rate follows the stick
  radius: 2.6, // m: collision radius of the rover body
  maxSlope: 0.62, // rise per metre: steeper faces (canyon walls, mesa sides) stop the rover
  gravity: 3.71, // m/s² Martian gravity, slows climbs / speeds descents under power
  worldLimit: 900, // m from the settlement centre
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Fresh driving state, e.g. from the rover's current pose. */
export function driveState(x = 0, z = 0, heading = 0, speed = 0) {
  return { x, z, heading, speed, yawRate: 0, blocked: false, moving: false, travelled: 0, step: 0, accel: 0 };
}

/**
 * Advance the rover one frame.
 * input: { throttle, steer } in [-1, 1] (throttle +1 = forward, steer +1 = turn right),
 *        optional { brake: true } forces a stop.
 * groundAt(x, z) → terrain height. circles: [{x, z, r}] colliders. Mutates and returns state.
 */
export function stepRover(state, input, dt, groundAt, circles = []) {
  const D = DRIVE;
  const throttle = input.brake ? 0 : clamp(input.throttle ?? 0, -1, 1);
  const steer = clamp(input.steer ?? 0, -1, 1);
  const v0 = state.speed;

  // ── Longitudinal: motor, brakes, rolling resistance, gravity along the slope ──
  let a;
  if (input.brake) {
    a = -Math.sign(v0) * D.brake;
  } else if (throttle !== 0 && Math.sign(throttle) !== Math.sign(v0) && Math.abs(v0) > 0.05) {
    a = -Math.sign(v0) * D.brake; // stick pulled against the motion: brake first
  } else if (throttle !== 0) {
    const top = throttle > 0 ? throttle * D.maxSpeed : throttle * D.maxReverse;
    const err = top - v0;
    a = clamp(err * 3, -D.accel, D.accel);
    // Under power the drivetrain feels the slope: climbs slow you, descents pull (either way).
    const h0 = groundAt(state.x, state.z);
    const ahead = groundAt(state.x + Math.sin(state.heading), state.z + Math.cos(state.heading));
    a -= D.gravity * clamp(ahead - h0, -0.5, 0.5) * 0.6;
  } else {
    a = -Math.sign(v0) * D.coast;
  }
  let v = v0 + a * dt;
  // Braking or coasting never flips the direction of travel.
  if ((throttle === 0 || input.brake || Math.sign(throttle) !== Math.sign(v0)) && Math.sign(v) !== Math.sign(v0) && v0 !== 0) v = 0;
  v = clamp(v, -D.maxReverse, D.maxSpeed);
  if (Math.abs(v) < 1e-4) v = 0;

  // ── Yaw: point-turn at rest, car-like steering when rolling (reversed in reverse) ──
  const roll = clamp(Math.abs(v) / 3, 0, 1);
  const highSpeedDamp = 1 - 0.35 * clamp((Math.abs(v) - 4) / (D.maxSpeed - 4), 0, 1);
  const dir = v < 0 ? -1 : 1;
  const yawTarget = -steer * (D.pivotRate * (1 - roll) + D.turnRate * highSpeedDamp * roll * dir);
  state.yawRate += (yawTarget - state.yawRate) * Math.min(1, dt * D.yawResponse);
  state.heading += state.yawRate * dt;
  state.heading = Math.atan2(Math.sin(state.heading), Math.cos(state.heading));

  // ── Translate, push out of colliders, refuse cliffs ──
  const want = v * dt;
  let nx = state.x + Math.sin(state.heading) * want;
  let nz = state.z + Math.cos(state.heading) * want;
  const r = Math.hypot(nx, nz);
  if (r > D.worldLimit) {
    nx *= D.worldLimit / r;
    nz *= D.worldLimit / r;
  }
  const res = Math.abs(want) > 1e-6 ? resolveCircles(nx, nz, D.radius, circles) : { x: state.x, z: state.z };
  const dx = res.x - state.x;
  const dz = res.z - state.z;
  const travelled = Math.hypot(dx, dz);
  const h0 = groundAt(state.x, state.z);
  const h1 = groundAt(res.x, res.z);
  state.blocked = false;
  if (travelled > 1e-6 && (h1 - h0) / travelled > D.maxSlope) {
    // A wall: stop dead with a little bounce-back of speed.
    state.blocked = true;
    v *= -0.15;
    state.step = 0;
  } else {
    // Scrubbing along a collider bleeds speed in proportion to how much of the move was lost.
    if (Math.abs(want) > 1e-6) {
      const along = (dx * Math.sin(state.heading) + dz * Math.cos(state.heading)) / want;
      if (along < 0.98) {
        state.blocked = along < 0.5;
        v *= clamp(along, 0, 1);
      }
    }
    state.x = res.x;
    state.z = res.z;
    state.step = Math.sign(want) * travelled;
    state.travelled += travelled;
  }
  state.accel = dt > 0 ? (v - v0) / dt : 0;
  state.speed = v;
  state.moving = Math.abs(v) > 0.15 || Math.abs(state.yawRate) > 0.05;
  return state;
}

/** Find a spot ~3.5 m beside the rover where a walker (radius rWalker) can stand. */
export function exitSpot(x, z, heading, circles, groundAt, rWalker = 0.8, gap = 3.6) {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  // Right-hand side of a rover facing (sin h, cos h) seen from above: (−cos h, sin h).
  const rx = -fz;
  const rz = fx;
  const tries = [
    [rx, rz],
    [-rx, -rz],
    [-fx, -fz],
    [fx, fz],
    [rx * 0.7 - fx * 0.7, rz * 0.7 - fz * 0.7],
    [-rx * 0.7 - fx * 0.7, -rz * 0.7 - fz * 0.7],
  ];
  const h0 = groundAt(x, z);
  let fallback = null;
  for (const scale of [1, 1.4, 2]) {
    for (const [ox, oz] of tries) {
      const px = x + ox * gap * scale;
      const pz = z + oz * gap * scale;
      const clear = !circles.some((c) => Math.hypot(px - c.x, pz - c.z) < c.r + rWalker);
      const steep = Math.abs(groundAt(px, pz) - h0) > 2.5;
      if (clear && !steep) return { x: px, z: pz };
      if (!fallback && !steep) fallback = resolveCircles(px, pz, rWalker, circles);
    }
  }
  return fallback ?? { x: x + rx * gap, z: z + rz * gap };
}
