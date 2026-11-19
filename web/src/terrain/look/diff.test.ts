import { describe, expect, it } from "vitest";
import type { Look } from "../../core/api/api";
import { bakes, diffLook, NO_CHANGE } from "./diff";
import { testLook } from "./look.fixture";

const edit = (f: (l: Look) => void): Look => {
  const copy = structuredClone(testLook);
  f(copy);
  return copy;
};

describe("what a change of look makes the renderer redo", () => {
  it("is nothing for the same look, or an equal copy of it", () => {
    expect(diffLook(testLook, testLook)).toEqual(NO_CHANGE);
    expect(diffLook(testLook, structuredClone(testLook))).toEqual(NO_CHANGE);
  });

  it("is nothing for the fields that are uniforms", () => {
    const changes: ((l: Look) => void)[] = [
      (l) => (l.sky = [0, 0, 0]),
      (l) => (l.surfaces.fairway.color = [1, 0, 0]),
      (l) => (l.surfaces.fairway.stripe = 5),
      (l) => (l.surfaces.bunker.bump = 2),
      (l) => (l.surfaces.woods.tuft = 3),
      (l) => (l.grass.tileMetres = 9),
      (l) => (l.grass.smoothing = 3),
      (l) => (l.tufts.height = 1),
      (l) => (l.tufts.tip = [1, 1, 1]),
      (l) => (l.shadows.strength = 0.1),
      (l) => (l.shadows.tint = [1, 1, 1]),
      (l) => (l.shadows.distance = 50),
      (l) => (l.trees.ambient = 0.1),
      (l) => (l.trees.direct = 1.5),
    ];
    for (const c of changes) {
      const change = diffLook(testLook, edit(c));
      expect(change).toEqual(NO_CHANGE);
      expect(bakes(change)).toBe(false);
    }
  });

  it("bakes the sun again when the sun or the edge of its shadows changes", () => {
    for (const c of [(l: Look) => (l.sun.hourAngle = -20), (l: Look) => (l.sun.latitude = 10), (l: Look) => (l.sun.declination = 0), (l: Look) => (l.shadows.softness = 2)]) {
      const change = diffLook(testLook, edit(c));
      expect(change).toEqual({ ...NO_CHANGE, sunBake: true });
      expect(bakes(change)).toBe(true);
    }
  });

  it("bakes the relief again when its smoothing changes", () => {
    expect(diffLook(testLook, edit((l) => (l.relief.smoothing = 4)))).toEqual({ ...NO_CHANGE, relief: true });
  });

  it("rebuilds the tree models, and nothing else, for a tree's colour", () => {
    const change = diffLook(testLook, edit((l) => (l.trees.kinds[0].parts[1].color = [1, 0, 0])));
    expect(change).toEqual({ ...NO_CHANGE, treeModels: true });
    expect(bakes(change)).toBe(false);
    expect(diffLook(testLook, edit((l) => { const p = l.trees.kinds[0].parts[0]; if (p.shape === "frustum") p.shade = 0.5; }))).toEqual({ ...NO_CHANGE, treeModels: true });
  });

  it("rebuilds the models and bakes the sky and sun again for a tree's shape", () => {
    const wider = diffLook(testLook, edit((l) => { const p = l.trees.kinds[0].parts[1]; if (p.shape === "frustum") p.r0 = 0.3; }));
    expect(wider).toEqual({ ...NO_CHANGE, treeModels: true, treeShape: true });
    expect(bakes(wider)).toBe(true);
    const blob = diffLook(testLook, edit((l) => { const p = l.trees.kinds[1].parts[1]; if (p.shape === "blob") p.cy = 0.5; }));
    expect(blob.treeShape).toBe(true);
  });

  it("regroups the trees when the kinds or their heights change", () => {
    const heights = diffLook(testLook, edit((l) => (l.trees.kinds[0].height = [20, 30])));
    expect(heights).toEqual({ ...NO_CHANGE, treeModels: true, treeLayout: true });
    const fewer = diffLook(testLook, edit((l) => l.trees.kinds.pop()));
    expect(fewer.treeLayout).toBe(true);
    expect(fewer.treeShape).toBe(true);
  });

  it("does nothing for a tree's name", () => {
    const change = diffLook(testLook, edit((l) => (l.trees.kinds[0].name = "spruce")));
    expect(change.treeShape).toBe(false);
    expect(change.treeLayout).toBe(false);
  });

  it("notices a different grass file", () => {
    expect(diffLook(testLook, edit((l) => (l.grass.tile = "other.png")))).toEqual({ ...NO_CHANGE, grassTile: true });
  });
});
