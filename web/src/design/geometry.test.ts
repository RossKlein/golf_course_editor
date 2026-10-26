import { describe, expect, it } from "vitest";
import { closeRing, dedupe, nearestVertex, outlineFromPoints, ringArea, selfIntersects, snapToRings, withoutLineVertex, withoutRingVertex } from "./geometry";
import type { Pt } from "../map/coords";

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
