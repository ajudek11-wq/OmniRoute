/**
 * Walkable spaces for Mars in VR (pure logic, no THREE; unit-tested in tests/marsvr.test.js).
 *
 * The outside is the terrain. Interiors are zones: { id, contains(x,z), floor(x,z), colliders, level? }.
 * The player is in exactly one zone (or outside = null). Floors and colliders come from that zone,
 * so a hallway under a tunnel or an upper deck over a lower one never mix. Crossing into another
 * zone is only possible through an open portal (a doorway): elsewhere groundAt() returns null,
 * which stops walking and teleporting through walls. Levels that share a footprint (an upper deck)
 * are only entered explicitly (ladder / lift), never by walking.
 */
export class Zones {
  constructor(outsideFloor, outsideColliders = []) {
    this.zones = [];
    this.portals = [];
    this.current = null;
    this.outsideFloor = outsideFloor;
    this.outsideColliders = outsideColliders;
  }

  add(zone) {
    this.zones.push({ colliders: [], ...zone });
    return this.zones[this.zones.length - 1];
  }

  byId(id) {
    return this.zones.find((z) => z.id === id) ?? null;
  }

  /** A doorway between zone ids a and b (null = outside), usable within r of (x, z) while open(). */
  portal({ a, b, x, z, r = 1.2, open = () => true }) {
    const p = { a, b, x, z, r, open };
    this.portals.push(p);
    return p;
  }

  /** The zone containing (x, z); `pref` (usually the current zone) wins when footprints overlap. */
  zoneAt(x, z, pref = this.current) {
    if (pref && pref.contains(x, z)) return pref;
    for (const zn of this.zones) if (!zn.level && zn.contains(x, z)) return zn;
    return null;
  }

  portalOpen(from, to, x, z) {
    const a = from?.id ?? null;
    const b = to?.id ?? null;
    for (const p of this.portals) {
      if (!((p.a === a && p.b === b) || (p.a === b && p.b === a))) continue;
      if (Math.hypot(x - p.x, z - p.z) <= p.r && p.open()) return true;
    }
    return false;
  }

  floorOf(zone, x, z) {
    return zone ? zone.floor(x, z) : this.outsideFloor(x, z);
  }

  /** Floor height for the player standing in the current zone, or null if (x, z) is not reachable. */
  groundAt(x, z) {
    const cur = this.current;
    const to = this.zoneAt(x, z, cur);
    if (to === cur) return this.floorOf(to, x, z);
    if (this.portalOpen(cur, to, x, z)) return this.floorOf(to, x, z);
    return null;
  }

  colliders() {
    return this.current ? this.current.colliders : this.outsideColliders;
  }

  /** Follow the head: the zone under it (keeping the current level where footprints overlap). */
  update(x, z) {
    const next = this.zoneAt(x, z, this.current);
    const changed = next !== this.current;
    this.current = next;
    return changed;
  }

  /** Put the player in a specific zone (ladders, lifts, spawns). */
  set(idOrNull) {
    this.current = idOrNull ? this.byId(idOrNull) : null;
  }
}

/** Rectangle test helper in a rotated frame: centre (cx,cz), half sizes, yaw (bearing of local +z). */
export function inRect(x, z, cx, cz, hx, hz, yaw = 0) {
  const dx = x - cx;
  const dz = z - cz;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // local axes: lz = (sin yaw, cos yaw), lx = (cos yaw, -sin yaw)
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= hx && Math.abs(lz) <= hz;
}

/** Local coordinates in a rotated frame (see inRect). */
export function toLocal(x, z, cx, cz, yaw = 0) {
  const dx = x - cx;
  const dz = z - cz;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

export const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

/** Gravity drop for a released sample: returns the new { y, vy, rest }. */
export function fall(y, vy, floor, dt, g = 3.71, bounce = 0.28) {
  vy -= g * dt;
  y += vy * dt;
  if (y <= floor) {
    y = floor;
    if (Math.abs(vy) < 0.35) return { y, vy: 0, rest: true };
    vy = -vy * bounce;
  }
  return { y, vy, rest: false };
}

/** Tau ramp for the VR dust-storm moment: approach, engulf, clear (seconds since triggered). */
export const STORM_MOMENT = { approach: 55, hold: 35, clear: 30 };
export function stormMoment(t, baseTau = 0.5, peak = 4.5) {
  const { approach, hold, clear } = STORM_MOMENT;
  if (t < 0) return { tau: baseTau, front: 0, dist: 2400, done: false };
  const total = approach + hold + clear;
  if (t >= total) return { tau: baseTau, front: 0, dist: 2400, done: true };
  const k = (x) => x * x * (3 - 2 * x);
  // The wall of dust closes from ~2.4 km to the base during the approach.
  const a = Math.min(1, t / approach);
  const dist = 2400 - 2150 * k(a);
  // Local optical depth only rises as the front arrives, then stays, then clears.
  let tauK = 0;
  if (t < approach) tauK = k(Math.max(0, (t - approach * 0.55) / (approach * 0.45)));
  else if (t < approach + hold) tauK = 1;
  else tauK = 1 - k((t - approach - hold) / clear);
  const front = t < approach + hold ? Math.min(1, t / 8) : 1 - k((t - approach - hold) / clear);
  return { tau: baseTau + (peak - baseTau) * tauK, front, dist, done: false };
}
