export const SCENARIOS = [
  {
    id: "outpost",
    name: "Frontier Outpost",
    tagline: "4 crew · solar field + 1 fission unit",
    description:
      "The baseline: a four-person research outpost with a tracked solar field, one 10 kWe fission unit and a modest greenhouse. Food is the long-term constraint.",
    config: {
      crew: 4,
      solarArea: 1200,
      greenhouseArea: 120,
      batteryKWh: 600,
      fissionUnits: 1,
      isruUnits: 1,
      waterRecovery: 0.98,
      tau: 0.5,
      storm: null,
    },
    stores: { o2: 1500, water: 8000, food: 2500000 },
  },
  {
    id: "expansion",
    name: "Expansion Phase",
    tagline: "12 crew · 3 fission units · large greenhouse",
    description:
      "A second wave of crew arrives. Three fission units and a 520 m² greenhouse push the settlement toward food closure.",
    config: {
      crew: 12,
      solarArea: 3200,
      greenhouseArea: 520,
      batteryKWh: 1600,
      fissionUnits: 3,
      isruUnits: 3,
      waterRecovery: 0.98,
      tau: 0.5,
      storm: null,
    },
    stores: { o2: 3000, water: 20000, food: 6000000 },
  },
  {
    id: "storm",
    name: "Global Dust Storm",
    tagline: "6 crew · solar only · storm from sol 2 to 70",
    description:
      "A planet-encircling dust storm (optical depth τ≈4.5) cuts sunlight by more than 80%. Without fission power the outpost must shed loads to keep life support running.",
    config: {
      crew: 6,
      solarArea: 2000,
      greenhouseArea: 200,
      batteryKWh: 900,
      fissionUnits: 0,
      isruUnits: 2,
      waterRecovery: 0.98,
      tau: 0.5,
      storm: { startSol: 2, endSol: 70, tau: 4.5 },
    },
    stores: { o2: 1800, water: 9000, food: 2000000 },
  },
  {
    id: "solar",
    name: "Solar Only",
    tagline: "6 crew · no fission · keep the arrays clean",
    description:
      "No fission power. The outpost works on clear days, but dust slowly coats the arrays. Send the rover to clean them before the night-time deficit forces load shedding.",
    config: {
      crew: 6,
      solarArea: 2600,
      greenhouseArea: 300,
      batteryKWh: 1400,
      fissionUnits: 0,
      isruUnits: 2,
      waterRecovery: 0.98,
      tau: 0.5,
      storm: null,
    },
    stores: { o2: 1800, water: 9000, food: 2400000 },
  },
];

export const CONFIG_LIMITS = {
  crew: { min: 1, max: 48, step: 1, label: "Crew", unit: "" },
  solarArea: { min: 0, max: 8000, step: 100, label: "Solar array area", unit: "m²" },
  greenhouseArea: { min: 0, max: 2000, step: 20, label: "Greenhouse growing area", unit: "m²" },
  batteryKWh: { min: 50, max: 5000, step: 50, label: "Battery storage", unit: "kWh" },
  fissionUnits: { min: 0, max: 6, step: 1, label: "Fission units (10 kWe)", unit: "" },
  isruUnits: { min: 0, max: 8, step: 1, label: "CO₂→O₂ ISRU units", unit: "" },
  waterRecovery: { min: 0.6, max: 0.99, step: 0.01, label: "Water recovery", unit: "%" },
  tau: { min: 0.1, max: 6, step: 0.1, label: "Dust optical depth τ", unit: "" },
};

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
