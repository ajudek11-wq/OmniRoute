/** Graphics tiers, device detection and a live performance governor. */

export const TIERS = {
  low: {
    name: "Low",
    dprCap: 1,
    antialias: false,
    shadows: 0,
    shadowEvery: 1,
    terrain: 160,
    rocks: 500,
    rockDetail: 1,
    particles: 90,
    stars: 700,
    texSize: 512,
    surfSize: 128,
    envMap: false,
    envSize: 64,
    dustDevil: false,
    terrainLow: true,
  },
  balanced: {
    name: "Balanced",
    dprCap: 1.6,
    antialias: true,
    shadows: 1024,
    shadowEvery: 2,
    terrain: 200,
    rocks: 1300,
    rockDetail: 1,
    particles: 160,
    stars: 1300,
    texSize: 512,
    surfSize: 256,
    envMap: true,
    envSize: 64,
    dustDevil: true,
    terrainLow: false,
  },
  high: {
    name: "High",
    dprCap: 2,
    antialias: true,
    shadows: 2048,
    shadowEvery: 1,
    terrain: 300,
    rocks: 2600,
    rockDetail: 2,
    particles: 260,
    stars: 2200,
    texSize: 1024,
    surfSize: 512,
    envMap: true,
    envSize: 128,
    dustDevil: true,
    terrainLow: false,
  },
};

const PERF_KEY = "mars-frontier:perf:v1";

export function isMobileDevice() {
  const ua = navigator.userAgent || "";
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || iPadOS;
}

function readPerf() {
  try {
    return JSON.parse(localStorage.getItem(PERF_KEY) || "null");
  } catch {
    return null;
  }
}

export function rememberPerf(tier) {
  try {
    localStorage.setItem(PERF_KEY, JSON.stringify({ tier, at: Date.now() }));
  } catch {
    /* storage unavailable */
  }
}

/** Device guess, refined by what the governor measured on a previous visit. */
export function detectTier() {
  const measured = readPerf()?.tier;
  if (measured && TIERS[measured]) return measured;
  const mobile = isMobileDevice();
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (mobile) return cores <= 4 && mem <= 2 ? "low" : "balanced";
  return cores >= 6 ? "high" : "balanced";
}

export function resolveQuality(setting) {
  const s = setting === "medium" ? "balanced" : setting;
  const auto = !s || s === "auto";
  const key = auto ? detectTier() : s;
  const tier = TIERS[key] ?? TIERS.balanced;
  return { key, auto, ...tier, dpr: Math.min(window.devicePixelRatio || 1, tier.dprCap) };
}

/**
 * Holds the frame rate up: first lowers render resolution, then (in Automatic mode) sheds
 * shadows and environment updates, and records a lower tier for the next launch.
 */
export class FrameGovernor {
  constructor(renderer, quality, hooks = {}) {
    this.renderer = renderer;
    this.quality = quality;
    this.hooks = hooks;
    this.max = quality.dpr;
    this.min = Math.min(1, quality.dpr);
    this.dpr = quality.dpr;
    this.frames = 0;
    this.elapsed = 0;
    this.fps = 60;
    this.goodStreak = 0;
    this.badStreak = 0;
    this.stage = 0;
    this.enabled = true;
    this.paused = false;
  }

  sample(dt) {
    if (this.paused) return;
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < 1.5) return;
    this.fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    if (!this.enabled) return;
    if (this.fps < 42 && this.dpr > this.min) {
      this.dpr = Math.max(this.min, this.dpr - 0.2);
      this.renderer.setPixelRatio(this.dpr);
      this.goodStreak = 0;
      return;
    }
    if (this.fps < 28 && this.dpr <= this.min && this.quality.auto) {
      this.badStreak++;
      if (this.badStreak >= 2) {
        this.badStreak = 0;
        this.stage++;
        this.hooks.degrade?.(this.stage);
      }
      return;
    }
    this.badStreak = 0;
    if (this.fps > 57 && this.dpr < this.max) {
      this.goodStreak++;
      if (this.goodStreak >= 3) {
        this.dpr = Math.min(this.max, this.dpr + 0.2);
        this.renderer.setPixelRatio(this.dpr);
        this.goodStreak = 0;
      }
    }
  }
}
