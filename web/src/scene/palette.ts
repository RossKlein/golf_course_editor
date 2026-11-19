// Colouring a big image of small numbers (the class map's surface and hole channels) through a table: one lookup a pixel, no array made per pixel.

/** A 256-entry colour table, 4 bytes an entry: `color(k)` for each value k, or transparent where it gives null. */
export function paletteOf(color: (k: number) => [number, number, number] | null): Uint8ClampedArray {
  const t = new Uint8ClampedArray(256 * 4);
  for (let k = 0; k < 256; k++) {
    const c = color(k);
    if (c) t.set([c[0], c[1], c[2], 255], k * 4);
  }
  return t;
}

/** Fill `out` (RGBA) from channel `channel` of an RGBA image through `palette`. */
export function paint(out: Uint8ClampedArray, image: ArrayLike<number>, channel: number, palette: Uint8ClampedArray) {
  for (let i = 0, n = out.length; i < n; i += 4) {
    const at = image[i + channel] * 4;
    out[i] = palette[at];
    out[i + 1] = palette[at + 1];
    out[i + 2] = palette[at + 2];
    out[i + 3] = palette[at + 3];
  }
}
