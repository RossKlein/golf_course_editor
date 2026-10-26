import { describe, expect, it } from "vitest";
import { stripeAcross, stripeDirections } from "./stripes";

describe("mowing stripes", () => {
  it("run along the line of play, so the across direction is perpendicular to it", () => {
    const [x, z] = stripeAcross([[0, 0], [10, 0]]);
    expect(Math.abs(x)).toBeCloseTo(0);
    expect(Math.abs(z)).toBeCloseTo(1);
    const d = stripeAcross([[0, 0], [30, 40]]);
    expect(d[0] * 30 + d[1] * 40).toBeCloseTo(0);
    expect(Math.hypot(...d)).toBeCloseTo(1);
  });

  it("uses the tee and the green, whatever the bends between", () => {
    expect(stripeAcross([[0, 0], [5, 50], [10, 0]])).toEqual(stripeAcross([[0, 0], [10, 0]]));
  });

  it("falls back for a hole with no route", () => {
    expect(stripeAcross([])).toEqual([1, 0]);
    expect(stripeAcross([[3, 3], [3, 3]])).toEqual([1, 0]);
  });

  it("gives all 24 holes an entry, in hole order", () => {
    const d = stripeDirections([[[0, 0], [10, 0]], [[0, 0], [0, 10]]]);
    expect(d.length).toBe(48);
    expect(Math.abs(d[1])).toBeCloseTo(1); // hole 1 runs east, stripes across z
    expect(Math.abs(d[2])).toBeCloseTo(1); // hole 2 runs south, stripes across x
    expect([d[46], d[47]]).toEqual([1, 0]);
  });
});
