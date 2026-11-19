import { describe, expect, it } from "vitest";
import type { Landmark } from "../../core/api/api";
import { testLook } from "../../terrain/look/look.fixture";
import { crownFraction, landmarkClearings, LANDMARK_CLEARANCE, PLACED_MARGIN, placedClearings } from "./clearings";

const KINDS = testLook.trees.kinds; // pine, broadleaf, fir: the same as the server's default look

const landmark = (over: Partial<Landmark> = {}): Landmark => ({ name: "a", kind: "b", x: 1, z: 2, rotation: 0, scale: 1, y: null, clearance: null, ...over });

// The numbers below are what course_maker/build/trees.py gives for the same inputs (test_trees.py checks them there too).
describe("the clearing rule, as the build has it", () => {
  it("the crown of each kind is its widest part, as a fraction of its height", () => {
    expect(KINDS.map((k) => +crownFraction(k).toFixed(6))).toEqual([0.17, 0.301803, 0.26]);
  });

  it("a placed tree clears its crown and half a metre", () => {
    const discs = placedClearings(
      [{ x: 10, z: 20, height: 20, kind: 0 }, { x: 1, z: 2, height: 10, kind: 1 }, { x: 3, z: 4, height: 15, kind: 5 }],
      KINDS,
    );
    expect(discs.map((d) => [d.x, d.z, +d.r.toFixed(6)])).toEqual([[10, 20, 3.9], [1, 2, 3.518034], [3, 4, 4.4]]); // kind 5 wraps to fir
    expect(PLACED_MARGIN).toBe(0.5);
  });

  it("a landmark clears its clearance, or four metres times its scale", () => {
    const discs = landmarkClearings([landmark(), landmark({ scale: 2.5 }), landmark({ clearance: 7 })]);
    expect(discs.map((d) => d.r)).toEqual([4, 10, 7]);
    expect(LANDMARK_CLEARANCE).toBe(4);
  });

  it("no kinds, no clearings", () => {
    expect(placedClearings([{ x: 0, z: 0, height: 10, kind: 0 }], [])).toEqual([]);
  });
});
