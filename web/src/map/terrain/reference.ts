// A CPU statement of what the terrain shader computes, for tests. Not used at runtime. If the shader's lighting
// changes, change this and its tests with it.

import type { Sun } from "./sun";

/** Brightness 0..1 of ground rising `dx` per metre east and `dz` per metre south, lit by the sun. */
export function shadeOf(dx: number, dz: number, exaggeration: number, sun: Sun): number {
  const slope = Math.PI / 2 - Math.atan(Math.hypot(dx, dz) * exaggeration);
  const aspect = Math.atan2(-dx, dz);
  const shade = Math.sin(sun.altitude) * Math.sin(slope) + Math.cos(sun.altitude) * Math.cos(slope) * Math.cos(sun.azimuth - aspect);
  return Math.max(0, Math.min(1, shade));
}

/** The contour line strength at a height: 0 between lines, 1 on one, given how many pixels a contour interval spans. */
export function contourIndex(height: number, interval: number): { nearest: number; distance: number; major: boolean } {
  const v = height / interval;
  const nearest = Math.floor(v + 0.5);
  return { nearest, distance: Math.abs(v - nearest), major: ((nearest % 5) + 5) % 5 === 0 };
}

/** Interleave heights and validity the way the shader's texture expects: (height, 1 or 0) per sample. */
export function packHeights(values: Float32Array, valid: Uint8Array): Float32Array {
  const out = new Float32Array(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    out[i * 2] = valid[i] ? values[i] : 0;
    out[i * 2 + 1] = valid[i] ? 1 : 0;
  }
  return out;
}
