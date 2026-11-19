import { describe, expect, it } from "vitest";
import { paint, paletteOf } from "./palette";

describe("a colour table", () => {
  it("has an RGBA entry for each of 256 values, transparent where there is no colour", () => {
    const t = paletteOf((k) => (k === 3 ? [10, 20, 30] : null));
    expect(t).toHaveLength(1024);
    expect(Array.from(t.slice(12, 16))).toEqual([10, 20, 30, 255]);
    expect(Array.from(t.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(t.slice(16, 20))).toEqual([0, 0, 0, 0]);
  });

  it("colours a channel of an image through it", () => {
    const table = paletteOf((k) => [k, k * 2, k * 3]);
    const image = Uint8ClampedArray.from([1, 7, 0, 255, 2, 0, 0, 255]); // two pixels: R is the class, G the hole
    const out = new Uint8ClampedArray(8);
    paint(out, image, 0, table);
    expect(Array.from(out)).toEqual([1, 2, 3, 255, 2, 4, 6, 255]);
    paint(out, image, 1, table);
    expect(Array.from(out)).toEqual([7, 14, 21, 255, 0, 0, 0, 255]);
  });

  it("leaves a pixel transparent where the table has nothing, as a hole number of 0 has", () => {
    const table = paletteOf((n) => (n ? [255, 0, 0] : null));
    const out = new Uint8ClampedArray(8).fill(9);
    paint(out, Uint8ClampedArray.from([0, 0, 0, 255, 0, 5, 0, 255]), 1, table);
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 255, 0, 0, 255]);
  });

  it("handles a ten-million-cell map without making a thing for each pixel", () => {
    const n = 3520 * 2810;
    const image = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) image[i * 4] = i % 9;
    const table = paletteOf((k) => [k, k, k]);
    const out = new Uint8ClampedArray(n * 4);
    const t = performance.now();
    paint(out, image, 0, table);
    const took = performance.now() - t;
    console.log(`  painted ${n.toLocaleString()} cells in ${took.toFixed(0)} ms`);
    expect(out[4 * 10]).toBe(10 % 9);
    expect(took).toBeLessThan(1500);
  });
});
