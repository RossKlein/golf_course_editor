import { describe, expect, it } from "vitest";
import { TUFT_TILE } from "../map/terrain/limits";
import { TUFT_RANGE, tuftGrid, tuftTiles } from "../map/terrain/sceneryGpu";
import { frustumOf } from "./frustum";
import { lookAt, multiply, perspective } from "./mat4";
import { chunkTrees, hash2, scatterWoods, speckleTexels, splitByKind, stripeAcross, stripeDirections, treeMesh, treesFromBin, type ClassImage } from "./scenery";
import { testLook } from "../map/terrain/look.fixture";

/** A class map `w` x `h` cells where `fn(col, row)` gives the class. */
function classes(w: number, h: number, fn: (c: number, r: number) => number): ClassImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) data[(r * w + c) * 4] = fn(c, r);
  return { data, width: w, height: h };
}

const KINDS = testLook.trees.kinds;

describe("hash", () => {
  it("is deterministic and spread over [0, 1)", () => {
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(4, 3, 5));
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const v = hash2(i, i * 7, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
  });
});

describe("sand speckle", () => {
  const t = speckleTexels(128);

  const share = (pick: (v: number) => boolean) => t.filter(pick).length / t.length;

  it("is mostly plain sand with three kinds of grain: dark and barely dark each about 7%, pale about 14%", () => {
    expect(t.length).toBe(128 * 128);
    expect(share((v) => v === 0)).toBeGreaterThan(0.05);
    expect(share((v) => v === 0)).toBeLessThan(0.09);
    expect(share((v) => v === 64)).toBeGreaterThan(0.05);
    expect(share((v) => v === 64)).toBeLessThan(0.09);
    expect(share((v) => v === 255)).toBeGreaterThan(0.11);
    expect(share((v) => v === 255)).toBeLessThan(0.17);
  });

  it("is as dark as it is pale, as the shader weighs them (darks 0.1, pales 0.07), so it averages to plain sand", () => {
    const effect = t.reduce((sum, v) => {
      const s = (v / 255 - 0.5) * 2;
      return sum + (s < 0 ? s * 0.1 : s * 0.07);
    }, 0) / t.length;
    expect(Math.abs(effect)).toBeLessThan(0.002);
  });

  it("is deterministic", () => {
    expect(Array.from(speckleTexels(16))).toEqual(Array.from(speckleTexels(16)));
  });
});

describe("woods scatter", () => {
  const img = classes(200, 200, (c) => (c >= 100 ? 8 : 1)); // 100 x 100 m at 0.5 m cells, woods in the east half

  it("puts trees only in woods", () => {
    const t = scatterWoods(img, 0.5, KINDS);
    expect(t.length).toBeGreaterThan(0);
    for (let i = 0; i < t.length; i += 4) expect(t[i]).toBeGreaterThanOrEqual(50 - 0.01);
  });

  it("is deterministic, one tree to a cell of the grid, and gives plausible heights and kinds", () => {
    const a = scatterWoods(img, 0.5, KINDS), b = scatterWoods(img, 0.5, KINDS);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length / 4).toBeLessThanOrEqual(10 * 20); // 5 m cells over the 50 x 100 m of woods
    expect(a.length / 4).toBeGreaterThan(150);
    for (let i = 0; i < a.length; i += 4) {
      expect(a[i + 2]).toBeGreaterThan(8);
      expect(a[i + 2]).toBeLessThan(25);
      expect([0, 1, 2]).toContain(a[i + 3]);
    }
  });

  it("no woods, no trees", () => {
    expect(scatterWoods(classes(50, 50, () => 0), 0.5, KINDS).length).toBe(0);
  });
});

describe("trees.bin", () => {
  it("reads the 12-byte records", () => {
    const buf = new ArrayBuffer(24);
    const dv = new DataView(buf);
    dv.setFloat32(0, 10.5, true); dv.setFloat32(4, 20.25, true); dv.setUint16(8, 1250, true); dv.setUint8(10, 2);
    dv.setFloat32(12, 1, true); dv.setFloat32(16, 2, true); dv.setUint16(20, 300, true); dv.setUint8(22, 7);
    expect(Array.from(treesFromBin(buf))).toEqual([10.5, 20.25, 12.5, 2, 1, 2, 3, 7]);
  });

  it("an empty file is no trees, and a ragged tail is ignored", () => {
    expect(treesFromBin(new ArrayBuffer(0)).length).toBe(0);
    expect(treesFromBin(new ArrayBuffer(13)).length).toBe(4);
  });

  it("splits by model kind, wrapping kinds past the models we have", () => {
    const groups = splitByKind(new Float32Array([0, 0, 10, 0, 1, 1, 10, 1, 2, 2, 10, 4]), 3);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.length / 4)).toEqual([1, 2, 0]);
  });
});

describe("tree chunks", () => {
  const trees = new Float32Array([5, 5, 10, 0, 250, 5, 12, 1, 15, 20, 14, 0, 255, 90, 9, 2, 5, -30, 11, 1]);

  it("keeps every tree, grouped so each chunk is a run", () => {
    const { sorted, chunks } = chunkTrees(trees, 100);
    expect(sorted.length).toBe(trees.length);
    expect(chunks.reduce((n, c) => n + c.count, 0)).toBe(5);
    expect(chunks.map((c) => c.count).sort()).toEqual([1, 2, 2]);
    const seen = [];
    for (let i = 0; i < sorted.length; i += 4) seen.push(`${sorted[i]},${sorted[i + 1]}`);
    expect(seen.sort()).toEqual(["15,20", "250,5", "255,90", "5,-30", "5,5"].sort());
  });

  it("bounds each chunk's trees and notes the tallest", () => {
    const { sorted, chunks } = chunkTrees(trees, 100);
    for (const c of chunks) {
      for (let k = c.first; k < c.first + c.count; k++) {
        expect(sorted[k * 4]).toBeGreaterThanOrEqual(c.x0);
        expect(sorted[k * 4]).toBeLessThanOrEqual(c.x1);
        expect(sorted[k * 4 + 1]).toBeGreaterThanOrEqual(c.z0);
        expect(sorted[k * 4 + 1]).toBeLessThanOrEqual(c.z1);
        expect(sorted[k * 4 + 2]).toBeLessThanOrEqual(c.tallest);
      }
    }
    expect(Math.max(...chunks.map((c) => c.tallest))).toBe(14);
  });

  it("no trees, no chunks", () => {
    expect(chunkTrees(new Float32Array(0)).chunks).toEqual([]);
  });
});

describe("mowing stripes", () => {
  it("run along the line of play, so the across direction is perpendicular to it", () => {
    const [x, z] = stripeAcross([[0, 0], [10, 0]]);
    expect(Math.abs(x)).toBeCloseTo(0);
    expect(Math.abs(z)).toBeCloseTo(1);
    const d = stripeAcross([[0, 0], [30, 40]]);
    expect(d[0] * 30 + d[1] * 40).toBeCloseTo(0);
    expect(Math.hypot(...d)).toBeCloseTo(1);
  });

  it("uses the tee and the green, whatever the bends between", () => {
    expect(stripeAcross([[0, 0], [5, 50], [10, 0]])).toEqual(stripeAcross([[0, 0], [10, 0]]));
  });

  it("falls back for a hole with no route", () => {
    expect(stripeAcross([])).toEqual([1, 0]);
    expect(stripeAcross([[3, 3], [3, 3]])).toEqual([1, 0]);
  });

  it("gives all 24 holes an entry, in hole order", () => {
    const d = stripeDirections([[[0, 0], [10, 0]], [[0, 0], [0, 10]]]);
    expect(d.length).toBe(48);
    expect(Math.abs(d[1])).toBeCloseTo(1); // hole 1 runs east, stripes across z
    expect(Math.abs(d[2])).toBeCloseTo(1); // hole 2 runs south, stripes across x
    expect([d[46], d[47]]).toEqual([1, 0]);
  });
});

describe("tree meshes", () => {
  for (let kind = 0; kind < KINDS.length; kind++) {
    it(`kind ${kind} stands on the ground, is one unit tall and has unit normals`, () => {
      const m = treeMesh(KINDS[kind]);
      expect(m.positions.length).toBe(m.normals.length);
      expect(m.positions.length).toBe(m.colors.length);
      expect(m.positions.length % 9).toBe(0);
      let min = Infinity, max = -Infinity;
      for (let i = 1; i < m.positions.length; i += 3) {
        min = Math.min(min, m.positions[i]);
        max = Math.max(max, m.positions[i]);
      }
      expect(min).toBeGreaterThanOrEqual(-1e-6);
      expect(min).toBeLessThan(0.01);
      expect(max).toBeGreaterThan(0.95);
      expect(max).toBeLessThan(1.05);
      for (let i = 0; i < m.normals.length; i += 3) expect(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2])).toBeCloseTo(1, 4);
    });

    it(`kind ${kind} stays low-poly`, () => {
      expect(treeMesh(KINDS[kind]).positions.length / 9).toBeLessThan(160);
    });
  }

  it("the broadleaf crown faces outward and upward at the top", () => {
    const m = treeMesh(KINDS[1]);
    let topY = -1, topN = 0;
    for (let i = 0; i < m.positions.length; i += 3) {
      if (m.positions[i + 1] > topY) {
        topY = m.positions[i + 1];
        topN = m.normals[i + 1];
      }
    }
    expect(topN).toBeGreaterThan(0);
  });
});

describe("grass tuft tiles", () => {
  // a camera 20 m up looking north along z at a target 30 m ahead
  const target: [number, number] = [0, -30];
  const view = lookAt([0, 20, 0], [0, 0, -30]);
  const f = frustumOf(multiply(perspective((45 * Math.PI) / 180, 1.6, 1, 5000), view));

  it("draws far fewer tiles than the patch holds, and none behind the camera", () => {
    const all = Math.ceil(tuftGrid(90, 1).across / TUFT_TILE) ** 2;
    const tiles = tuftTiles(target, 90, 1, f, 0, 5);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThan(all * 0.6);
    const { cell, across } = tuftGrid(90, 1);
    const cornerZ = Math.round(target[1] / cell) - across / 2;
    for (const [, ty] of tiles) expect((cornerZ + ty + TUFT_TILE + 1) * cell).toBeLessThan(25); // nothing wholly behind the eye
  });

  it("skips tiles outside the circle of the range", () => {
    const wide = frustumOf(multiply(perspective(Math.PI * 0.9, 1, 0.1, 5000), lookAt([0, 500, 0], [0, 0, -1]))); // sees it all from above
    const { across } = tuftGrid(60, 1);
    const all = Math.ceil(across / TUFT_TILE) ** 2;
    const tiles = tuftTiles([0, 0], 60, 1, wide, 0, 5);
    expect(tiles.length).toBeLessThan(all);
    expect(tiles.length).toBeGreaterThan(all * 0.6);
  });

  it("draws nothing when the patch is out of sight", () => {
    expect(tuftTiles([5000, 5000], 90, 1, f, 0, 5)).toEqual([]);
  });
});

describe("grass tuft grid", () => {
  it("the default is a tuft every half metre across twice the default range", () => {
    expect(TUFT_RANGE).toBe(200);
    expect(tuftGrid(TUFT_RANGE, 1)).toEqual({ cell: 0.5, across: 800 });
  });

  it("twice the density is twice the tufts to the square metre", () => {
    const one = tuftGrid(45, 1), two = tuftGrid(45, 2);
    expect((two.across * two.across) / (one.across * one.across)).toBeCloseTo(2, 1);
  });

  it("a longer range covers more ground at the same spacing", () => {
    expect(tuftGrid(90, 1).cell).toBe(0.5);
    expect(tuftGrid(90, 1).across).toBe(360);
  });

  it("is capped, so the sliders cannot ask for an unbounded number of tufts", () => {
    const g = tuftGrid(300, 20);
    expect(g.across).toBeLessThanOrEqual(3073);
    expect(g.cell).toBeGreaterThan(0.19);
  });

  it("the slider limits, 300 m at five times the density, are honoured and not capped", () => {
    const g = tuftGrid(300, 5);
    expect(g.cell).toBeCloseTo(0.5 / Math.sqrt(5), 3);
    expect(g.across).toBeLessThan(3072);
  });
});
