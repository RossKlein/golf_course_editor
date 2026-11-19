import { beforeEach, describe, expect, it } from "vitest";
import type { Pt } from "../../core/geometry/coords";
import { addCollars, COLLAR_CLASS, GREEN_CLASS } from "./collar";
import { addPath, PATH_CLASS } from "./path";
import { addRegion, designStore, emptyDoc } from "./store";

const box = (x: number, z: number, w = 10, h = 10): Pt[] => [[x, z], [x + w, z], [x + w, z + h], [x, z + h], [x, z]];
const doc = () => designStore.getState().doc;
const green = (x: number, z: number, hole: number | null = 1) => addRegion("Draw green", { class: GREEN_CLASS, hole, outer: box(x, z), inner: [] });

beforeEach(() => designStore.getState().reset(emptyDoc()));

describe("addPath", () => {
  it("adds one Path region on top, selects it, and is one undo step", () => {
    const fairway = addRegion("f", { class: 1, hole: 1, outer: box(0, 0, 100, 100), inner: [] });
    const ids = addPath("Draw path", [[10, 10], [40, 20], [80, 15]], 2.5, 0.2);
    expect(ids).toHaveLength(1);
    expect(doc().order).toEqual([fairway, ids[0]]);
    const r = doc().regions[ids[0]];
    expect(r.class).toBe(PATH_CLASS);
    expect(r.hole).toBeNull();
    expect(designStore.getState().selected).toEqual(ids);
    designStore.getState().undo();
    expect(doc().order).toEqual([fairway]);
  });

  it("adds nothing for a single point", () => {
    expect(addPath("Draw path", [[1, 1]], 2.5, 0)).toEqual([]);
    expect(doc().order).toEqual([]);
  });
});

describe("addCollars", () => {
  it("puts a collar under the green, ringing it exactly, and leaves the green's outline alone", () => {
    const below = addRegion("f", { class: 1, hole: 1, outer: box(-20, -20, 60, 60), inner: [] });
    const g = green(0, 0);
    const above = addRegion("b", { class: 5, hole: null, outer: box(3, 3, 2, 2), inner: [] });
    const s = addCollars("Add collars", 1.5, [g]);
    expect(s).toEqual({ made: 1, had: 0 });
    const order = doc().order;
    expect(order).toHaveLength(4);
    expect(order[0]).toBe(below);
    expect(doc().regions[order[1]].class).toBe(COLLAR_CLASS);
    expect(order.slice(2)).toEqual([g, above]);
    expect(doc().regions[g].outer).toEqual(box(0, 0));
    const xs = (doc().regions[order[1]].outer as Pt[]).map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-1.5, 2);
    expect(Math.max(...xs)).toBeCloseTo(11.5, 2);
    expect(designStore.getState().selected).toEqual([order[1]]);
  });

  it("does every green when none are given, and only greens", () => {
    green(0, 0);
    green(50, 0, 2);
    addRegion("t", { class: 4, hole: 1, outer: box(100, 0), inner: [] });
    expect(addCollars("Add collars", 1.5)).toEqual({ made: 2, had: 0 });
    expect(doc().order.map((id) => doc().regions[id].class)).toEqual([COLLAR_CLASS, GREEN_CLASS, COLLAR_CLASS, GREEN_CLASS, 4]);
  });

  it("skips a green that already has a collar, so a second press adds nothing", () => {
    green(0, 0);
    addCollars("Add collars", 1.5);
    expect(addCollars("Add collars", 1.5)).toEqual({ made: 0, had: 1 });
    expect(doc().order).toHaveLength(2);
  });

  it("adds a thicker collar over a thin one", () => {
    green(0, 0);
    addCollars("Add collars", 0.5);
    expect(addCollars("Add collars", 2)).toEqual({ made: 1, had: 0 });
  });

  it("is one undo step, and does nothing without a green", () => {
    green(0, 0);
    green(50, 0);
    addCollars("Add collars", 1.5);
    designStore.getState().undo();
    expect(doc().order).toHaveLength(2);
    designStore.getState().reset(emptyDoc());
    addRegion("f", { class: 1, hole: 1, outer: box(0, 0), inner: [] });
    expect(addCollars("Add collars", 1.5)).toEqual({ made: 0, had: 0 });
  });
});
