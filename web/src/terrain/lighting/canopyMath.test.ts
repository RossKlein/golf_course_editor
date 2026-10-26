import { describe, expect, it } from "vitest";
import { crownOcclusion, skyLeft, type Crown } from "./canopyMath";

const pine: Crown = { radius: 3, bottom: 5, top: 20 };

describe("a crown's share of the sky", () => {
  it("is half the sky for a wall that goes on for ever, which is what the formula should give", () => {
    // a cylinder far wider than it is far away is a wall; a mile high, it fills the sky from the horizon to the top
    const wall: Crown = { radius: 1e9, bottom: 0, top: 1e9 };
    expect(crownOcclusion(wall, 1e6, 0)).toBeCloseTo(0.5, 3);
  });

  it("is nothing far away, and falls steadily as the distance grows", () => {
    let last = Infinity;
    for (const d of [4, 6, 10, 20, 40, 80]) {
      const o = crownOcclusion(pine, d, 0);
      expect(o).toBeLessThan(last);
      last = o;
    }
    expect(crownOcclusion(pine, 200, 0)).toBeLessThan(0.002);
  });

  it("hides a tenth of the sky just beside a pine whose crown starts 5 m up, and a quarter under it", () => {
    // beside: it spans 118 degrees of azimuth, between 37 and 79 degrees up; under: all the way round, from 56 to 80 degrees
    expect(crownOcclusion(pine, 3.5, 0)).toBeCloseTo(0.098, 2);
    expect(crownOcclusion(pine, 0, 0)).toBeCloseTo(0.243, 2);
  });

  it("is more for a taller or wider crown, and more when its bottom is lower", () => {
    const base = crownOcclusion(pine, 8, 0);
    expect(crownOcclusion({ ...pine, top: 30 }, 8, 0)).toBeGreaterThan(base);
    expect(crownOcclusion({ ...pine, radius: 5 }, 8, 0)).toBeGreaterThan(base);
    expect(crownOcclusion({ ...pine, bottom: 1 }, 8, 0)).toBeGreaterThan(base);
  });

  it("is nothing for a point above the crown, more for ground that stands up the slope from the trunk, and less for ground below it", () => {
    expect(crownOcclusion(pine, 5, 25)).toBe(0);
    expect(crownOcclusion(pine, 5, 8)).toBeGreaterThan(crownOcclusion(pine, 5, 0)); // level with the crown's bottom, it fills from the horizon up
    expect(crownOcclusion(pine, 5, -8)).toBeLessThan(crownOcclusion(pine, 5, 0)); // below the trunk, the crown is higher and steeper overhead
  });

  it("is continuous across the crown's edge, and between 0 and 1", () => {
    const inside = crownOcclusion(pine, 2.999, 0), outside = crownOcclusion(pine, 3.001, 0);
    expect(Math.abs(inside - outside)).toBeLessThan(0.01);
    for (const d of [0, 1, 3, 7, 30]) for (const r of [-5, 0, 5, 15]) {
      const o = crownOcclusion(pine, d, r);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  });
});

describe("several crowns", () => {
  it("leave what the others did not hide, never more than all of the sky", () => {
    const one = skyLeft([{ crown: pine, distance: 5, rise: 0 }]);
    const two = skyLeft([{ crown: pine, distance: 5, rise: 0 }, { crown: pine, distance: 7, rise: 0 }]);
    expect(one).toBeCloseTo(1 - crownOcclusion(pine, 5, 0), 12);
    expect(two).toBeLessThan(one);
    expect(two).toBeGreaterThan(0);
    expect(skyLeft([])).toBe(1);
  });
});
