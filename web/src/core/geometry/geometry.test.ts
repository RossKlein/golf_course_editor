import { describe, expect, it } from "vitest";
import { closeRing, dedupe, nearestVertex, outlineFromPoints, pointInPolygon, pointInRing, ringArea, roundRing, selfIntersects, snapToRings, withoutLineVertex, withoutRingVertex } from "./geometry";
import type { Pt } from "./coords";

const square: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

describe("geometry", () => {
  it("closes an open ring and leaves a closed one alone", () => {
    expect(closeRing(square.slice(0, 4))).toEqual(square);
    expect(closeRing(square)).toBe(square);
  });

  it("removes consecutive duplicates only", () => {
    expect(dedupe([[0, 0], [0, 0], [1, 1], [1, 1], [0, 0]])).toEqual([[0, 0], [1, 1], [0, 0]]);
  });

  it("detects a bowtie but not a square", () => {
    expect(selfIntersects(square)).toBe(false);
    expect(selfIntersects([[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]])).toBe(true);
  });

  it("measures area", () => {
    expect(ringArea(square)).toBe(100);
  });
});

describe("outlineFromPoints", () => {
  const circle = (n: number, jitter = 0): Pt[] =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [50 * Math.cos(a) + jitter * Math.sin(i * 7), 50 * Math.sin(a)];
    });

  it("closes the outline and keeps the shape", () => {
    const out = outlineFromPoints(circle(400), 0.1);
    expect(out[0]).toEqual(out[out.length - 1]);
    expect(selfIntersects(out)).toBe(false);
    expect(ringArea(out)).toBeGreaterThan(0.99 * Math.PI * 50 * 50);
  });

  it("a small tolerance keeps many more points than a coarse one", () => {
    const pts = circle(400, 0.1);
    const fine = outlineFromPoints(pts, 0.001).length;
    const coarse = outlineFromPoints(pts, 1.5).length;
    expect(fine).toBeGreaterThan(coarse * 3);
    expect(fine).toBeGreaterThan(350); // essentially every sample survives
  });

  it("a tolerance of zero keeps every point", () => {
    expect(outlineFromPoints(circle(100), 0).length).toBe(101); // 100 points plus the closing one
  });

  it("joins strokes with straight connectors and drops repeated points", () => {
    const strokes: Pt[] = [[0, 0], [5, 0], [10, 0], [10, 0], [10, 10], [0, 10]]; // second stroke starts where the first ended
    const out = outlineFromPoints(strokes, 0);
    expect(out).toEqual([[0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  });

  it("returns too few points as they are, for the caller to reject", () => {
    expect(outlineFromPoints([[0, 0], [1, 1]], 0.1).length).toBe(2);
  });
});

describe("snapToRings", () => {
  const rings: Pt[][] = [square];

  it("snaps to a vertex within tolerance", () => {
    expect(snapToRings([10.4, 0.3], rings, 1)).toEqual([10, 0]);
  });

  it("prefers a vertex over a nearer edge point", () => {
    expect(snapToRings([9.7, 0.1], rings, 1)).toEqual([10, 0]);
  });

  it("snaps onto an edge when no vertex is near", () => {
    expect(snapToRings([5, 0.6], rings, 1)).toEqual([5, 0]);
    expect(snapToRings([10.6, 4], rings, 1)).toEqual([10, 4]);
  });

  it("leaves a point alone when nothing is within tolerance", () => {
    const p: Pt = [5, 5];
    expect(snapToRings(p, rings, 1)).toBe(p);
  });

  it("works with several rings and a hole", () => {
    expect(snapToRings([20.2, 20.2], [square, [[20, 20], [30, 20], [30, 30], [20, 20]]], 1)).toEqual([20, 20]);
  });
});

describe("removing vertices", () => {
  it("finds the nearest vertex of a closed ring, counting the shared first and last point once", () => {
    expect(nearestVertex(square, [9.5, 0.4], 2)).toMatchObject({ index: 1 });
    expect(nearestVertex(square, [0.2, 0.2], 2)).toMatchObject({ index: 0 });
    expect(nearestVertex(square, [5, 5], 2)).toBeNull();
  });

  it("drops a corner and keeps the ring closed, including the first one", () => {
    expect(withoutRingVertex(square, 2)).toEqual([[0, 0], [10, 0], [0, 10], [0, 0]]);
    expect(withoutRingVertex(square, 0)).toEqual([[10, 0], [10, 10], [0, 10], [10, 0]]);
  });

  it("refuses to leave fewer than three corners", () => {
    expect(withoutRingVertex([[0, 0], [5, 0], [0, 5], [0, 0]], 1)).toBeNull();
  });

  it("drops a point from a line but keeps two", () => {
    expect(withoutLineVertex([[0, 0], [1, 1], [2, 2]], 1)).toEqual([[0, 0], [2, 2]]);
    expect(withoutLineVertex([[0, 0], [1, 1]], 0)).toBeNull();
  });
});

describe("point in polygon", () => {
  it("is inside a ring, or not", () => {
    expect(pointInRing(square, [5, 5])).toBe(true);
    expect(pointInRing(square, [15, 5])).toBe(false);
    expect(pointInRing(square, [5, -1])).toBe(false);
  });

  it("works for a concave ring", () => {
    const ell: Pt[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10], [0, 0]];
    expect(pointInRing(ell, [2, 8])).toBe(true);
    expect(pointInRing(ell, [8, 8])).toBe(false);
    expect(pointInRing(ell, [8, 2])).toBe(true);
  });

  it("is outside a hole", () => {
    const hole: Pt[] = [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]];
    expect(pointInPolygon(square, [hole], [5, 5])).toBe(false);
    expect(pointInPolygon(square, [hole], [1, 1])).toBe(true);
    expect(pointInPolygon(square, [], [5, 5])).toBe(true);
  });
});

describe("roundRing", () => {
  it("adds one point to every edge and keeps every corner exactly where it was", () => {
    const out = roundRing(square)!;
    expect(out).toHaveLength(9); // 4 corners and 4 new points, and the closing point
    expect(out[0]).toEqual(out[out.length - 1]);
    for (const corner of square) expect(out).toContainEqual(corner);
  });

  it("puts the new points on a smooth curve: a square becomes a rounder shape, a bit fuller but nowhere near a circle round it", () => {
    const out = roundRing(square)!;
    expect(ringArea(out)).toBeGreaterThan(100);
    expect(ringArea(out)).toBeLessThan(Math.PI * 50); // its circumscribed circle
    expect(selfIntersects(out)).toBe(false);
    // a point beside the middle of an edge bulges out of the square, but not by much
    const mid = out[1];
    expect(mid[0]).toBeCloseTo(5, 5);
    expect(mid[1]).toBeLessThan(0);
    expect(mid[1]).toBeGreaterThan(-3);
  });

  it("leaves a straight run straight: between collinear corners the new point is on the line", () => {
    const out = roundRing([[0, 0], [10, 0], [20, 0], [30, 0], [40, 0], [40, 40], [0, 40], [0, 0]])!;
    const on = out.filter((p) => p[0] > 10 && p[0] < 30 && p[1] === 0 || (p[0] > 10 && p[0] < 30 && Math.abs(p[1]) < 1e-9));
    expect(on.length).toBeGreaterThanOrEqual(2); // the new points between 10 and 20 and between 20 and 30
    for (const p of on) expect(p[1]).toBeCloseTo(0, 9);
  });

  it("is repeatable: another call halves the segments again and still keeps the corners", () => {
    const once = roundRing(square)!;
    const twice = roundRing(once)!;
    expect(twice).toHaveLength(17);
    for (const corner of once) expect(twice).toContainEqual(corner);
  });

  it("adds nothing to an edge shorter than the minimum, and returns null when no edge is long enough", () => {
    const tiny: Pt[] = [[0, 0], [0.3, 0], [0.3, 0.3], [0, 0.3], [0, 0]];
    expect(roundRing(tiny)).toBeNull();
    const mixed = roundRing([[0, 0], [10, 0], [10, 0.3], [0, 0.3], [0, 0]])!;
    expect(mixed).toHaveLength(7); // the two long edges got a point, the two short ones did not
  });

  it("copes with a closed or open ring, repeated points, and fewer than three corners", () => {
    expect(roundRing(square.slice(0, 4))).toEqual(roundRing(square));
    expect(roundRing([[0, 0], [0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])).toEqual(roundRing(square));
    expect(roundRing([[0, 0], [10, 0], [0, 0]])).toBeNull();
  });

  it("does not loop or overshoot beside a long edge between short ones", () => {
    const thin: Pt[] = [[0, 0], [100, 0], [100, 1], [0, 1], [0, 0]];
    const out = roundRing(thin)!;
    expect(selfIntersects(out)).toBe(false);
    for (const [, z] of out) expect(Math.abs(z - 0.5)).toBeLessThan(3);
  });
});
