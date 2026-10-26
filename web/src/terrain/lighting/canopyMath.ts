// How much of the sky a tree's crown hides from a point on the ground. canopy.frag.glsl does the same sum on the GPU, once for
// every tree near each texel of the sky bake; this is the version the tests can reach.
//
// The crown is a vertical cylinder of half-width `radius`, from `bottom` to `top` metres above the ground at the trunk. From a
// point, it fills a strip of the sky: as wide as the angle the cylinder spans, and between the elevations of its bottom and its
// top. The light a flat surface takes from the sky is weighted by the cosine of the angle from straight up, which makes the
// share of it in a strip between elevations e0 and e1, across a fraction f of the way round, f times (sin^2 e1 - sin^2 e0).
// That is exact, and sums to 1 over the whole sky.

/** A tree crown, in metres: its half-width, and the heights of its bottom and top above the ground at the trunk. */
export type Crown = { radius: number; bottom: number; top: number };

/**
 * The share of the sky, 0 to 1, a crown hides from a point `distance` metres from the trunk (horizontally) and `rise` metres
 * above the ground at the trunk. Under the crown the point is treated as standing at its edge, which is continuous with
 * outside it and a fair guess for the leaf cover overhead. From the edge the crown fills half the way round; the nearer the
 * trunk, the more of the way round it fills, up to all of it at the trunk.
 */
export function crownOcclusion(crown: Crown, distance: number, rise: number): number {
  const top = crown.top - rise;
  if (top <= 0) return 0; // the whole crown is below the point
  const bottom = Math.max(0, crown.bottom - rise);
  const reach = Math.max(distance, crown.radius);
  const across = distance > crown.radius ? Math.asin(crown.radius / distance) / Math.PI : 1 - (0.5 * distance) / crown.radius;
  const sin2 = (a: number) => (a * a) / (a * a + reach * reach); // sin^2 of the elevation of a point a metres up at that reach
  return across * (sin2(top) - sin2(bottom));
}

/** What is left of the sky after every crown in `crowns` has hidden its share: each takes its share of what the others left. */
export function skyLeft(crowns: { crown: Crown; distance: number; rise: number }[]): number {
  return crowns.reduce((left, c) => left * (1 - crownOcclusion(c.crown, c.distance, c.rise)), 1);
}
