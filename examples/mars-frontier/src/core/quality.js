/** Device-aware rendering tiers + an adaptive resolution governor. */

export const TIERS = {
  low: { name: "Low", dprCap: 1, antialias: false, shadows: 0, terrain: 150, rocks: 450, particles: 160, stars: 700, shadowEvery: 1 },
  medium: { name: "Medium", dprCap: 1.6, antialias: true, shadows: 1024, terrain: 210, rocks: 1100, particles: 320, stars: 1300, shadowEvery: 3 },
  high: { name: "High", dprCap: 2, antialias: true, shadows: 2048, terrain: 300, rocks: 2400, particles: 600, stars: 2200, shadowEvery: 1 },
};

export function isMobileDevice() {
  const ua = navigator.userAgent || "";
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || iPadOS;
}

export function detectTier() {
  const mobile = isMobileDevice();
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (mobile) return cores <= 4 && mem <= 2 ? "low" : "medium";
  return cores >= 6 ? "high" : "medium";
}

export function resolveQuality(setting) {
  const key = setting && setting !== "auto" ? setting : detectTier();
  const tier = TIERS[key] ?? TIERS.medium;
  const dpr = Math.min(window.devicePixelRatio || 1, tier.dprCap);
  return { key, ...tier, dpr };
}

/** Lowers (and cautiously restores) render resolution to hold a smooth frame rate. */
export class FrameGovernor {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.max = quality.dpr;
    this.min = Math.min(1, quality.dpr);
    this.dpr = quality.dpr;
    this.frames = 0;
    this.elapsed = 0;
    this.fps = 60;
    this.goodStreak = 0;
    this.enabled = true;
  }

  sample(dt) {
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < 1.5) return;
    this.fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    if (!this.enabled) return;
    if (this.fps < 42 && this.dpr > this.min) {
      this.dpr = Math.max(this.min, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.goodStreak = 0;
    } else if (this.fps > 57 && this.dpr < this.max) {
      this.goodStreak++;
      if (this.goodStreak >= 3) {
        this.dpr = Math.min(this.max, this.dpr + 0.25);
        this.renderer.setPixelRatio(this.dpr);
        this.goodStreak = 0;
      }
    }
  }
}
