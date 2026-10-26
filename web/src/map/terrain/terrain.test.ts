import { describe, expect, it } from "vitest";
import { hillshadePixels, type HeightGrid } from "../../decode/decode";
import { M_PER_FT } from "../../units/units";
import { contourOptions, nearestContour, nextContour } from "./contours";
import { contourIndex, packHeights, shadeOf } from "./reference";

/** A grid of `cols` x `rows` heights from a function of (col, row). */
function grid(cols: number, rows: number, h: (c: number, r: number) => number): HeightGrid {
  const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) values[r * cols + c] = h(c, r);
  return { values, valid: new Uint8Array(cols * rows).fill(1), cols, rows };
}

describe("terrain lighting", () => {
  it("flat ground is lit by the sun's height alone", () => {
    expect(shadeOf(0, 0, 3)).toBeCloseTo(Math.sin(Math.PI / 4), 6);
  });

  it("faces toward the north-west are brighter than faces toward the south-east", () => {
    // rising to the south-east means the surface faces north-west, towards the sun
    expect(shadeOf(0.2, 0.2, 3)).toBeGreaterThan(shadeOf(-0.2, -0.2, 3));
  });

  it("exaggeration steepens the shading", () => {
    expect(Math.abs(shadeOf(0.2, 0.2, 6) - shadeOf(0, 0, 6))).toBeGreaterThan(Math.abs(shadeOf(0.2, 0.2, 1) - shadeOf(0, 0, 1)));
  });

  it("matches the CPU hillshade the viewer used before, on a tilted plane", () => {
    const g = grid(5, 5, (c, r) => 0.3 * c - 0.1 * r);
    const px = new Uint8ClampedArray(25 * 4);
    hillshadePixels(g, 1, 1, 3, px);
    expect(px[(2 * 5 + 2) * 4]).toBe(Math.round(shadeOf(0.3, -0.1, 3) * 255));
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
