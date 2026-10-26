import { describe, expect, it } from "vitest";
import { frustumOf } from "../../../gfx/math/frustum";
import { lookAt, multiply, perspective } from "../../../gfx/math/mat4";
import { TUFT_TILE } from "../../limits";
import { TUFT_RANGE, tuftGrid, tuftTiles } from "./tufts";

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
  it("the default is a tuft every half metre across twice the default range", () => {
    expect(TUFT_RANGE).toBe(200);
    expect(tuftGrid(TUFT_RANGE, 1)).toEqual({ cell: 0.5, across: 800 });
  });

  it("twice the density is twice the tufts to the square metre", () => {
    const one = tuftGrid(45, 1), two = tuftGrid(45, 2);
    expect((two.across * two.across) / (one.across * one.across)).toBeCloseTo(2, 1);
  });

  it("a longer range covers more ground at the same spacing", () => {
    expect(tuftGrid(90, 1).cell).toBe(0.5);
    expect(tuftGrid(90, 1).across).toBe(360);
  });

  it("is capped, so the sliders cannot ask for an unbounded number of tufts", () => {
    const g = tuftGrid(300, 20);
    expect(g.across).toBeLessThanOrEqual(3073);
    expect(g.cell).toBeGreaterThan(0.19);
  });

  it("the slider limits, 300 m at five times the density, are honoured and not capped", () => {
    const g = tuftGrid(300, 5);
    expect(g.cell).toBeCloseTo(0.5 / Math.sqrt(5), 3);
    expect(g.across).toBeLessThan(3072);
  });
});
