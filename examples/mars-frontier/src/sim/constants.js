/**
 * Every number the simulation uses lives here, tagged with how much trust it deserves.
 *
 *  measured   — observed by missions / physical data (rounded)
 *  reference  — published NASA planning or design values (rounded)
 *  assumption — operating choices for this outpost; adjustable
 *  estimate   — simplified educational estimates, NOT engineering predictions
 *  hypothetical — future technology that does not yet exist at this scale on Mars
 */

export const SOL_SECONDS = 88775.244; // 24 h 39 m 35 s
export const SOL_HOURS = SOL_SECONDS / 3600;

export const CATEGORIES = {
  measured: {
    label: "Measured",
    desc: "Observed by missions or a physical constant (rounded).",
  },
  reference: {
    label: "Reference",
    desc: "Published NASA planning or design value (rounded).",
  },
  assumption: {
    label: "Assumption",
    desc: "Operating choice for this outpost. Change it and the outcome changes.",
  },
  estimate: {
    label: "Estimate",
    desc: "Simplified educational estimate. Not a validated engineering prediction.",
  },
  hypothetical: {
    label: "Hypothetical",
    desc: "Future technology not yet demonstrated at this scale on Mars. Values are planning-level guesses.",
  },
};

export const PARAMS = {
  // ── Environment ─────────────────────────────────────────────
  solLength: {
    value: SOL_HOURS,
    unit: "h",
    label: "Length of a sol",
    category: "measured",
    source: "NASA Mars Fact Sheet — 24 h 39 m 35 s",
  },
  solarConstant: {
    value: 0.59,
    unit: "kW/m²",
    label: "Mean solar irradiance at Mars' orbit",
    category: "measured",
    source: "NASA Mars Fact Sheet (~586 W/m²; varies about ±20% over the Martian year)",
  },
  latitude: {
    value: 40.2,
    unit: "°N",
    label: "Settlement latitude (Arcadia Planitia)",
    category: "assumption",
    source: "Mid-latitude site chosen for shallow ground ice",
  },
  declination: {
    value: 0,
    unit: "°",
    label: "Solar declination (season)",
    category: "assumption",
    source: "Fixed at equinox — seasons are not modelled",
  },
  atmosphericK: {
    value: 0.4,
    unit: "",
    label: "Atmospheric transmission factor k in exp(−k·τ)",
    category: "estimate",
    source: "Simplified: diffuse skylight partly offsets direct-beam loss",
  },
  dustLossPerSol: {
    value: 0.002,
    unit: "/sol",
    label: "Solar-panel dust accumulation",
    category: "reference",
    source: "Same order as MER / InSight observations (~0.1–0.3% per sol)",
  },
  // ── Power ───────────────────────────────────────────────────
  panelEfficiency: {
    value: 0.22,
    unit: "",
    label: "Solar panel conversion efficiency",
    category: "assumption",
    source: "Typical of space-qualified multi-junction arrays after losses",
  },
  trackingGain: {
    value: 1.25,
    unit: "×",
    label: "Single-axis sun-tracking gain",
    category: "estimate",
    source: "Simplified multiplier over a fixed horizontal panel",
  },
  batteryEfficiency: {
    value: 0.9,
    unit: "",
    label: "Battery charge efficiency",
    category: "assumption",
    source: "Typical lithium-ion round-trip losses",
  },
  fissionUnitKW: {
    value: 10,
    unit: "kWe",
    label: "Fission surface power unit output",
    category: "hypothetical",
    source: "Design target of NASA's Kilopower concept (KRUSTY ground test, 2018). Not yet flown",
  },
  habitatBaseKW: {
    value: 6,
    unit: "kW",
    label: "Habitat base load (thermal, avionics)",
    category: "assumption",
    source: "Lean surface outpost estimate",
  },
  habitatPerCrewKW: {
    value: 1.2,
    unit: "kW/crew",
    label: "Habitat load per crew member",
    category: "assumption",
    source: "Air revitalisation, galley, workstations",
  },
  labKW: { value: 2, unit: "kW", label: "Science laboratory", category: "assumption", source: "" },
  commsKW: { value: 0.5, unit: "kW", label: "Communications", category: "assumption", source: "" },
  recyclerBaseKW: {
    value: 0.4,
    unit: "kW",
    label: "Water recycler base load",
    category: "assumption",
    source: "",
  },
  recyclerPerCrewKW: {
    value: 0.15,
    unit: "kW/crew",
    label: "Water recycler load per crew",
    category: "assumption",
    source: "",
  },
  greenhouseLightKW: {
    value: 0.08,
    unit: "kW/m²",
    label: "Greenhouse LED lighting (sol-averaged)",
    category: "assumption",
    source: "Supplemental LED lighting averaged over the photoperiod",
  },
  conservationFactor: {
    value: 0.8,
    unit: "×",
    label: "Habitat load in conservation mode",
    category: "assumption",
    source: "Reduced thermal set-points, lab powered down",
  },
  isruO2KW: {
    value: 2.5,
    unit: "kW/unit",
    label: "CO₂→O₂ ISRU unit power",
    category: "hypothetical",
    source: "Scaled-up solid-oxide electrolysis",
  },
  isruO2Rate: {
    value: 0.2 * SOL_HOURS,
    unit: "kg/sol/unit",
    label: "CO₂→O₂ ISRU output",
    category: "hypothetical",
    source: "0.2 kg/h per unit. For scale: MOXIE on Perseverance measured ~6–12 g/h at ~300 W",
  },
  waterExtractorKW: {
    value: 4,
    unit: "kW",
    label: "Ground-ice water extractor power",
    category: "hypothetical",
    source: "",
  },
  waterExtractorRate: {
    value: 1.5 * SOL_HOURS,
    unit: "kg/sol",
    label: "Ground-ice water extractor output",
    category: "hypothetical",
    source: "1.5 kg/h from ice-rich regolith",
  },
  // ── Crew metabolism ─────────────────────────────────────────
  o2PerCrew: {
    value: 0.84,
    unit: "kg/crew/sol",
    label: "Metabolic oxygen use",
    category: "reference",
    source: "NASA Life Support Baseline Values & Assumptions (BVAD), nominal crew member",
  },
  o2Leak: {
    value: 0.2,
    unit: "kg/sol",
    label: "Airlock and leakage losses",
    category: "assumption",
    source: "",
  },
  waterPerCrew: {
    value: 3.5,
    unit: "kg/crew/sol",
    label: "Water use (drinking, food prep, minimal hygiene)",
    category: "assumption",
    source: "BVAD drinking ~2.5 kg/day plus a lean hygiene allowance",
  },
  waterRecovery: {
    value: 0.98,
    unit: "",
    label: "Water recovery efficiency",
    category: "measured",
    source: "ISS Environmental Control & Life Support demonstrated ~98% (NASA, 2023)",
  },
  foodPerCrew: {
    value: 2700,
    unit: "kcal/crew/sol",
    label: "Food energy need",
    category: "reference",
    source: "NASA planning range ~2,500–3,000+ kcal/day depending on crew and activity",
  },
  // ── Greenhouse ──────────────────────────────────────────────
  greenhouseYield: {
    value: 60,
    unit: "kcal/m²/sol",
    label: "Greenhouse edible food yield",
    category: "estimate",
    source: "Conservative controlled-environment yield, mixed crops, full lighting",
  },
  greenhouseO2: {
    value: 0.03,
    unit: "kg/m²/sol",
    label: "Greenhouse photosynthetic oxygen",
    category: "estimate",
    source: "Roughly 25–30 m² of crops per person's oxygen",
  },
  greenhouseWaterLoss: {
    value: 0.01,
    unit: "kg/m²/sol",
    label: "Greenhouse net water loss",
    category: "estimate",
    source: "Most transpired water is recovered as condensate",
  },
  naturalLightFactor: {
    value: 0.2,
    unit: "×",
    label: "Greenhouse output with LEDs off",
    category: "estimate",
    source: "Sunlight through the glazing only",
  },
  // ── Storage & survival ──────────────────────────────────────
  o2Capacity: {
    value: 3000,
    unit: "kg",
    label: "Oxygen storage capacity",
    category: "assumption",
    source: "",
  },
  waterCapacity: {
    value: 30000,
    unit: "kg",
    label: "Water storage capacity",
    category: "assumption",
    source: "",
  },
  maxDeficitHours: {
    value: 72,
    unit: "h",
    label: "Survivable continuous power deficit",
    category: "assumption",
    source: "Thermal control loss beyond ~3 sols treated as unsurvivable",
  },
};

export const p = (key) => PARAMS[key].value;
