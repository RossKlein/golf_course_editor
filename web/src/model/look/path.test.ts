import { describe, expect, it } from "vitest";
import { assignPath, getPath, leafPaths, pathKey } from "./path";

const look = { sky: [0.1, 0.2, 0.3], surfaces: { fairway: { color: [1, 0, 0], stripe: 2, color2: null } }, kinds: [{ name: "pine", parts: [{ r0: 0.1 }, { r0: 0.2 }] }] };

describe("paths into the look", () => {
  it("reads a value, or undefined where there is none", () => {
    expect(getPath(look, ["surfaces", "fairway", "stripe"])).toBe(2);
    expect(getPath(look, ["kinds", 0, "parts", 1, "r0"])).toBe(0.2);
    expect(getPath(look, ["surfaces", "lava", "stripe"])).toBeUndefined();
    expect(getPath(look, [])).toBe(look);
  });

  it("sets a value in place", () => {
    const copy = structuredClone(look);
    assignPath(copy, ["surfaces", "fairway", "stripe"], 5);
    assignPath(copy, ["kinds", 0, "parts", 0, "r0"], 0.5);
    expect(copy.surfaces.fairway.stripe).toBe(5);
    expect(copy.kinds[0].parts[0].r0).toBe(0.5);
    expect(look.surfaces.fairway.stripe).toBe(2);
  });

  it("refuses a path through something missing, or an empty one", () => {
    expect(() => assignPath(structuredClone(look), ["surfaces", "lava", "stripe"], 1)).toThrow(/nothing to set/);
    expect(() => assignPath(structuredClone(look), [], 1)).toThrow();
  });

  it("names a path", () => {
    expect(pathKey(["trees", "kinds", 0, "name"])).toBe("trees.kinds.0.name");
  });

  it("lists the leaves, taking a list of numbers (a colour, a range) as one", () => {
    expect(leafPaths(look).map(pathKey)).toEqual(["sky", "surfaces.fairway.color", "surfaces.fairway.stripe", "surfaces.fairway.color2", "kinds.0.name", "kinds.0.parts.0.r0", "kinds.0.parts.1.r0"]);
  });
});
