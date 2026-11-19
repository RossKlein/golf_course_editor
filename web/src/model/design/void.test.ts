import { beforeEach, describe, expect, it } from "vitest";
import type { Pt } from "../../core/geometry/coords";
import { ringArea } from "../../core/geometry/geometry";
import { designStore, emptyDoc, regionList } from "./store";
import { cutHole, makeIsland, VOID_CLASS } from "./void";

const box = (x0: number, z0: number, x1: number, z1: number): Pt[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
const map = { w: 200, h: 100 };
const voids = () => regionList(designStore.getState().doc).filter((r) => r.class === VOID_CLASS);
const area = (r: { outer: unknown; inner: unknown }) => ringArea(r.outer as Pt[]) - (r.inner as Pt[][]).reduce((a, h) => a + ringArea(h), 0);

beforeEach(() => designStore.getState().reset(emptyDoc()));

describe("cutHole", () => {
  it("adds a void region with the outline, belonging to no hole", () => {
    const id = cutHole(box(10, 10, 30, 30));
    const r = designStore.getState().doc.regions[id];
    expect(r).toMatchObject({ class: 255, hole: null, inner: [] });
    expect(r.outer).toEqual(box(10, 10, 30, 30));
  });
  it("is one undo step", () => {
    cutHole(box(10, 10, 30, 30));
    designStore.getState().undo();
    expect(voids()).toEqual([]);
  });
});

describe("makeIsland", () => {
  it("makes the rest of the map void: one region with the island as a hole in it", () => {
    expect(makeIsland(box(50, 20, 150, 80), map)).toBe(1);
    const [sea] = voids();
    expect(sea.inner).toHaveLength(1);
    expect(area(sea)).toBeCloseTo(202 * 102 - 100 * 60, 3);
  });
  it("leaves land that reaches the edge as a sea in pieces, and still all of it", () => {
    expect(makeIsland(box(-20, 40, 220, 60), map)).toBe(2); // a strip right across the map splits the sea in two
    expect(voids().reduce((a, r) => a + area(r), 0)).toBeCloseTo(202 * 102 - 202 * 20, 3); // the frame is a metre past the map each way
  });
  it("is a single undo step however many regions it made", () => {
    makeIsland(box(-20, 40, 220, 60), map);
    expect(designStore.getState().past).toHaveLength(1);
    designStore.getState().undo();
    expect(voids()).toEqual([]);
  });
  it("does nothing for an outline off the map or one that covers all of it", () => {
    expect(makeIsland(box(500, 500, 600, 600), map)).toBe(0);
    expect(makeIsland(box(-10, -10, 300, 300), map)).toBe(0);
    expect(voids()).toEqual([]);
    expect(designStore.getState().past).toEqual([]);
  });
});
