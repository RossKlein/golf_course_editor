import { describe, expect, it } from "vitest";
import { basis, blend, blendShare, scaleOf, surfaceWeights, tapsFor, type CellAt } from "./blend";

/** Class 1 for cells right of the line x = z (centres at index + 0.5), else class 0: a 45 degree staircase. */
const diagonal: CellAt = (cx, cz) => (cx > cz ? 1 : 0);
/** Class 1 right of the vertical line x = 10. */
const vertical: CellAt = (cx) => (cx >= 10 ? 1 : 0);
/** A line one cell wide, class 1 in column 10. */
const thin: CellAt = (cx) => (cx === 10 ? 1 : 0);
/** A gentle slope: the edge climbs one cell every eleven columns, so it is a staircase of long steps. */
const shallow: CellAt = (cx, cz) => (cz < Math.floor(cx / 11) ? 1 : 0);

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

/** Where along z the weight of class 1 crosses one half, for a column at x. */
function crossingZ(weightAt: (qx: number, qz: number) => number, qx: number, from: number, to: number) {
  let lo = from, hi = to;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (weightAt(qx, mid) > 0.5) lo = mid;
    else hi = mid;
  }
  return lo;
}

describe("the B-spline", () => {
  it("is a smooth bump, 2/3 high in the middle and nothing past two", () => {
    expect(basis(0)).toBeCloseTo(2 / 3, 12);
    expect(basis(1)).toBeCloseTo(1 / 6, 12);
    expect(basis(2)).toBe(0);
    expect(basis(-0.7)).toBeCloseTo(basis(0.7), 12);
  });

  it("adds up to one with its shifted copies, at any scale that is a whole number", () => {
    for (const scale of [1, 2, 3]) {
      for (let q = 0; q < 1; q += 0.1) {
        let sum = 0;
        for (let n = -20; n <= 20; n++) sum += basis((n - q) / scale) / scale;
        expect(sum).toBeCloseTo(1, 9);
      }
    }
  });

  it("is as wide as the radius asks, and never narrower than one cell to the unit", () => {
    expect(scaleOf(1, 0.5)).toBe(1); // a 1 m radius over 0.5 m cells: the narrowest
    expect(scaleOf(2, 0.5)).toBe(2);
    expect(scaleOf(3, 0.5)).toBe(3);
    expect(scaleOf(0.2, 0.5)).toBe(1);
    expect(tapsFor(1)).toBe(4);
    expect(tapsFor(2)).toBe(8);
    expect(tapsFor(3)).toBe(12);
    expect(tapsFor(1.3) % 2).toBe(0); // always an even number, so the point is in the middle
  });
});

describe("surface weights", () => {
  it("add up to one wherever they are taken, at any width", () => {
    for (const scale of [1, 1.4, 2, 3]) {
      for (const [x, z] of [[3.3, 7.9], [10.01, 4.4], [-2.5, 0.2]]) {
        const total = [...surfaceWeights(diagonal, x, z, scale).values()].reduce((a, b) => a + b, 0);
        expect(total).toBeCloseTo(1, 12);
      }
    }
  });

  it("belong wholly to a surface far from any edge", () => {
    for (const scale of [1, 2, 3]) {
      expect(surfaceWeights(vertical, 25.3, 5.5, scale).get(1)).toBeCloseTo(1, 12);
      expect(surfaceWeights(vertical, -3.3, 5.5, scale).get(0)).toBeCloseTo(1, 12);
    }
  });
});

describe("the line between two surfaces", () => {
  it("falls where the cells change, for a straight edge, at any width", () => {
    for (const scale of [1, 2, 3]) {
      const line = crossing((x, z) => surfaceWeights(vertical, x, z, scale).get(1) ?? 0, 5.5, 6, 14);
      expect(line).toBeCloseTo(9.5, 6); // cell 10 starts at q = 9.5, as q has the half-cell taken off
    }
  });

  it("is straight along a 45 degree staircase, to a twentieth of a cell", () => {
    // the true edge of the polygon this raster came from is the line x = z + 0.5 in q
    for (const scale of [1, 2, 3]) {
      let worst = 0;
      for (let z = 20; z < 24; z += 0.05) worst = Math.max(worst, Math.abs(crossing((x, y) => surfaceWeights(diagonal, x, y, scale).get(1) ?? 0, z, z - 4, z + 4) - (z + 0.5)));
      expect(worst).toBeLessThan(0.05);
    }
  });

  it("ripples less the wider the spline, on a long shallow edge", () => {
    // the true edge climbs one cell every eleven columns: a line, so the best an edge can do is be straight
    const ripple = (scale: number) => {
      const zs: number[] = [];
      for (let x = 30; x < 60; x += 0.5) zs.push(crossingZ((qx, qz) => surfaceWeights(shallow, qx, qz, scale).get(1) ?? 0, x, 0, 12));
      const n = zs.length, xs = zs.map((_, i) => i * 0.5);
      const mx = xs.reduce((a, b) => a + b, 0) / n, mz = zs.reduce((a, b) => a + b, 0) / n;
      const slope = xs.reduce((a, x, i) => a + (x - mx) * (zs[i] - mz), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
      return Math.max(...zs.map((z, i) => Math.abs(z - (mz + slope * (xs[i] - mx))))); // the worst distance from the straight line through it
    };
    expect(ripple(2)).toBeLessThan(ripple(1) * 0.8); // about 0.44, 0.32, 0.23 of a cell for a spline 1, 2 and 3 cells to the unit
    expect(ripple(3)).toBeLessThan(ripple(2) * 0.8);
  });

  it("loses a feature thinner than the spline is wide, and keeps it when the spline is narrow enough", () => {
    const peak = (scale: number) => surfaceWeights(thin, 10, 5.5, scale).get(1) ?? 0; // the middle of a one-cell line
    expect(peak(1)).toBeGreaterThan(0.5); // a 1 m radius keeps a 0.5 m line
    expect(peak(2)).toBeLessThan(0.5); // a 2 m radius does not: it averages it away
  });

  it("is one surface on either side of a crisp line, and half and half on it", () => {
    const at = (x: number, footprint = 0) => blend(surfaceWeights(vertical, x, 5.5, 2), footprint);
    expect(at(2)).toEqual({ a: 0, b: 0, share: 1 }); // well inside: only one surface is near
    expect(at(9.5 - 0.05)).toMatchObject({ a: 0, share: 1 });
    expect(at(9.5 + 0.05)).toMatchObject({ a: 1, share: 1 }); // the change is at the line, with nothing between
    expect(at(9.5, 0.01).share).toBeCloseTo(0.5, 3);
  });

  it("is no sharper than a pixel", () => {
    const share = (x: number, footprint: number) => blend(surfaceWeights(vertical, x, 5.5, 2), footprint).share;
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
