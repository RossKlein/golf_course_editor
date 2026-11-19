import { describe, expect, it } from "vitest";
import { parseWaterMesh } from "./data";

const lake = (extra: object = {}) => ({
  id: "lake-1",
  anchor: [1, 2],
  estimatedLevel: 3,
  level: 3,
  positions: [0, 3, 0, 1, 3, 0, 0, 3, 1],
  normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
  indices: [0, 1, 2],
  ...extra,
});

describe("the water mesh", () => {
  it("takes a mesh from before the excess existed as having none", () => {
    expect(parseWaterMesh({ version: 1, lakes: [lake()] }).lakes[0].excess).toBe(0);
  });
  it("takes a mesh from before the cut as a carrier to clip, and keeps a cut one", () => {
    expect(parseWaterMesh({ version: 1, lakes: [lake()] }).lakes[0].cut).toBe(false);
    expect(parseWaterMesh({ version: 1, lakes: [lake({ cut: true })] }).lakes[0].cut).toBe(true);
  });
  it("keeps a lake's excess, and refuses one that is negative or not a number", () => {
    expect(parseWaterMesh({ version: 1, lakes: [lake({ excess: 2.5 })] }).lakes[0].excess).toBe(2.5);
    expect(() => parseWaterMesh({ version: 1, lakes: [lake({ excess: -1 })] })).toThrow();
    expect(() => parseWaterMesh({ version: 1, lakes: [lake({ excess: "far" })] })).toThrow();
  });
});
