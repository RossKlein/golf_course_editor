import { describe, expect, it } from "vitest";
import { emptyDoc, type Doc } from "../../model/design/store";
import type { Region } from "../../core/api/api";
import { contentBox, cropImpact, touchesDesign } from "./cropImpact";

const box = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
const region = (id: string, outer: [number, number][]): Region => ({ id, class: 1, hole: null, outer, inner: [], note: null, trees: null });
function doc(): Doc {
  const d = emptyDoc();
  for (const r of [region("in", box(20, 20, 40, 40)), region("cross", box(80, 20, 120, 40)), region("out", box(300, 300, 320, 320))]) {
    d.order.push(r.id);
    d.regions[r.id] = r;
  }
  d.layout.holes = [
    { number: 1, par: 4, name: null, route: [[25, 25], [90, 30]] },
    { number: 2, par: 4, name: null, route: [[25, 25], [200, 30]] },
  ];
  d.trees.added = [{ x: 30, z: 30, height: 8, kind: 0 }, { x: 500, z: 30, height: 8, kind: 0 }];
  return d;
}
const r = { x0: 0, z0: 0, x1: 100, z1: 60 };

describe("cropImpact", () => {
  it("counts what goes, what is cut and what sticks out", () => {
    expect(cropImpact(doc(), [{ x: 10, z: 10 }, { x: 400, z: 10 }], r)).toEqual({ gone: 1, cut: 1, routes: [2], trees: 1, landmarks: 1 });
  });
  it("says nothing is touched for a rectangle round it all", () => {
    expect(touchesDesign(cropImpact(emptyDoc(), [], r))).toBe(false);
    expect(touchesDesign(cropImpact(doc(), [], { x0: 0, z0: 0, x1: 600, z1: 600 }))).toBe(false);
  });
});

describe("contentBox", () => {
  it("is the box round the course with a margin", () => {
    expect(contentBox(doc(), [], 10)).toEqual({ x0: 10, z0: 10, x1: 510, z1: 330 });
  });
  it("is null for an empty design", () => {
    expect(contentBox(emptyDoc(), [], 10)).toBeNull();
  });
});
