// How the ground's surfaces meet, in the one place a test can reach: ground.frag.glsl does the same sums per pixel
// (gameGround), with SURFACES classes and the same four-by-four neighbourhood.
//
// The class map is one surface per cell, with no partial coverage, so a slanted edge is a staircase of cells. Blending the
// four nearest cells (bilinear) only softens each step. Instead each surface's weight is spread over the sixteen nearest cells
// with a cubic B-spline, which turns the staircase into a smooth curve, and the two heaviest surfaces are then told apart
// across the line where their weights are equal, as narrowly as the pixel allows: a clean edge, not a blend.

/** Cubic B-spline weights of the four cells around a point, `t` (0..1) being its place between the middle two. They sum to 1. */
export function bspline(t: number): [number, number, number, number] {
  const t2 = t * t, t3 = t2 * t;
  return [(1 - 3 * t + 3 * t2 - t3) / 6, (4 - 6 * t2 + 3 * t3) / 6, (1 + 3 * t + 3 * t2 - 3 * t3) / 6, t3 / 6];
}

/** The surface of a class-map cell (column, row). */
export type CellAt = (cx: number, cz: number) => number;

/**
 * How much of each surface lies around a point `q`, given in cells with a cell's centre at its index plus a half (the
 * shader's `q`, so subtract the half first). The weights add up to 1.
 */
export function surfaceWeights(cellAt: CellAt, qx: number, qz: number): Map<number, number> {
  const x0 = Math.floor(qx), z0 = Math.floor(qz);
  const wx = bspline(qx - x0), wz = bspline(qz - z0);
  const out = new Map<number, number>();
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const cls = cellAt(x0 + i - 1, z0 + j - 1);
      out.set(cls, (out.get(cls) ?? 0) + wx[i] * wz[j]);
    }
  }
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
