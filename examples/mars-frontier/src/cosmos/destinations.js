/**
 * The destinations on the star map, with the science behind each one.
 * Every note carries a label so the experience never blurs fact and fiction:
 *   established  – measured or observed by missions / instruments
 *   simplified   – real physics, compressed or scaled so it can be seen or reached in VR
 *   hypothesis   – a scientific idea that is argued for but not confirmed
 *   fiction      – invented technology or places (all bases, stations and vehicles not flown)
 */

export const SCI = {
  established: { text: "Established science", color: "#7fe0a8" },
  simplified: { text: "Simplified simulation", color: "#ffd27f" },
  hypothesis: { text: "Scientific hypothesis", color: "#c8a2ff" },
  fiction: { text: "Fictional / speculative", color: "#ff9f7f" },
};

export const DESTINATIONS = [
  {
    id: "mars",
    name: "Mars",
    site: "Frontier Base · Arcadia Planitia",
    color: "#d0703f",
    tex: "mars",
    order: 4,
    au: 1.52,
    descent: "atmospheric",
    notes: [
      ["established", "Mid-latitude ground ice under Arcadia Planitia has been mapped by orbital radar (SHARAD) and exposed by fresh impacts imaged by HiRISE."],
      ["established", "Surface gravity is 0.38 g and the average surface pressure is about 0.6 kPa, under 1% of Earth's."],
      ["fiction", "Frontier Base, its vehicles and its modules are an imagined future settlement."],
    ],
  },
  {
    id: "moon",
    name: "The Moon",
    site: "South pole · Shackleton rim",
    color: "#b9b6ae",
    tex: "moon",
    order: 3.2,
    au: 1,
    descent: "powered",
    notes: [
      ["established", "Craters near the lunar poles never see sunlight; LCROSS (2009) confirmed water ice in one of them, Cabeus."],
      ["established", "With no atmosphere the sky stays black in daylight, shadows are razor-sharp and there is no sound outside."],
      ["established", "From the south pole the Earth always hangs low on the horizon, rocking slightly with libration."],
      ["fiction", "The base, rover and lander here are design concepts, not existing hardware."],
    ],
  },
  {
    id: "orbit",
    name: "Earth Orbit",
    site: "Low Earth orbit · 400 km",
    color: "#6fa8ff",
    tex: "earth_day",
    order: 3,
    au: 1,
    descent: "docking",
    notes: [
      ["established", "At about 400 km, like the ISS, one orbit takes roughly 92 minutes: about 16 sunrises and sunsets a day."],
      ["established", "Astronauts in orbit are not beyond gravity; they float because the station and crew are falling around the Earth together."],
      ["fiction", "Meridian Station is an imagined station, larger than any flown so far."],
    ],
  },
  {
    id: "venus",
    name: "Venus",
    site: "Cloud deck · 55 km altitude",
    color: "#e8c27a",
    tex: "venus_atmos",
    order: 2,
    au: 0.72,
    descent: "aerostat",
    notes: [
      ["established", "The surface is about 465 °C under ~92 bar of CO₂; the Soviet Venera 13 lander survived 127 minutes there in 1982."],
      ["established", "Sulfuric-acid clouds fill roughly 45–70 km altitude. Near 50–55 km, pressure and temperature are close to Earth-surface values."],
      ["hypothesis", "NASA's HAVOC study (2015) proposed crewed airships in that layer; it remains a concept."],
      ["fiction", "The research aerostat and the armoured surface probe are imagined vehicles."],
    ],
  },
  {
    id: "asteroids",
    name: "Asteroid Belt",
    site: "Metal-rich asteroid field",
    color: "#a4978a",
    order: 5,
    au: 2.8,
    descent: "rendezvous",
    notes: [
      ["established", "NASA's Psyche spacecraft is travelling to the metal-rich asteroid 16 Psyche, arriving in 2029."],
      ["simplified", "Real belt asteroids are typically hundreds of thousands of kilometres apart; the field here is packed together so it can be explored."],
      ["fiction", "The mining outpost is an imagined facility."],
    ],
  },
  {
    id: "jupiter",
    name: "Jupiter",
    site: "Observation platform near Callisto",
    color: "#d8b48c",
    tex: "jupiter",
    order: 6,
    au: 5.2,
    descent: "orbit",
    notes: [
      ["established", "The Great Red Spot is a storm larger than Earth that has been observed for at least 150 years; it has been shrinking."],
      ["established", "Callisto orbits outside Jupiter's most intense radiation belts, which is why it is often proposed for a future outpost."],
      ["fiction", "The observation platform is imagined."],
    ],
  },
  {
    id: "europa",
    name: "Europa",
    site: "Conamara Chaos region",
    color: "#cfd8dc",
    order: 6.2,
    au: 5.2,
    descent: "powered",
    notes: [
      ["established", "Galileo's magnetometer found strong evidence of a global salty ocean beneath Europa's ice shell."],
      ["established", "Europa is tidally locked, so from its Jupiter-facing side the giant planet hangs fixed in the sky, about 12° across."],
      ["hypothesis", "Estimates of the ice shell's thickness range from a few kilometres to over 25 km."],
      ["fiction", "The research station and ice-melting probe are imagined."],
    ],
  },
  {
    id: "titan",
    name: "Titan",
    site: "Shore of Ligeia Mare",
    color: "#e0a14a",
    order: 7,
    au: 9.5,
    descent: "parachute",
    notes: [
      ["established", "Titan's nitrogen atmosphere is about 1.5 times as dense at the surface as Earth's; gravity is 0.14 g."],
      ["established", "Cassini's radar mapped seas of liquid methane and ethane in the north, including Ligeia Mare, at about −179 °C."],
      ["established", "NASA's Dragonfly rotorcraft is planned to launch in 2028 to fly between sites on Titan."],
      ["fiction", "The research station and hover vehicle are imagined."],
    ],
  },
  {
    id: "saturn",
    name: "Saturn",
    site: "Above the ring plane",
    color: "#e3cf9c",
    tex: "saturn",
    order: 7.5,
    au: 9.5,
    descent: "orbit",
    notes: [
      ["established", "The main rings span about 280,000 km yet are mostly only around 10 m thick; they are made of water-ice particles."],
      ["established", "Cassini studied Saturn for 13 years before diving into the planet in 2017."],
      ["fiction", "The observation platform is imagined."],
    ],
  },
  {
    id: "deep",
    name: "Deep Space",
    site: "Beyond the Solar System",
    color: "#b58cff",
    order: 9,
    au: 0,
    descent: "jump",
    notes: [
      ["established", "The Event Horizon Telescope imaged the shadows of black holes M87* (2019) and Sagittarius A* (2022)."],
      ["established", "Pulsars are spinning neutron stars; the Crab pulsar rotates about 30 times per second."],
      ["simplified", "The black hole's lensing, the nebula and the pulsar are artistic visualisations placed together for one trip."],
      ["fiction", "Travelling here is impossible with any known technology."],
    ],
  },
];

export const byId = Object.fromEntries(DESTINATIONS.map((d) => [d.id, d]));
