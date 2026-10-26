import type { Vec3 } from "../../../gfx/math/mat4";
import { SELF_SHADOW_REACH, SELF_SHADOW_STEPS } from "../../limits";

/**
 * How much the ground shades itself at a point: 0 in the light, 1 in the shadow of a rise between it and the sun. It steps
 * along the ray to the sun and compares the ray's height with the ground under it; how far above the ground the ray clears
 * sets how soft the edge is, wider the further away the rise is. This is the CPU statement of what ground.frag.glsl computes
 * (terrainShadow), for tests, and uses the same constants.
 *
 * `height` is the ground's height in metres at (x, z), `scale` the vertical exaggeration the ground is drawn with, `sun` the unit
 * vector towards the sun (x east, y up, z south).
 */
export function selfShadow(height: (x: number, z: number) => number, x: number, z: number, scale: number, sun: Vec3): number {
  if (sun[1] <= 0.001) return 1; // the sun is down
  const y0 = height(x, z) * scale + 0.15;
  let lit = 1;
  for (let i = 1; i <= SELF_SHADOW_STEPS; i++) {
    const f = i / SELF_SHADOW_STEPS;
    const t = SELF_SHADOW_REACH * f * f; // closer samples are denser
    const clearance = y0 + sun[1] * t - height(x + sun[0] * t, z + sun[2] * t) * scale;
    lit = Math.min(lit, Math.min(1, Math.max(0, clearance / (0.06 * t + 0.25))));
  }
  return 1 - lit;
}
