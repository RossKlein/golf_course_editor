import { describe, expect, it } from "vitest";
import { SUN_WIDTH, sunVisibility, type SunSettings } from "./sunMath";

/** What the shader uses. Its steps are few and spread out, which suits smooth ground but can step over a thin wall. */
const S: SunSettings = { steps: 24, reach: 120, softness: 0.3, angular: SUN_WIDTH };
/** The same marched very finely, for a sheer edge whose place has to come out exactly. */
const DENSE: SunSettings = { ...S, steps: 6000 };

const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** The sun to the east, 45 degrees up. */
const EAST = norm([1, 1, 0]);

/** A cliff: ground at 0 to the west of x = 0, and a plateau of height `h` to the east, towards the sun. */
const cliff = (h: number) => (x: number) => (x >= 0 ? h : 0);
const lit = (f: (x: number, z: number) => number | null, x: number, sun = EAST, s = S) => sunVisibility(f, x, 0, sun, s)!;

describe("the sun past the terrain", () => {
  it("reaches open flat ground, and a slope facing it or away from it, in full", () => {
    expect(lit(() => 0, 5)).toBe(1);
    expect(lit((x) => 0.2 * x, 5)).toBe(1); // a gentle slope: the ray climbs faster than the ground
    expect(lit((x) => -0.2 * x, 5)).toBe(1);
  });

  it("is blocked in the shadow of a cliff, and clear beyond the length of the shadow", () => {
    const f = cliff(5);
    expect(lit(f, -1, EAST, DENSE)).toBe(0);
    expect(lit(f, -4, EAST, DENSE)).toBe(0);
    expect(lit(f, -7, EAST, DENSE)).toBe(1); // past the 5 m shadow, with the sun at 45 degrees
    expect(lit(f, 5, EAST, DENSE)).toBe(1); // on the plateau, the sun's side
  });

  it("puts the edge of a shadow where the ray just grazes the top, and half lights it there", () => {
    const f = cliff(5);
    // a ray from 0.15 m up at x reaches the cliff's top edge at x = 0 at a height of 0.15 + (0 - x): level with the top at x = -4.85
    expect(lit(f, -4.85, EAST, DENSE)).toBeCloseTo(0.5, 1);
    expect(lit(f, -5.5, EAST, DENSE)).toBe(1);
    expect(lit(f, -4.2, EAST, DENSE)).toBe(0);
  });

  it("has an edge softer the farther away what casts it is", () => {
    // across the edge from a tenth lit to nine tenths: a low cliff, near, and a high one, far
    const edge = (h: number) => {
      const f = cliff(h);
      let light = NaN, dark = NaN;
      for (let x = -(h + 3); x < -0.5; x += 0.005) { // from the lit side, west, into the shadow (not out onto the plateau)
        const v = lit(f, x, EAST, DENSE);
        if (v > 0.9) light = x;
        else if (Number.isNaN(dark) && v < 0.1) dark = x;
      }
      return dark - light;
    };
    expect(edge(30)).toBeGreaterThan(edge(3) * 1.5);
    expect(edge(30)).toBeCloseTo(0.8 * (0.3 + 29.85 * Math.SQRT2 * SUN_WIDTH), 1); // 0.8 of the penumbra: 0.3 m plus the sun's width at that distance
  });

  it("falls steadily from dark behind a smooth ridge to lit far from it, with the real march", () => {
    const ridge = (x: number) => 12 * Math.exp(-(x * x) / (2 * 5 * 5));
    let last = -1;
    for (let x = -4; x >= -30; x -= 1) { // moving away from the ridge, more of the sun gets through
      const v = lit(ridge, x);
      expect(v).toBeGreaterThanOrEqual(last - 0.02);
      last = v;
    }
    expect(lit(ridge, -4)).toBeLessThan(0.1);
    expect(lit(ridge, -30)).toBe(1);
    expect(lit(ridge, 12)).toBe(1); // the sun's side
  });

  it("reaches nothing when the sun is at or below the horizon, and nothing is said where there is no ground", () => {
    expect(lit(() => 0, 5, norm([1, 0, 0]))).toBe(0);
    expect(lit(() => 0, 5, norm([1, -1, 0]))).toBe(0);
    expect(sunVisibility(() => null, 0, 0, EAST, S)).toBeNull();
    expect(lit((x) => (x > 2 ? null : 0), 0)).toBe(1); // missing data is open sky
  });

  it("is the same whichever way the sun and the ground are turned", () => {
    const f = (_x: number, z: number) => (z >= 0 ? 5 : 0);
    const south = norm([0, 1, 1]); // the sun to the south now, and the cliff across z
    expect(sunVisibility(f, 0, -2, south, DENSE)!).toBeCloseTo(lit(cliff(5), -2, EAST, DENSE), 6);
  });
});
