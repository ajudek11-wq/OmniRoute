/**
 * VR graphics tiers and a GPU-based recommendation.
 *
 * The browser only reports the GPU model (WEBGL_debug_renderer_info); it cannot measure the PC directly,
 * so the recommendation is a starting point. The in-headset governor then backs off (more foveation,
 * then fewer effects) if frames miss the headset's refresh budget.
 *
 *   framebufferScale – multiplies the runtime's recommended per-eye resolution (SteamVR decides the base)
 *   foveation        – 0 none … 1 max (only applies where the runtime supports fixed foveation)
 *   hz               – requested refresh rate (PS VR2 on PC: 90 or 120 Hz)
 *   scene            – the scene detail tier used by the Mars settlement and the worlds
 */
export const VR_TIERS = {
  low: { name: "Low", framebufferScale: 0.7, foveation: 1, hz: 90, scene: "low" },
  balanced: { name: "Balanced", framebufferScale: 0.9, foveation: 0.6, hz: 90, scene: "balanced" },
  high: { name: "High", framebufferScale: 1.0, foveation: 0.35, hz: 90, scene: "high" },
  ultra: { name: "Ultra", framebufferScale: 1.25, foveation: 0.15, hz: 120, scene: "high" },
};
export const VR_TIER_ORDER = ["low", "balanced", "high", "ultra"];

export function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(raw ?? "");
  } catch {
    return "";
  }
}

/** Map a GPU string to a VR tier. Pure, unit-tested. */
export function recommendVrTier(gpu) {
  const g = String(gpu).toLowerCase();
  if (!g || /swiftshader|llvmpipe|software|basic render/.test(g)) return { tier: "low", reason: "software renderer — VR will not run smoothly" };
  if (/intel|uhd|iris|apple m1\b|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|adreno|mali/.test(g) && !/arc a7/.test(g))
    return { tier: "low", reason: "integrated graphics — below PS VR2 PC requirements" };
  const num = (re) => {
    const m = g.match(re);
    return m ? parseInt(m[1], 10) : 0;
  };
  const rtx = num(/rtx\s*(\d{4})/);
  const gtx = num(/gtx\s*(\d{3,4})/);
  const rx = num(/rx\s*(\d{4})/);
  if (rtx) {
    const series = Math.floor(rtx / 1000);
    const model = rtx % 100;
    if ((series >= 4 && model >= 80) || (series >= 5 && model >= 70)) return { tier: "ultra", reason: `RTX ${rtx}` };
    if ((series === 3 && model >= 70) || (series >= 4 && model >= 60)) return { tier: "high", reason: `RTX ${rtx}` };
    return { tier: "balanced", reason: `RTX ${rtx}` };
  }
  if (rx) {
    const series = Math.floor(rx / 1000);
    const model = rx % 1000;
    if (series >= 7 && model >= 900) return { tier: "ultra", reason: `RX ${rx}` };
    if (series >= 6 && model >= 700) return { tier: "high", reason: `RX ${rx}` };
    if (series >= 6 && model >= 600) return { tier: "balanced", reason: `RX ${rx}` };
    return { tier: "low", reason: `RX ${rx}` };
  }
  if (/arc a7/.test(g)) return { tier: "balanced", reason: "Intel Arc A7xx" };
  if (gtx >= 1060) return { tier: "low", reason: `GTX ${gtx} — at the PS VR2 minimum` };
  return { tier: "balanced", reason: "unrecognised GPU — starting at Balanced" };
}

/**
 * In-headset governor: watches frame time against the refresh budget and steps down live.
 * Calls onStep(level) with 1 (more foveation), 2 (drop shadows / effects), 3 (drop particles).
 */
export class VrGovernor {
  constructor(onStep) {
    this.onStep = onStep;
    this.reset(90);
  }
  reset(hz) {
    this.budget = 1 / hz;
    this.acc = 0;
    this.n = 0;
    this.slow = 0;
    this.level = 0;
    this.cool = 3;
  }
  sample(dt) {
    if (dt <= 0 || dt > 0.5) return;
    this.cool -= dt;
    this.acc += dt;
    this.n++;
    if (this.acc < 1) return;
    const avg = this.acc / this.n;
    this.acc = 0;
    this.n = 0;
    if (this.cool > 0) return;
    this.slow = avg > this.budget * 1.12 ? this.slow + 1 : 0;
    if (this.slow >= 2 && this.level < 3) {
      this.level++;
      this.slow = 0;
      this.cool = 4;
      this.onStep(this.level);
    }
  }
}
