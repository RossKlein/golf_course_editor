import { describe, expect, it } from "vitest";
import { BUMP_RANGE, decodeSlope, grainHeights, luminanceHeights, slopeMap } from "./bump";

const rms = (bytes: Uint8Array) => {
  let sum = 0;
  for (const b of bytes) sum += decodeSlope(b) ** 2;
  return Math.sqrt(sum / bytes.length);
};

describe("height from an image", () => {
  it("is the light of each pixel, from 0 to 1", () => {
    const rgba = [0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255];
    const h = luminanceHeights(rgba, 3, 1);
    expect(h[0]).toBe(0);
    expect(h[1]).toBeCloseTo(1, 6);
    expect(h[2]).toBeCloseTo(0.299, 6); // red is lighter than blue, darker than green
  });
});

describe("the grain noise", () => {
  it("is the same every time, between 0 and 1, and different for another seed", () => {
    const a = grainHeights(64, 7), b = grainHeights(64, 7), c = grainHeights(64, 8);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
  });

  it("tiles: the step across the edge is no bigger than steps inside", () => {
    const n = 128, h = grainHeights(n, 3);
    let inside = 0, edge = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n - 1; x++) inside = Math.max(inside, Math.abs(h[y * n + x + 1] - h[y * n + x]));
      edge = Math.max(edge, Math.abs(h[y * n] - h[y * n + n - 1]));
    }
    expect(edge).toBeLessThanOrEqual(inside * 1.01);
  });
});

describe("the slope map", () => {
  it("is level, all 128, for a level field, and for a field that is merely bright", () => {
    for (const level of [0, 0.7]) {
      const map = slopeMap(new Float32Array(16 * 16).fill(level), 16, 16);
      expect(map.length).toBe(16 * 16 * 2);
      expect(map.every((b) => b === 127 || b === 128)).toBe(true);
    }
  });

  it("has a root mean square slope of one, whatever the heights are scaled by", () => {
    const n = 64, h = grainHeights(n, 5);
    const loud = h.map((v) => v * 40);
    expect(rms(slopeMap(h, n, n))).toBeCloseTo(1, 1);
    expect(rms(slopeMap(loud, n, n))).toBeCloseTo(1, 1);
  });

  it("points east where the ground rises east, and south where it rises south", () => {
    const n = 32;
    const east = new Float32Array(n * n), south = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      east[y * n + x] = Math.sin((x / n) * 2 * Math.PI); // rises from x = 0 to a quarter of the way
      south[y * n + x] = Math.sin((y / n) * 2 * Math.PI);
    }
    const e = slopeMap(east, n, n), s = slopeMap(south, n, n);
    const at = (m: Uint8Array, x: number, y: number, c: number) => decodeSlope(m[(y * n + x) * 2 + c]);
    expect(at(e, 0, 5, 0)).toBeGreaterThan(0.5); // rising east at x = 0
    expect(at(e, n / 2, 5, 0)).toBeLessThan(-0.5); // falling at x = half
    expect(Math.abs(at(e, 3, 5, 1))).toBeLessThan(0.05); // and no south slope
    expect(at(s, 5, 0, 1)).toBeGreaterThan(0.5);
    expect(Math.abs(at(s, 5, 3, 0))).toBeLessThan(0.05);
  });

  it("wraps: a field moved along one pixel gives the same map moved along", () => {
    const n = 32, h = grainHeights(n, 9);
    const moved = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) moved[y * n + ((x + 1) % n)] = h[y * n + x];
    const a = slopeMap(h, n, n), b = slopeMap(moved, n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) expect(b[(y * n + ((x + 1) % n)) * 2]).toBe(a[(y * n + x) * 2]);
  });

  it("clamps the steepest slopes to the range, so the bytes are spent where the slopes mostly are", () => {
    const n = 16, h = new Float32Array(n * n);
    h[5 * n + 5] = 100; // one spike in a flat field: a huge slope next to it, on a tiny rms
    const m = slopeMap(h, n, n);
    expect(Math.max(...Array.from(m).map(decodeSlope))).toBeLessThanOrEqual(BUMP_RANGE + 1e-9);
  });
});
