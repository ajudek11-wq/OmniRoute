/** Settlement master plan (meters). +x east, −z north. */

export const STRUCTURE_POS = {
  habitat: { x: 0, z: 0 },
  lab: { x: -30, z: 4 },
  greenhouse: { x: 3, z: -34 },
  water: { x: -31, z: -29 },
  battery: { x: 40, z: -22 },
  garage: { x: 36, z: 18 },
  comms: { x: -42, z: 36 },
  solar: { x: 118, z: 4 },
  landing: { x: -165, z: 118 },
  fission: { x: -70, z: -235 },
  // Expansion (all inside the levelled core, rotation 0: local axes = world axes).
  habitatB: { x: 24, z: -12 },
  yard: { x: 64, z: -30 },
  isru: { x: -62, z: -28 },
  fieldlab: { x: -2, z: 46 },
};

/** Areas levelled for construction (target height 0). */
export const FLAT_ZONES = [
  { x: 0, z: 0, r: 80, blend: 45 },
  { x: 118, z: 4, r: 52, blend: 30 },
  { x: -165, z: 118, r: 34, blend: 28 },
  { x: -70, z: -235, r: 26, blend: 22 },
];

/** Compacted-regolith roads. */
export const PATHS = [
  [
    [12, 2],
    [50, 4],
    [86, 4],
  ],
  [
    [-8, 10],
    [-46, 46],
    [-100, 82],
    [-145, 106],
  ],
  [
    [-6, -12],
    [-26, -70],
    [-48, -150],
    [-66, -212],
  ],
  [
    [8, 10],
    [24, 30],
    [36, 34],
  ],
];

export const ROVER_HOME = { x: 36, z: 36, heading: 0.35 };
export const SOLAR_SERVICE_POINT = { x: 84, z: 6 };

export const SURVEY_SITES = [
  {
    id: "alpha",
    name: "Site Alpha",
    subtitle: "Crater rim",
    x: 214,
    z: -186,
    finding:
      "The rim of a 240 m impact crater. Impacts excavate material from depth and drape it across the rim — a natural drill core. Spectra show basaltic ejecta overlain by bright, oxidised dust.",
  },
  {
    id: "beta",
    name: "Site Beta",
    subtitle: "Layered mesa",
    x: -246,
    z: -60,
    finding:
      "Stacked layers in the mesa wall record repeated episodes of deposition. Layering like this preserves a timeline of Mars' changing climate.",
  },
  {
    id: "gamma",
    name: "Site Gamma",
    subtitle: "Fresh ice-exposing crater",
    x: -118,
    z: 293,
    finding:
      "A young impact has punched through the dust and exposed bright, nearly pure water ice. HiRISE has imaged craters like this in the mid-latitudes; the exposed ice sublimates over months. This is why Frontier Base sits here.",
  },
];

/** Big crater feeding Site Alpha + smaller named features. */
export const NAMED_CRATERS = [
  { x: 300, z: -260, r: 120, depth: 24, rim: 9 },
  { x: -118, z: 312, r: 15, depth: 4.5, rim: 1.6, ice: true },
];

export const MESA = { x: -300, z: -64, r: 44, height: 16 };

/** Circles laid along a straight run (walls, rows of equipment). */
function run(ox, oz, ax, az, bx, bz, r, step = r * 1.4) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push({ x: ox + ax + ((bx - ax) * i) / n, z: oz + az + ((bz - az) * i) / n, r });
  return out;
}
/** Offset local circles [x, z, r] by a structure's position. */
function at(id, list) {
  const p = STRUCTURE_POS[id];
  return list.map(([x, z, r]) => ({ x: p.x + x, z: p.z + z, r }));
}

/**
 * Solid footprints of the expansion structures (walker + rover collision), grouped per structure.
 * Gaps of at least 1.6 m (the walker's diameter) are kept between structures.
 */
export const STRUCTURE_COLLIDERS = {
  habitatB: [
    ...at("habitatB", [
      [0, 0, 5.2], // two-deck shell + rings
      [3.99, 4.74, 1.7], // airlock (bearing 40°)
    ]),
  ],
  yard: [
    ...run(STRUCTURE_POS.yard.x, STRUCTURE_POS.yard.z, -5.3, -10.6, -5.3, -0.5, 1.45, 2.0), // container stacks
    ...run(STRUCTURE_POS.yard.x, STRUCTURE_POS.yard.z, 8.0, -12.4, 8.0, 1.4, 1.1, 2.0), // shelter back wall
    ...run(STRUCTURE_POS.yard.x, STRUCTURE_POS.yard.z, 1.0, -12.9, 7.0, -12.9, 0.9, 1.5), // shelter end wall
    ...at("yard", [
      [-0.6, -9, 0.3], // shelter front columns
      [-0.6, -5.5, 0.3],
      [-0.6, -2, 0.3],
      [-0.6, 1.5, 0.3],
      [6.6, -4.2, 1.0], // workbench
      [6.6, -2.4, 1.0],
      [2.2, -10.6, 1.0], // spare wheels
      [1.6, -6.2, 0.8], // air compressor
      [-7.8, 3.0, 0.7], // gantry legs
      [-2.8, 3.0, 0.7],
      [-5.6, 7.6, 1.75], // half container
      [-6.3, 11.0, 1.1], // pressure pod
      [0.2, 7.0, 1.0], // pallets + crates
      [0.4, 10.4, 1.0],
      [3.7, 6.0, 1.2], // spare tanks
      [5.1, 6.0, 1.2],
      [4.8, 9.6, 0.8], // gas bottle rack
      [6.6, 11.6, 1.0], // cable drum
      [7.6, 12.8, 0.4], // floodlight mast
      [1.7, 14.0, 0.45], // entrance sign
      [2.7, 14.0, 0.45],
    ]),
  ],
  isru: [
    ...run(STRUCTURE_POS.isru.x, STRUCTURE_POS.isru.z, -9, -4.1, 10.4, -4.1, 3.2, 3.4), // cryo tank farm + bund
    ...at("isru", [
      [-8.6, 5.1, 2.4], // electrolysis + Sabatier skid
      [-5.4, 5.1, 2.4],
      [-1.0, 5.1, 2.2], // compressor skid
      [2.2, 5.1, 2.2],
      [5.6, 5.1, 1.9], // radiator field
      [7.7, 5.1, 1.9],
      [9.8, 5.1, 1.9],
      [-10, 0.6, 0.3], // pipe-rack posts
      [-6, 0.6, 0.3],
      [-2, 0.6, 0.3],
      [2, 0.6, 0.3],
      [6, 0.6, 0.3],
      [10, 0.6, 0.3],
      [11.6, 1.2, 0.45], // vent stack
      [14, 0.7, 0.3], // pipe-bridge posts
      [19, 0.83, 0.3],
      [-11.2, 8.0, 0.5], // control cabinet
    ]),
  ],
  fieldlab: [
    ...at("fieldlab", [
      [-2.0, 0, 2.3], // hard-shell lab pod
      [1.6, 0, 2.3],
      [4.4, 0, 1.0], // porch
      [-6.0, 3.8, 1.1], // seismometer shield
      [-6.8, -3.0, 0.4], // weather mast
      [-1.8, 4.8, 0.75], // core racks
      [-0.6, 4.8, 0.75],
      [5.8, 5.2, 1.7], // core drill
      [8.0, 3.4, 0.8], // drill power unit
      [3.0, 7.0, 1.35], // drill-pipe rack
    ]),
  ],
};

/** Bellows tunnel from the main habitat to Habitat B (the walker cannot pass under it). */
function tunnelCircles(a, b, from, to, r) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const out = [];
  for (let d = from; d <= to + 1e-6; d += (to - from) / 2) out.push({ x: a.x + (dx / len) * d, z: a.z + (dz / len) * d, r });
  return out;
}
export const LINK_COLLIDERS = tunnelCircles(STRUCTURE_POS.habitat, STRUCTURE_POS.habitatB, 15.6, 20.6, 1.4);

/** Rover avoidance + walker collision circles. */
export const OBSTACLES = [
  { x: 0, z: 0, r: 14.5 },
  { x: -30, z: 4, r: 11 },
  { x: -7, z: -34, r: 8.5 },
  { x: 13, z: -34, r: 8.5 },
  { x: -31, z: -29, r: 10 },
  { x: 40, z: -22, r: 9 },
  { x: 36, z: 15, r: 8 },
  { x: -42, z: 36, r: 6 },
  { x: 118, z: 4, r: 33 },
  { x: -165, z: 118, r: 9 },
  { x: -70, z: -235, r: 16 },
  { x: -15, z: 4, r: 3 },
  { x: 3, z: -19, r: 3 },
  ...Object.values(STRUCTURE_COLLIDERS).flat(),
  ...LINK_COLLIDERS,
];

/** Kasei-style canyon system south-west of the base: a carved valley with walls of layered rock. */
export const CANYON = {
  path: [
    [-360, 120],
    [-430, 260],
    [-470, 380],
    [-520, 520],
    [-560, 640],
  ],
  halfWidth: 46, // m from centreline to the rim
  depth: 52, // m below the surrounding plain at the deepest point
};

/** Tall landmarks visible across the plain (positions are world metres). */
export const LANDMARKS = [
  { id: "spire", name: "Glass Spire", x: 560, z: -420, kind: "spire" },
  { id: "arch", name: "Ridge Arch", x: -640, z: -420, kind: "arch" },
];

/** Where the first-person walker appears when entering on foot (near the garage). */
export const WALK_START = { x: 24, z: 30 };
