import { describe, expect, it } from "vitest";
import { chunkTrees, splitByKind, treesFromBin } from "./trees";

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
