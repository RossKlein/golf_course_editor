import { beforeEach, describe, expect, it } from "vitest";
import type { Region } from "../api/api";
import type { Pt } from "../map/coords";
import { holeExtent, holeView, routeLength, suggestHoles, unassignedCount, visibleRegionIds } from "./holes";
import { addHole, addRegion, assignHoles, designStore, emptyDoc, removeHole, setRoute, updateHole } from "./store";

const box = (x: number, z: number, w = 10, h = 10): Pt[] => [[x, z], [x + w, z], [x + w, z + h], [x, z + h], [x, z]];
const region = (cls: number, outer: Pt[], hole: number | null = null): Omit<Region, "id" | "note"> => ({ class: cls, hole, outer, inner: [] });

beforeEach(() => designStore.getState().reset(emptyDoc()));

const doc = () => designStore.getState().doc;

describe("holes in the store", () => {
  it("adds holes numbered from 1", () => {
    expect(addHole()).toBe(1);
    expect(addHole()).toBe(2);
    expect(doc().layout.holes.map((h) => h.number)).toEqual([1, 2]);
  });

  it("stops at the limit", () => {
    for (let i = 0; i < 24; i++) addHole();
    expect(addHole()).toBeNull();
    expect(doc().layout.holes).toHaveLength(24);
  });

  it("drawing a route creates the hole and any before it", () => {
    setRoute(3, [[0, 0], [100, 0]]);
    expect(doc().layout.holes.map((h) => h.number)).toEqual([1, 2, 3]);
    expect(doc().layout.holes[2].route).toEqual([[0, 0], [100, 0]]);
    expect(doc().layout.holes[0].route).toEqual([]);
  });

  it("removing a hole renumbers later holes and their surfaces, and frees its own", () => {
    setRoute(3, [[0, 0], [1, 1]]);
    const a = addRegion("a", region(1, box(0, 0), 1));
    const b = addRegion("b", region(1, box(20, 0), 2));
    const c = addRegion("c", region(2, box(40, 0), 3));
    removeHole(2);
    expect(doc().layout.holes.map((h) => h.number)).toEqual([1, 2]);
    expect(doc().layout.holes[1].route).toEqual([[0, 0], [1, 1]]); // the old hole 3
    expect([a, b, c].map((id) => doc().regions[id].hole)).toEqual([1, null, 2]);
  });

  it("removing a hole is one undo step", () => {
    setRoute(2, [[0, 0], [1, 1]]);
    const r = addRegion("r", region(2, box(0, 0), 2));
    removeHole(1);
    expect(doc().regions[r].hole).toBe(1);
    designStore.getState().undo();
    expect(doc().layout.holes).toHaveLength(2);
    expect(doc().regions[r].hole).toBe(2);
  });

  it("edits par and name", () => {
    addHole();
    updateHole(1, { par: 5, name: "Tea Olive" });
    expect(doc().layout.holes[0]).toMatchObject({ par: 5, name: "Tea Olive" });
  });
});

describe("hole geometry", () => {
  it("measures a route", () => {
    expect(routeLength([[0, 0], [3, 4], [3, 14]])).toBe(15);
    expect(routeLength([])).toBe(0);
  });

  it("the extent covers the route and the hole's own fairways, greens and tees, but not shared surfaces or other holes", () => {
    setRoute(1, [[0, 0], [100, 0]]);
    addRegion("g", region(2, box(95, -20, 10, 10), 1));
    addRegion("bunker", region(5, box(500, 500)));
    addRegion("other", region(1, box(300, 300), 2));
    expect(holeExtent(doc(), 1)).toEqual({ x: 0, z: -20, w: 105, h: 20 });
    expect(holeExtent(doc(), 1, 5)).toEqual({ x: -5, z: -25, w: 115, h: 30 });
  });

  it("has no extent for an empty hole", () => {
    addHole();
    expect(holeExtent(doc(), 1)).toBeNull();
    expect(holeView(doc(), 1)).toBeNull();
  });

  it("the view around a tiny hole is not absurdly small", () => {
    setRoute(1, [[0, 0], [2, 0]]);
    const v = holeView(doc(), 1)!;
    expect(v.w).toBeGreaterThanOrEqual(80);
    expect(v.h).toBeGreaterThanOrEqual(80);
    expect(v.x + v.w / 2).toBeCloseTo(1);
  });
});

describe("hiding other holes", () => {
  it("keeps this hole, unclaimed surfaces, and shared surfaces near it", () => {
    setRoute(1, [[0, 0], [100, 0]]);
    setRoute(2, [[1000, 0], [1100, 0]]);
    const mine = addRegion("m", region(1, box(10, 0), 1));
    const theirs = addRegion("t", region(1, box(1010, 0), 2));
    const orphan = addRegion("o", region(2, box(2000, 2000), null));
    const nearBunker = addRegion("b1", region(5, box(50, 20)));
    const farBunker = addRegion("b2", region(5, box(1050, 20)));
    const shown = visibleRegionIds(doc(), 1);
    expect([mine, orphan, nearBunker].every((id) => shown.has(id))).toBe(true);
    expect([theirs, farBunker].some((id) => shown.has(id))).toBe(false);
  });

  it("always keeps what is selected", () => {
    setRoute(1, [[0, 0], [100, 0]]);
    const far = addRegion("far", region(5, box(5000, 5000)));
    expect(visibleRegionIds(doc(), 1).has(far)).toBe(false);
    expect(visibleRegionIds(doc(), 1, [far]).has(far)).toBe(true);
  });

  it("an empty hole shows only unclaimed surfaces", () => {
    addHole();
    const bunker = addRegion("b", region(5, box(0, 0)));
    const orphan = addRegion("o", region(1, box(0, 0)));
    const shown = visibleRegionIds(doc(), 1);
    expect(shown.has(bunker)).toBe(false);
    expect(shown.has(orphan)).toBe(true);
  });
});

describe("assigning surfaces", () => {
  beforeEach(() => {
    setRoute(1, [[0, 0], [200, 0]]);
    setRoute(2, [[0, 100], [200, 100]]);
  });

  it("gives a tee to the hole it starts, a green to the hole it ends, a fairway to the nearest line", () => {
    const tee = addRegion("t", region(4, box(-5, 105))); // by hole 2's start, though hole 1's line is also close
    const green = addRegion("g", region(2, box(195, -5))); // at hole 1's end
    const fairway = addRegion("f", region(1, box(90, 60))); // nearer hole 2's line
    const found = suggestHoles(doc());
    expect(found[tee]).toBe(2);
    expect(found[green]).toBe(1);
    expect(found[fairway]).toBe(2);
  });

  it("leaves claimed, shared and faraway surfaces alone", () => {
    const claimed = addRegion("c", region(1, box(90, 0), 2));
    const bunker = addRegion("b", region(5, box(90, 0)));
    const far = addRegion("far", region(1, box(9000, 9000)));
    const found = suggestHoles(doc());
    expect(Object.keys(found)).toEqual([]);
    expect(unassignedCount(doc())).toBe(1);
    void claimed, bunker, far;
  });

  it("ignores holes that have no route", () => {
    addHole();
    addHole(); // holes 3 and 4, unfinished
    const g = addRegion("g", region(2, box(195, -5)));
    expect(suggestHoles(doc())[g]).toBe(1);
  });

  it("applies the suggestions as one undo step", () => {
    const a = addRegion("a", region(2, box(195, -5)));
    const b = addRegion("b", region(1, box(90, 60)));
    assignHoles(suggestHoles(doc()));
    expect([a, b].map((id) => doc().regions[id].hole)).toEqual([1, 2]);
    designStore.getState().undo();
    expect([a, b].map((id) => doc().regions[id].hole)).toEqual([null, null]);
  });
});
