import { describe, expect, it } from "vitest";
import { frustumOf } from "../../../gfx/math/frustum";
import { lookAt, multiply, perspective } from "../../../gfx/math/mat4";
import { TUFT_TILE } from "../../limits";
import { BLADE_LOD, bladesAt, TUFT_RANGE, tuftGrid, tuftTiles } from "./tufts";

describe("grass tuft tiles", () => {
  // a camera 20 m up looking north along z at a target 30 m ahead
  const target: [number, number] = [0, -30];
  const view = lookAt([0, 20, 0], [0, 0, -30]);
  const f = frustumOf(multiply(perspective((45 * Math.PI) / 180, 1.6, 1, 5000), view));

  it("draws far fewer tiles than the patch holds, and none behind the camera", () => {
    const all = Math.ceil(tuftGrid(90, 1).across / TUFT_TILE) ** 2;
    const tiles = tuftTiles(target, 90, 1, f, 0, 5);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThan(all * 0.6);
    const { cell, across } = tuftGrid(90, 1);
    const cornerZ = Math.round(target[1] / cell) - across / 2;
    for (const [, ty] of tiles) expect((cornerZ + ty + TUFT_TILE + 1) * cell).toBeLessThan(25); // nothing wholly behind the eye
  });

  it("skips tiles outside the circle of the range", () => {
    const wide = frustumOf(multiply(perspective(Math.PI * 0.9, 1, 0.1, 5000), lookAt([0, 500, 0], [0, 0, -1]))); // sees it all from above
    const { across } = tuftGrid(60, 1);
    const all = Math.ceil(across / TUFT_TILE) ** 2;
    const tiles = tuftTiles([0, 0], 60, 1, wide, 0, 5);
    expect(tiles.length).toBeLessThan(all);
    expect(tiles.length).toBeGreaterThan(all * 0.6);
  });

  it("draws nothing when the patch is out of sight", () => {
    expect(tuftTiles([5000, 5000], 90, 1, f, 0, 5)).toEqual([]);
  });
});

describe("grass tuft grid", () => {
  it("the default is a clump every metre across twice the default range", () => {
    expect(TUFT_RANGE).toBe(200);
    expect(tuftGrid(TUFT_RANGE, 1)).toEqual({ cell: 1, across: 400 });
  });

  it("twice the density is twice the tufts to the square metre", () => {
    const one = tuftGrid(45, 1), two = tuftGrid(45, 2);
    expect((two.across * two.across) / (one.across * one.across)).toBeCloseTo(2, 1);
  });

  it("a longer range covers more ground at the same spacing", () => {
    expect(tuftGrid(90, 1).cell).toBe(1);
    expect(tuftGrid(90, 1).across).toBe(180);
  });

  it("is capped, so the sliders cannot ask for an unbounded number of tufts", () => {
    const g = tuftGrid(300, 1000);
    expect(g.across).toBeLessThanOrEqual(6145);
    expect(g.cell).toBeGreaterThan(0.09);
    expect(g.cell).toBeCloseTo((2 * 300) / 6144, 3); // held to the cap, not the density's own spacing
  });

  it("the slider limits, 300 m at twenty times the density, are honoured and not capped", () => {
    const g = tuftGrid(300, 20);
    expect(g.cell).toBeCloseTo(1 / Math.sqrt(20), 3);
    expect(g.across).toBeLessThan(6144);
  });
});

describe("grass tuft tiles and the eye", () => {
  const target: [number, number] = [0, -30];
  const eye: [number, number, number] = [0, 20, 0];
  const f = frustumOf(multiply(perspective((45 * Math.PI) / 180, 1.6, 1, 5000), lookAt(eye, [0, 0, -30])));

  it("says how far each tile is from the eye, nearest first for the tiles ahead", () => {
    const tiles = tuftTiles(target, 90, 1, f, 0, 5, eye);
    expect(tiles.length).toBeGreaterThan(0);
    for (const [, , away] of tiles) expect(away).toBeGreaterThanOrEqual(eye[1] - 5 - 1e-9); // never nearer than the height of the eye above the ground
    const { cell, across } = tuftGrid(90, 1);
    const cornerZ = Math.round(target[1] / cell) - across / 2;
    const nearest = tiles.reduce((a, b) => (b[2] < a[2] ? b : a));
    const farthest = tiles.reduce((a, b) => (b[2] > a[2] ? b : a));
    expect(cornerZ + nearest[1]).toBeGreaterThan(cornerZ + farthest[1]); // the nearest tile is further along z, towards the eye
  });

  it("is zero away from a tile whose box holds the eye", () => {
    const high = tuftTiles([0, 0], 60, 1, frustumOf(multiply(perspective(Math.PI * 0.9, 1, 0.1, 5000), lookAt([0.2, 3, 0.2], [0, 0, -1]))), 0, 5, [0.2, 3, 0.2]);
    expect(Math.min(...high.map((t) => t[2]))).toBe(0);
  });
});

describe("blades by distance", () => {
  it("has all of them near, half further out and a quarter beyond", () => {
    expect(bladesAt(0, 12)).toBe(12);
    expect(bladesAt(BLADE_LOD[0] - 0.01, 12)).toBe(12);
    expect(bladesAt(BLADE_LOD[0], 12)).toBe(6);
    expect(bladesAt(BLADE_LOD[1], 12)).toBe(3);
    expect(bladesAt(500, 12)).toBe(3);
  });

  it("never draws fewer than three blades, or more than the clump has", () => {
    expect(bladesAt(500, 4)).toBe(3);
    expect(bladesAt(0, 3)).toBe(3);
    for (const d of [0, 30, 100]) for (const full of [3, 5, 16]) expect(bladesAt(d, full)).toBeLessThanOrEqual(full);
  });

  it("only ever has fewer further out", () => {
    for (const full of [3, 7, 12, 16]) {
      let last = full;
      for (let d = 0; d < 300; d += 5) {
        const n = bladesAt(d, full);
        expect(n).toBeLessThanOrEqual(last);
        last = n;
      }
    }
  });
});
