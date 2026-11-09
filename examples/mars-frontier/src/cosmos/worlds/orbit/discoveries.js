/** Discoveries at Meridian Station. Labels follow SCI in src/cosmos/destinations.js. */
export const DISCOVERIES = {
  "orbit-sunrise16": {
    title: "16 sunrises a day",
    short: "One orbit ≈ 92 min → about 16 sunrises and sunsets every 24 h.",
    text: "At ~400 km a circular orbit takes about 92 minutes (T = 2π√(a³/GM)), so crews on the ISS see roughly 16 sunrises and 16 sunsets a day, each lasting only seconds. Here the orbit is compressed to 10 minutes so you can watch it happen.",
    sci: "established",
  },
  "orbit-freefall": {
    title: "Why astronauts float",
    short: "Gravity at 400 km is still ~89% of the surface value: you float because you are falling.",
    text: "Gravity at ISS altitude is about 89% of its surface value (g scales as 1/r²). Astronauts float because they and their station are in free fall together, moving sideways at ~7.7 km/s so that they keep missing the Earth. At the non-rotating hub of this station you share that free fall.",
    sci: "established",
  },
  "orbit-limb": {
    title: "The thin blue line",
    short: "Seen edge-on, the atmosphere is a hair-thin glowing band on the limb.",
    text: "From low orbit the Earth fills about 140° of sky, and its atmosphere appears as a thin blue band hugging the curved limb. About 90% of the atmosphere's mass lies below ~16 km — a layer thinner, relative to the Earth, than the skin of an apple.",
    sci: "established",
  },
  "orbit-citylights": {
    title: "City lights",
    short: "On the night side, cities, roads and coastlines trace themselves in light.",
    text: "Crossing the night side, astronauts see the lights of cities, highways and fishing fleets; the night-side map here is based on satellite night-lights imagery. Lightning in thunderstorms and the airglow layer are also visible from orbit.",
    sci: "established",
  },
  "orbit-aurora": {
    title: "Aurora from above",
    short: "Curtains of green light ring the magnetic poles (brightened here for VR).",
    text: "Aurorae form where charged particles from the Sun, guided by Earth's magnetic field, excite oxygen and nitrogen around 100–300 km up. Oxygen gives the common green (557.7 nm) and high-altitude red light. Astronauts on the ISS often see them below and even beside the station. Brightness and extent are exaggerated here (simplified).",
    sci: "established",
  },
  "orbit-spin-gravity": {
    title: "Gravity from spin",
    short: "a = ω²r: a 225 m ring at 2 rpm gives about 1 g.",
    text: "A rotating ring pushes you toward its axis: the floor supplies the centripetal acceleration a = ω²r. At 2 rpm (ω ≈ 0.2094 rad/s) and r = 225 m, a ≈ 9.9 m/s² ≈ 1 g. Meridian Station is fiction: no rotating crewed station has been built.",
    sci: "fiction",
  },
  "orbit-iss": {
    title: "The ISS, then and now",
    short: "Assembled in orbit since 1998; crewed continuously since 2 November 2000.",
    text: "The first ISS module, Zarya, launched in November 1998. Expedition 1 arrived on 2 November 2000, and the station has been continuously crewed ever since — the longest continuous human presence in space.",
    sci: "established",
  },
  "orbit-veggie": {
    title: "Salad grown in space",
    short: "ISS crews first ate lettuce grown on board (NASA's Veggie) in August 2015.",
    text: "NASA's Veggie plant-growth unit uses red, blue and green LEDs; in August 2015 the Expedition 44 crew ate 'Outredgeous' red romaine lettuce grown in it. Plants find 'up' by light when gravity is absent. The greenhouse racks here are fiction.",
    sci: "established",
  },
  "orbit-tdrs": {
    title: "Talking to the ground",
    short: "The ISS relays voice, video and data through NASA's TDRS satellites in geostationary orbit.",
    text: "Low-orbit stations pass over a ground station for only minutes at a time. The ISS instead talks to Mission Control mostly through NASA's Tracking and Data Relay Satellites (TDRS), 36,000 km up, giving near-continuous coverage.",
    sci: "established",
  },
  "orbit-silence": {
    title: "Silence of vacuum",
    short: "Outside, only your suit makes sound: there is no air to carry it.",
    text: "Sound is a pressure wave and needs a medium. In vacuum, an astronaut hears nothing from outside — only their own breathing, the suit's fans and pumps, and sounds conducted through anything they touch.",
    sci: "established",
  },
};
