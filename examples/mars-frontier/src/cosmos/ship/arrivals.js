import { buildLanding } from "./landing.js";
import { arrivalProfile } from "./flight.js";

/** Arrival leg for a descent type. Every arrival exposes the same interface (see landing.js). */
export function buildArrival(type, to, ctx) {
  const landingType = ["atmospheric", "powered", "parachute"].includes(type) ? type : "powered";
  const a = buildLanding(ctx, landingType, to);
  a.hold = arrivalProfile(type).hold ?? null;
  return a;
}
