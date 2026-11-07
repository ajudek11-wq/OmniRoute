import { fmtSols } from "../sim/engine.js";

const kg = (v) => `${Math.round(v).toLocaleString("en-US")} kg`;
const kw = (v) => `${v.toFixed(1)} kW`;
const pct = (v) => `${Math.round(v * 100)}%`;
const perSol = (v, u = "kg") => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} ${u}/sol`;

/**
 * Each entry: copy for the inspector + live telemetry rows + operable systems.
 * telemetry(app) → [[label, value, status?]]
 */
export const STRUCTURE_INFO = {
  habitat: {
    name: "Crew Habitat",
    eyebrow: "Pressurised · 4 levels",
    blurb:
      "A 20 m pressurised dome, bermed with piled regolith for radiation shielding. Life support, galley, crew quarters and the operations deck live here.",
    facts: [
      "Curiosity's RAD instrument measured roughly 0.64 mSv per day of radiation on the surface. Regolith mass overhead is the cheapest shield available.",
      "Surface pressure averages about 0.6 kPa, under 1% of Earth's. Every seal, hatch and airlock cycle matters.",
    ],
    telemetry: ({ sim, summary }) => [
      ["Crew aboard", `${sim.config.crew}`],
      ["Oxygen store", kg(sim.stores.o2), summary.o2.status],
      ["O₂ reserve", fmtSols(summary.o2.reserve), summary.o2.status],
      ["Life-support load", kw(sim.flows.loads.habitat)],
      ["Power status", sim.powerDeficit ? "DEFICIT" : Object.keys(sim.shed).length ? "Shedding" : "Nominal", summary.power.status],
    ],
    systems: ["conservation"],
  },
  lab: {
    name: "Science Laboratory",
    eyebrow: "Geology · Astrobiology",
    blurb:
      "Sample handling, microscopy and gas analysis. The weather mast logs wind, pressure and dust opacity every few minutes.",
    facts: [
      "MOXIE on Perseverance made about 122 g of oxygen from Martian CO₂ across 16 runs (2021–2023), peaking at roughly 12 g per hour. This outpost's ISRU units are a scaled-up version of that idea.",
    ],
    telemetry: ({ sim }) => [
      ["Status", sim.shed.lab ? "Powered down (load shed)" : sim.systems.conservation ? "Standby (conservation)" : "Operational"],
      ["Atmospheric opacity τ", sim.flows.tau.toFixed(2)],
      ["Sunlight transmission", pct(sim.flows.transmission)],
      ["Load", kw(sim.flows.loads.lab)],
    ],
    systems: ["isruO2"],
  },
  greenhouse: {
    name: "Greenhouse",
    eyebrow: "Bioregenerative life support",
    blurb:
      "Hydroponic beds under a pressurised glazing tunnel. Red-blue LEDs top up the weak Martian sunlight. Crops supply food and some oxygen, and their transpired water is recovered.",
    facts: [
      "Mars receives about 43% of the sunlight Earth does (590 vs 1,361 W/m² above the atmosphere).",
      "Yields here are a conservative educational estimate. Real closed-loop yields depend on crop, light and CO₂ levels.",
    ],
    telemetry: ({ sim, summary }) => [
      ["Growing area", `${sim.config.greenhouseArea} m²`],
      ["Lighting", sim.shed.greenhouseLights ? "Shed (power)" : sim.systems.greenhouseLights ? "On" : "Off"],
      ["Food output", `${Math.round(sim.flows.foodProd).toLocaleString("en-US")} kcal/sol`],
      ["Food closure", pct(summary.closures.food), summary.food.status],
      ["Plant O₂", perSol(sim.config.greenhouseArea * 0.03 * sim.flows.lightFactor)],
      ["Lighting load", kw(sim.flows.loads.greenhouseLights)],
    ],
    systems: ["greenhouseLights"],
  },
  solar: {
    name: "Solar Field",
    eyebrow: "Single-axis trackers",
    blurb:
      "Rows of east–west tracking arrays. Output follows the sun, drops to zero at night and collapses in dust storms. Settled dust slowly reduces it every sol.",
    facts: [
      "The MER rovers lost a few tenths of a percent of array output per sol to dust, partly restored by occasional wind 'cleaning events'.",
      "Opportunity fell silent in 2018 when a planet-encircling storm pushed optical depth above 10.",
    ],
    telemetry: ({ sim, app }) => [
      ["Array area", `${sim.config.solarArea.toLocaleString("en-US")} m²`],
      ["Output now", kw(sim.flows.solarKW)],
      ["Panel cleanliness", pct(sim.dust), sim.dust < 0.85 ? "caution" : "nominal"],
      ["Sun elevation", `${((Math.asin(Math.max(-1, Math.min(1, sim.flows.sunY))) * 180) / Math.PI).toFixed(0)}°`],
      ["Modules shown", `${app.panelCount} of ${Math.round(sim.config.solarArea / 18)}`],
    ],
    actions: [{ id: "clean-panels", label: "Dispatch rover to clean arrays" }],
  },
  battery: {
    name: "Energy Storage",
    eyebrow: "Lithium-ion bank",
    blurb:
      "Four containerised battery modules carry the outpost through the night: about 12.3 hours of darkness at equinox.",
    facts: ["When storage runs out, loads are shed in priority order: greenhouse lights first, life support never."],
    telemetry: ({ sim, summary }) => [
      ["Charge", `${pct(summary.power.soc)} · ${Math.round(sim.stores.battery)} / ${sim.config.batteryKWh} kWh`, summary.power.status],
      ["Generation", kw(sim.flows.genKW)],
      ["Load served", kw(sim.flows.servedKW)],
      ["Net", `${sim.flows.netKW >= 0 ? "+" : "−"}${Math.abs(sim.flows.netKW).toFixed(1)} kW`],
      ["Curtailed", kw(sim.flows.curtailedKW)],
    ],
  },
  comms: {
    name: "Communications",
    eyebrow: "Deep-space relay",
    blurb: "A tracking dish for direct-to-Earth links, plus UHF relay through orbiting spacecraft.",
    facts: [
      "One-way light time between Earth and Mars ranges from about 3 to 22 minutes, so real-time control from Earth is impossible.",
      "Roughly every 26 months the Sun passes between the planets (solar conjunction) and communications pause for about two weeks.",
    ],
    telemetry: ({ sim }) => [
      ["Link", "Locked · X-band"],
      ["One-way light time", "12.6 min (assumed)"],
      ["Load", kw(sim.flows.loads.comms)],
    ],
    actions: [{ id: "send-report", label: "Transmit status report to Earth" }],
  },
  water: {
    name: "Water & ISRU Plant",
    eyebrow: "Ground-ice extraction",
    blurb:
      "Excavated ice-rich regolith is heated and the vapour condensed into storage tanks. A recycler recovers almost all wastewater.",
    facts: [
      "Orbital radar (SHARAD) and fresh impact craters imaged by HiRISE point to ice-rich ground at mid-latitudes such as Arcadia Planitia.",
      "The ISS water system demonstrated about 98% water recovery in 2023.",
    ],
    telemetry: ({ sim, summary }) => [
      ["Water store", kg(sim.stores.water), summary.water.status],
      ["Extraction", sim.shed.waterExtraction ? "Shed (power)" : sim.systems.waterExtraction ? perSol(sim.flows.waterExtracted) : "Off"],
      ["Recycler", sim.shed.recycler ? "Shed (power)" : sim.systems.recycler ? `${Math.round(sim.config.waterRecovery * 100)}% recovery` : "Off"],
      ["Reserve", fmtSols(summary.water.reserve), summary.water.status],
    ],
    systems: ["waterExtraction", "recycler"],
  },
  garage: {
    name: "Rover Garage",
    eyebrow: "Maintenance & charging",
    blurb: "Shelter, charging and dust removal for the exploration rover.",
    facts: ["Mid-latitude nights fall well below −70 °C. Vehicles and batteries need heaters and insulation to survive them."],
    telemetry: ({ rover }) => [
      ["Rover", rover.task],
      ["Rover battery", pct(rover.battery)],
      ["Odometer", `${(rover.odometer / 1000).toFixed(2)} km`],
    ],
    actions: [{ id: "rover-home", label: "Recall rover to garage" }],
  },
  landing: {
    name: "Landing Zone",
    eyebrow: "Sintered regolith pad",
    blurb:
      "A prepared pad 300 m from the habitat. Rocket plumes blast regolith outward at high speed; a hardened pad and distance protect the settlement.",
    facts: ["Mars' gravity is 3.71 m/s², about 38% of Earth's, which makes ascent far cheaper than leaving Earth."],
    telemetry: () => [
      ["Pad status", "Clear"],
      ["Ascent vehicle", "Fuelled · standby"],
      ["Next resupply window", "~26 months (synodic period)"],
    ],
  },
  fission: {
    name: "Fission Surface Power",
    eyebrow: "10 kWe units",
    blurb:
      "Compact fission reactors give steady power through night and storms. They sit inside a regolith berm, well away from the habitat.",
    facts: ["NASA's KRUSTY test (2018) demonstrated a kilowatt-class fission reactor. The Kilopower concept scales to 10 kWe units."],
    telemetry: ({ sim }) => [
      ["Units installed", `${sim.config.fissionUnits}`],
      ["Output", kw(sim.flows.fissionKW)],
      ["Share of generation", sim.flows.genKW > 0 ? pct(sim.flows.fissionKW / sim.flows.genKW) : "—"],
    ],
  },
};

export const SYSTEM_LABELS = {
  greenhouseLights: { label: "Greenhouse lighting", hint: "Food & plant O₂ vs. a large power draw" },
  isruO2: { label: "CO₂ → O₂ production", hint: "Oxygen from the atmosphere" },
  waterExtraction: { label: "Ice extraction", hint: "Water from ground ice" },
  recycler: { label: "Water recycler", hint: "Recovers wastewater" },
  conservation: { label: "Conservation mode", hint: "−20% habitat load, lab off" },
};
