import { describe, expect, it } from "vitest";
import { fromMetres, M_PER_FT, M_PER_YD, makeFormatter, parseLength, scaleBar, toMetres } from "./units";

describe("conversions", () => {
  it("uses the exact international foot and yard", () => {
    expect(M_PER_FT).toBe(0.3048);
    expect(M_PER_YD).toBe(0.9144);
    expect(M_PER_YD).toBeCloseTo(3 * M_PER_FT, 12);
    expect(fromMetres(0.9144, "us", "distance")).toBeCloseTo(1, 12);
    expect(fromMetres(0.3048, "us", "height")).toBeCloseTo(1, 12);
  });

  it("round-trips without drift", () => {
    for (const kind of ["distance", "height"] as const) {
      for (const m of [0, 0.25, 1, 87.4, 1405.123]) {
        expect(toMetres(fromMetres(m, "us", kind), "us", kind)).toBeCloseTo(m, 9);
      }
    }
  });

  it("is the identity in metric", () => {
    expect(fromMetres(12.5, "metric", "distance")).toBe(12.5);
    expect(toMetres(12.5, "metric", "height")).toBe(12.5);
  });
});

describe("formatter", () => {
  it("shows yards for distances and feet for heights in US units", () => {
    const f = makeFormatter("us");
    expect(f.distance(91.44)).toBe("100.0 yd");
    expect(f.distance(91.44, 0)).toBe("100 yd");
    expect(f.height(30.48)).toBe("100.0 ft");
    expect(f.height(0.3048 * 87.4)).toBe("87.4 ft");
  });

  it("shows metres in metric units", () => {
    const f = makeFormatter("metric");
    expect(f.distance(91.44)).toBe("91.4 m");
    expect(f.height(87.4321)).toBe("87.43 m");
  });
});

describe("area", () => {
  it("uses square feet and acres in US units", () => {
    const f = makeFormatter("us");
    expect(f.area(9.290304)).toBe("100 sq ft");
    expect(f.area(4046.8564224)).toBe("1.00 acres");
    expect(f.area(20234.282112)).toBe("5.00 acres");
  });

  it("uses square metres and hectares in metric", () => {
    const f = makeFormatter("metric");
    expect(f.area(450.4)).toBe("450 m²");
    expect(f.area(25_000)).toBe("2.50 ha");
  });
});

describe("parseLength", () => {
  it("reads a bare number in the display unit for the kind", () => {
    expect(parseLength("100", "us", "distance")).toBeCloseTo(91.44, 9);
    expect(parseLength("87.4", "us", "height")).toBeCloseTo(26.64, 2);
    expect(parseLength("12", "metric", "height")).toBe(12);
  });

  it("lets a unit suffix win over the display unit", () => {
    expect(parseLength("12 m", "us", "height")).toBe(12);
    expect(parseLength("10 yd", "metric", "height")).toBeCloseTo(9.144, 9);
    expect(parseLength("3ft", "metric", "distance")).toBeCloseTo(0.9144, 9);
    expect(parseLength("6 in", "us", "height")).toBeCloseTo(0.1524, 9);
    expect(parseLength(" 2.5 FEET ", "us", "distance")).toBeCloseTo(0.762, 9);
    expect(parseLength(".5 m", "us", "height")).toBe(0.5);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "abc", "12 parsecs", "1,5", "--3", "3 4"]) expect(parseLength(bad, "us", "height")).toBeNull();
  });
});

describe("scaleBar", () => {
  it("picks round yard lengths in US units", () => {
    // 0.5 px per metre: 50 yd = 45.72 m = 22.9 px (too short); 250 yd = 114 px (first step >= 80 px)
    const bar = scaleBar("us", 0.5);
    expect(bar.label).toBe("250 yd");
    expect(bar.metres).toBeCloseTo(228.6, 9);
  });

  it("picks round metre lengths in metric units, with km for long ones", () => {
    expect(scaleBar("metric", 0.5).label).toBe("200 m");
    expect(scaleBar("metric", 0.05).label).toBe("2 km");
  });

  it("is at least as wide as asked and falls back to the longest step when zoomed far out", () => {
    for (const units of ["us", "metric"] as const) {
      const bar = scaleBar(units, 2, 80);
      expect(bar.metres * 2).toBeGreaterThanOrEqual(80);
    }
    expect(scaleBar("us", 1e-6).label).toBe("2500 yd");
  });
});
