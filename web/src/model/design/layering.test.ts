import { describe, expect, it } from "vitest";
import type { Region } from "../../core/api/api";
import type { Pt } from "../../core/geometry/coords";
import { ringArea } from "../../core/geometry/geometry";
import { coveringRegions, visibleGeometry } from "./layering";

const rect = (x: number, z: number, w: number, h: number): Pt[] => [[x, z], [x + w, z], [x + w, z + h], [x, z + h], [x, z]];
const reg = (id: string, cls: number, outer: Pt[]): Region => ({ id, class: cls, hole: null, outer, inner: [], note: null });
const area = (g: Pt[][][]) => g.reduce((a, poly) => a + ringArea(poly[0]) - poly.slice(1).reduce((b, h) => b + ringArea(h), 0), 0);

describe("coveringRegions", () => {
  const fairway = reg("f", 1, rect(0, 0, 40, 40));
  const bunker = reg("b", 5, rect(10, 10, 10, 10));
  const far = reg("far", 5, rect(100, 100, 5, 5));
  const fairway2 = reg("f2", 1, rect(5, 5, 10, 10));

  it("only later regions of another surface that touch it", () => {
    expect(coveringRegions([fairway, bunker, far, fairway2], 0)).toEqual([bunker]);
    expect(coveringRegions([bunker, fairway], 0)).toEqual([fairway]);
    expect(coveringRegions([bunker, fairway], 1)).toEqual([]); // nothing is later than the last
  });
});

describe("visibleGeometry", () => {
  const fairway = reg("f", 1, rect(0, 0, 40, 40));

  it("is untouched when nothing covers it", () => {
    expect(visibleGeometry(fairway, [])).toBeUndefined();
  });

  it("cuts a hole where a region sits inside it", () => {
    const g = visibleGeometry(fairway, [reg("b", 5, rect(10, 10, 10, 10))])!;
    expect(g).toHaveLength(1);
    expect(g[0]).toHaveLength(2); // outer ring and one hole
    expect(area(g)).toBeCloseTo(1600 - 100);
  });

  it("bites a notch from the edge, and can split a region in two", () => {
    expect(area(visibleGeometry(fairway, [reg("c", 3, rect(30, 10, 20, 10))])!)).toBeCloseTo(1600 - 100);
    expect(visibleGeometry(fairway, [reg("path", 7, rect(-5, 15, 50, 10))])!).toHaveLength(2);
  });

  it("several regions cut together, and overlapping cutters are not subtracted twice", () => {
    const g = visibleGeometry(fairway, [reg("a", 5, rect(5, 5, 10, 10)), reg("b", 6, rect(10, 10, 10, 10))])!;
    expect(area(g)).toBeCloseTo(1600 - (100 + 100 - 25));
  });

  it("is null when wholly covered", () => {
    expect(visibleGeometry(fairway, [reg("w", 6, rect(-5, -5, 60, 60))])).toBeNull();
  });

  it("keeps a region's own holes", () => {
    const ring: Region = { ...fairway, inner: [rect(30, 30, 5, 5)] };
    expect(area(visibleGeometry(ring, [reg("b", 5, rect(5, 5, 5, 5))])!)).toBeCloseTo(1600 - 25 - 25);
  });
});
