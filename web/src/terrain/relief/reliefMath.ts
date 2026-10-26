// The ground's slope and curvature for lighting, worked out from a cubic B-spline over the height grid. relief.frag.glsl
// does the same sums on the GPU (it bakes them into a texture); this is the version the tests can reach.
//
// The grid is 1 m, and heights are bilinear between its points, so the slope of that surface is the same across each square
// and jumps at the edges between them: lit, it looks faceted. A cubic B-spline smooths the heights over a few samples, and
// its derivative gives the slope of that smooth surface directly, so the slope changes smoothly everywhere. A plane keeps
// exactly its slope, and a bowl exactly its curvature; only bumps smaller than the spline are averaged away.

/** The cubic B-spline basis and its first two derivatives: a bump 4 wide, 2/3 high in the middle. */
export function basis(x: number): { b: number; d1: number; d2: number } {
  const a = Math.abs(x);
  if (a < 1) return { b: (4 - 6 * a * a + 3 * a * a * a) / 6, d1: Math.sign(x) * (-12 * a + 9 * a * a) / 6, d2: -2 + 3 * a };
  if (a < 2) return { b: (2 - a) ** 3 / 6, d1: -Math.sign(x) * (2 - a) ** 2 / 2, d2: 2 - a };
  return { b: 0, d1: 0, d2: 0 };
}

/** The spline's scale in samples for a smoothing `radius` in metres (how far it reaches either side), given the metres between samples. At least 1. */
export const reliefScale = (radiusMetres: number, resMetres: number) => Math.max(1, radiusMetres / (2 * resMetres));

/** Samples across the spline's width along each axis for a spline `scale` samples to the unit: even, so the point is in the middle. */
export const reliefTaps = (scale: number) => 2 * Math.ceil(2 * scale);

/** The weights of the samples around a point for the smoothed height, its slope and its curvature, with what makes a plane and a bowl come out exact. */
export function reliefWeights(scale: number) {
  const taps = reliefTaps(scale);
  const offsets = Array.from({ length: taps }, (_, i) => i - taps / 2 + 1);
  const w0: number[] = [], w1: number[] = [], w2: number[] = [];
  for (const k of offsets) {
    const { b, d1, d2 } = basis(k / scale);
    w0.push(b / scale);
    w1.push(d1 / (scale * scale));
    w2.push(d2 / (scale * scale * scale));
  }
  const sum = (f: (k: number, i: number) => number) => offsets.reduce((a, k, i) => a + f(k, i), 0);
  return {
    offsets,
    w0, w1, w2,
    n0: sum((_, i) => w0[i]), // 1 for a whole-number scale
    n1: -sum((k, i) => k * w1[i]), // what a slope of one sample per sample comes out as
    n2: sum((k, i) => 0.5 * k * k * w2[i]), // and a curvature of one
  };
}

export type Relief = {
  /** Rise over run to the east and to the south (metres per metre). */
  gx: number;
  gz: number;
  /** Second derivative of the height, summed over both axes, per square metre: positive in a hollow, negative on a crest. */
  curvature: number;
};

/**
 * The relief at grid sample (i, j). `heightAt` gives a sample's height, or null where there is no data; a missing neighbour
 * counts as level with the sample, as the shader does, so a hole in the data does not make a spike. Null if the sample itself has none.
 */
export function reliefAt(heightAt: (i: number, j: number) => number | null, i: number, j: number, scale: number, resX: number, resZ: number): Relief | null {
  const centre = heightAt(i, j);
  if (centre === null) return null;
  const { offsets, w0, w1, w2, n0, n1, n2 } = reliefWeights(scale);
  let sx = 0, sz = 0, sxx = 0, szz = 0;
  offsets.forEach((kz, b) => {
    offsets.forEach((kx, a) => {
      const h = (heightAt(i + kx, j + kz) ?? centre) - centre; // relative to the sample, so a level field has no slope or curvature whatever the spline's width
      sx += h * w1[a] * w0[b];
      sz += h * w0[a] * w1[b];
      sxx += h * w2[a] * w0[b];
      szz += h * w0[a] * w2[b];
    });
  });
  // the surface's slope at sample (i, j) is the sum of h(i + k) times the spline's slope at -k, and the slope of a spline is odd
  return {
    gx: -sx / (n1 * n0 * resX),
    gz: -sz / (n1 * n0 * resZ),
    curvature: sxx / (n2 * n0 * resX * resX) + szz / (n2 * n0 * resZ * resZ),
  };
}
