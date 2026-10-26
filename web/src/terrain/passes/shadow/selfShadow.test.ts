import { describe, expect, it } from "vitest";
import type { Vec3 } from "../../../gfx/math/mat4";
import { SELF_SHADOW_REACH } from "../../limits";
import { selfShadow } from "./selfShadow";

// a plateau 10 m high from x = 0 eastwards, flat ground to the west of it; the sun is due east, 45 degrees up
const plateau = (x: number) => (x >= 0 ? 10 : 0);
const sun: Vec3 = [Math.SQRT1_2, Math.SQRT1_2, 0];
const at = (x: number, z = 0, s = sun, scale = 1) => selfShadow((px) => plateau(px), x, z, scale, s);

// a smooth hill 10 m high and about 6 m across at x = 0, and a low sun in the east
const hill = (x: number) => 10 * Math.exp(-((x / 6) ** 2));
const lowSun: Vec3 = [0.866, 0.5, 0];
const onHill = (x: number, scale = 1, s = lowSun) => selfShadow(hill, x, 0, scale, s);

describe("the ground shading itself", () => {
  it("is in shadow at the foot of a rise towards the sun", () => {
    expect(at(-5)).toBeGreaterThan(0.9);
    expect(at(-1)).toBeGreaterThan(0.9);
  });

  it("is lit on top of the rise, and on flat ground with nothing in the way", () => {
    expect(at(5)).toBe(0);
    expect(selfShadow(() => 3, 0, 0, 1, sun)).toBe(0);
  });

  it("is lit where the rise is further than the shadow can reach", () => {
    expect(at(-SELF_SHADOW_REACH - 20)).toBe(0);
  });

  it("falls away behind a hill: dark close to it, fading out, light beyond the end of the shadow", () => {
    expect(onHill(-12)).toBeGreaterThan(0.5);
    expect(onHill(-30)).toBe(0);
    const xs = [-12, -16, -20, -24, -28, -32];
    const values = xs.map((x) => onHill(x));
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThanOrEqual(values[i - 1] + 1e-9);
  });

  it("is lit on the side of the hill that faces the sun, and well east of it", () => {
    expect(onHill(4)).toBe(0);
    expect(onHill(20)).toBe(0);
  });

  it("is lit by a high sun where a low sun is blocked", () => {
    const high: Vec3 = [0.1, 0.995, 0];
    expect(onHill(-12, 1, high)).toBe(0);
    expect(onHill(-12)).toBeGreaterThan(0.5);
  });

  it("is all in shadow when the sun is down", () => {
    expect(at(5, 0, [1, 0, 0])).toBe(1);
  });

  it("follows the vertical exaggeration the ground is drawn with", () => {
    // 3x the height casts a much longer shadow
    expect(onHill(-30)).toBe(0);
    expect(onHill(-30, 3)).toBeGreaterThan(0.5);
  });

  it("does not depend on z when the ground does not", () => {
    expect(at(-5, 100)).toBeCloseTo(at(-5, -40), 9);
  });
});
