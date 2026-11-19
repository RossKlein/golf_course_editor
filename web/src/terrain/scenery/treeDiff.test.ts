import { describe, expect, it } from "vitest";
import { diffTrees } from "./treeDiff";

/** Trees as the renderer holds them: x, z, height, kind, grouped by kind. */
const group = (...trees: [number, number, number][]) => Float32Array.from(trees.flatMap(([x, z, h]) => [x, z, h, 0]));

describe("what changed between two sets of trees", () => {
  const a = group([10, 20, 15], [30, 40, 12], [50, 60, 18]);

  it("is nothing when they are the same, in any order", () => {
    expect(diffTrees([a], [a]).box).toBeNull();
    expect(diffTrees([a], [group([50, 60, 18], [10, 20, 15], [30, 40, 12])])).toEqual({ changed: 0, total: 3, box: null, tallest: 0 });
    expect(diffTrees([], [])).toEqual({ changed: 0, total: 0, box: null, tallest: 0 });
  });

  it("is where a tree was added", () => {
    const c = diffTrees([a], [group([10, 20, 15], [30, 40, 12], [50, 60, 18], [70, 80, 22])]);
    expect(c).toEqual({ changed: 1, total: 4, box: { x0: 70, z0: 80, x1: 70, z1: 80 }, tallest: 22 });
  });

  it("is where a tree was removed", () => {
    const c = diffTrees([a], [group([10, 20, 15], [50, 60, 18])]);
    expect(c).toEqual({ changed: 1, total: 3, box: { x0: 30, z0: 40, x1: 30, z1: 40 }, tallest: 12 });
  });

  it("is both ends of a tree that moved or grew, and the box covers them", () => {
    const c = diffTrees([a], [group([10, 20, 15], [31, 41, 12], [50, 60, 18])]);
    expect(c.changed).toBe(2);
    expect(c.box).toEqual({ x0: 30, z0: 40, x1: 31, z1: 41 });
    const grown = diffTrees([a], [group([10, 20, 15], [30, 40, 25], [50, 60, 18])]);
    expect(grown.changed).toBe(2);
    expect(grown.tallest).toBe(25);
  });

  it("is a different kind at the same place", () => {
    const pine = [Float32Array.from([5, 5, 10, 0])];
    const fir = [new Float32Array(0), Float32Array.from([5, 5, 10, 1])];
    expect(diffTrees(pine, fir).changed).toBe(2);
  });

  it("is everything when there were none, as when a course is first loaded", () => {
    const c = diffTrees([], [a]);
    expect(c.changed).toBe(3);
    expect(c.total).toBe(3);
    expect(c.box).toEqual({ x0: 10, z0: 20, x1: 50, z1: 60 });
  });

  it("counts two trees in one place as two", () => {
    const two = group([1, 1, 10], [1, 1, 10]);
    expect(diffTrees([two], [group([1, 1, 10])]).changed).toBe(1);
  });

  it("is quick for a forest the size of the course's", () => {
    const n = 40_000;
    const big = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) big.set([(i * 7.3) % 1500, (i * 13.1) % 1900, 10 + (i % 15), 0], i * 4);
    const moved = big.slice();
    moved[0] += 1;
    const t = performance.now();
    const c = diffTrees([big], [moved]);
    const took = performance.now() - t;
    expect(c.changed).toBe(2);
    expect(took).toBeLessThan(500);
  });
});
