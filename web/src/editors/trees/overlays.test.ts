import { describe, expect, it } from "vitest";
import type { Landmark, Region } from "../../core/api/api";
import { DEFAULT_FOREST } from "../../model/design/forestDefaults";
import { emptyDoc } from "../../model/design/store";
import { testLook } from "../../terrain/look/look.fixture";
import { densityAlpha, marks, withSelection } from "./overlays";

const ring: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const region = (id: string, cls: number, trees: Region["trees"] = null): Region => ({ id, class: cls, hole: null, outer: ring, inner: [], note: null, trees });
const lm = (over: Partial<Landmark> = {}): Landmark => ({ name: "a", kind: "b", x: 50, z: 50, rotation: 0, scale: 1, y: null, clearance: null, ...over });

function doc() {
  const d = emptyDoc();
  d.regions = { w1: region("w1", 8), w2: region("w2", 8, { ...DEFAULT_FOREST, spacing: 3 }), f: region("f", 1) };
  d.order = ["w1", "f", "w2"];
  d.trees.added = [{ x: 5, z: 5, height: 20, kind: 0 }, { x: 8, z: 8, height: 10, kind: 1 }];
  d.trees.removed = [{ x: 30, z: 30, r: 6 }];
  return d;
}
const KINDS = testLook.trees.kinds;
const on = { showClearings: true, selectedTree: null };

describe("what the Trees editor draws", () => {
  it("tints each woods patch, and only woods, denser where it is planted closer", () => {
    const patches = marks(doc(), [], KINDS, on).filter((m) => m.type === "patch");
    expect(patches.map((m) => m.type === "patch" && m.id)).toEqual(["w1", "w2"]);
    const [a, b] = patches.map((m) => (m.type === "patch" ? m.alpha : 0));
    expect(b).toBeGreaterThan(a); // 3 m is darker than the 5 m default
  });

  it("the tint runs from the faintest at 20 m to the darkest at 2 m, and no further", () => {
    expect(densityAlpha(20)).toBeCloseTo(0.12);
    expect(densityAlpha(2)).toBeCloseTo(0.5);
    expect(densityAlpha(100)).toBeCloseTo(0.12);
    expect(densityAlpha(0)).toBeCloseTo(0.5);
  });

  it("draws every placed tree, with the selected one marked", () => {
    const trees = marks(doc(), [], KINDS, { ...on, selectedTree: 1 }).filter((m) => m.type === "tree");
    expect(trees.map((m) => m.type === "tree" && m.selected)).toEqual([false, true]);
  });

  it("draws the clearings derived from landmarks and placed trees, and the ones drawn by hand", () => {
    const clearings = marks(doc(), [lm({ clearance: 9 })], KINDS, on).filter((m) => m.type === "clearing");
    const derived = clearings.filter((m) => m.type === "clearing" && m.source === "derived");
    const hand = clearings.filter((m) => m.type === "clearing" && m.source === "hand");
    expect(derived).toHaveLength(3); // the landmark and the two placed trees
    expect(hand).toEqual([{ type: "clearing", source: "hand", x: 30, z: 30, r: 6 }]);
    expect(derived[0]).toMatchObject({ x: 50, z: 50, r: 9 });
  });

  it("leaves the clearings out when they are switched off, and keeps the trees", () => {
    const m = marks(doc(), [lm()], KINDS, { showClearings: false, selectedTree: null });
    expect(m.some((x) => x.type === "clearing")).toBe(false);
    expect(m.filter((x) => x.type === "tree")).toHaveLength(2);
  });

  it("marks the selected patches", () => {
    const list = withSelection(marks(doc(), [], KINDS, on), ["w2"]);
    expect(list.filter((m) => m.type === "patch").map((m) => m.type === "patch" && m.selected)).toEqual([false, true]);
  });
});
