import { describe, expect, it } from "vitest";
import { cleanFreehand, closeRing, dedupe, ringArea, selfIntersects } from "./geometry";
import type { Pt } from "../map/coords";

const square: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

describe("geometry", () => {
  it("closes an open ring and leaves a closed one alone", () => {
    expect(closeRing(square.slice(0, 4))).toEqual(square);
    expect(closeRing(square)).toBe(square);
  });

  it("removes consecutive duplicates only", () => {
    expect(dedupe([[0, 0], [0, 0], [1, 1], [1, 1], [0, 0]])).toEqual([[0, 0], [1, 1], [0, 0]]);
  });

  it("detects a bowtie but not a square", () => {
    expect(selfIntersects(square)).toBe(false);
    expect(selfIntersects([[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]])).toBe(true);
  });

  it("simplifies a jittery circle into far fewer vertices, still a simple polygon", () => {
    const ring: Pt[] = Array.from({ length: 200 }, (_, i) => {
      const a = (i / 200) * Math.PI * 2;
      return [50 * Math.cos(a) + 0.2 * Math.sin(i * 7), 50 * Math.sin(a)];
    });
    const out = cleanFreehand(ring, 1.5);
    expect(out.length).toBeLessThan(ring.length / 2);
    expect(selfIntersects(out)).toBe(false);
    expect(ringArea(out)).toBeGreaterThan(0.9 * Math.PI * 50 * 50);
  });

  it("measures area", () => {
    expect(ringArea(square)).toBe(100);
  });
});
