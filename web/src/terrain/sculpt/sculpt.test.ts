import { describe, expect, it } from "vitest";
import { cloneTarget, falloff, perStamp, resized, stampPoints, stampSample, MAX_RADIUS, MIN_RADIUS, type Brush } from "./brush";
import { decodeDelta, encodeDelta, readTile, tileKey, tileRect, tilesAcross, tilesInBox, writeTile, type Grid } from "./tiles";

const grid: Grid = { cols: 150, rows: 130 };

describe("tiles", () => {
  it("covers the grid with 64 x 64 tiles, the last ones partial", () => {
    expect(tilesAcross(grid)).toBe(3);
    expect(tileRect(grid, tileKey(grid, 0, 0))).toEqual({ x: 0, y: 0, w: 64, h: 64 });
    expect(tileRect(grid, tileKey(grid, 2, 2))).toEqual({ x: 128, y: 128, w: 22, h: 2 });
  });

  it("finds the tiles a box touches, clipped to the grid", () => {
    expect(tilesInBox(grid, 60, 60, 70, 70)).toEqual([0, 1, 3, 4]);
    expect(tilesInBox(grid, -20, -20, 5, 5)).toEqual([0]);
    expect(tilesInBox(grid, 140, 120, 999, 999)).toEqual([5, 8]);
  });

  it("reads and writes a tile without disturbing its neighbours", () => {
    const v = new Float32Array(grid.cols * grid.rows);
    const key = tileKey(grid, 2, 1);
    const tile = new Float32Array(22 * 64).fill(1.5);
    writeTile(v, grid, key, tile);
    expect(v[64 * 150 + 128]).toBe(1.5);
    expect(v[64 * 150 + 127]).toBe(0);
    expect(v[128 * 150 + 128]).toBe(0);
    expect(Array.from(readTile(v, grid, key))).toEqual(Array.from(tile));
  });
});

describe("the delta file", () => {
  it("round trips to the millimetre, with only touched tiles stored", () => {
    const v = new Float32Array(grid.cols * grid.rows);
    v[100 * 150 + 140] = -2.3456;
    v[3] = 0.0004; // under half a millimetre: nothing to store
    const bytes = encodeDelta(v, grid);
    expect(bytes.length).toBe(20 + 1 * (4 + 64 * 64 * 2));
    const back = decodeDelta(bytes, grid);
    expect(back[100 * 150 + 140]).toBeCloseTo(-2.346, 3);
    expect(back[3]).toBe(0);
  });

  it("an empty file is no edits", () => {
    expect(decodeDelta(new Uint8Array(0), grid).every((x) => x === 0)).toBe(true);
    expect(encodeDelta(new Float32Array(grid.cols * grid.rows), grid).length).toBe(20);
  });

  it("refuses a file for another grid or a damaged one", () => {
    const bytes = encodeDelta(new Float32Array(10 * 10).fill(1), { cols: 10, rows: 10 });
    expect(() => decodeDelta(bytes, grid)).toThrow(/different grid/);
    expect(() => decodeDelta(bytes.slice(0, -1), { cols: 10, rows: 10 })).toThrow(/damaged/);
    expect(() => decodeDelta(Uint8Array.from([1, 2, 3]), grid)).toThrow();
  });

  it("matches the layout the Python side writes (header fields and tile padding)", () => {
    const bytes = encodeDelta(new Float32Array(2 * 2).fill(0.001), { cols: 2, rows: 2 });
    const dv = new DataView(bytes.buffer);
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([72, 68, 76, 84]);
    expect([dv.getUint16(4, true), dv.getUint16(6, true), dv.getUint32(8, true), dv.getUint32(12, true), dv.getUint32(16, true)]).toEqual([1, 64, 2, 2, 1]);
    expect(dv.getInt16(20 + 4, true)).toBe(1);
    expect(dv.getInt16(20 + 4 + 2 * 2, true)).toBe(0); // padding past the 2 columns
  });
});

describe("brush falloff", () => {
  it("is full in the core and gone at the edge, smoothly between", () => {
    expect(falloff(0, 10, 0.5)).toBe(1);
    expect(falloff(5, 10, 0.5)).toBe(1);
    expect(falloff(10, 10, 0.5)).toBe(0);
    expect(falloff(12, 10, 0.5)).toBe(0);
    expect(falloff(7.5, 10, 0.5)).toBeCloseTo(0.5, 6);
  });

  it("a hardness of 0 is a dome and a hardness of 1 is a flat disc", () => {
    expect(falloff(5, 10, 0)).toBeCloseTo(0.5, 6);
    expect(falloff(9.99, 10, 1)).toBe(1);
  });
});

describe("stamping a sample", () => {
  it("raise and lower move the offset by the amount times the weight, and stay within 32 m", () => {
    expect(stampSample("raise", 50, 1, 0.5, 0.2, 0, 0)).toBeCloseTo(1.1);
    expect(stampSample("lower", 50, 1, 1, 0.2, 0, 0)).toBeCloseTo(0.8);
    expect(stampSample("raise", 50, 31.95, 1, 1, 0, 0)).toBe(32);
  });

  it("flatten pulls the height toward the level", () => {
    const next = stampSample("flatten", 50, 1, 1, 0, 0.5, 52);
    expect(50 + next).toBeCloseTo(51.5); // from 51 halfway to 52
    expect(50 + stampSample("flatten", 50, 1, 1, 0, 1, 52)).toBeCloseTo(52);
  });

  it("smooth pulls toward the neighbourhood's average, restore toward the original", () => {
    expect(50 + stampSample("smooth", 50, 3, 1, 0, 0.5, 50)).toBeCloseTo(51.5);
    expect(stampSample("restore", 50, 4, 1, 0, 0.25, 0)).toBeCloseTo(3);
    expect(stampSample("restore", 50, 4, 1, 0, 1, 0)).toBe(0);
  });

  it("changes nothing outside the brush", () => {
    for (const kind of ["raise", "lower", "smooth", "flatten", "restore", "clone"] as const) expect(stampSample(kind, 50, 1.234, 0, 5, 1, 0)).toBe(1.234);
  });
});

describe("a drag becomes stamps", () => {
  const brush: Brush = { kind: "raise", radius: 8, hardness: 0.5, strength: 0.5 };

  it("a stationary press stamps once at the pointer", () => {
    expect(stampPoints(null, [3, 4], 8)).toEqual([[3, 4]]);
    expect(stampPoints([3, 4], [3, 4], 8)).toEqual([[3, 4]]);
  });

  it("a long move is filled in no more than a quarter radius apart", () => {
    const pts = stampPoints([0, 0], [20, 0], 8);
    expect(pts.length).toBe(10);
    expect(pts[pts.length - 1]).toEqual([20, 0]);
    for (let i = 1; i < pts.length; i++) expect(pts[i][0] - pts[i - 1][0]).toBeLessThanOrEqual(2.0001);
  });

  it("the speed of the work does not depend on the frame rate or on how the drag is split up", () => {
    const rate = (dt: number, stamps: number) => perStamp(brush, dt, stamps).amount * stamps;
    expect(rate(1 / 60, 1)).toBeCloseTo(rate(1 / 60, 10));
    expect(rate(1 / 30, 1)).toBeCloseTo(2 * rate(1 / 60, 1));
    const pulls = (dt: number, n: number) => 1 - Math.pow(1 - perStamp(brush, dt, n).k, n);
    expect(pulls(1 / 60, 7)).toBeCloseTo(pulls(1 / 60, 1));
  });
});

describe("brush size keys", () => {
  it("grow and shrink by a fifth within limits", () => {
    expect(resized(10, true)).toBeCloseTo(12);
    expect(resized(12, false)).toBeCloseTo(10);
    expect(resized(MAX_RADIUS, true)).toBe(MAX_RADIUS);
    expect(resized(MIN_RADIUS, false)).toBe(MIN_RADIUS);
  });
});

describe("the clone brush's numbers", () => {
  it("copies the shape onto the ground where the stroke began, or the exact heights", () => {
    // a hill 12 m above the spot it was picked at (80 m), stamped where the ground is 30 m
    expect(cloneTarget(92, 80, 30, true)).toBe(42);
    expect(cloneTarget(80, 80, 30, true)).toBe(30); // the picked spot itself lands on the new ground
    expect(cloneTarget(92, 80, 30, false)).toBe(92);
  });

  it("pulls the ground towards the target like a flatten, in proportion to the weight", () => {
    const target = cloneTarget(92, 80, 30, true); // 42
    expect(50 + stampSample("clone", 50, 0, 1, 0, 1, target)).toBeCloseTo(42); // 50 m ground, pulled all the way
    expect(stampSample("clone", 50, 1, 0.5, 0, 0.5, target)).toBeCloseTo(stampSample("flatten", 50, 1, 0.5, 0, 0.5, target));
  });
});

