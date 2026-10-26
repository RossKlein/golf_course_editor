/** Which blocks of the class map are near an edge between two surfaces: one byte a block, 255 near an edge and 0 not. */
export type EdgeMask = { data: Uint8Array; cols: number; rows: number };

/**
 * The ground shader averages many cells around each pixel to draw a smooth edge, which is wasted where there is no edge. This
 * tells it where there is none: a block of `block` by `block` cells is marked when any pair of neighbouring cells within
 * `reach` cells of it are different surfaces. A pixel in an unmarked block can read the one cell under it and be done.
 * `classes` is the class map's RGBA bytes, the surface in R.
 */
export function edgeMask(classes: Uint8ClampedArray | Uint8Array, width: number, height: number, block: number, reach: number): EdgeMask {
  const cols = Math.ceil(width / block), rows = Math.ceil(height / block);
  const data = new Uint8Array(cols * rows);
  const mark = (x0: number, z0: number, x1: number, z1: number) => {
    const bx0 = Math.max(0, Math.floor(x0 / block)), bx1 = Math.min(cols - 1, Math.floor(x1 / block));
    const bz0 = Math.max(0, Math.floor(z0 / block)), bz1 = Math.min(rows - 1, Math.floor(z1 / block));
    for (let bz = bz0; bz <= bz1; bz++) data.fill(255, bz * cols + bx0, bz * cols + bx1 + 1);
  };
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const here = classes[(z * width + x) * 4];
      const right = x + 1 < width ? classes[(z * width + x + 1) * 4] : here;
      const below = z + 1 < height ? classes[((z + 1) * width + x) * 4] : here;
      if (here === right && here === below) continue;
      mark(x - reach, z - reach, x + 1 + reach, z + 1 + reach);
    }
  }
  return { data, cols, rows };
}
