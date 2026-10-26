// How much of the sun reaches a point of ground, past the terrain. sun.frag.glsl does the same sums on the GPU (it bakes them into
// a texture); this is the version the tests can reach.
//
// A ray goes from just above the point toward the sun, in steps that grow with distance. At each, how far the ray is above the
// ground there, against how wide the sun is at that distance, says how much of the sun that spot lets past: none when the
// ground is well above the ray, all when it is well below, half when it just grazes. The sun is about half a degree wide, so
// the soft edge of a shadow grows in proportion to how far away what casts it is, as it does in life.

/** How the ray is marched: steps, how far to look in metres, the least width of the soft edge in metres, and the sun's width as a fraction of the distance. */
export type SunSettings = { steps: number; reach: number; softness: number; angular: number };

/** How wide the sun looks, as a fraction of how far away something is: the tangent of its half a degree. */
export const SUN_WIDTH = 0.0093;

/**
 * The share of the sun, 0 to 1, that reaches the point (x, z) metres past the terrain, with `sun` the unit vector toward it
 * (x east, y up, z south). Null where there is no ground. A sun at or below the horizon reaches nothing.
 */
export function sunVisibility(heightAt: (x: number, z: number) => number | null, x: number, z: number, sun: [number, number, number], { steps, reach, softness, angular }: SunSettings): number | null {
  const h0 = heightAt(x, z);
  if (h0 === null) return null;
  if (sun[1] <= 0.001) return 0;
  const y0 = h0 + 0.15; // a little above the ground, so it does not shade itself
  let lit = 1;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const t = reach * f * f;
    const h = heightAt(x + sun[0] * t, z + sun[2] * t);
    if (h === null) continue;
    const clearance = y0 + sun[1] * t - h;
    const width = softness + t * angular;
    lit = Math.min(lit, Math.min(1, Math.max(0, 0.5 + clearance / width)));
  }
  return lit;
}
