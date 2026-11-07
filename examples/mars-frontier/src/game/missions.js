/**
 * Mission system. Missions complete from discrete events (inspect, action, survey…)
 * or from continuous state checks evaluated on each tick.
 */
export const MISSIONS = [
  {
    id: "arrival",
    title: "Arrival",
    brief: "Inspect the crew habitat.",
    hint: "Tap the dome or its label.",
    focus: "habitat",
    on: (e) => e.type === "inspect" && e.id === "habitat",
    codex: "The habitat dome is bermed with regolith: the cheapest radiation shield on Mars is the ground itself.",
  },
  {
    id: "power-audit",
    title: "Power Audit",
    brief: "Inspect the solar field and the energy storage bank.",
    hint: "Both are east of the habitat.",
    focus: "solar",
    steps: ["solar", "battery"],
    on: (e, st) => {
      if (e.type === "inspect" && (e.id === "solar" || e.id === "battery")) st[e.id] = true;
      return st.solar && st.battery;
    },
    codex: "Solar arrays track the sun east to west. Batteries bridge the 12-hour night. Fission units carry the load through storms.",
  },
  {
    id: "greenhouse",
    title: "Greenhouse Rounds",
    brief: "Check crop output in the greenhouse.",
    hint: "The glass tunnel north of the habitat.",
    focus: "greenhouse",
    on: (e) => e.type === "inspect" && e.id === "greenhouse",
    codex: "Feeding one person entirely from crops takes tens of square metres of lit growing area, plus the power to light it.",
  },
  {
    id: "signal",
    title: "Signal Home",
    brief: "Transmit a status report to Earth from the comms array.",
    hint: "Open Communications and transmit.",
    focus: "comms",
    on: (e) => e.type === "action" && e.id === "send-report",
    codex: "Your report reaches Earth in 3–22 minutes depending on planetary geometry. Any reply takes just as long.",
  },
  {
    id: "shakedown",
    title: "Shakedown Drive",
    brief: "Drive the rover at least 150 m.",
    hint: "Switch to Rover view and tap the ground to drive.",
    focus: "rover",
    tick: (ctx) => ctx.rover.odometer >= 150,
    codex: "Real Mars rovers creep along at centimetres per second. Frontier's crewed rover is faster, and this simulation is faster still.",
  },
  {
    id: "geology",
    title: "Field Geology",
    brief: "Survey any of the three geology sites.",
    hint: "Tap a blue survey beacon, then send the rover.",
    focus: "site:alpha",
    on: (e) => e.type === "survey",
    codex: "Crater rims are natural drill cores: impacts lift material from depth onto the surface.",
  },
  {
    id: "deep-survey",
    title: "Deep Survey",
    brief: "Survey all three geology sites: Alpha, Beta and Gamma.",
    hint: "Gamma hides exposed ice.",
    focus: "site:gamma",
    steps: ["alpha", "beta", "gamma"],
    on: (e, st) => {
      if (e.type === "survey") st[e.id] = true;
      return st.alpha && st.beta && st.gamma;
    },
    codex: "Fresh mid-latitude craters exposing bright ice confirmed that ice-rich ground lies close to the surface here.",
  },
  {
    id: "dust-patrol",
    title: "Dust Patrol",
    brief: "Send the rover to clean the solar arrays.",
    hint: "Open the Solar Field and dispatch the rover.",
    focus: "solar",
    on: (e) => e.type === "clean",
    codex: "Every fraction of a percent of dust removed is power you don't have to generate.",
  },
  {
    id: "blue-sunset",
    title: "Blue Hour",
    brief: "Witness a Martian sunset.",
    hint: "Speed up time and watch the sky near the sun.",
    focus: null,
    tick: (ctx) => ctx.sunset,
    codex: "Martian sunsets glow blue: fine dust scatters blue light forward, toward the observer, near the sun.",
  },
  {
    id: "full-sol",
    title: "Steady State",
    brief: "Run a full sol with every system nominal and nothing shed.",
    hint: "Watch the night-time battery margin.",
    focus: "battery",
    tick: (ctx) => ctx.sim.nominalSeconds >= 88775,
    codex: "One full sol of nominal operations: the outpost can sustain its crew through a complete day–night cycle.",
  },
  {
    id: "engineer",
    title: "Engineer Autonomy",
    brief: "Reach 95% settlement autonomy, in any configuration.",
    hint: "Food is usually the weakest loop. Try the Scenario tab.",
    focus: "greenhouse",
    tick: (ctx) => ctx.summary && ctx.summary.autonomy >= 0.95 && ctx.sim.t > 3600 * 6,
    codex: "Autonomy is set by the weakest loop. Closing food takes area and light, and that means power.",
  },
  {
    id: "storm",
    title: "Storm Survivor",
    brief: "Load the Global Dust Storm scenario and reach sol 72 without a failure.",
    hint: "Shed loads, conserve, and keep life support alive.",
    focus: "solar",
    tick: (ctx) => ctx.sim.scenarioId === "storm" && !ctx.sim.failed && ctx.sol >= 72,
    codex: "You rode out a planet-encircling dust storm, the event that ended Opportunity's 15-year mission.",
  },
];

export class MissionManager {
  constructor(saved, onComplete) {
    this.state = {};
    for (const m of MISSIONS) {
      const s = saved?.[m.id];
      this.state[m.id] = { done: !!s?.done, progress: s?.progress ?? {}, at: s?.at ?? null };
    }
    this.onComplete = onComplete;
  }

  get current() {
    return MISSIONS.find((m) => !this.state[m.id].done) ?? null;
  }

  get doneCount() {
    return MISSIONS.filter((m) => this.state[m.id].done).length;
  }

  emit(event, ctx) {
    for (const m of MISSIONS) {
      const st = this.state[m.id];
      if (st.done || !m.on) continue;
      if (m.on(event, st.progress, ctx)) this.complete(m, ctx);
    }
  }

  tick(ctx) {
    for (const m of MISSIONS) {
      const st = this.state[m.id];
      if (st.done || !m.tick) continue;
      if (m.tick(ctx)) this.complete(m, ctx);
    }
  }

  complete(m, ctx) {
    const st = this.state[m.id];
    st.done = true;
    st.at = ctx?.sol ?? null;
    this.onComplete?.(m);
  }

  serialize() {
    return JSON.parse(JSON.stringify(this.state));
  }

  reset() {
    for (const k of Object.keys(this.state)) this.state[k] = { done: false, progress: {}, at: null };
  }
}
