import { describe, expect, it } from "vitest";
import type { Region } from "../core/api/api";
import { DEFAULT_FOREST } from "../model/design/forestDefaults";
import { designStore, emptyDoc } from "../model/design/store";
import { setForest, addPlacedTree } from "../model/design/forest";
import { Previewer, requestOf, sameSignature, signatureOf } from "./treePreview";

const ring: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const region = (id: string, cls: number, trees: Region["trees"] = null): Region => ({ id, class: cls, hole: null, outer: ring, inner: [], note: null, trees });
const doc = () => designStore.getState().doc;

function load() {
  const d = emptyDoc();
  d.regions = { w1: region("w1", 8), w2: region("w2", 8, { ...DEFAULT_FOREST, spacing: 3 }), f: region("f", 1) };
  d.order = ["w1", "w2", "f"];
  designStore.getState().reset(d);
}

describe("what a preview is asked", () => {
  it("is the tree edits, and the settings of the woods patches only", () => {
    load();
    const r = requestOf(doc());
    expect(Object.keys(r.settings)).toEqual(["w1", "w2"]);
    expect(r.settings.w1).toBeNull();
    expect(r.settings.w2?.spacing).toBe(3);
    expect(r.edits).toBe(doc().trees);
  });
});

describe("what decides the trees", () => {
  it("changes with a patch's settings, the defaults, a placed tree or a clearing", () => {
    load();
    const seen = [signatureOf(doc())];
    setForest("x", "w1", { spacing: 4 });
    seen.push(signatureOf(doc()));
    setForest("x", null, { spacing: 6 });
    seen.push(signatureOf(doc()));
    addPlacedTree("x", { x: 1, z: 1, height: 10, kind: 0 });
    seen.push(signatureOf(doc()));
    designStore.getState().commit("x", (d) => void d.trees.removed.push({ x: 2, z: 2, r: 4 }));
    seen.push(signatureOf(doc()));
    for (let i = 1; i < seen.length; i++) expect(sameSignature(seen[i - 1], seen[i]), `change ${i}`).toBe(false);
  });

  it("does not change with anything else in the design", () => {
    load();
    const before = signatureOf(doc());
    designStore.getState().commit("x", (d) => void (d.regions.f.hole = 3));
    designStore.getState().commit("x", (d) => void (d.layout.name = "Somewhere"));
    designStore.getState().commit("x", (d) => void (d.regions.w1.outer = [[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]));
    designStore.getState().select(["w1"]);
    expect(sameSignature(before, signatureOf(doc()))).toBe(true);
  });

  it("changes when a woods patch appears or goes", () => {
    load();
    const before = signatureOf(doc());
    designStore.getState().commit("x", (d) => void (d.regions.f.class = 8));
    expect(sameSignature(before, signatureOf(doc()))).toBe(false);
  });
});

/** A server that answers when told to. */
function server() {
  const asked: { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }[] = [];
  const shown: number[] = [];
  const failures: string[] = [];
  const previewer = new Previewer(
    () => new Promise((resolve, reject) => asked.push({ resolve, reject })),
    (b) => shown.push(b.byteLength),
    (e) => failures.push(e.message),
  );
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { previewer, asked, shown, failures, tick, answer: (n: number, i = 0) => asked[i].resolve(new ArrayBuffer(n)) };
}

describe("asking for previews as a slider is dragged", () => {
  it("asks the server and shows its answer", async () => {
    const s = server();
    s.previewer.ask();
    expect(s.asked).toHaveLength(1);
    s.answer(12);
    await s.tick();
    expect(s.shown).toEqual([12]);
    expect(s.previewer.working).toBe(false);
  });

  it("never has two in flight: asks made meanwhile become one, for the design as it is when the first is back", async () => {
    const s = server();
    s.previewer.ask();
    for (let i = 0; i < 20; i++) s.previewer.ask(); // the hand keeps moving
    expect(s.asked).toHaveLength(1);
    s.answer(24, 0);
    await s.tick();
    expect(s.asked).toHaveLength(2); // exactly one more, not twenty
    s.answer(36, 1);
    await s.tick();
    expect(s.shown).toEqual([24, 36]);
    expect(s.asked).toHaveLength(2);
    expect(s.previewer.working).toBe(false);
  });

  it("asks again after a quiet moment: it is not stuck", async () => {
    const s = server();
    s.previewer.ask();
    s.answer(1);
    await s.tick();
    s.previewer.ask();
    expect(s.asked).toHaveLength(2);
  });

  it("carries on after a failed one, and says it failed", async () => {
    const s = server();
    s.previewer.ask();
    s.asked[0].reject(new Error("422 spacing"));
    await s.tick();
    expect(s.failures).toEqual(["422 spacing"]);
    expect(s.previewer.working).toBe(false);
    s.previewer.ask();
    expect(s.asked).toHaveLength(2);
  });
});
