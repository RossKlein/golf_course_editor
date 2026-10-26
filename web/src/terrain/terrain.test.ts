import { describe, expect, it } from "vitest";
import type { HeightGrid } from "../core/decode/decode";
import { hillshadePixels } from "./passes/flat/cpuHillshade";
import { M_PER_FT } from "../core/units/units";
import { contourOptions, nearestContour, nextContour } from "./passes/flat/contours";
import { packHeights } from "./heightfield/heightfield";
import { contourIndex, shadeOf } from "./passes/flat/reference";
import { testSun as SUN } from "./look/look.fixture";
import { solarPosition, sunDirection, sunOfLook } from "./sun";
import { testLook } from "./look/look.fixture";

/** A grid of `cols` x `rows` heights from a function of (col, row). */
function grid(cols: number, rows: number, h: (c: number, r: number) => number): HeightGrid {
  const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) values[r * cols + c] = h(c, r);
  return { values, valid: new Uint8Array(cols * rows).fill(1), cols, rows };
}

describe("terrain lighting", () => {
  it("flat ground is lit by the sun's height alone", () => {
    expect(shadeOf(0, 0, 3, SUN)).toBeCloseTo(Math.sin(SUN.altitude), 6);
  });

  it("faces toward the sun are brighter than faces away from it", () => {
    // the sun is in the east, so ground that falls to the east faces it
    expect(shadeOf(-0.2, 0, 3, SUN)).toBeGreaterThan(shadeOf(0, 0, 3, SUN));
    expect(shadeOf(0.2, 0, 3, SUN)).toBeLessThan(shadeOf(0, 0, 3, SUN));
  });

  it("exaggeration steepens the shading", () => {
    expect(Math.abs(shadeOf(0.2, 0.2, 6, SUN) - shadeOf(0, 0, 6, SUN))).toBeGreaterThan(Math.abs(shadeOf(0.2, 0.2, 1, SUN) - shadeOf(0, 0, 1, SUN)));
  });

  it("matches the CPU hillshade the viewer used before, on a tilted plane", () => {
    const g = grid(5, 5, (c, r) => 0.3 * c - 0.1 * r);
    const px = new Uint8ClampedArray(25 * 4);
    hillshadePixels(g, 1, 1, 3, px, SUN);
    expect(px[(2 * 5 + 2) * 4]).toBe(Math.round(shadeOf(0.3, -0.1, 3, SUN) * 255));
  });
});

describe("contours", () => {
  it("finds the nearest line and whether it is a major one", () => {
    expect(contourIndex(11.2, 1)).toMatchObject({ nearest: 11, major: false });
    expect(contourIndex(11.2, 1).distance).toBeCloseTo(0.2);
    expect(contourIndex(10.2, 1).major).toBe(true); // every fifth line is a major one
    expect(contourIndex(9.8, 2)).toMatchObject({ nearest: 5, major: true });
    expect(contourIndex(-5.1, 1).major).toBe(true);
  });

  it("offers off first, then round numbers in the display unit", () => {
    expect(contourOptions("metric")[0]).toBe(0);
    expect(contourOptions("us")).toEqual([0, 0.5 * M_PER_FT, M_PER_FT, 2 * M_PER_FT, 5 * M_PER_FT]);
  });

  it("cycles through the options and back to off", () => {
    let c = 0;
    const seen: number[] = [];
    for (let i = 0; i < contourOptions("metric").length; i++) {
      c = nextContour(c, "metric");
      seen.push(c);
    }
    expect(seen[0]).toBe(0.1);
    expect(seen[seen.length - 1]).toBe(0);
  });

  it("a spacing saved in feet still finds its place in metric", () => {
    expect(nearestContour(M_PER_FT, "metric")).toBe(0.25); // 1 ft = 0.3048 m
    expect(nextContour(M_PER_FT, "metric")).toBe(0.5);
  });
});

describe("height texture", () => {
  it("interleaves height and validity, zeroing missing data", () => {
    const packed = packHeights(new Float32Array([1.5, 7, 3]), new Uint8Array([1, 0, 1]));
    expect(Array.from(packed)).toEqual([1.5, 1, 0, 0, 3, 1]);
  });
});

describe("the sun", () => {
  const deg = (r: number) => (r * 180) / Math.PI;

  it("is nearly due east and high at 11 am on a midsummer morning on the east coast", () => {
    expect(deg(SUN.azimuth)).toBeGreaterThan(90);
    expect(deg(SUN.azimuth)).toBeLessThan(110);
    expect(deg(SUN.altitude)).toBeGreaterThan(52);
    expect(deg(SUN.altitude)).toBeLessThan(62);
  });

  it("is the look's sun, however the look sets it", () => {
    expect(sunOfLook(testLook)).toEqual(SUN);
    const noon = sunOfLook({ ...testLook, sun: { latitude: 33.5, declination: 23.44, hourAngle: 0 } });
    expect(deg(noon.azimuth)).toBeCloseTo(180, 4);
  });

  it("is due south and at its highest at solar noon", () => {
    const noon = solarPosition(33.5, 23.44, 0);
    expect(deg(noon.azimuth)).toBeCloseTo(180, 4);
    expect(deg(noon.altitude)).toBeCloseTo(90 - 33.5 + 23.44, 4);
  });

  it("rises in the east in the morning and sets in the west in the evening", () => {
    expect(solarPosition(33.5, 23.44, -90).azimuth).toBeLessThan(Math.PI);
    expect(solarPosition(33.5, 23.44, 90).azimuth).toBeGreaterThan(Math.PI);
  });

  it("points east and up in course axes", () => {
    const [x, y, z] = sunDirection(SUN);
    expect(x).toBeGreaterThan(0.4); // east is +x
    expect(y).toBeGreaterThan(0.7);
    expect(z).toBeLessThan(0.2); // slightly south of east would be +z
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
  });
});
