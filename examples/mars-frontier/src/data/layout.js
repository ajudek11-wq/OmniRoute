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

/** Rover avoidance circles. */
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
];
