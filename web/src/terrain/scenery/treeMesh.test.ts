import { describe, expect, it } from "vitest";
import { testLook } from "../look/look.fixture";
import { treeMesh } from "./treeMesh";

const KINDS = testLook.trees.kinds;

describe("tree meshes", () => {
  for (let kind = 0; kind < KINDS.length; kind++) {
    it(`kind ${kind} stands on the ground, is one unit tall and has unit normals`, () => {
      const m = treeMesh(KINDS[kind]);
      expect(m.positions.length).toBe(m.normals.length);
      expect(m.positions.length).toBe(m.colors.length);
      expect(m.positions.length % 9).toBe(0);
      let min = Infinity, max = -Infinity;
      for (let i = 1; i < m.positions.length; i += 3) {
        min = Math.min(min, m.positions[i]);
        max = Math.max(max, m.positions[i]);
      }
      expect(min).toBeGreaterThanOrEqual(-1e-6);
      expect(min).toBeLessThan(0.01);
      expect(max).toBeGreaterThan(0.95);
      expect(max).toBeLessThan(1.05);
      for (let i = 0; i < m.normals.length; i += 3) expect(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2])).toBeCloseTo(1, 4);
    });

    it(`kind ${kind} stays low-poly`, () => {
      expect(treeMesh(KINDS[kind]).positions.length / 9).toBeLessThan(160);
    });
  }

  it("the broadleaf crown faces outward and upward at the top", () => {
    const m = treeMesh(KINDS[1]);
    let topY = -1, topN = 0;
    for (let i = 0; i < m.positions.length; i += 3) {
      if (m.positions[i + 1] > topY) {
        topY = m.positions[i + 1];
        topN = m.normals[i + 1];
      }
    }
    expect(topN).toBeGreaterThan(0);
  });
});
