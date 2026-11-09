/**
 * Pure numbers behind Meridian Station (no three.js, unit-tested in tests/orbit.test.js).
 * Real values are real; the station itself is fiction and the on-screen timings are compressed.
 */
export const G0 = 9.80665;
export const MU_EARTH = 3.986004418e14; // m³/s²
export const R_EARTH = 6371e3; // mean radius, m
export const ALT = 400e3; // station altitude, m (ISS flies ~400–420 km)

export const RING_R = 225; // habitat-ring floor radius, m (fiction)
export const RING_RPM = 2; // real design spin rate

/** Angular velocity in rad/s for a spin rate in rpm. */
export const omegaOf = (rpm) => (rpm * 2 * Math.PI) / 60;
/** Centripetal acceleration a = ω²r (m/s²). */
export const spinAccel = (r, rpm) => omegaOf(rpm) ** 2 * r;
/** Rim speed v = ωr (m/s). */
export const rimSpeed = (r, rpm) => omegaOf(rpm) * r;
/** Floor height (m above the lowest point) of a ring of radius R at arc offset z along the floor plane. */
export const ringFloorY = (z, R = RING_R) => R - Math.sqrt(Math.max(0, R * R - z * z));

/** Circular orbit period in seconds at altitude h. */
export const orbitPeriod = (h = ALT) => 2 * Math.PI * Math.sqrt((R_EARTH + h) ** 3 / MU_EARTH);
export const orbitSpeed = (h = ALT) => Math.sqrt(MU_EARTH / (R_EARTH + h));
export const sunrisesPerDay = (h = ALT) => 86400 / orbitPeriod(h);
/** Apparent angular diameter of the Earth (degrees) from altitude h. */
export const earthAngularDiameter = (h = ALT) => (2 * Math.asin(R_EARTH / (R_EARTH + h)) * 180) / Math.PI;
/** Gravity at altitude h relative to the surface value. */
export const gravityFraction = (h = ALT) => (R_EARTH / (R_EARTH + h)) ** 2;
/** Half-angle of the Earth's disc seen from h: the Sun is eclipsed when it is closer than this to nadir. */
export const shadowHalfAngle = (h = ALT) => Math.asin(R_EARTH / (R_EARTH + h));

/**
 * Sunlit fraction (0 = full eclipse, 1 = full Sun) from the angle between the Sun direction and nadir.
 * A short soft edge stands in for the Sun's disc setting through the atmosphere.
 */
export function sunlitFraction(angleFromNadir, h = ALT, soft = 0.03) {
  const edge = shadowHalfAngle(h);
  const t = (angleFromNadir - (edge - soft)) / (2 * soft);
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
