import { beforeEach, describe, expect, it } from "vitest";
import openapi from "../../../openapi.json";
import type { Region } from "../../core/api/api";
import { testLook } from "../../terrain/look/look.fixture";
import { DEFAULT_FOREST, emptyTreeEdits } from "./forestDefaults";
import {
  addClearing, addPlacedTree, duplicateTreeKind, erase, forestOf, hasOwnForest, kindAfterMove, MAX_EDITS, moveTreeKind, patchAt, placedTreeAt, removePlacedTree,
  removeTreeKind, renameTreeKind, resetForest, setForest, touched, updatePlacedTree, woodsIds,
} from "./forest";
import { designStore, emptyDoc } from "./store";

const ring: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const region = (id: string, cls: number, trees: Region["trees"] = null): Region => ({ id, class: cls, hole: null, outer: ring, inner: [], note: null, trees });
const doc = () => designStore.getState().doc;

beforeEach(() => {
  const d = emptyDoc();
  d.look = structuredClone(testLook);
  d.regions = { w1: region("w1", 8), w2: region("w2", 8, { ...DEFAULT_FOREST, kinds: { pine: 0.5, fir: 1 } }), f: region("f", 1) };
  d.order = ["w1", "w2", "f"];
  designStore.getState().reset(d);
});

describe("the defaults the client holds", () => {
  it("are the server's, from the API schema", () => {
    const schema = (openapi as unknown as { components: { schemas: Record<string, { properties: Record<string, { default?: unknown }> }> } }).components.schemas["ForestSettings-Output"].properties;
    for (const [key, value] of Object.entries(DEFAULT_FOREST)) expect(schema[key].default, key).toEqual(value);
    expect(Object.keys(schema).sort()).toEqual(Object.keys(DEFAULT_FOREST).sort());
  });

  it("make an empty document with no edits", () => {
    expect(emptyTreeEdits()).toEqual({ defaults: DEFAULT_FOREST, added: [], removed: [] });
    expect(emptyTreeEdits().defaults).not.toBe(emptyTreeEdits().defaults);
  });
});

describe("forest settings", () => {
  it("find the woods patches, and the settings each is planted with", () => {
    expect(woodsIds(doc())).toEqual(["w1", "w2"]);
    expect(forestOf(doc(), "w1")).toBe(doc().trees.defaults);
    expect(forestOf(doc(), "w2").kinds).toEqual({ pine: 0.5, fir: 1 });
    expect([hasOwnForest(doc(), "w1"), hasOwnForest(doc(), "w2")]).toEqual([false, true]);
  });

  it("change the defaults, and so every patch without its own", () => {
    setForest("Spacing", null, { spacing: 8 });
    expect(forestOf(doc(), "w1").spacing).toBe(8);
    expect(forestOf(doc(), "w2").spacing).toBe(5);
  });

  it("give a patch its own, starting from the defaults as they are then, and keeping them when the defaults change", () => {
    setForest("Defaults", null, { spacing: 7, edgeThinning: 12 });
    setForest("Spacing", "w1", { spacing: 3 });
    expect(forestOf(doc(), "w1")).toEqual({ ...DEFAULT_FOREST, spacing: 3, edgeThinning: 12 });
    setForest("Defaults", null, { spacing: 9 });
    expect(forestOf(doc(), "w1").spacing).toBe(3);
  });

  it("can work a change out from what each patch has, so several patches keep their own values", () => {
    for (const id of ["w1", "w2"]) setForest("Weight", id, (s) => ({ kinds: { ...s.kinds, fir: 0.1 } }));
    expect(forestOf(doc(), "w1").kinds).toEqual({ fir: 0.1 });
    expect(forestOf(doc(), "w2").kinds).toEqual({ pine: 0.5, fir: 0.1 });
    setForest("Weight", null, (s) => ({ kinds: { ...s.kinds, pine: 0.4 } }));
    expect(doc().trees.defaults.kinds).toEqual({ pine: 0.4 });
  });

  it("put a patch back on the defaults", () => {
    resetForest("Reset", "w2");
    expect(hasOwnForest(doc(), "w2")).toBe(false);
  });

  it("do nothing for a region that is not woods or does not exist", () => {
    setForest("x", "f", { spacing: 3 });
    setForest("x", "nope", { spacing: 3 });
    expect(doc().regions.f.trees).toBeNull();
  });

  it("are one undo step each", () => {
    setForest("Spacing", "w1", { spacing: 3 });
    designStore.getState().undo();
    expect(hasOwnForest(doc(), "w1")).toBe(false);
    designStore.getState().redo();
    expect(forestOf(doc(), "w1").spacing).toBe(3);
  });

  it("a slider drag is one undo step", () => {
    const s = designStore.getState();
    s.begin("Spacing");
    for (const v of [4, 4.5, 5, 5.5, 6]) setForest("Spacing", "w1", { spacing: v });
    s.end();
    s.undo();
    expect(hasOwnForest(doc(), "w1")).toBe(false);
  });
});

describe("placed trees and clearings", () => {
  it("are added, changed and removed", () => {
    expect(addPlacedTree("Add tree", { x: 5, z: 6, height: 12, kind: 1 })).toBe(true);
    updatePlacedTree("Move tree", 0, { x: 9 });
    expect(doc().trees.added).toEqual([{ x: 9, z: 6, height: 12, kind: 1 }]);
    removePlacedTree("Delete tree", 0);
    expect(doc().trees.added).toEqual([]);
  });

  it("stop at the server's limit", () => {
    const d = doc();
    designStore.getState().reset({ ...d, trees: { ...d.trees, added: Array.from({ length: MAX_EDITS }, (_, i) => ({ x: i, z: 0, height: 5, kind: 0 })) } });
    expect(addPlacedTree("x", { x: 1, z: 1, height: 5, kind: 0 })).toBe(false);
  });

  it("clearings are not stamped twice on the same ground, as a brush stroke would", () => {
    expect(addClearing("Clear", { x: 10, z: 10, r: 8 })).toBe(true);
    expect(addClearing("Clear", { x: 11, z: 10, r: 8 })).toBe(false); // a stamp 1 m along: covered
    expect(addClearing("Clear", { x: 20, z: 10, r: 8 })).toBe(true);
    expect(addClearing("Clear", { x: 10, z: 10, r: 12 })).toBe(true); // a bigger one over the first is new
    expect(doc().trees.removed).toHaveLength(3);
  });

  it("the erase brush takes the placed trees under it and the clearings it touches, and nothing else", () => {
    addPlacedTree("a", { x: 10, z: 10, height: 10, kind: 0 });
    addPlacedTree("b", { x: 40, z: 10, height: 10, kind: 0 });
    addClearing("c", { x: 20, z: 10, r: 4 });
    addClearing("d", { x: 80, z: 80, r: 4 });
    expect(touched(doc(), 12, 10, 6)).toEqual({ trees: [0], clearings: [0] });
    expect(erase("Erase", 12, 10, 6)).toEqual({ trees: 1, clearings: 1 });
    expect(doc().trees.added.map((t) => t.x)).toEqual([40]);
    expect(doc().trees.removed.map((c) => c.x)).toEqual([80]);
    expect(erase("Erase", 500, 500, 5)).toEqual({ trees: 0, clearings: 0 });
  });

  it("erasing is one undo step", () => {
    addPlacedTree("a", { x: 10, z: 10, height: 10, kind: 0 });
    addClearing("c", { x: 12, z: 10, r: 4 });
    erase("Erase", 11, 10, 3);
    designStore.getState().undo();
    expect([doc().trees.added.length, doc().trees.removed.length]).toEqual([1, 1]);
  });
});

describe("tree kinds, which the document refers to by name and by index", () => {
  const names = () => doc().look!.trees.kinds.map((k) => k.name);

  it("renaming carries the weights, in the defaults and in every patch, in one undo step", () => {
    setForest("Defaults", null, { kinds: { pine: 0.25 } });
    expect(renameTreeKind(0, "loblolly")).toBe("ok");
    expect(names()).toEqual(["loblolly", "broadleaf", "fir"]);
    expect(doc().trees.defaults.kinds).toEqual({ loblolly: 0.25 });
    expect(doc().regions.w2.trees!.kinds).toEqual({ loblolly: 0.5, fir: 1 });
    designStore.getState().undo();
    expect(names()[0]).toBe("pine");
    expect(doc().trees.defaults.kinds).toEqual({ pine: 0.25 });
    expect(doc().regions.w2.trees!.kinds).toEqual({ pine: 0.5, fir: 1 });
  });

  it("refuses a blank name and a name another kind has, and changes nothing", () => {
    const before = doc();
    expect(renameTreeKind(0, "  ")).toBe("blank");
    expect(renameTreeKind(0, "fir")).toBe("taken");
    expect(doc()).toBe(before);
    expect(renameTreeKind(0, "pine")).toBe("ok"); // its own name is not taken
    expect(doc()).toBe(before);
  });

  it("typing a name a letter at a time keeps the weight with it", () => {
    for (const n of ["pin", "pi", "pit", "pitch"]) renameTreeKind(0, n);
    expect(names()[0]).toBe("pitch");
    expect(doc().regions.w2.trees!.kinds).toEqual({ pitch: 0.5, fir: 1 });
  });

  it("a copy gets its own name and the placed trees after it keep their model", () => {
    addPlacedTree("a", { x: 1, z: 1, height: 10, kind: 0 });
    addPlacedTree("b", { x: 2, z: 2, height: 10, kind: 1 });
    addPlacedTree("c", { x: 3, z: 3, height: 10, kind: 2 });
    expect(duplicateTreeKind(0)).toBe(1);
    expect(names()).toEqual(["pine", "pine copy", "broadleaf", "fir"]);
    expect(doc().trees.added.map((t) => t.kind)).toEqual([0, 2, 3]); // broadleaf and fir moved up; pine stayed
    expect(duplicateTreeKind(0)).toBe(1);
    expect(names()).toEqual(["pine", "pine copy 2", "pine copy", "broadleaf", "fir"]); // "pine copy" was taken, so the next is numbered
    expect(duplicateTreeKind(0)).toBe(1);
    expect(new Set(names()).size).toBe(names().length);
  });

  it("removing a kind drops its weights and moves the placed trees", () => {
    addPlacedTree("a", { x: 1, z: 1, height: 10, kind: 0 });
    addPlacedTree("b", { x: 2, z: 2, height: 10, kind: 1 });
    addPlacedTree("c", { x: 3, z: 3, height: 10, kind: 2 });
    expect(removeTreeKind(1)).toBe(true);
    expect(names()).toEqual(["pine", "fir"]);
    expect(doc().trees.added.map((t) => t.kind)).toEqual([0, 0, 1]); // broadleaf's tree takes the first model; fir moved down
    setForest("w", null, { kinds: { fir: 1 } });
    expect(removeTreeKind(1)).toBe(true);
    expect(doc().trees.defaults.kinds).toEqual({});
    expect(removeTreeKind(0)).toBe(false); // the last one stays
    designStore.getState().undo();
    designStore.getState().undo();
    expect(names()).toEqual(["pine", "fir"]);
    expect(doc().trees.added.map((t) => t.kind)).toEqual([0, 0, 1]);
  });

  it("moving a kind keeps each placed tree on its own model", () => {
    for (let k = 0; k < 3; k++) addPlacedTree("t", { x: k, z: 0, height: 10, kind: k });
    expect(moveTreeKind(0, 2)).toBe(true);
    expect(names()).toEqual(["broadleaf", "fir", "pine"]);
    expect(doc().trees.added.map((t) => names()[t.kind])).toEqual(["pine", "broadleaf", "fir"]); // each tree is still its own model
    expect(moveTreeKind(1, 1)).toBe(false);
  });

  it("kindAfterMove is a permutation in every direction", () => {
    for (const [from, to] of [[0, 2], [2, 0], [1, 3], [3, 1], [1, 2], [2, 1]]) {
      const after = [0, 1, 2, 3].map((k) => kindAfterMove(k, from, to));
      expect([...after].sort()).toEqual([0, 1, 2, 3]);
      expect(after[from]).toBe(to);
    }
  });
});

describe("finding things at a point", () => {
  const big = (x: number, z: number, w: number): [number, number][] => [[x, z], [x + w, z], [x + w, z + w], [x, z + w], [x, z]];

  it("the woods patch there, or none", () => {
    const d = emptyDoc();
    d.regions = { w1: { ...region("w1", 8), outer: big(0, 0, 100) }, f: { ...region("f", 1), outer: big(40, 40, 20) }, w2: { ...region("w2", 8), outer: big(50, 50, 20) } };
    d.order = ["w1", "f", "w2"];
    designStore.getState().reset(d);
    expect(patchAt(doc(), [10, 10])).toBe("w1");
    expect(patchAt(doc(), [45, 45])).toBeNull(); // a fairway painted over the woods
    expect(patchAt(doc(), [55, 55])).toBe("w2"); // and woods painted over the fairway
    expect(patchAt(doc(), [200, 200])).toBeNull();
  });

  it("the placed tree nearest a point within reach", () => {
    addPlacedTree("a", { x: 10, z: 10, height: 10, kind: 0 });
    addPlacedTree("b", { x: 12, z: 10, height: 10, kind: 0 });
    expect(placedTreeAt(doc(), [11.5, 10], 3)).toBe(1);
    expect(placedTreeAt(doc(), [10.2, 10], 3)).toBe(0);
    expect(placedTreeAt(doc(), [30, 30], 3)).toBeNull();
  });
});
