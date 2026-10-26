import { hash2 } from "../scenery/hash";

/** The texels across the speckle texture, which tiles. A grain is one texel; how many metres it covers is the look's (grass.speckleGrain). */
export const SPECKLE_SIZE = 256;

/**
 * The speckle for sand as one byte a texel: 128 is plain sand, 0 a dark grain (pepper), 64 a barely darker one, 255 a pale one (salt). Mipmapped
 * and tiled over the ground, so the GPU averages it for distance and the pattern does not step with it.
 */
export function speckleTexels(size = SPECKLE_SIZE): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = hash2(x, y, 41);
      // 7% pepper, 7% pale pepper, 14% salt: as much dark as pale in all
      out[y * size + x] = n < 0.07 ? 0 : n < 0.14 ? 64 : n > 0.86 ? 255 : Math.round(128 + (hash2(x, y, 42) - 0.5) * 40);
    }
  }
  return out;
}
