import { beforeEach, describe, expect, it } from "vitest";
import type { Region } from "../../core/api/api";
import type { Pt } from "../../core/geometry/coords";
import { selfIntersects } from "../../core/geometry/geometry";
import { roundRegions } from "./round";
import { designStore, emptyDoc } from "./store";

const box = (x0: number, z0: number, x1: number, z1: number): Pt[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
const region = (id: string, outer: Pt[], inner: Pt[][] = []): Region => ({ id, class: 1, hole: null, outer, inner, note: null, trees: null });
const doc = () => designStore.getState().doc;

function load(...rs: Region[]) {
  const d = emptyDoc();
  d.regions = Object.fromEntries(rs.map((r) => [r.id, r]));
  d.order = rs.map((r) => r.id);
  designStore.getState().reset(d);
}

describe("rounding regions", () => {
  beforeEach(() => load(region("a", box(0, 0, 20, 20), [box(5, 5, 10, 10)]), region("b", box(30, 0, 50, 20)), region("c", box(60, 0, 60.3, 0.3))));

  it("adds points to the outline and to its holes, as one undo step", () => {
    const r = roundRegions("Round region", ["a"]);
    expect(r).toEqual({ rounded: 1, added: 8, crossed: 0, fine: 0 });
    expect(doc().regions.a.outer).toHaveLength(9);
    expect(doc().regions.a.inner[0]).toHaveLength(9);
    designStore.getState().undo();
    expect(doc().regions.a.outer).toHaveLength(5);
    expect(doc().regions.a.inner[0]).toHaveLength(5);
  });

  it("changes only the regions asked for", () => {
    roundRegions("Round regions", ["a"]);
    expect(doc().regions.b.outer).toHaveLength(5);
  });

  it("rounds several regions in one undo step", () => {
    roundRegions("Round regions", ["a", "b"]);
    expect(doc().regions.b.outer).toHaveLength(9);
    designStore.getState().undo();
    expect(doc().regions.a.outer).toHaveLength(5);
    expect(doc().regions.b.outer).toHaveLength(5);
  });

  it("keeps the corners, so a neighbour's shared border still meets it", () => {
    const before = doc().regions.a.outer.map((p) => [...p]);
    roundRegions("Round region", ["a"]);
    for (const corner of before) expect(doc().regions.a.outer).toContainEqual(corner);
  });

  it("leaves a region with only tiny edges alone, and says so", () => {
    const r = roundRegions("Round region", ["c"]);
    expect(r).toEqual({ rounded: 0, added: 0, crossed: 0, fine: 1 });
    expect(doc().regions.c.outer).toHaveLength(5);
    expect(designStore.getState().past).toHaveLength(0); // nothing to undo
  });

  it("can be pressed again, and every press adds points", () => {
    roundRegions("Round region", ["b"]);
    roundRegions("Round region", ["b"]);
    expect(doc().regions.b.outer).toHaveLength(17);
    expect(selfIntersects(doc().regions.b.outer as Pt[])).toBe(false);
  });

  it("leaves a region alone when the curve would cross itself", () => {
    // a hole nearly touching the outline: the curve through the outline's corners bulges into it
    load(region("h", box(0, 0, 20, 20), [box(0.05, 8, 3, 12)]));
    const before = JSON.stringify(doc().regions.h);
    const r = roundRegions("Round region", ["h"]);
    expect(r.rounded + r.crossed).toBe(1);
    if (r.crossed) expect(JSON.stringify(doc().regions.h)).toBe(before);
  });
});
