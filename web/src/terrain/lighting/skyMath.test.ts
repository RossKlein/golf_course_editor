import { describe, expect, it } from "vitest";
import { skyVisibility, type SkySettings } from "./skyMath";

const S: SkySettings = { dirs: 16, steps: 12, reach: 48 };
const vis = (f: (x: number, z: number) => number | null, x: number, z: number, s = S) => skyVisibility(f, x, z, s)!;

describe("sky visibility", () => {
  it("is 1 on open flat ground, and on a plane however it slopes", () => {
    expect(vis(() => 5, 0, 0)).toBe(1);
    expect(vis((x) => 0.3 * x, 0, 0)).toBeLessThan(1); // a slope has ground rising on one side
    expect(vis((x) => 0.3 * x, 0, 0)).toBeGreaterThan(0.8); // but a gentle one hides little sky
    expect(vis((x) => -0.3 * x, 10, 3)).toBeCloseTo(vis((x) => 0.3 * x, 10, 3), 6); // the same either way round
  });

  it("is less at the bottom of a hollow, and less the deeper it is", () => {
    const bowl = (depth: number) => (x: number, z: number) => depth * Math.exp(-(x * x + z * z) / (2 * 8 * 8)) * -1;
    const shallow = vis(bowl(1), 0, 0), deep = vis(bowl(6), 0, 0);
    expect(shallow).toBeLessThan(1);
    expect(deep).toBeLessThan(shallow);
    expect(deep).toBeGreaterThan(0);
  });

  it("is 1 on the top of a hill, and less beside it than far from it", () => {
    const hill = (x: number, z: number) => 12 * Math.exp(-(x * x + z * z) / (2 * 10 * 10));
    expect(vis(hill, 0, 0)).toBe(1);
    expect(vis(hill, 18, 0)).toBeLessThan(1);
    expect(vis(hill, 80, 0)).toBeCloseTo(1, 3);
  });

  it("is darker against a wall than away from it", () => {
    const wall = (x: number) => (x > 5 ? 8 : 0); // a step up to the east
    const near = vis(wall, 4, 0), far = vis(wall, -30, 0);
    expect(near).toBeLessThan(far);
    expect(near).toBeGreaterThan(0.5); // a wall 1 m away and 8 m high hides much of one side, but not all of it
  });

  it("looks the same in every direction", () => {
    const wall = (x: number, z: number) => (x > 5 ? 8 : 0) + (z > 5 ? 8 : 0);
    expect(vis((x, z) => wall(z, x), 4, 4)).toBeCloseTo(vis(wall, 4, 4), 6);
  });

  it("stays between 0 and 1, and counts missing data as open", () => {
    const spike = (x: number, z: number) => (Math.hypot(x, z) > 1 ? 1000 : 0);
    const v = vis(spike, 0, 0);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(0.01);
    expect(vis((x) => (x > 3 ? null : 0), 0, 0)).toBe(1);
    expect(skyVisibility(() => null, 0, 0, S)).toBeNull();
  });
});
