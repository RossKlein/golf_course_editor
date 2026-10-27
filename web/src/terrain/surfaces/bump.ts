// Normal maps for the ground's surfaces, made on the client from what the bundle already has, so nothing is added to it: the
// grass tile (its light and dark, read as height, gives the blades and clumps) and a tileable noise (grains, for sand and
// paths). Each becomes a map of slopes, two bytes a pixel, that the ground shader adds to the slope of the terrain.
//
// A slope is stored in units of the map's own root mean square, so every map has the same amount of detail to start with and
// a surface's `bump` in the look is how steep that detail is: 0.3 is a slope of about 17 degrees on average.

/** Slopes are stored in units of the map's root mean square, and clamped to this many; the shader multiplies it back out. */
export const BUMP_RANGE = 3;

/** The height of each pixel of an image, from its light: 0 black, 1 white. `rgba` is 4 bytes a pixel. */
export function luminanceHeights(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
  return out;
}

/** A small deterministic random sequence, so a noise map is the same every time. */
function sequence(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A square of tileable noise, `size` pixels across, 0 to 1: octaves of smooth value noise on a lattice that wraps, from a
 * lattice 8 cells across to one 64, each half the height of the last. Its detail runs from about an eighth of the map down to
 * a sixty-fourth.
 */
export function grainHeights(size: number, seed = 1): Float32Array {
  const next = sequence(seed);
  const out = new Float32Array(size * size);
  let amplitude = 1, total = 0;
  for (const cells of [8, 16, 32, 64]) {
    const lattice = Float32Array.from({ length: cells * cells }, () => next());
    const smooth = (t: number) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells, y0 = Math.floor(fy), ty = smooth(fy - y0);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells, x0 = Math.floor(fx), tx = smooth(fx - x0);
        const at = (i: number, j: number) => lattice[(j % cells) * cells + (i % cells)];
        out[y * size + x] += amplitude * ((at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty);
      }
    }
    total += amplitude;
    amplitude /= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * The slope of a field of heights, as a map: two bytes a pixel (east, then south), 128 for level. The field is tileable, so
 * the edges wrap. Slopes are by central differences, then scaled so their root mean square is 1 and stored as
 * `slope / (BUMP_RANGE * rms)` mapped from -1..1 to 0..255; a level field is all 128.
 */
export function slopeMap(heights: Float32Array, width: number, height: number): Uint8Array {
  const sx = new Float32Array(width * height), sz = new Float32Array(width * height);
  let sum = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      sx[i] = (heights[y * width + ((x + 1) % width)] - heights[y * width + ((x + width - 1) % width)]) / 2;
      sz[i] = (heights[((y + 1) % height) * width + x] - heights[((y + height - 1) % height) * width + x]) / 2;
      sum += sx[i] * sx[i] + sz[i] * sz[i];
    }
  }
  const rms = Math.sqrt(sum / (2 * width * height));
  const out = new Uint8Array(width * height * 2);
  const encode = (s: number) => Math.round((Math.max(-1, Math.min(1, rms > 1e-9 ? s / (rms * BUMP_RANGE) : 0)) * 0.5 + 0.5) * 255);
  for (let i = 0; i < width * height; i++) {
    out[i * 2] = encode(sx[i]);
    out[i * 2 + 1] = encode(sz[i]);
  }
  return out;
}

/** A stored byte back to a slope in units of the map's root mean square, as the shader reads it. */
export const decodeSlope = (byte: number) => (byte / 255) * 2 * BUMP_RANGE - BUMP_RANGE;
