import * as THREE from "three";

/**
 * Site plan for the lunar south-pole destination (1 unit = 1 m, −Z = north, +X = east).
 * The base sits on a ridge on the rim of Shackleton crater; Shackleton's bowl opens to the west,
 * a deep permanently shadowed crater lies to the north under the Earth, and a skylight pit with a
 * walk-in lava tube lies to the south-east.
 */

const D2R = Math.PI / 180;

/** Direction from azimuth (degrees from north toward east) and elevation (degrees). */
export function dirFromAzEl(az, el) {
  const a = az * D2R;
  const e = el * D2R;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

export const MOON_RADIUS = 1737400;

// The Sun skims the horizon at the pole (elevation ~1.5°); it circles the sky once per lunar day.
export const SUN_AZ = 100;
export const SUN_EL = 1.5;
// The Earth hangs low toward the lunar near side (north on this map), rocking with libration.
export const EARTH_AZ = 5;
export const EARTH_EL = 3.1;
export const EARTH_ANG = 1.9; // degrees across

export const SITE = {
  base: { x: 0, z: 0, r: 46, blend: 26 },
  pad: { x: 132, z: -42, r: 16, blend: 14 },
  // Shackleton: 21 km across, ~4.1 km deep; its rim crest runs ~900 m west of the base.
  shackleton: { x: -11400, z: 600, R: 10500, depth: 4100 },
  // Permanently shadowed crater in front of the Earth (frost on its floor).
  psr: { x: 150, z: -1150, R: 380, depth: 150 },
  // Fresh crater with a boulder-strewn bright ejecta blanket.
  fresh: { x: -280, z: -320, R: 36, depth: 13 },
  // Skylight pit with a ramp on its west side and a lava tube heading east.
  pit: { x: 620, z: 380, a: 45, b: 24, depth: 30 },
  tube: { x0: 652, x1: 792, z: 380, halfW: 8, height: 12 },
  // Malapert-like massif on the horizon under the Earth (brought closer than the real ~120 km).
  massif: { az: EARTH_AZ, dist: 26000, h: 1150, sigma: 4200 },
};

export const BOUNDS = { x: 0, z: 0, r: 1500 };
export const SPAWN = { x: 6, z: 14, yaw: 0.18 };
