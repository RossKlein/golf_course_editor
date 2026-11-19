import { beforeEach, describe, expect, it } from "vitest";
import type { Pt } from "../../core/geometry/coords";
import { addPath } from "./path";
import { MIN_PATH_WIDTH, pathWidthOf, selectedPaths, startWidthSession } from "./pathWidth";
import { addRegion, designStore, emptyDoc } from "./store";

const doc = () => designStore.getState().doc;
const line: Pt[] = [[0, 0], [60, 5], [120, 0], [180, 12]];

beforeEach(() => designStore.getState().reset(emptyDoc()));

describe("path width", () => {
  it("reads the width a path was made at, from its outline", () => {
    const [id] = addPath("Draw path", line, 3, 0.1);
    expect(pathWidthOf(id)).toBeGreaterThan(2.85);
    expect(pathWidthOf(id)).toBeLessThan(3.05);
  });

  it("selects only paths", () => {
    const [p] = addPath("Draw path", line, 3, 0.1);
    const f = addRegion("f", { class: 1, hole: 1, outer: [[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]], inner: [] });
    designStore.getState().select([p, f]);
    expect(selectedPaths()).toEqual([p]);
  });

  it("narrows and widens, from the start every time, as one undo step", () => {
    const [id] = addPath("Draw path", line, 4, 0.1);
    designStore.getState().select([id]);
    const before = doc().regions[id].outer;
    const undoDepth = designStore.getState().past.length;
    const s = startWidthSession([id])!;
    const w0 = s.start;
    s.set(w0 - 2);
    expect(pathWidthOf(id)).toBeGreaterThan(1.8);
    expect(pathWidthOf(id)).toBeLessThan(2.2);
    s.set(w0 + 3);
    expect(pathWidthOf(id)).toBeGreaterThan(6.8);
    expect(pathWidthOf(id)).toBeLessThan(7.2);
    s.set(w0 - 2); // back where it was: the same result as the first time, nothing has built up
    expect(pathWidthOf(id)).toBeGreaterThan(1.8);
    expect(pathWidthOf(id)).toBeLessThan(2.2);
    expect(s.end()).toBe(0);
    expect(designStore.getState().past).toHaveLength(undoDepth + 1);
    designStore.getState().undo();
    expect(doc().regions[id].outer).toEqual(before);
    expect(designStore.getState().selected).toEqual([id]);
  });

  it("returns exactly to the original shape when set back to the starting width", () => {
    const [id] = addPath("Draw path", line, 4, 0.1);
    const s = startWidthSession([id])!;
    s.set(s.start - 2);
    s.set(s.start);
    expect(pathWidthOf(id)).toBeCloseTo(s.start, 1);
    s.end();
  });

  it("never takes a path to nothing", () => {
    const [id] = addPath("Draw path", line, 3, 0.1);
    const s = startWidthSession([id])!;
    s.set(0);
    expect(pathWidthOf(id)).toBeGreaterThanOrEqual(MIN_PATH_WIDTH - 0.05);
    expect(doc().regions[id].outer.length).toBeGreaterThan(3);
    s.end();
  });

  it("moves several paths by the same amount", () => {
    const [a] = addPath("a", line, 3, 0.1);
    const [b] = addPath("b", line.map(([x, z]) => [x, z + 40] as Pt), 5, 0.1);
    const s = startWidthSession([a, b])!;
    s.set(s.start + 1);
    expect(pathWidthOf(a)).toBeGreaterThan(3.8);
    expect(pathWidthOf(b)).toBeGreaterThan(5.8);
    expect(pathWidthOf(b) - pathWidthOf(a)).toBeCloseTo(2, 0);
    s.end();
  });

  it("keeps the larger piece and says so when a shrink splits a path", () => {
    const dumbbell: Pt[] = [[0, 0], [20, 0], [20, 8], [30, 8], [30, 0], [50, 0], [50, 22], [30, 22], [30, 12], [20, 12], [20, 20], [0, 20], [0, 0]];
    const id = addRegion("p", { class: 7, hole: null, outer: dumbbell, inner: [] });
    const s = startWidthSession([id])!;
    s.set(s.start - 5);
    expect(s.end()).toBe(1);
    expect(doc().order).toEqual([id]);
  });

  it("does nothing without a path", () => {
    expect(startWidthSession([])).toBeNull();
    const f = addRegion("f", { class: 1, hole: 1, outer: [[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]], inner: [] });
    expect(startWidthSession([f])).toBeNull();
  });
});
