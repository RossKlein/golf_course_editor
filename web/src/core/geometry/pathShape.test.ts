import { describe, expect, it } from "vitest";
import type { Pt } from "./coords";
import { selfIntersects } from "./geometry";
import { growLine, growRing, pathShapes, ringCoverage, smoothLine } from "./pathShape";

const area = (ring: Pt[]) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a) / 2;
};
const net = (s: { outer: Pt[]; inner: Pt[][] }) => area(s.outer) - s.inner.reduce((a, h) => a + area(h), 0);
const square = (x: number, z: number, side: number): Pt[] => [[x, z], [x + side, z], [x + side, z + side], [x, z + side], [x, z]];

describe("growLine", () => {
  it("makes a stadium: length times width plus a circle", () => {
    const [s] = growLine([[0, 0], [20, 0]], 1);
    expect(Math.abs(net(s) - (20 * 2 + Math.PI))).toBeLessThan(0.15); // the arcs are polygons that sit just inside a true circle
    const xs = s.outer.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-1, 2); // the end is round, a radius beyond the last point
    expect(Math.max(...xs)).toBeCloseTo(21, 2);
  });

  it("is one clean shape where the line loops over itself", () => {
    const loop: Pt[] = [[0, 0], [20, 0], [20, 20], [10, 20], [10, -10]]; // crosses its own start
    const shapes = growLine(loop, 1);
    expect(shapes).toHaveLength(1);
    expect(selfIntersects(shapes[0].outer)).toBe(false);
    expect(shapes[0].inner.length).toBeGreaterThanOrEqual(0);
  });

  it("makes a hole where the line encloses ground", () => {
    const ring: Pt[] = [[0, 0], [30, 0], [30, 30], [0, 30], [0, 1]];
    const [s] = growLine(ring, 1);
    expect(s.inner).toHaveLength(1);
  });

  it("makes nothing from a point or no width", () => {
    expect(growLine([[0, 0]], 1)).toEqual([]);
    expect(growLine([[0, 0], [5, 0]], 0)).toEqual([]);
  });
});

describe("growRing", () => {
  it("leaves the polygon's own outline as the inner edge, and rounds the corners", () => {
    const g = square(0, 0, 10);
    const [s] = growRing(g, 1.5);
    // a square grown by r: side^2 + 4*side*r + pi*r^2
    expect(Math.abs(net(s) - (100 + 4 * 10 * 1.5 + Math.PI * 1.5 * 1.5))).toBeLessThan(0.3);
    expect(s.inner).toHaveLength(0);
    const xs = s.outer.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-1.5, 2);
    expect(selfIntersects(s.outer)).toBe(false);
  });

  it("follows a concave outline", () => {
    const l: Pt[] = [[0, 0], [20, 0], [20, 5], [5, 5], [5, 20], [0, 20], [0, 0]];
    const [s] = growRing(l, 1);
    expect(net(s)).toBeGreaterThan(area(l));
    expect(selfIntersects(s.outer)).toBe(false);
  });

  it("is quick on a detailed outline", () => {
    const round: Pt[] = Array.from({ length: 300 }, (_, i) => [20 * Math.cos((i / 300) * 2 * Math.PI), 14 * Math.sin((i / 300) * 2 * Math.PI)] as Pt);
    round.push(round[0]);
    const t = performance.now();
    const [s] = growRing(round, 1.5);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(s.outer.length).toBeLessThan(1500);
  });
});

describe("ringCoverage", () => {
  const g = square(0, 0, 10);
  it("is 0 with nothing there and 1 when a collar covers the whole ring", () => {
    expect(ringCoverage(g, 1.5, [])).toBe(0);
    const [collar] = growRing(g, 1.5);
    expect(ringCoverage(g, 1.5, [[collar.outer, collar.inner]])).toBeCloseTo(1, 2);
  });
  it("is partial for a thinner collar, and 0 for a far-away one", () => {
    const [thin] = growRing(g, 0.5);
    const c = ringCoverage(g, 1.5, [[thin.outer, thin.inner]]);
    expect(c).toBeGreaterThan(0.2);
    expect(c).toBeLessThan(0.6);
    expect(ringCoverage(g, 1.5, [[square(100, 100, 10), []]])).toBe(0);
  });
});

describe("smoothLine", () => {
  it("passes through the points it keeps and keeps both ends", () => {
    const pts: Pt[] = [[0, 0], [10, 0], [20, 10], [30, 10]];
    const out = smoothLine(pts, 0, 1);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[3]);
    for (const p of pts) expect(out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6)).toBe(true);
  });

  it("is sampled about every step", () => {
    const out = smoothLine([[0, 0], [10, 0], [20, 0]], 0, 1);
    for (let i = 1; i < out.length; i++) expect(Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1])).toBeLessThanOrEqual(1.0001);
  });

  it("does not overshoot a sharp bend by much", () => {
    const out = smoothLine([[0, 0], [10, 0], [10, 0.5], [20, 0.5]], 0, 0.5);
    const zs = out.map((p) => p[1]);
    expect(Math.min(...zs)).toBeGreaterThan(-0.5);
    expect(Math.max(...zs)).toBeLessThan(1);
  });

  it("drops a hand wobble when thinned", () => {
    const wobble: Pt[] = Array.from({ length: 60 }, (_, i) => [i, (i % 2) * 0.05] as Pt);
    const out = smoothLine(wobble, 0.3, 1);
    expect(Math.max(...out.map((p) => Math.abs(p[1] - 0.025)))).toBeLessThan(0.1);
  });

  it("leaves two points straight", () => {
    expect(smoothLine([[0, 0], [5, 5]], 0, 1)).toEqual([[0, 0], [5, 5]]);
  });
});

describe("pathShapes", () => {
  it("is quick on a long winding path and as wide as asked", () => {
    const pts: Pt[] = Array.from({ length: 40 }, (_, i) => [i * 8, Math.sin(i / 3) * 12] as Pt);
    const t = performance.now();
    const shapes = pathShapes(pts, 2.5, 0.2);
    expect(performance.now() - t).toBeLessThan(3000);
    expect(shapes).toHaveLength(1);
    expect(selfIntersects(shapes[0].outer)).toBe(false);
    const length = smoothLine(pts, 0.2, 0.5).reduce((a, p, i, l) => (i ? a + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0);
    expect(net(shapes[0])).toBeGreaterThan(length * 2.5 * 0.97);
    expect(net(shapes[0])).toBeLessThan(length * 2.5 * 1.1 + 10);
  });

  it("makes nothing from one point", () => {
    expect(pathShapes([[1, 1]], 2, 0)).toEqual([]);
  });
});

import { offsetShape, shapeWidth } from "./pathShape";

describe("shapeWidth", () => {
  it("is the width of a long path", () => {
    const [s] = pathShapes([[0, 0], [100, 0], [200, 30]], 3, 0.1);
    expect(shapeWidth(s.outer, s.inner)).toBeGreaterThan(2.9);
    expect(shapeWidth(s.outer, s.inner)).toBeLessThan(3.05);
  });
});

describe("offsetShape", () => {
  const strip = (w: number): { outer: Pt[]; inner: Pt[][] } => ({ outer: [[0, 0], [500, 0], [500, w], [0, w], [0, 0]], inner: [] });

  it("widens a strip by the offset each side, and shrinks it", () => {
    const { outer, inner } = strip(4);
    const [wide] = offsetShape(outer, inner, 1);
    expect(shapeWidth(wide.outer, wide.inner)).toBeGreaterThan(5.7);
    expect(shapeWidth(wide.outer, wide.inner)).toBeLessThan(6.1);
    const [narrow] = offsetShape(outer, inner, -1);
    expect(net(narrow)).toBeCloseTo(498 * 2, 0); // 500 x 4 loses 1 m off every side
    const ys = narrow.outer.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(1, 3);
    expect(Math.max(...ys)).toBeCloseTo(3, 3);
  });

  it("leaves a shape alone for no offset, and nothing for a shrink that takes it all", () => {
    const { outer, inner } = strip(4);
    expect(net(offsetShape(outer, inner, 0)[0])).toBeCloseTo(2000, 3);
    expect(offsetShape(outer, inner, -2.5)).toEqual([]);
  });

  it("closes a hole as the shape grows and opens it as it shrinks", () => {
    const ring = square(0, 0, 40);
    const hole = square(15, 15, 10).reverse();
    const [grown] = offsetShape(ring, [hole], 2);
    expect(Math.abs(net(grown) - (1600 + 4 * 40 * 2 + Math.PI * 4 - 6 * 6))).toBeLessThan(2); // the outside grows 2 m and the hole closes to 6 m across
    const hollow = (s: { inner: Pt[][] }) => s.inner.reduce((a, h) => a + area(h), 0);
    expect(hollow(grown)).toBeLessThan(area(hole));
    const [shrunk] = offsetShape(ring, [hole], -2);
    expect(hollow(shrunk)).toBeGreaterThan(area(hole));
  });

  it("splits a dumbbell that is shrunk past its neck, largest first", () => {
    const outer: Pt[] = [[0, 0], [20, 0], [20, 8], [30, 8], [30, 0], [50, 0], [50, 20], [30, 20], [30, 12], [20, 12], [20, 20], [0, 20], [0, 0]];
    const pieces = offsetShape(outer, [], -2.5);
    expect(pieces.length).toBe(2);
    expect(net(pieces[0])).toBeGreaterThanOrEqual(net(pieces[1]));
  });

  it("is quick on the outline of a long path", () => {
    const pts: Pt[] = Array.from({ length: 40 }, (_, i) => [i * 8, Math.sin(i / 3) * 12] as Pt);
    const [path] = pathShapes(pts, 2.5, 0.2);
    for (const delta of [1.5, -0.6]) {
      const t = performance.now();
      const out = offsetShape(path.outer, path.inner, delta);
      expect(performance.now() - t).toBeLessThan(500); // fast enough to follow a slider
      expect(out.length).toBeGreaterThan(0);
    }
  });
});
