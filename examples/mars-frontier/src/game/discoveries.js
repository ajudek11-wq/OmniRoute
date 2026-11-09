/**
 * Collectible geological samples. Pure data + pure progress logic (no THREE, no DOM).
 * Positions are placed by the world builder; names describe what is found, never invented data.
 */
export const SAMPLES = [
  { id: "spherules", name: "Hematite spherules", where: "Canyon floor", x: -418, z: 232, hint: "Blueberry-like concretions formed in water" },
  { id: "layers", name: "Layered basalt", where: "Canyon wall", x: -492, z: 452, hint: "Lava flows stacked over billions of years" },
  { id: "ice", name: "Ice-bearing soil", where: "Ice crater", x: -126, z: 304, hint: "Bright soil over buried water ice" },
  { id: "breccia", name: "Impact breccia", where: "Crater rim", x: 318, z: -146, hint: "Rock fused by a meteorite impact" },
  { id: "sulfate", name: "Sulfate crust", where: "Mesa base", x: -252, z: -122, hint: "Salts left behind by evaporating water" },
  { id: "dust", name: "Cemented dust", where: "Spire plain", x: 528, z: -372, hint: "Dust bound into a hard crust by wind" },
];

export function sampleById(id) {
  return SAMPLES.find((s) => s.id === id) ?? null;
}

/** Returns the new found-set and whether this call added a discovery. */
export function collect(found, id) {
  if (!sampleById(id) || found.has(id)) return { found, added: false };
  const next = new Set(found);
  next.add(id);
  return { found: next, added: true };
}

export function nearestWithin(list, x, z, radius) {
  let best = null;
  let bd = radius;
  for (const item of list) {
    const d = Math.hypot(item.x - x, item.z - z);
    if (d <= bd) {
      bd = d;
      best = item;
    }
  }
  return best;
}
