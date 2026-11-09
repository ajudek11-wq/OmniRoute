/**
 * Pure locomotion maths shared by VR and the desktop preview (no three.js, unit-tested).
 * Conventions: the player rig sits at floor level at (x, y, z) with yaw about +Y.
 * A head offset (hx, hz) in rig space maps to the world as three.js does for rotation.y:
 *   wx = x + hx·cos(yaw) + hz·sin(yaw),  wz = z − hx·sin(yaw) + hz·cos(yaw).
 */

export function headWorld(rig, hx, hz) {
  const c = Math.cos(rig.yaw);
  const s = Math.sin(rig.yaw);
  return { x: rig.x + hx * c + hz * s, z: rig.z - hx * s + hz * c };
}

/** Turn the rig by `delta` radians about the head, so the player's head stays put (no swing). */
export function turnAboutHead(rig, hx, hz, delta) {
  const h = headWorld(rig, hx, hz);
  const yaw = rig.yaw + delta;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { ...rig, yaw, x: h.x - (hx * c + hz * s), z: h.z - (-hx * s + hz * c) };
}

/**
 * Head-relative smooth movement. `headYaw` is the head's world yaw (camera forward = −Z rotated by it).
 * Stick +y moves forward, +x strafes right. Returns the world-space displacement.
 */
export function moveDelta(headYaw, sx, sy, speed, dt) {
  const fx = -Math.sin(headYaw);
  const fz = -Math.cos(headYaw);
  const rx = Math.cos(headYaw);
  const rz = -Math.sin(headYaw);
  return { dx: (fx * sy + rx * sx) * speed * dt, dz: (fz * sy + rz * sx) * speed * dt };
}

/** Push a point out of 2D circle colliders (cheap, stable; a few passes resolve overlaps). */
export function pushOut(x, z, r, circles) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const c of circles) {
      const dx = x - c.x;
      const dz = z - c.z;
      const min = r + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 1e-4;
        x = c.x + (dx / d) * min;
        z = c.z + (dz / d) * min;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x, z };
}

/** True when a point is inside any collider (with a margin). */
export function blocked(x, z, r, circles) {
  for (const c of circles) if (Math.hypot(x - c.x, z - c.z) < r + c.r) return true;
  return false;
}

/**
 * Sample a ballistic teleport arc from a controller and find where it meets the ground.
 * groundAt(x, z) returns the floor height or null where there is no floor.
 * Returns { points: [[x,y,z]…], hit: {x,y,z} | null }.
 */
export function teleportArc(o, d, groundAt, { speed = 8, gravity = 9.8, step = 0.025, maxT = 2.6, maxDist = 30 } = {}) {
  const points = [[o.x, o.y, o.z]];
  const len = Math.hypot(d.x, d.y, d.z) || 1;
  const vx = (d.x / len) * speed;
  const vy = (d.y / len) * speed;
  const vz = (d.z / len) * speed;
  let px = o.x;
  let py = o.y;
  let pz = o.z;
  for (let t = step; t <= maxT; t += step) {
    const x = o.x + vx * t;
    const y = o.y + vy * t - 0.5 * gravity * t * t;
    const z = o.z + vz * t;
    const g = groundAt(x, z);
    if (g !== null && g !== undefined && y <= g) {
      // Refine the crossing between the previous sample and this one.
      const gp = groundAt(px, pz) ?? g;
      const a = py - gp;
      const b = y - g;
      const f = a - b !== 0 ? Math.max(0, Math.min(1, a / (a - b))) : 1;
      const hx = px + (x - px) * f;
      const hz = pz + (z - pz) * f;
      const hit = { x: hx, y: groundAt(hx, hz) ?? g, z: hz };
      points.push([hit.x, hit.y, hit.z]);
      if (Math.hypot(hit.x - o.x, hit.z - o.z) > maxDist) return { points, hit: null };
      return { points, hit };
    }
    points.push([x, y, z]);
    px = x;
    py = y;
    pz = z;
    if (y < o.y - 60) break;
  }
  return { points, hit: null };
}

/** Teleport target check: gentle slope, clear of colliders, inside the world bounds. */
export function validTarget(hit, groundAt, circles, { radius = 0.35, maxSlope = 0.6, bounds = null } = {}) {
  if (!hit) return false;
  if (bounds && Math.hypot(hit.x - bounds.x, hit.z - bounds.z) > bounds.r) return false;
  const e = 0.4;
  const gx = (groundAt(hit.x + e, hit.z) ?? hit.y) - (groundAt(hit.x - e, hit.z) ?? hit.y);
  const gz = (groundAt(hit.x, hit.z + e) ?? hit.y) - (groundAt(hit.x, hit.z - e) ?? hit.y);
  const slope = Math.hypot(gx, gz) / (2 * e);
  if (slope > maxSlope) return false;
  return !blocked(hit.x, hit.z, radius, circles);
}

/** Seated mode raises the floor so a seated head sits at a standing eye height. */
export function seatedOffset(measuredHeadY, standingEye = 1.65) {
  return Math.max(0, Math.min(1.2, standingEye - measuredHeadY));
}

/** Comfort vignette strength from linear (m/s) and angular (rad/s) velocity. */
export function vignetteFor(linear, angular, strength = 1) {
  return Math.min(0.85, (Math.max(0, linear - 0.4) * 0.22 + Math.max(0, angular - 0.3) * 0.35) * strength);
}
