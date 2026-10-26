// How the ground's surfaces meet, in the one place a test can reach: ground.frag.glsl does the same sums per pixel
// (gameGround), with SURFACES classes.
//
// The class map is one surface per cell, with no partial coverage, so a slanted edge is a staircase of cells and a curved
// one is a staircase with ripples. Each surface's weight is instead spread over the cells around a point with a cubic
// B-spline, which averages the staircase into a smooth curve; the wider the spline, the bigger and rounder the curves. The
// two heaviest surfaces are then told apart across the line where their weights are equal, as narrowly as the pixel allows:
// a clean edge, not a blend.

/** The cubic B-spline basis: a bump 4 wide, 2/3 high in the middle. Shifted copies of it, one per unit, add up to 1. */
export function basis(x: number): number {
  const a = Math.abs(x);
  if (a < 1) return (4 - 6 * a * a + 3 * a * a * a) / 6;
  if (a < 2) return (2 - a) ** 3 / 6;
  return 0;
}

/** The surface of a class-map cell (column, row). */
export type CellAt = (cx: number, cz: number) => number;

/** Cells across the spline's width along each axis for a spline `scale` cells to the unit: even, so the point is in the middle. */
export const tapsFor = (scale: number) => 2 * Math.ceil(2 * scale);

/** The spline's scale in cells for a smoothing `radius` in metres (how far it reaches either side), given the cell size. At least 1. */
export const scaleOf = (radiusMetres: number, cellMetres: number) => Math.max(1, radiusMetres / (2 * cellMetres));

/**
 * How much of each surface lies around a point `q`, given in cells with a cell's centre at its index (the shader's `q`, so
 * subtract the half first), averaged with a spline `scale` cells to the unit. The weights add up to 1.
 */
export function surfaceWeights(cellAt: CellAt, qx: number, qz: number, scale = 1): Map<number, number> {
  const taps = tapsFor(scale);
  const x0 = Math.floor(qx) - taps / 2 + 1, z0 = Math.floor(qz) - taps / 2 + 1;
  const out = new Map<number, number>();
  let total = 0;
  for (let j = 0; j < taps; j++) {
    const wz = basis((z0 + j - qz) / scale);
    for (let i = 0; i < taps; i++) {
      const w = basis((x0 + i - qx) / scale) * wz;
      if (w <= 0) continue;
      const cls = cellAt(x0 + i, z0 + j);
      out.set(cls, (out.get(cls) ?? 0) + w);
      total += w;
    }
  }
  for (const [cls, w] of out) out.set(cls, w / total);
  return out;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How much of the heaviest surface to show, 0.5 to 1, from the weight difference `d` (0 on the line between two surfaces, 1
 * far from any). A smoothstep across `width` either side of the line, rescaled so d = 1 is always all of it: a pixel that
 * covers many cells (far away) would otherwise leave a little of a surface that is not there in every pure area.
 */
export function blendShare(d: number, width: number): number {
  const top = smoothstep(-width, width, 1);
  return 0.5 + (0.5 * (smoothstep(-width, width, d) - 0.5)) / (top - 0.5);
}

export type Blend = {
  /** The heaviest surface and the runner-up (the same when only one is near). */
  a: number;
  b: number;
  /** How much of `a` there is, 0.5 to 1: the rest is `b`. */
  share: number;
};

/**
 * The two surfaces to show at a point and how much of each. The line between them is where their weights are equal, and
 * across it the change is as narrow as a pixel: `footprint` is how much the weight difference changes across a pixel (so
 * the edge is antialiased, never softer). Surfaces are not blended beyond that; golf courses have clean edges.
 */
export function blend(weights: Map<number, number>, footprint = 0): Blend {
  let a = -1, b = -1, wa = -1, wb = -1;
  for (const [cls, w] of weights) {
    if (w > wa) {
      b = a;
      wb = wa;
      a = cls;
      wa = w;
    } else if (w > wb) {
      b = cls;
      wb = w;
    }
  }
  if (b < 0) return { a, b: a, share: 1 };
  const width = footprint * 0.75;
  return { a, b, share: width > 0 ? blendShare(wa - wb, width) : wa > wb ? 1 : 0.5 };
}
