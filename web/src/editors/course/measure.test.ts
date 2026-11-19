import { describe, expect, it } from "vitest";
import { makeFormatter } from "../../core/units/units";
import { measurePoints, measureReadout, pathLength, segments } from "./measure";

const yards = makeFormatter("us").distance;
const metres = makeFormatter("metric").distance;

describe("pathLength", () => {
  it("is zero until there are two points", () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([[0, 0]])).toBe(0);
  });

  it("sums the straight segments", () => {
    expect(pathLength([[0, 0], [3, 4], [13, 4]])).toBeCloseTo(15);
  });
});

describe("measurePoints", () => {
  it("follows the pointer only while the measurement is open", () => {
    expect(measurePoints([[0, 0]], [10, 0], true)).toEqual([[0, 0], [10, 0]]);
    expect(measurePoints([[0, 0], [10, 0]], [20, 0], false)).toEqual([[0, 0], [10, 0]]);
  });

  it("ignores a pointer still on the last point", () => {
    expect(measurePoints([[0, 0], [10, 0]], [10, 0], true)).toEqual([[0, 0], [10, 0]]);
  });
});

describe("segments", () => {
  it("labels the midpoint and skips a repeated point", () => {
    expect(segments([[0, 0], [10, 0], [10, 0]])).toEqual([{ mid: [5, 0], metres: 10 }]);
  });
});

describe("measureReadout", () => {
  it("is empty until there is a segment", () => {
    expect(measureReadout([[0, 0]], [91.44, 0], false, yards)).toBe("");
  });

  it("reads one leg in the display units, including the pointer", () => {
    expect(measureReadout([[0, 0]], [91.44, 0], true, yards)).toBe("100.0 yd");
    expect(measureReadout([[0, 0]], [100, 0], true, metres)).toBe("100.0 m");
  });

  it("reads the whole path once there is more than one leg", () => {
    expect(measureReadout([[0, 0], [91.44, 0], [182.88, 0]], null, false, yards)).toBe("200.0 yd total");
  });

  it("leaves the pointer out of a finished measurement", () => {
    expect(measureReadout([[0, 0], [91.44, 0]], [182.88, 0], false, yards)).toBe("100.0 yd");
  });
});
