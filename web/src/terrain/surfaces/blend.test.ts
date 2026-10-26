import { describe, expect, it } from "vitest";
import { blend, blendShare, bspline, surfaceWeights, type CellAt } from "./blend";

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

  it("is one surface on either side of a crisp line, and half and half on it", () => {
    const at = (x: number, footprint = 0) => blend(surfaceWeights(vertical, x, 5.5), footprint);
    expect(at(5)).toEqual({ a: 0, b: 0, share: 1 }); // well inside: only one surface is near
    expect(at(9.5 - 0.05)).toMatchObject({ a: 0, share: 1 });
    expect(at(9.5 + 0.05)).toMatchObject({ a: 1, share: 1 }); // the change is at the line, with nothing between
    expect(at(9.5, 0.01).share).toBeCloseTo(0.5, 3);
  });

  it("is no sharper than a pixel", () => {
    const share = (x: number, footprint: number) => blend(surfaceWeights(vertical, x, 5.5), footprint).share;
    expect(share(9.6, 0)).toBe(1);
    expect(share(9.6, 2)).toBeLessThan(1); // a pixel covering several cells softens the edge: antialiasing
    expect(share(9.6, 2)).toBeGreaterThan(0.5);
  });

  it("leaves a pure area pure however many cells a pixel covers", () => {
    for (const width of [0.1, 0.9, 1, 1.5, 2.7, 10]) {
      expect(blendShare(1, width)).toBeCloseTo(1, 12); // far from any other surface
      expect(blendShare(0, width)).toBeCloseTo(0.5, 12); // on the line
    }
    expect(blend(new Map([[2, 1], [3, 0]]), 5).share).toBeCloseTo(1, 12);
  });

  it("stays between half and all at any width, and still rises with the weight difference", () => {
    for (const d of [0, 0.2, 0.5, 0.8, 1]) {
      const s = blendShare(d, 3);
      expect(s).toBeGreaterThanOrEqual(0.5);
      expect(s).toBeLessThanOrEqual(1);
    }
    expect(blendShare(0.3, 3)).toBeLessThan(blendShare(0.6, 3)); // and it still rises with d
  });

  it("does not jump where the runner-up changes from one surface to another", () => {
    const a = blend(new Map([[2, 0.7], [3, 0.2], [4, 0.1]]), 0.4);
    const b = blend(new Map([[2, 0.7], [3, 0.1], [4, 0.2]]), 0.4);
    expect(a.share).toBeCloseTo(b.share, 12);
  });
});
