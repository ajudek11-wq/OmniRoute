import { stubWorld } from "./_stub.js";

export async function build(ctx) {
  return stubWorld(ctx, { tex: "jupiter" });
}
