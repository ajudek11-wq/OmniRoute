/**
 * Controller input in the WebXR "xr-standard" gamepad mapping.
 *
 * In Chrome/Edge on Windows the WebXR session runs on the active OpenXR runtime (SteamVR for PS VR2 on PC).
 * SteamVR binds the PS VR2 Sense controllers to an OpenXR interaction profile, and the browser exposes it
 * through the xr-standard layout below, so the same indices hold for Sense, Index, Touch and WMR controllers:
 *   buttons[0] trigger · [1] grip/squeeze · [2] touchpad (often absent) · [3] stick press · [4] A/X · [5] B/Y
 *   axes[2], axes[3] thumbstick (axes[0], axes[1] on runtimes that omit the touchpad axes)
 * PS VR2 naming: Cross/Circle (right) and Square/Triangle (left) land on [4]/[5].
 */

export const DEADZONE = 0.18;

/** Radial deadzone with rescaling, so small stick drift never moves the player. */
export function deadzone(x, y, dz = DEADZONE) {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0, m: 0 };
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return { x: x * k, y: y * k, m: Math.min(1, (m - dz) / (1 - dz)) };
}

const val = (b) => (b ? (typeof b.value === "number" ? b.value : b.pressed ? 1 : 0) : 0);
const on = (b) => !!(b && (b.pressed || b.value > 0.55));

export function emptyPad() {
  return { trigger: 0, grip: 0, stick: { x: 0, y: 0, m: 0 }, triggerDown: false, gripDown: false, stickDown: false, a: false, b: false, touchA: false };
}

/**
 * Read one gamepad into a normalised state and add edge flags (…Pressed / …Released) against the previous state.
 * Stick y is flipped so that pushing forward is +1.
 */
export function readPad(gp, prev = emptyPad()) {
  const s = emptyPad();
  if (gp) {
    const B = gp.buttons ?? [];
    const A = gp.axes ?? [];
    s.trigger = val(B[0]);
    s.grip = val(B[1]);
    s.triggerDown = s.trigger > 0.55;
    s.gripDown = s.grip > 0.55;
    s.stickDown = on(B[3]);
    s.a = on(B[4]);
    s.b = on(B[5]);
    s.touchA = !!(B[4]?.touched || B[5]?.touched);
    const useHi = A.length >= 4;
    const sx = (useHi ? A[2] : A[0]) ?? 0;
    const sy = (useHi ? A[3] : A[1]) ?? 0;
    s.stick = deadzone(sx, -sy);
  }
  for (const k of ["triggerDown", "gripDown", "stickDown", "a", "b"]) {
    s[`${k}Pressed`] = s[k] && !prev[k];
    s[`${k}Released`] = !s[k] && prev[k];
  }
  return s;
}

/** Stick "flick" detection for snap turn / teleport aim, with hysteresis. */
export function flick(value, armed, on = 0.7, off = 0.35) {
  if (armed && Math.abs(value) > on) return { fire: Math.sign(value), armed: false };
  if (!armed && Math.abs(value) < off) return { fire: 0, armed: true };
  return { fire: 0, armed };
}
