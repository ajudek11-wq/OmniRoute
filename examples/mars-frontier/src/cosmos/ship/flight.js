/**
 * Pure mission logic for the Pathfinder shuttle (no three.js): the phase machine, leg durations,
 * arrival profiles per descent type, real-world travel facts and display formatting.
 * Everything here is deterministic so it can be unit-tested with `node --test`.
 *
 * Phases: docked → undock → cruise → arrival (→ free → rejoin → arrival) → landed → exiting
 */

/** Length of the (compressed, fictional) cruise leg in seconds. */
export const CRUISE_S = { moon: 48, orbit: 45, venus: 55, mars: 62, asteroids: 66, jupiter: 78, europa: 80, saturn: 84, titan: 86, deep: 46 };
export const UNDOCK_S = 16;
/** How long autopilot waits at a free-flight hold before finishing on its own. */
export const HOLD_AUTO_S = 9;
export const REJOIN_S = 6;

export function cruiseSeconds(id) {
  return CRUISE_S[id] ?? 60;
}

/**
 * Arrival profiles. `events` fire once when progress s crosses them; `hold` marks where free flight
 * is offered (orbit / rendezvous). `word` is what the cockpit says when the leg is complete.
 */
export const ARRIVALS = {
  atmospheric: { duration: 48, word: "Touchdown", events: [[0.02, "entry"], [0.34, "sky"], [0.52, "retro"], [0.86, "dust"], [0.97, "contact"], [1, "touchdown"]] },
  powered: { duration: 42, word: "Touchdown", events: [[0.02, "deorbit"], [0.38, "pitchover"], [0.5, "retro"], [0.86, "dust"], [0.97, "contact"], [1, "touchdown"]] },
  docking: { duration: 46, word: "Docked", events: [[0.02, "approach"], [0.5, "align"], [0.62, "final"], [1, "latch"]] },
  aerostat: { duration: 46, word: "Docked", events: [[0.02, "cloudtops"], [0.22, "dive"], [0.55, "gondola"], [0.7, "final"], [1, "latch"]] },
  rendezvous: { duration: 46, word: "Docked", hold: 0.42, events: [[0.02, "match"], [0.42, "free"], [0.62, "final"], [1, "latch"]] },
  orbit: { duration: 50, word: "Docked", hold: 0.5, events: [[0.02, "insertion"], [0.34, "burnout"], [0.5, "free"], [0.66, "final"], [1, "latch"]] },
  parachute: { duration: 54, word: "Touchdown", events: [[0.02, "entry"], [0.22, "chute"], [0.84, "retro"], [0.97, "contact"], [1, "touchdown"]] },
  jump: { duration: 34, word: "Docked", events: [[0.02, "fold"], [0.36, "emerge"], [0.6, "final"], [1, "latch"]] },
};

export function arrivalProfile(type) {
  return ARRIVALS[type] ?? ARRIVALS.powered;
}

/** Event ids whose position lies in (s0, s1]. */
export function eventsBetween(profile, s0, s1) {
  return profile.events.filter(([at]) => at > s0 && at <= s1).map(([, id]) => id);
}

/**
 * Real travel times (established) shown on the mission panel during cruise, plus the fiction note.
 * Sources: mission timelines published by NASA / ESA.
 */
export const REAL_TRIP = {
  moon: ["Apollo crews reached the Moon in about 3 days.", "Artemis I (uncrewed, 2022) took about 5 days on a low-energy path."],
  orbit: ["From launch, Crew Dragon usually reaches the ISS in about a day; Soyuz fast-track rendezvous takes about 3 hours.", "Dropping from ~20,000 km to 400 km on a Hohmann transfer takes about 3 hours (orbital mechanics)."],
  venus: ["A Hohmann transfer to Venus takes about 5 months.", "ESA's Venus Express took 153 days (Nov 2005 – Apr 2006)."],
  mars: ["A Hohmann transfer to Mars takes about 7–9 months.", "Perseverance launched July 2020 and landed February 2021: almost 7 months."],
  asteroids: ["Dawn took almost 4 years to reach Vesta (2007–2011), using a Mars gravity assist.", "Psyche launched in October 2023 and is due at 16 Psyche in 2029."],
  jupiter: ["Juno took 5 years (2011–2016); Galileo took 6 (1989–1995).", "Spacecraft need gravity assists or very large rockets to get there."],
  europa: ["Europa Clipper launched in October 2024 and is due at Jupiter in 2030: about 5.5 years.", "ESA's JUICE (launched 2023) is due in 2031."],
  saturn: ["Cassini took almost 7 years (October 1997 – July 2004) with four gravity assists."],
  titan: ["The Huygens probe rode Cassini for 7 years and landed on Titan in January 2005.", "Dragonfly is planned to launch in 2028 and arrive in the mid-2030s."],
  deep: ["Voyager 1, moving at about 17 km/s, would need more than 70,000 years to cover the 4.2 light-years to the nearest star.", "No known technology can make this trip in a human lifetime."],
};

export const FICTION_NOTE = "The Pathfinder shuttle and its speed are fiction: this trip is compressed into about a minute.";

/** Straight-line range at the start of cruise (m), rounded typical values: labelled "simplified". */
export const CRUISE_RANGE = {
  moon: 3.84e8,
  orbit: 2.0e7,
  venus: 4.1e10,
  mars: 7.8e10,
  asteroids: 2.7e11,
  jupiter: 6.3e11,
  europa: 6.3e11,
  saturn: 1.28e12,
  titan: 1.28e12,
  deep: 3.0e8,
};

/** Range at the end of cruise (m) for each destination. */
export const CRUISE_END = {
  moon: 9.0e6,
  orbit: 4.0e3,
  venus: 2.6e7,
  mars: 2.2e7,
  asteroids: 4.0e4,
  jupiter: 2.0e8,
  europa: 7.0e6,
  saturn: 1.6e8,
  titan: 1.1e7,
  deep: 2.0e4,
};

export const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** Logarithmic approach: range shrinks by a constant factor per unit progress (the body grows smoothly). */
export function cruiseRange(id, s) {
  const d0 = CRUISE_RANGE[id] ?? 1e9;
  const d1 = CRUISE_END[id] ?? 1e7;
  const e = s * s * (3 - 2 * s) * 0.35 + s * 0.65;
  return d0 * Math.pow(d1 / d0, clamp(e, 0, 1));
}

export function fmtDist(m) {
  if (!isFinite(m)) return "—";
  const a = Math.abs(m);
  if (a < 1000) return `${a.toFixed(a < 10 ? 1 : 0)} m`;
  if (a < 1e6) return `${(a / 1000).toFixed(a < 1e5 ? 1 : 0)} km`;
  if (a < 1e9) return `${Math.round(a / 1000).toLocaleString("en-US")} km`;
  return `${(a / 1e9).toFixed(a < 1e10 ? 2 : 1)} million km`;
}

export function fmtSpeed(ms) {
  const a = Math.abs(ms);
  if (a < 100) return `${a.toFixed(1)} m/s`;
  if (a < 1e5) return `${(a / 1000).toFixed(2)} km/s`;
  return `${Math.round(a / 1000).toLocaleString("en-US")} km/s`;
}

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return "--:--";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The mission state machine. Input each frame: { throttle 0..1, align 0..1 (how well the nose points at
 * the target in manual cruise), anyInput (stick touched) }.
 */
export class Mission {
  constructor({ to = "moon", descent = "powered" } = {}) {
    this.to = to;
    this.type = descent;
    this.profile = arrivalProfile(descent);
    this.cruiseS = cruiseSeconds(to);
    this.phase = "docked";
    this.t = 0; // time in phase
    this.s = 0; // progress 0..1 in phase
    this.auto = true;
    this.rate = 0;
    this.holdT = 0;
    this.events = [];
  }

  get flying() {
    return this.phase === "undock" || this.phase === "cruise" || this.phase === "arrival" || this.phase === "free" || this.phase === "rejoin";
  }

  set(phase) {
    this.phase = phase;
    this.t = 0;
    this.s = 0;
    this.holdT = 0;
    this.events.push(`phase:${phase}`);
  }

  launch() {
    if (this.phase !== "docked") return false;
    this.set("undock");
    return true;
  }

  setAuto(on) {
    this.auto = on;
    if (on && this.phase === "free") {
      this.phase = "rejoin";
      this.t = 0;
      this.events.push("phase:rejoin");
    }
    if (!on && this.phase === "arrival" && this.profile.hold != null && Math.abs(this.s - this.profile.hold) < 1e-6) {
      this.phase = "free";
      this.t = 0;
      this.events.push("phase:free");
    }
  }

  /** LAND/DOCK: hand the final leg to the computer (same as autopilot). */
  land() {
    if (this.phase === "free") this.setAuto(true);
    else this.auto = true;
  }

  skip() {
    if (this.phase === "undock" || this.phase === "cruise") {
      this.set("arrival");
      return true;
    }
    if (this.phase === "arrival" || this.phase === "free" || this.phase === "rejoin") {
      const s0 = this.s;
      this.phase = "arrival";
      this.s = 1;
      this.events.push(...eventsBetween(this.profile, s0, 1));
      this.set("landed");
      return true;
    }
    return false;
  }

  /** Remaining seconds of the current leg at the present rate. */
  eta() {
    const dur = this.phase === "cruise" ? this.cruiseS : this.phase === "undock" ? UNDOCK_S : this.profile.duration;
    return ((1 - this.s) * dur) / Math.max(0.2, this.rate || 1);
  }

  update(dt, input = {}) {
    const thr = clamp(input.throttle ?? 0.8, 0, 1);
    this.t += dt;
    switch (this.phase) {
      case "undock": {
        this.rate = 1;
        this.s = Math.min(1, this.s + dt / UNDOCK_S);
        if (this.s >= 1) this.set("cruise");
        break;
      }
      case "cruise": {
        const align = clamp(input.align ?? 1, 0, 1);
        this.rate = this.auto ? 1 : clamp(0.3 + 1.3 * thr, 0.2, 1.6) * Math.max(0.3, align);
        this.s = Math.min(1, this.s + (dt * this.rate) / this.cruiseS);
        if (this.s >= 1) this.set("arrival");
        break;
      }
      case "arrival": {
        const p = this.profile;
        this.rate = this.auto ? 1 : clamp(0.35 + 1.1 * thr, 0.25, 1.45);
        const s0 = this.s;
        let s1 = Math.min(1, s0 + (dt * this.rate) / p.duration);
        if (p.hold != null && s0 < p.hold && s1 >= p.hold) {
          s1 = p.hold;
          this.holdT = 0;
        }
        this.s = s1;
        this.events.push(...eventsBetween(p, s0, s1));
        if (p.hold != null && s1 === p.hold) {
          if (!this.auto) {
            this.phase = "free";
            this.t = 0;
            this.events.push("phase:free");
          } else {
            this.holdT += dt;
            if (this.holdT >= HOLD_AUTO_S) this.s = p.hold + 1e-6;
          }
        }
        if (this.s >= 1) this.set("landed");
        break;
      }
      case "free":
        this.rate = 0;
        break;
      case "rejoin":
        this.rate = 0;
        if (this.t >= REJOIN_S) {
          this.phase = "arrival";
          this.s = this.profile.hold + 1e-6;
          this.events.push("phase:arrival");
        }
        break;
      default:
        this.rate = 0;
    }
  }

  /** Drain the events raised since the last call. */
  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
