import { describe, expect, it } from "vitest";
import { boxFromPoints, dragHandle, hitHandle, isWhole, MIN_SIDE, tidy, trimmed, wholeMap } from "./cropRect";

const map = { w: 200, h: 100 };
const r = { x0: 50, z0: 20, x1: 150, z1: 80 };

describe("hitHandle", () => {
  it("finds corners, edges and the inside", () => {
    expect(hitHandle(r, [51, 21], 3)).toBe("nw");
    expect(hitHandle(r, [149, 79], 3)).toBe("se");
    expect(hitHandle(r, [100, 19], 3)).toBe("n");
    expect(hitHandle(r, [152, 50], 3)).toBe("e");
    expect(hitHandle(r, [100, 50], 3)).toBe("move");
  });
  it("finds nothing away from the rectangle", () => {
    expect(hitHandle(r, [10, 50], 3)).toBeNull();
    expect(hitHandle(r, [100, 90], 3)).toBeNull();
  });
});

describe("dragHandle", () => {
  it("moves one edge, in whole metres", () => {
    expect(dragHandle(r, "w", [50, 50], [60.4, 50], map)).toEqual({ ...r, x0: 60 });
    expect(dragHandle(r, "s", [100, 80], [100, 60], map)).toEqual({ ...r, z1: 60 });
  });
  it("moves a corner as two edges", () => {
    expect(dragHandle(r, "ne", [150, 20], [160, 30], map)).toEqual({ ...r, x1: 160, z0: 30 });
  });
  it("cannot cross the opposite edge or leave the map", () => {
    expect(dragHandle(r, "w", [50, 50], [500, 50], map).x0).toBe(150 - MIN_SIDE);
    expect(dragHandle(r, "e", [150, 50], [999, 50], map).x1).toBe(200);
    expect(dragHandle(r, "n", [100, 20], [100, -40], map).z0).toBe(0);
  });
  it("moves the whole rectangle and keeps its size at the map's edge", () => {
    expect(dragHandle(r, "move", [100, 50], [110, 55], map)).toEqual({ x0: 60, z0: 25, x1: 160, z1: 85 });
    expect(dragHandle(r, "move", [100, 50], [900, 900], map)).toEqual({ x0: 100, z0: 40, x1: 200, z1: 100 });
  });
});

describe("boxFromPoints", () => {
  it("draws from any corner and clips to the map", () => {
    expect(boxFromPoints([120.4, 70], [30, -20], map)).toEqual({ x0: 30, z0: 0, x1: 120, z1: 70 });
  });
  it("ignores a click or a sliver", () => {
    expect(boxFromPoints([50, 50], [51, 51], map)).toBeNull();
    expect(boxFromPoints([50, 50], [150, 53], map)).toBeNull();
  });
});

describe("tidy and trimmed", () => {
  it("keeps a rectangle whole, inside and no smaller than the minimum", () => {
    expect(tidy({ x0: 90.6, z0: -5, x1: 20, z1: 40 }, map)).toEqual({ x0: 20, z0: 0, x1: 91, z1: 40 });
    expect(tidy({ x0: 195, z0: 95, x1: 199, z1: 99 }, map)).toEqual({ x0: 192, z0: 92, x1: 200, z1: 100 });
  });
  it("is a trim off each side", () => {
    expect(trimmed(map, { west: 10, east: 20, north: 0, south: 30 })).toEqual({ x0: 10, z0: 0, x1: 180, z1: 70 });
    expect(isWhole(trimmed(map, { west: 0, east: 0, north: -4, south: 0 }), map)).toBe(true);
    expect(wholeMap(map)).toEqual({ x0: 0, z0: 0, x1: 200, z1: 100 });
  });
});
