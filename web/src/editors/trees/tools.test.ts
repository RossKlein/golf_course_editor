import { beforeEach, describe, expect, it } from "vitest";
import type { Region } from "../../core/api/api";
import type { Pt } from "../../core/geometry/coords";
import { addPlacedTree, setForest } from "../../model/design/forest";
import { designStore, emptyDoc } from "../../model/design/store";
import { testLook } from "../../terrain/look/look.fixture";
import { heightOf, isTreeTool, makeTreeTool, pickWeighted, TREE_TOOLS, type Frames, type ToolEnv, type TreeToolId } from "./tools";
import { treesUi } from "./treesUi";

const KINDS = testLook.trees.kinds; // pine 14-24, broadleaf 9-15, fir 14-24
const big: [number, number][] = [[0, 0], [200, 0], [200, 200], [0, 200], [0, 0]];
const region = (id: string): Region => ({ id, class: 8, hole: null, outer: big, inner: [], note: null, trees: null });
const doc = () => designStore.getState().doc;

/** Frames run by hand. */
function frames() {
  let pending: (() => void) | null = null;
  const f: Frames = { request: (cb) => ((pending = cb), 1), cancel: () => void (pending = null) };
  return { f, run: () => { const cb = pending; pending = null; cb?.(); } };
}

function env(over: Partial<ToolEnv> = {}) {
  const fr = frames();
  const calls = { changed: 0, said: [] as string[] };
  const e: ToolEnv = { radius: () => 6, kinds: () => KINDS, say: (t) => calls.said.push(t), changed: () => calls.changed++, random: () => 0.5, frames: fr.f, ...over };
  return { e, calls, run: fr.run };
}

const at = (p: Pt | null) => () => p;

beforeEach(() => {
  const d = emptyDoc();
  d.look = structuredClone(testLook);
  d.regions = { w: region("w") };
  d.order = ["w"];
  designStore.getState().reset(d);
  treesUi.getState().set({ addKind: "mix", addHeight: null, selectedTree: null });
});

describe("the tools", () => {
  it("are four, each with a key", () => {
    expect(TREE_TOOLS.map((t) => t.id)).toEqual(["select", "add", "remove", "erase"]);
    expect(new Set(TREE_TOOLS.map((t) => t.key)).size).toBe(4);
    expect(isTreeTool("add")).toBe(true);
    expect(isTreeTool("raise")).toBe(false);
  });

  it("have a ring: the brush's size for the brushes, a small one for the clicks", () => {
    const { e } = env();
    expect(makeTreeTool("remove", e).ring.radius).toBe(6);
    expect(makeTreeTool("erase", e).ring.radius).toBe(6);
    expect(makeTreeTool("add", e).ring.radius).toBeLessThan(4);
    expect(makeTreeTool("select", e).ring.radius).toBeLessThan(4);
  });
});

describe("pickWeighted", () => {
  it("picks by weight", () => {
    expect([0, 0.2, 0.34, 0.99].map((u) => pickWeighted([1, 2], u))).toEqual([0, 0, 1, 1]);
    expect(pickWeighted([0, 1, 0], 0.5)).toBe(1);
  });
  it("picks evenly when every weight is zero", () => {
    expect([0, 0.4, 0.9].map((u) => pickWeighted([0, 0, 0], u))).toEqual([0, 1, 2]);
  });
});

describe("heightOf", () => {
  it("is the chosen height, or the middle of the model's range, a little varied", () => {
    expect(heightOf(KINDS[0], 22, 0.5)).toBe(22);
    expect(heightOf(KINDS[0], null, 0.5)).toBe(19);
    expect(heightOf(KINDS[0], null, 0)).toBeCloseTo(19 * 0.85, 1);
    expect(heightOf(KINDS[0], null, 1)).toBeCloseTo(19 * 1.15, 1);
    expect(heightOf(undefined, null, 0.5)).toBeGreaterThan(0);
  });
});

describe("Add tree", () => {
  it("plants a tree where you click, selects it and asks for a build", () => {
    const { e, calls } = env();
    makeTreeTool("add", e).begin(at([50.123, 60.456]), false);
    expect(doc().trees.added).toHaveLength(1);
    expect(doc().trees.added[0]).toMatchObject({ x: 50.12, z: 60.46 });
    expect(treesUi.getState().selectedTree).toBe(0);
    expect(calls.changed).toBe(1);
  });

  it("does nothing when the pointer is off the ground", () => {
    makeTreeTool("add", env().e).begin(at(null), false);
    expect(doc().trees.added).toEqual([]);
  });

  it("plants the model chosen, at the height chosen", () => {
    treesUi.getState().set({ addKind: 1, addHeight: 12 });
    makeTreeTool("add", env().e).begin(at([5, 5]), false);
    expect(doc().trees.added[0]).toMatchObject({ kind: 1, height: 12 });
  });

  it("from the mix, follows the weights of the patch it is planted in", () => {
    setForest("w", "w", { kinds: { pine: 0, broadleaf: 1, fir: 0 } });
    for (const u of [0.1, 0.5, 0.9]) makeTreeTool("add", env({ random: () => u }).e).begin(at([5, 5]), false);
    expect(doc().trees.added.map((t) => t.kind)).toEqual([1, 1, 1]);
  });

  it("from the mix, uses the woods defaults outside any patch", () => {
    setForest("d", null, { kinds: { pine: 0, broadleaf: 0, fir: 1 } });
    makeTreeTool("add", env().e).begin(at([500, 500]), false);
    expect(doc().trees.added[0].kind).toBe(2);
  });

  it("is one undo step each", () => {
    makeTreeTool("add", env().e).begin(at([5, 5]), false);
    designStore.getState().undo();
    expect(doc().trees.added).toEqual([]);
  });

  it("says so at the limit", () => {
    const d = doc();
    designStore.getState().reset({ ...d, trees: { ...d.trees, added: Array.from({ length: 5000 }, (_, i) => ({ x: i, z: 0, height: 5, kind: 0 })) } });
    const { e, calls } = env();
    makeTreeTool("add", e).begin(at([5, 5]), false);
    expect(doc().trees.added).toHaveLength(5000);
    expect(calls.said[0]).toMatch(/most trees/);
  });

  it("says so when there are no tree models", () => {
    const { e, calls } = env({ kinds: () => [] });
    makeTreeTool("add", e).begin(at([5, 5]), false);
    expect(calls.said[0]).toMatch(/no tree models/);
  });
});

describe("Select", () => {
  it("selects the woods patch under a click", () => {
    makeTreeTool("select", env().e).begin(at([50, 50]), false);
    expect(designStore.getState().selected).toEqual(["w"]);
    expect(treesUi.getState().selectedTree).toBeNull();
  });

  it("selects a placed tree near the click instead of the patch", () => {
    addPlacedTree("a", { x: 50, z: 50, height: 10, kind: 0 });
    makeTreeTool("select", env().e).begin(at([51, 50.5]), false);
    expect(treesUi.getState().selectedTree).toBe(0);
    expect(designStore.getState().selected).toEqual([]);
  });

  it("selects nothing on open ground", () => {
    designStore.getState().select(["w"]);
    makeTreeTool("select", env().e).begin(at([900, 900]), false);
    expect(designStore.getState().selected).toEqual([]);
  });
});

describe("Clear", () => {
  it("stamps clearings along the stroke, as one undo step, and asks for a build when it ends", () => {
    const { e, calls, run } = env();
    const tool = makeTreeTool("remove", e);
    let p: Pt = [10, 10];
    tool.begin(() => p, false);
    for (const x of [20, 40, 60]) {
      p = [x, 10];
      run();
    }
    tool.end();
    expect(doc().trees.removed.length).toBeGreaterThan(5);
    expect(doc().trees.removed.every((c) => c.r === 6 && c.z === 10)).toBe(true);
    expect(calls.changed).toBe(1);
    designStore.getState().undo();
    expect(doc().trees.removed).toEqual([]);
  });

  it("holding still does not pile up circles", () => {
    const { e, run } = env();
    const tool = makeTreeTool("remove", e);
    tool.begin(at([30, 30]), false);
    for (let i = 0; i < 20; i++) run();
    tool.end();
    expect(doc().trees.removed).toHaveLength(1);
  });

  it("takes the brush size as it is when each stamp is made", () => {
    let r = 4;
    const { e, run } = env({ radius: () => r });
    const tool = makeTreeTool("remove", e);
    let x = 10;
    tool.begin(() => [x, 10], false);
    r = 12;
    x = 80;
    run();
    tool.end();
    expect(new Set(doc().trees.removed.map((c) => c.r))).toEqual(new Set([4, 12]));
  });

  it("leaves placed trees alone", () => {
    addPlacedTree("a", { x: 30, z: 30, height: 10, kind: 0 });
    const tool = makeTreeTool("remove", env().e);
    tool.begin(at([30, 30]), false);
    tool.end();
    expect(doc().trees.added).toHaveLength(1);
  });
});

describe("Erase", () => {
  it("takes placed trees and hand-drawn clearings under the brush, in one undo step", () => {
    addPlacedTree("a", { x: 30, z: 30, height: 10, kind: 0 });
    addPlacedTree("b", { x: 150, z: 150, height: 10, kind: 0 });
    designStore.getState().commit("c", (d) => void d.trees.removed.push({ x: 33, z: 30, r: 4 }, { x: 120, z: 120, r: 4 }));
    const { e, calls } = env();
    const tool = makeTreeTool("erase", e);
    tool.begin(at([31, 30]), false);
    tool.end();
    expect(doc().trees.added.map((t) => t.x)).toEqual([150]);
    expect(doc().trees.removed.map((c) => c.x)).toEqual([120]);
    expect(calls.changed).toBe(1);
    designStore.getState().undo();
    expect([doc().trees.added.length, doc().trees.removed.length]).toEqual([2, 2]);
  });

  it("forgets a selected tree that was erased", () => {
    addPlacedTree("a", { x: 30, z: 30, height: 10, kind: 0 });
    treesUi.getState().set({ selectedTree: 0 });
    const tool = makeTreeTool("erase", env().e);
    tool.begin(at([30, 30]), false);
    tool.end();
    expect(treesUi.getState().selectedTree).toBeNull();
  });

  it("every tool can be made", () => {
    for (const t of TREE_TOOLS) expect(() => makeTreeTool(t.id as TreeToolId, env().e)).not.toThrow();
  });
});
