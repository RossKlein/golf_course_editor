import { describe, expect, it } from "vitest";
import { hasVoid, markVoid, VOID } from "./voidGround";

/** A class map of `w` x `h` cells (0.5 m each) with the cells in `cells` made void. */
function classes(w: number, h: number, voids: [number, number][]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (const [x, z] of voids) data[(z * w + x) * 4] = VOID;
  return { data, width: w, height: h };
}
const block = (x0: number, z0: number, x1: number, z1: number) => {
  const out: [number, number][] = [];
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) out.push([x, z]);
  return out;
};
const grid = (cols: number, rows: number) => ({ cols, rows, valid: new Uint8Array(cols * rows).fill(1) });
const at = (g: ReturnType<typeof grid>, c: number, r: number) => g.valid[r * g.cols + c];

describe("markVoid", () => {
  it("leaves a map without void alone", () => {
    const g = grid(10, 10);
    expect(hasVoid(classes(18, 18, []))).toBe(false);
    expect(markVoid(classes(18, 18, []), 0.5, 1, g)).toBe(false);
    expect(g.valid.every((v) => v === 1)).toBe(true);
  });

  it("takes out the samples whose four class cells are all void", () => {
    // void over metres 3..6 east and 3..6 south: class cells 6..11
    const g = grid(10, 10);
    expect(markVoid(classes(18, 18, block(6, 6, 12, 12)), 0.5, 1, g)).toBe(true);
    expect(at(g, 4, 4)).toBe(0);
    expect(at(g, 5, 5)).toBe(0);
    expect(at(g, 3, 4)).toBe(1); // on the void's own edge: two of its four cells are ground
    expect(at(g, 6, 5)).toBe(1);
    expect(at(g, 1, 1)).toBe(1);
    expect(g.valid.reduce((n, v) => n + (v ? 0 : 1), 0)).toBe(4);
  });

  it("does not hollow a strip thinner than a metre", () => {
    const g = grid(10, 10);
    markVoid(classes(18, 18, block(8, 0, 9, 18)), 0.5, 1, g); // one class cell wide
    expect(g.valid.every((v) => v === 1)).toBe(true);
  });

  it("puts the ground back when the void goes", () => {
    const g = grid(10, 10);
    markVoid(classes(18, 18, block(0, 0, 18, 18)), 0.5, 1, g);
    expect(g.valid.every((v) => v === 0) || at(g, 5, 5) === 0).toBe(true);
    expect(markVoid(classes(18, 18, []), 0.5, 1, g)).toBe(true);
    expect(g.valid.every((v) => v === 1)).toBe(true);
  });

  it("copes with the edges of the map", () => {
    const g = grid(10, 10);
    markVoid(classes(18, 18, block(0, 0, 4, 4)), 0.5, 1, g); // the corner
    expect(at(g, 0, 0)).toBe(0); // its missing outer cells count as the nearest ones
    expect(at(g, 1, 1)).toBe(0);
    expect(at(g, 3, 3)).toBe(1);
  });
});
