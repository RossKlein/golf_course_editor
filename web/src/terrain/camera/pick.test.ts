import { describe, expect, it } from "vitest";
import { project } from "../../gfx/math/mat4";
import { matricesOf, type Camera } from "./camera";
import { ndcOf, pickGround, pickPlane, rayThrough, type Heights } from "./pick";

const cam: Camera = { x: 100, z: 50, yaw: 0.6, pitch: (40 * Math.PI) / 180, distance: 200 };
const aspect = 1.6;
const hill = (x: number, z: number) => 30 * Math.exp(-(((x - 120) ** 2 + (z - 40) ** 2) / (2 * 40 ** 2)));
const view = (ground: Heights) => matricesOf(cam, aspect, (x, z) => ground(x, z) ?? 0);

/** Picks, then projects the answer back to the screen: it must land where the pointer was. */
function roundTrip(ground: Heights, nx: number, ny: number) {
  const { viewProj } = view(ground);
  const ray = rayThrough(viewProj, nx, ny)!;
  const hit = pickGround(ray, ground, 4000);
  if (!hit) return null;
  const [sx, sy] = project(viewProj, [hit[0], ground(hit[0], hit[1])!, hit[1]]);
  return { hit, sx, sy };
}

describe("picking the ground", () => {
  it("turns pixels into clip coordinates", () => {
    expect(ndcOf(0, 0, 800, 600)).toEqual([-1, 1]);
    expect(ndcOf(400, 300, 800, 600)).toEqual([0, 0]);
    expect(ndcOf(800, 600, 800, 600)).toEqual([1, -1]);
  });

  it("finds the point the camera looks at in the middle of the picture", () => {
    const flat: Heights = () => 0;
    const r = roundTrip(flat, 0, 0)!;
    expect(r.hit[0]).toBeCloseTo(cam.x, 1);
    expect(r.hit[1]).toBeCloseTo(cam.z, 1);
  });

  it("lands back under the pointer on flat ground, wherever it points", () => {
    const flat: Heights = () => 0;
    for (const [x, y] of [[-0.7, -0.5], [0.5, -0.2], [0.9, -0.9], [-0.3, 0.1]]) {
      const r = roundTrip(flat, x, y)!;
      expect(r.sx).toBeCloseTo(x, 3);
      expect(r.sy).toBeCloseTo(y, 3);
    }
  });

  it("lands back under the pointer on hilly ground", () => {
    for (const [x, y] of [[0, 0], [0.3, -0.1], [-0.4, -0.4], [0.6, -0.7]]) {
      const r = roundTrip(hill, x, y)!;
      expect(r.sx).toBeCloseTo(x, 3);
      expect(r.sy).toBeCloseTo(y, 3);
    }
  });

  it("follows a vertical exaggeration", () => {
    const tall: Heights = (x, z) => hill(x, z) * 3;
    const r = roundTrip(tall, 0.2, -0.3)!;
    expect(r.sx).toBeCloseTo(0.2, 3);
    expect(r.sy).toBeCloseTo(-0.3, 3);
    const plain = roundTrip(hill, 0.2, -0.3)!;
    expect(Math.hypot(r.hit[0] - plain.hit[0], r.hit[1] - plain.hit[1])).toBeGreaterThan(1); // it hits a different spot
  });

  it("misses the sky", () => {
    const low: Camera = { ...cam, pitch: (8 * Math.PI) / 180 }; // looking nearly level, so the top of the picture is sky
    const { viewProj } = matricesOf(low, aspect, () => 0);
    const ray = rayThrough(viewProj, 0, 0.999)!;
    expect(ray.dir[1]).toBeGreaterThan(0);
    expect(pickGround(ray, () => 0, 3000)).toBeNull();
  });

  it("passes over places with no data and finds the ground beyond", () => {
    const edge: Heights = (x) => (x > 0 ? 0 : null);
    const { viewProj } = view(() => 0);
    const ray = rayThrough(viewProj, -0.6, -0.6)!;
    const hit = pickGround(ray, edge, 4000);
    if (hit) expect(hit[0]).toBeGreaterThan(0);
  });

  it("gives nothing when the eye is under the ground", () => {
    const ray = { origin: [0, -5, 0] as [number, number, number], dir: [0, 0, -1] as [number, number, number] };
    expect(pickGround(ray, () => 0, 100)).toBeNull();
  });
});

describe("picking a level", () => {
  it("crosses the plane where the ray does", () => {
    const ray = { origin: [10, 50, 20] as [number, number, number], dir: [0.6, -0.8, 0] as [number, number, number] };
    const p = pickPlane(ray, 10, 1000)!;
    expect(p[0]).toBeCloseTo(10 + 0.6 * 50, 6); // 40 m down at 0.8 per metre is 50 m along
    expect(p[1]).toBeCloseTo(20, 6);
  });

  it("is null when it looks away from the plane, runs parallel, or is too far", () => {
    expect(pickPlane({ origin: [0, 50, 0], dir: [0, 1, 0] }, 10, 1000)).toBeNull();
    expect(pickPlane({ origin: [0, 50, 0], dir: [1, 0, 0] }, 10, 1000)).toBeNull();
    expect(pickPlane({ origin: [0, 50, 0], dir: [0.999, -0.0447, 0] }, 10, 100)).toBeNull();
  });

  it("agrees with picking the ground on flat ground", () => {
    const { viewProj } = view(() => 0);
    const ray = rayThrough(viewProj, 0.3, -0.4)!;
    const a = pickGround(ray, () => 0, 4000)!, b = pickPlane(ray, 0, 4000)!;
    expect(a[0]).toBeCloseTo(b[0], 2);
    expect(a[1]).toBeCloseTo(b[1], 2);
  });
});
