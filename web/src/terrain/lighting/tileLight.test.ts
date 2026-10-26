import { describe, expect, it } from "vitest";
import { project, type Vec3 } from "../../gfx/math/mat4";
import { tileLight } from "./tileLight";

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const rect = { x0: 100, z0: 200, x1: 356, z1: 456 }; // a 256 m tile
const MORNING = norm([0.8, 0.5, -0.2]);
const fit = (sun: Vec3 = MORNING, casterTop = 25) => tileLight(rect, 40, 70, casterTop, sun, 150)!;

describe("a tile's view of the sun", () => {
  it("takes in every point of ground in the tile, in the map and at depths it spans", () => {
    const { viewProj } = fit();
    for (const [x, z] of [[100, 200], [356, 456], [228, 328], [100, 456], [356, 200]]) {
      for (const y of [40, 55, 70]) {
        const [cx, cy, cz] = project(viewProj, [x, y, z]);
        expect(Math.abs(cx)).toBeLessThanOrEqual(1.0001);
        expect(Math.abs(cy)).toBeLessThanOrEqual(1.0001);
        expect(cz).toBeGreaterThan(-1);
        expect(cz).toBeLessThan(1);
      }
    }
  });

  it("puts a caster toward the sun at the same place in the map as what it shades, and nearer the camera", () => {
    const { viewProj } = fit();
    const ground: Vec3 = [250, 50, 300];
    for (const t of [3, 20, 60]) {
      const caster: Vec3 = [ground[0] + MORNING[0] * t, ground[1] + MORNING[1] * t, ground[2] + MORNING[2] * t];
      const a = project(viewProj, ground), b = project(viewProj, caster);
      expect(b[0]).toBeCloseTo(a[0], 6);
      expect(b[1]).toBeCloseTo(a[1], 6);
      expect(b[2]).toBeLessThan(a[2]); // nearer: it would be in front of the ground in the map
    }
  });

  it("reaches back toward the sun far enough to hold a tall tree that shades the tile's far edge", () => {
    const { viewProj } = fit(MORNING, 25);
    // a 25 m tree standing outside the tile on the sun's side, as far as it can still shade the tile's edge
    const horizontal = Math.hypot(MORNING[0], MORNING[2]);
    const reach = 25 / (MORNING[1] / horizontal);
    const foot: Vec3 = [rect.x1 + (MORNING[0] / horizontal) * reach * 0.95, 40, 330];
    const top = project(viewProj, [foot[0], foot[1] + 25, foot[2]]);
    expect(top[2]).toBeGreaterThan(-1); // not cut off by the near plane
    expect(top[2]).toBeLessThan(1);
  });

  it("makes a map whose depth range is metres and covers the volume it was fitted to", () => {
    const { range } = fit();
    expect(range).toBeGreaterThan(25); // at least the tallest tree
    expect(range).toBeLessThan(600); // and not absurdly more than the tile and the heights
  });

  it("copes with the sun straight overhead", () => {
    const { viewProj } = fit(norm([0, 1, 0.0001]));
    const [x, y] = project(viewProj, [228, 50, 328]);
    expect(Math.abs(x)).toBeLessThan(1);
    expect(Math.abs(y)).toBeLessThan(1);
  });

  it("gives nothing when the sun is too low to light the ground", () => {
    expect(tileLight(rect, 40, 70, 25, norm([1, 0.01, 0]), 150)).toBeNull();
    expect(tileLight(rect, 40, 70, 25, norm([1, -0.5, 0]), 150)).toBeNull();
  });
});
