/** Placeholder travel: goes straight to the destination (the full cockpit flight replaces this). */
import { stubWorld } from "./worlds/_stub.js";

export async function build(ctx) {
  const w = stubWorld(ctx, {});
  const to = ctx.opts?.to ?? "mars";
  w.onEnter = () => setTimeout(() => ctx.go(to), 1500);
  return w;
}
