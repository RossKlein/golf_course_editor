import { describe, expect, it } from "vitest";
import { blend, bspline, surfaceWeights, type CellAt } from "./blend";

/** Class 1 for cells right of the line x = z (centres at index + 0.5), else class 0: a 45 degree staircase. */
const diagonal: CellAt = (cx, cz) => (cx > cz ? 1 : 0);
/** Class 1 right of the vertical line x = 10. */
const vertical: CellAt = (cx) => (cx >= 10 ? 1 : 0);

/** The weight of class 1 by the old way: bilinear between the four nearest cells. */
function bilinear(cellAt: CellAt, qx: number, qz: number) {
  const x0 = Math.floor(qx), z0 = Math.floor(qz), fx = qx - x0, fz = qz - z0;
  const c = (i: number, j: number) => (cellAt(x0 + i, z0 + j) === 1 ? 1 : 0);
  return (c(0, 0) * (1 - fx) + c(1, 0) * fx) * (1 - fz) + (c(0, 1) * (1 - fx) + c(1, 1) * fx) * fz;
}

/** Where along x (in cells) a weight crosses one half, for a row at z, by bisection. */
function crossing(weightAt: (qx: number, qz: number) => number, qz: number, from: number, to: number) {
  let lo = from, hi = to;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (weightAt(mid, qz) < 0.5) lo = mid;
    else hi = mid;
  }
  return lo;
}

describe("B-spline weights", () => {
  it("add up to one and are never negative", () => {
    for (let t = 0; t < 1; t += 0.05) {
      const w = bspline(t);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(Math.min(...w)).toBeGreaterThanOrEqual(0);
    }
  });

  it("are symmetric about the middle of the two cells either side", () => {
    const [a, b, c, d] = bspline(0.5);
    expect(a).toBeCloseTo(d, 12);
    expect(b).toBeCloseTo(c, 12);
  });
});

describe("surface weights", () => {
  it("add up to one wherever they are taken", () => {
    for (const [x, z] of [[3.3, 7.9], [10.01, 4.4], [-2.5, 0.2]]) {
      const total = [...surfaceWeights(diagonal, x, z).values()].reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it("belong wholly to a surface far from any edge", () => {
    expect(surfaceWeights(vertical, 20.3, 5.5).get(1)).toBeCloseTo(1, 12);
    expect(surfaceWeights(vertical, 2.3, 5.5).get(0)).toBeCloseTo(1, 12);
  });
});

describe("the line between two surfaces", () => {
  it("falls where the cells change, for a straight edge", () => {
    const line = crossing((x, z) => surfaceWeights(vertical, x, z).get(1) ?? 0, 5.5, 8, 12);
    expect(line).toBeCloseTo(9.5, 6); // cell 10 starts at q = 9.5, as q has the half-cell taken off
  });

  it("is a much straighter line than bilinear gives for a slanted edge", () => {
    // the true edge of the polygon this raster came from is the line x = z + 0.5 in q
    const wobble = (weightAt: (x: number, z: number) => number) => {
      let worst = 0;
      for (let z = 20; z < 24; z += 0.05) worst = Math.max(worst, Math.abs(crossing(weightAt, z, z - 3, z + 3) - (z + 0.5)));
      return worst;
    };
    const smooth = wobble((x, z) => surfaceWeights(diagonal, x, z).get(1) ?? 0);
    const old = wobble((x, z) => bilinear(diagonal, x, z));
    expect(smooth).toBeLessThan(0.05); // within a twentieth of a cell of the true line
    expect(smooth).toBeLessThan(old / 3);
  });

  it("is blended across, and is one surface on either side", () => {
    const at = (x: number, edge: number) => blend(surfaceWeights(vertical, x, 5.5), edge);
    expect(at(5, 0.3)).toEqual({ a: 0, b: 0, share: 1 }); // well inside: only one surface is near
    expect(at(9.5, 0.3).share).toBeCloseTo(0.5, 6); // on the line: half and half
    const near = at(9.5 + 0.05, 0.3);
    expect(near.a).toBe(1);
    expect(near.share).toBeGreaterThan(0.5);
    expect(near.share).toBeLessThan(1);
  });

  it("is as wide as the look's edge says, and no narrower than a pixel", () => {
    const share = (x: number, edge: number, footprint = 0) => blend(surfaceWeights(vertical, x, 5.5), edge, footprint).share;
    const x = 9.5 + 0.1;
    expect(share(x, 0)).toBe(1); // a crisp edge with nothing to soften it
    expect(share(x, 0.6)).toBeLessThan(share(x, 0.1)); // softer: still mixed further from the line
    expect(share(x, 0, 2)).toBeLessThan(1); // a coarse pixel softens it even with a crisp edge
  });

  it("does not jump where the runner-up changes from one surface to another", () => {
    const a = blend(new Map([[2, 0.7], [3, 0.2], [4, 0.1]]), 0.3);
    const b = blend(new Map([[2, 0.7], [3, 0.1], [4, 0.2]]), 0.3);
    expect(a.share).toBeCloseTo(b.share, 12);
  });
});
