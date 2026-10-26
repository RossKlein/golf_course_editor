import { describe, expect, it } from "vitest";
import { crownOfMesh } from "./crown";

/** A ring of `n` vertices at height y and radius r, as x, y, z. */
const ring = (y: number, r: number, n = 8) => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * 2 * Math.PI) * r, y, Math.sin((i / n) * 2 * Math.PI) * r]).flat();

describe("a tree's crown, from its mesh", () => {
  it("starts where the foliage does, not at the trunk, and reaches the top", () => {
    // a thin trunk from the ground to 0.3, then two rings of foliage and a tip
    const mesh = [...ring(0, 0.02), ...ring(0.3, 0.02), ...ring(0.3, 0.2), ...ring(0.9, 0.1), 0, 1, 0];
    const crown = crownOfMesh(mesh);
    expect(crown.bottom).toBeCloseTo(0.3, 9);
    expect(crown.top).toBe(1);
    expect(crown.radius).toBeCloseTo(0.15, 9); // the foliage rings average 0.2 and 0.1 out
  });

  it("is a plain ball from its widest ring", () => {
    const crown = crownOfMesh([...ring(0.3, 0.25), ...ring(0.5, 0.3), ...ring(0.7, 0.25)]);
    expect(crown.bottom).toBeCloseTo(0.3, 9);
    expect(crown.top).toBeCloseTo(0.7, 9);
    expect(crown.radius).toBeCloseTo((0.25 + 0.3 + 0.25) / 3, 9);
  });

  it("copes with a mesh that is only a trunk", () => {
    const crown = crownOfMesh(ring(0.5, 0.05));
    expect(crown.radius).toBeGreaterThan(0);
  });
});
