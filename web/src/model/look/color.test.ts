import { describe, expect, it } from "vitest";
import { hexToRgb, hsvToRgb, rgbToCss, rgbToHex, rgbToHsv, type Rgb } from "./color";

const near = (a: number[], b: number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe("colours", () => {
  it("writes and reads hex", () => {
    expect(rgbToHex([1, 0, 0.5])).toBe("#ff0080");
    expect(rgbToHex([-1, 2, 0])).toBe("#00ff00"); // out of range is clamped
    near(hexToRgb("#ff8000")!, [1, 128 / 255, 0]);
    near(hexToRgb("0f0")!, [0, 1, 0]);
    expect(hexToRgb("#12")).toBeNull();
    expect(hexToRgb("blue")).toBeNull();
  });

  it("round-trips the look's own colours through hex to within a 255th", () => {
    for (const c of [[0.5, 0.86, 0.3], [0.965, 0.93, 0.81], [0.16, 0.31, 0.1]] as Rgb[]) near(hexToRgb(rgbToHex(c))!, c, 2);
  });

  it("converts to and from hue, saturation and value", () => {
    near(rgbToHsv([1, 0, 0]), [0, 1, 1]);
    near(rgbToHsv([0, 1, 0]), [120, 1, 1]);
    near(rgbToHsv([0, 0, 1]), [240, 1, 1]);
    near(rgbToHsv([0.5, 0.5, 0.5]), [0, 0, 0.5]);
    near(rgbToHsv([0, 0, 0]), [0, 0, 0]);
    near(hsvToRgb([60, 1, 1]), [1, 1, 0]);
    near(hsvToRgb([300, 0.5, 0.5]), [0.5, 0.25, 0.5]);
  });

  it("round-trips through hue, saturation and value", () => {
    for (const c of [[0.5, 0.86, 0.3], [0.965, 0.93, 0.81], [0.27, 0.6, 0.86], [0.42, 0.31, 0.2], [1, 1, 1], [0.2, 0.2, 0.2]] as Rgb[]) near(hsvToRgb(rgbToHsv(c)), c);
  });

  it("writes CSS", () => {
    expect(rgbToCss([1, 0.5, 0])).toBe("rgb(255 128 0)");
  });
});
