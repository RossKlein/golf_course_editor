import { describe, expect, it } from "vitest";
import { lookAt, multiply, perspective, project, type Vec3 } from "../../../gfx/math/mat4";
import { fitCascades, sliceCorners, splitDistances } from "./cascades";

const SIZE = 2048;
const REACH = 150;
// the 11 am midsummer sun: high and nearly due east
const SUN: Vec3 = [0.83, 0.54, -0.1];
const camera = (eye: Vec3, target: Vec3, far = 5000) => multiply(perspective(0.8, 1.6, 2, far), lookAt(eye, target));
const fit = (eye: Vec3, target: Vec3, over: Partial<{ distance: number; count: number }> = {}) =>
  fitCascades({ viewProj: camera(eye, target), eye, sunDir: SUN, distance: 300, count: 3, size: SIZE, reach: REACH, ...over });

describe("shadow slices", () => {
  it("are thin near the camera and end at the shadow distance", () => {
    const s = splitDistances(2, 300, 3);
    expect(s).toHaveLength(3);
    expect(s[2]).toBe(300);
    expect(s[0]).toBeGreaterThan(2);
    expect(s[1]).toBeGreaterThan(s[0]);
    expect(s[0] - 2).toBeLessThan(s[1] - s[0]);
    expect(s[1] - s[0]).toBeLessThan(s[2] - s[1]);
  });

  it("are one slice to the distance when there is one", () => {
    expect(splitDistances(1, 80, 1)).toEqual([80]);
  });
});

describe("shadow maps", () => {
  const eye: Vec3 = [20, 6, 40], target: Vec3 = [120, 0, -30];

  it("make one map for each slice, each reaching further than the one before", () => {
    const f = fit(eye, target)!;
    expect(f.cascades).toHaveLength(3);
    expect(f.cascades[1].far).toBeGreaterThan(f.cascades[0].far);
    expect(f.cascades[2].far).toBeCloseTo(300, 3);
    expect(f.cascades[2].texel).toBeGreaterThan(f.cascades[0].texel);
  });

  it("hold every point of their own slice", () => {
    const f = fit(eye, target)!;
    let start = 2;
    f.cascades.forEach((c) => {
      const pts = sliceCorners(camera(eye, target), eye, start, c.far)!;
      for (const p of pts) {
        const [x, y, z] = project(c.viewProj, p);
        expect(Math.abs(x)).toBeLessThanOrEqual(1.001);
        expect(Math.abs(y)).toBeLessThanOrEqual(1.001);
        expect(z).toBeGreaterThanOrEqual(-1);
        expect(z).toBeLessThanOrEqual(1);
      }
      start = c.far;
    });
  });

  it("let something between the sun and the slice cast onto it, up to the reach", () => {
    const f = fit(eye, target)!;
    const c = f.cascades[0];
    const slice = sliceCorners(camera(eye, target), eye, 2, c.far)!;
    const mid: Vec3 = slice.reduce((a, p) => [a[0] + p[0] / 8, a[1] + p[1] / 8, a[2] + p[2] / 8], [0, 0, 0] as Vec3);
    const caster: Vec3 = [mid[0] + SUN[0] * 100, mid[1] + SUN[1] * 100, mid[2] + SUN[2] * 100]; // 100 m towards the sun
    const [x, y, z] = project(c.viewProj, caster);
    expect(Math.abs(x)).toBeLessThan(1);
    expect(Math.abs(y)).toBeLessThan(1);
    expect(z).toBeGreaterThan(-1);
    expect(z).toBeLessThan(1);
  });

  it("move in whole texels as the camera moves, so shadow edges hold still", () => {
    const a = fit(eye, target)!, b = fit([eye[0] + 3.37, eye[1], eye[2] - 1.91], [target[0] + 3.37, target[1], target[2] - 1.91])!;
    const point: Vec3 = [60, 0, 5];
    a.cascades.forEach((ca, i) => {
      const cb = b.cascades[i];
      if (Math.abs(ca.texel - cb.texel) > 1e-9) return; // the size of a slice is steady for a steady view
      const pa = project(ca.viewProj, point), pb = project(cb.viewProj, point);
      const steps = ((pb[0] - pa[0]) * SIZE) / 2;
      const stepsY = ((pb[1] - pa[1]) * SIZE) / 2;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(0.02);
      expect(Math.abs(stepsY - Math.round(stepsY))).toBeLessThan(0.02);
    });
    expect(a.cascades[0].texel).toBeCloseTo(b.cascades[0].texel, 9);
  });

  it("put a point in the shadow of a caster at the same map position, but further from the sun (the lookup the shaders make)", () => {
    const f = fit(eye, target)!;
    const c = f.cascades[0];
    const slice = sliceCorners(camera(eye, target), eye, 2, c.far)!;
    const mid = slice.reduce((a, p) => [a[0] + p[0] / 8, a[1] + p[1] / 8, a[2] + p[2] / 8], [0, 0, 0] as Vec3);
    const L = Math.hypot(...SUN);
    const along = (p: Vec3, t: number): Vec3 => [p[0] + (SUN[0] / L) * t, p[1] + (SUN[1] / L) * t, p[2] + (SUN[2] / L) * t];
    const uvz = (p: Vec3) => {
      const [x, y, z] = project(c.texMat, p);
      return { u: x, v: y, z };
    };
    const caster = along(mid, 12), receiver = mid; // the receiver is 12 m down the sun's ray from the caster
    const a = uvz(caster), b = uvz(receiver);
    expect(b.u).toBeCloseTo(a.u, 6); // the same texel of the map
    expect(b.v).toBeCloseTo(a.v, 6);
    expect(b.z).toBeGreaterThan(a.z); // and further from the sun, so the caster's depth is nearer: the receiver is shadowed
    expect((b.z - a.z) * c.range).toBeCloseTo(12, 2); // by exactly the 12 metres between them
    for (const t of [a, b]) {
      expect(t.u).toBeGreaterThan(0);
      expect(t.u).toBeLessThan(1);
      expect(t.v).toBeGreaterThan(0);
      expect(t.v).toBeLessThan(1);
      expect(t.z).toBeGreaterThan(0);
      expect(t.z).toBeLessThan(1);
    }
    // a point to the side is in a different texel, so it is not in that shadow
    const side = uvz([mid[0], mid[1], mid[2] + 20]);
    expect(Math.hypot(side.u - b.u, side.v - b.v)).toBeGreaterThan(0.001);
  });

  it("tell which way the camera looks", () => {
    const f = fit([0, 10, 0], [100, 0, 0])!;
    expect(f.forward[0]).toBeGreaterThan(0.9);
  });

  it("are none when nothing is within range", () => {
    expect(fit(eye, target, { distance: 0.5 })).toBeNull();
    expect(fit(eye, target, { count: 0 })).toBeNull();
  });
});
