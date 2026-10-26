import type { Mat4 } from "./mat4";

/** The six planes of the view volume as (a, b, c, d) with the inside where a*x + b*y + c*z + d >= 0: left, right, bottom, top, near, far. */
export type Frustum = Float32Array;

/** Read the planes off a view-projection matrix (column-major, clip z from -w to w). */
export function frustumOf(m: Mat4): Frustum {
  const out = new Float32Array(24);
  const row = (r: number) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
  const [r0, r1, r2, r3] = [row(0), row(1), row(2), row(3)];
  const sets = [
    [1, r0], [-1, r0], // left, right
    [1, r1], [-1, r1], // bottom, top
    [1, r2], [-1, r2], // near, far
  ] as const;
  sets.forEach(([sign, r], i) => {
    for (let k = 0; k < 4; k++) out[i * 4 + k] = r3[k] + sign * r[k];
  });
  return out;
}

/**
 * Whether an axis-aligned box could be seen. It can be wrong only in saying yes, for a box near a corner of the volume that
 * no plane rules out alone; a box that is in view always gets yes.
 */
export function boxVisible(f: Frustum, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  for (let i = 0; i < 24; i += 4) {
    const a = f[i], b = f[i + 1], c = f[i + 2];
    // the corner furthest along the plane's normal: if even that is outside, the whole box is
    const x = a >= 0 ? x1 : x0, y = b >= 0 ? y1 : y0, z = c >= 0 ? z1 : z0;
    if (a * x + b * y + c * z + f[i + 3] < 0) return false;
  }
  return true;
}
