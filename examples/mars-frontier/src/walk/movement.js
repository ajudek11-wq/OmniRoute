/**
 * Pure first-person movement rules. No THREE, no DOM: unit-tested in Node.
 * Heading convention matches the rover: forward = (sin yaw, cos yaw) in the x/z plane.
 */

export const WALK = {
  eye: 1.7, // camera height above ground (m)
  radius: 0.8, // player body radius for collisions (m)
  speed: 2.3, // m/s
  sprint: 5.4, // m/s
  accel: 7, // 1/s response
  maxClimb: 0.55, // max rise per metre travelled before a slope is "too steep"
};

/** Push a point out of circular colliders. Returns the corrected {x,z}. */
export function resolveCircles(x, z, radius, circles) {
  let px = x;
  let pz = z;
  for (let pass = 0; pass < 2; pass++) {
    for (const c of circles) {
      const dx = px - c.x;
      const dz = pz - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 1e-6;
        const k = (min - d) / d;
        px += dx * k;
        pz += dz * k;
      }
    }
  }
  return { x: px, z: pz };
}

/**
 * Advance the player by one frame.
 * input: { mx, mz } desired move in player space (mz forward, mx right), each in [-1, 1].
 * groundAt(x,z) → height. circles: colliders. Returns the new state.
 */
export function stepPlayer(state, input, dt, groundAt, circles) {
  const mag = Math.min(1, Math.hypot(input.mx, input.mz));
  const dirLen = Math.hypot(input.mx, input.mz) || 1;
  const fwd = { x: Math.sin(state.yaw), z: Math.cos(state.yaw) };
  const right = { x: Math.cos(state.yaw), z: -Math.sin(state.yaw) };
  const ix = (input.mx * right.x + input.mz * fwd.x) / dirLen;
  const iz = (input.mx * right.z + input.mz * fwd.z) / dirLen;
  const top = input.sprint ? WALK.sprint : WALK.speed;
  const target = mag * top;
  state.speed += (target - state.speed) * Math.min(1, dt * WALK.accel);
  const dist = state.speed * dt;
  if (dist < 1e-5) {
    state.moving = false;
    return state;
  }
  const nx = state.x + ix * dist;
  const nz = state.z + iz * dist;
  const resolved = resolveCircles(nx, nz, WALK.radius, circles);
  const h0 = groundAt(state.x, state.z);
  const h1 = groundAt(resolved.x, resolved.z);
  const travelled = Math.hypot(resolved.x - state.x, resolved.z - state.z);
  // Cliff face: refuse to climb steeper than the limit (canyon walls, mesa sides).
  if (travelled > 1e-6 && (h1 - h0) / travelled > WALK.maxClimb) {
    state.blocked = true;
    state.speed *= 0.5;
  } else {
    state.blocked = false;
    state.x = resolved.x;
    state.z = resolved.z;
  }
  state.moving = state.speed > 0.15;
  state.travelled = (state.travelled ?? 0) + travelled;
  return state;
}

/** Head-bob phase advances with distance travelled; amplitude is tiny so it never nauseates. */
export function headBob(travelled) {
  return { y: Math.sin(travelled * 2.6) * 0.035, roll: Math.sin(travelled * 1.3) * 0.004 };
}

export function clampLook(pitch) {
  return Math.max(-1.2, Math.min(1.1, pitch));
}

export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
