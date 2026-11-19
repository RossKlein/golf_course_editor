import { beforeEach, describe, expect, it } from "vitest";
import type { BoundsArea, Region } from "../../core/api/api";
import type { Pt } from "../../core/geometry/coords";
import { ringArea } from "../../core/geometry/geometry";
import { DEFAULT_FOREST } from "./forestDefaults";
import { cutBounds, cutPolygon, cutRegions, MIN_PART_AREA } from "./cut";
import { designStore, emptyDoc } from "./store";

const box = (x0: number, z0: number, x1: number, z1: number): Pt[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
const region = (id: string, cls: number, outer: Pt[], over: Partial<Region> = {}): Region => ({ id, class: cls, hole: null, outer, inner: [], note: null, trees: null, ...over });
const area = (r: { outer: readonly Pt[]; inner: readonly (readonly Pt[])[] }) => ringArea(r.outer as Pt[]) - r.inner.reduce((a, h) => a + ringArea(h as Pt[]), 0);
const doc = () => designStore.getState().doc;

function load(...rs: Region[]) {
  const d = emptyDoc();
  d.regions = Object.fromEntries(rs.map((r) => [r.id, r]));
  d.order = rs.map((r) => r.id);
  designStore.getState().reset(d);
}

describe("cutting a polygon", () => {
  const square = box(0, 0, 100, 100);

  it("leaves what is outside the cutter: a corner cut away", () => {
    const parts = cutPolygon(square, [], box(50, 50, 150, 150))!;
    expect(parts).toHaveLength(1);
    expect(area(parts[0])).toBeCloseTo(10_000 - 2_500);
  });

  it("leaves a hole when the cutter is inside", () => {
    const parts = cutPolygon(square, [], box(40, 40, 60, 60))!;
    expect(parts).toHaveLength(1);
    expect(parts[0].inner).toHaveLength(1);
    expect(area(parts[0])).toBeCloseTo(10_000 - 400);
  });

  it("leaves two pieces when the cutter goes across, the larger first", () => {
    const parts = cutPolygon(square, [], box(-10, 70, 110, 80))!;
    expect(parts).toHaveLength(2);
    expect(area(parts[0])).toBeCloseTo(7_000);
    expect(area(parts[1])).toBeCloseTo(2_000);
  });

  it("is nothing left when the cutter covers it", () => {
    expect(cutPolygon(square, [], box(-5, -5, 105, 105))).toEqual([]);
  });

  it("is null when the cutter does not touch it, or only touches its edge", () => {
    expect(cutPolygon(square, [], box(200, 200, 300, 300))).toBeNull();
    expect(cutPolygon(square, [], box(100, 0, 150, 100))).toBeNull();
  });

  it("keeps the holes the polygon already had", () => {
    const withHole = cutPolygon(square, [box(10, 10, 20, 20)], box(60, 60, 150, 150))!;
    expect(withHole[0].inner).toHaveLength(1);
    expect(area(withHole[0])).toBeCloseTo(10_000 - 100 - 1_600);
  });

  it("is null for a cutter inside an existing hole: there is nothing there to take", () => {
    expect(cutPolygon(square, [box(30, 30, 70, 70)], box(40, 40, 60, 60))).toBeNull();
  });

  it("drops a sliver left where two outlines nearly met", () => {
    const parts = cutPolygon(square, [], box(-10, -10, 99.99999, 110))!;
    expect(parts.every((p) => area(p) >= MIN_PART_AREA)).toBe(true);
  });
});

describe("cutting regions", () => {
  beforeEach(() => load(region("a", 1, box(0, 0, 100, 100), { hole: 3, note: "the fairway" }), region("b", 8, box(50, 50, 150, 150)), region("far", 5, box(500, 500, 600, 600))));

  it("cuts every region the outline touches, and none it does not", () => {
    const s = cutRegions("Cut", box(55, 55, 65, 65));
    expect(s).toEqual({ touched: 2, removed: 0, created: 0 });
    expect(doc().regions.a.inner).toHaveLength(1);
    expect(doc().regions.b.inner).toHaveLength(1);
    expect(doc().regions.far.inner).toEqual([]);
  });

  it("cuts only the regions it is given, when it is given some", () => {
    const s = cutRegions("Cut", box(55, 55, 65, 65), ["b"]);
    expect(s.touched).toBe(1);
    expect(doc().regions.a.inner).toEqual([]);
    expect(doc().regions.b.inner).toHaveLength(1);
  });

  it("splits a region in two: the larger keeps the id, the other is a new region right after it, with the same surface, hole and note", () => {
    const s = cutRegions("Cut", box(-10, 70, 110, 80), ["a"]);
    expect(s).toEqual({ touched: 1, removed: 0, created: 1 });
    expect(doc().order).toHaveLength(4);
    expect(doc().order.slice(0, 1)).toEqual(["a"]);
    const made = doc().order[1];
    expect(made).not.toBe("a");
    expect(made).not.toBe("b");
    expect(doc().regions[made]).toMatchObject({ id: made, class: 1, hole: 3, note: "the fairway" });
    expect(area(doc().regions.a)).toBeCloseTo(7_000);
    expect(area(doc().regions[made])).toBeCloseTo(2_000);
    expect(doc().order[2]).toBe("b"); // painter's order is kept: the new piece sits where its region was
  });

  it("gives a split piece its own copy of the forest settings", () => {
    load(region("w", 8, box(0, 0, 100, 100), { trees: { ...DEFAULT_FOREST, spacing: 3, kinds: { pine: 0.5 } } }));
    cutRegions("Cut", box(-10, 40, 110, 60));
    const [first, second] = doc().order.map((id) => doc().regions[id]);
    expect(second.trees).toEqual(first.trees);
    expect(second.trees).not.toBe(first.trees);
    expect(second.trees!.kinds).not.toBe(first.trees!.kinds);
  });

  it("deletes a region that is cut away entirely", () => {
    designStore.getState().select(["a", "b"]);
    const s = cutRegions("Cut", box(-5, -5, 105, 105), ["a"]);
    expect(s).toEqual({ touched: 1, removed: 1, created: 0 });
    expect(doc().order).toEqual(["b", "far"]);
    expect(doc().regions.a).toBeUndefined();
    expect(designStore.getState().selected).toEqual(["b"]); // the selection forgets what is gone
  });

  it("does nothing, and makes no undo step, when it touches nothing", () => {
    const before = designStore.getState().past.length;
    expect(cutRegions("Cut", box(300, 300, 320, 320))).toEqual({ touched: 0, removed: 0, created: 0 });
    expect(designStore.getState().past.length).toBe(before);
  });

  it("is one undo step, however many regions it changes", () => {
    const before = doc();
    cutRegions("Cut", box(-10, 45, 160, 55)); // across both, splitting each
    expect(doc().order.length).toBeGreaterThan(3);
    designStore.getState().undo();
    expect(doc().order).toEqual(before.order);
    expect(doc().regions.a).toEqual(before.regions.a);
    expect(doc().regions.b).toEqual(before.regions.b);
    designStore.getState().redo();
    expect(doc().order.length).toBeGreaterThan(3);
  });

  it("makes ids that are all different", () => {
    cutRegions("Cut", box(-10, 20, 160, 25));
    cutRegions("Cut", box(-10, 60, 160, 65));
    cutRegions("Cut", box(-10, 80, 160, 85));
    expect(new Set(doc().order).size).toBe(doc().order.length);
  });
});

describe("cutting bounds areas", () => {
  const bounds = (id: string, hole: number, outer: Pt[], inner: Pt[][] = []): BoundsArea => ({ id, hole, outer, inner });
  const loadBounds = (...as: BoundsArea[]) => {
    const d = emptyDoc();
    d.bounds = Object.fromEntries(as.map((a) => [a.id, a]));
    designStore.getState().reset(d);
  };
  const all = () => Object.values(doc().bounds);

  beforeEach(() => loadBounds(bounds("b1", 1, box(0, 0, 100, 100)), bounds("b2", 2, box(0, 0, 100, 100)), bounds("far", 1, box(500, 500, 600, 600))));

  it("takes a bite out of the hole's area, leaving a hole when the cutter is inside", () => {
    const s = cutBounds("Subtract", box(40, 40, 60, 60), 1);
    expect(s).toEqual({ touched: 1, removed: 0, created: 0 });
    expect(doc().bounds.b1.inner).toHaveLength(1);
    expect(area(doc().bounds.b1)).toBeCloseTo(10_000 - 400);
  });

  it("leaves other holes' areas alone, even where they overlap the cutter", () => {
    cutBounds("Subtract", box(40, 40, 60, 60), 1);
    expect(doc().bounds.b2).toEqual(bounds("b2", 2, box(0, 0, 100, 100)));
  });

  it("splits an area the cutter goes across: the larger piece keeps the id, the other is a new area of the same hole", () => {
    const s = cutBounds("Subtract", box(-10, 70, 110, 80), 1);
    expect(s).toEqual({ touched: 1, removed: 0, created: 1 });
    const mine = all().filter((a) => a.hole === 1 && a.id !== "far");
    expect(mine).toHaveLength(2);
    expect(area(doc().bounds.b1)).toBeCloseTo(7_000);
    expect(mine.find((a) => a.id !== "b1")!.hole).toBe(1);
    expect(new Set(all().map((a) => a.id)).size).toBe(all().length);
  });

  it("deletes an area that is cut away entirely", () => {
    const s = cutBounds("Subtract", box(-5, -5, 105, 105), 1);
    expect(s).toEqual({ touched: 1, removed: 1, created: 0 });
    expect(doc().bounds.b1).toBeUndefined();
    expect(doc().bounds.far).toBeDefined();
  });

  it("does nothing, and makes no undo step, when it touches nothing", () => {
    const before = designStore.getState().past.length;
    expect(cutBounds("Subtract", box(300, 300, 320, 320), 1)).toEqual({ touched: 0, removed: 0, created: 0 });
    expect(designStore.getState().past.length).toBe(before);
  });

  it("is one undo step, however many areas it changes", () => {
    loadBounds(bounds("b1", 1, box(0, 0, 100, 100)), bounds("b3", 1, box(0, 200, 100, 300)));
    cutBounds("Subtract", box(-10, -10, 110, 250), 1);
    expect(all()).toHaveLength(1); // b1 is gone, b3 is trimmed
    designStore.getState().undo();
    expect(doc().bounds.b1).toEqual(bounds("b1", 1, box(0, 0, 100, 100)));
    expect(doc().bounds.b3).toEqual(bounds("b3", 1, box(0, 200, 100, 300)));
  });

  it("forgets deleted areas in the selection", () => {
    designStore.getState().select(["b1", "far"]);
    cutBounds("Subtract", box(-5, -5, 105, 105), 1);
    expect(designStore.getState().selected).toEqual(["far"]);
  });
});
