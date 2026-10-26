// How much of the sky a point on the ground can see, worked out from the heights around it. sky.frag.glsl does the same sums on
// the GPU (it bakes them into a texture); this is the version the tests can reach.
//
// Looking out from the point in a ring of directions, the horizon in each is how high the ground rises above it. For one
// direction the light that reaches a flat surface from the sky above the horizon, weighted by the cosine of the angle from
// straight up, is 1 minus the sine of the horizon's elevation, squared. The average of that over the ring is the visibility:
// 1 on open ground, less in a hollow, under a bank, or beside a hill.

/** Directions and steps along each, and how far out to look in metres. */
export type SkySettings = { dirs: number; steps: number; reach: number };

/**
 * The visibility of the sky, 0 to 1, from the point (x, z) metres. `heightAt` gives the ground's height there, or null where
 * there is none; a point with none counts as open. The steps are closer together near the point, where the ground matters most.
 */
export function skyVisibility(heightAt: (x: number, z: number) => number | null, x: number, z: number, { dirs, steps, reach }: SkySettings): number | null {
  const h0 = heightAt(x, z);
  if (h0 === null) return null;
  let total = 0;
  for (let d = 0; d < dirs; d++) {
    const angle = ((d + 0.5) / dirs) * 2 * Math.PI;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    let sinMax = 0;
    for (let s = 1; s <= steps; s++) {
      const t = reach * (s / steps) ** 2;
      const h = heightAt(x + dx * t, z + dz * t);
      if (h === null) continue;
      const rise = h - h0;
      if (rise > 0) sinMax = Math.max(sinMax, rise / Math.hypot(rise, t));
    }
    total += 1 - sinMax * sinMax;
  }
  return total / dirs;
}
