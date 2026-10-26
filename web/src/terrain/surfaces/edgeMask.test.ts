import { describe, expect, it } from "vitest";
import { edgeMask } from "./edgeMask";

const mapOf = (w: number, h: number, at: (x: number, z: number) => number) => {
  const data = new Uint8Array(w * h * 4);
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) data[(z * w + x) * 4] = at(x, z);
  return data;
};
const markedAt = (m: ReturnType<typeof edgeMask>, x: number, z: number, block: number) => m.data[Math.floor(z / block) * m.cols + Math.floor(x / block)] === 255;

describe("the edge mask", () => {
  it("is blank where there is a single surface", () => {
    const m = edgeMask(mapOf(40, 40, () => 3), 40, 40, 4, 7);
    expect(m.data.every((v) => v === 0)).toBe(true);
  });

  it("covers the blocks near an edge and not those far from it", () => {
    const w = 100, h = 40;
    const m = edgeMask(mapOf(w, h, (x) => (x >= 50 ? 1 : 0)), w, h, 4, 7);
    expect(markedAt(m, 49, 10, 4)).toBe(true);
    expect(markedAt(m, 50, 10, 4)).toBe(true);
    expect(markedAt(m, 10, 10, 4)).toBe(false);
    expect(markedAt(m, 90, 10, 4)).toBe(false);
  });

  it("is a size that covers the whole map, rounded up", () => {
    const m = edgeMask(mapOf(10, 7, () => 0), 10, 7, 4, 7);
    expect([m.cols, m.rows]).toEqual([3, 2]);
  });

  it("marks every cell that has an edge within reach, so no smoothing is skipped that is needed", () => {
    const w = 60, h = 60, reach = 7, block = 4;
    // scattered islands of a second surface
    const at = (x: number, z: number) => ((x * 7 + z * 13) % 97 === 0 || (x > 30 && x < 33 && z > 20 && z < 24) ? 1 : 0);
    const classes = mapOf(w, h, at);
    const m = edgeMask(classes, w, h, block, reach);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        let differs = false;
        for (let dz = -6; dz <= 6 && !differs; dz++) for (let dx = -6; dx <= 6; dx++) if (classes[(Math.min(h - 1, Math.max(0, z + dz)) * w + Math.min(w - 1, Math.max(0, x + dx))) * 4] !== classes[(z * w + x) * 4]) differs = true;
        if (differs) expect(markedAt(m, x, z, block)).toBe(true);
      }
    }
  });
});
