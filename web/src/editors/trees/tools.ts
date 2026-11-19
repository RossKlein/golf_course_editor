import type { TreeKind } from "../../core/api/api";
import type { Pt } from "../../core/geometry/coords";
import { addClearing, addPlacedTree, erase, forestOf, MAX_EDITS, patchAt, placedTreeAt } from "../../model/design/forest";
import { designStore } from "../../model/design/store";
import type { GroundTool } from "../../scene/groundTool";
import { treesUi } from "./treesUi";

// The four tools of the Trees editor. Each is a GroundTool, so the same code works on the map (which feeds it the pointer) and in 3D
// (where the view finds the ground under the pointer), as the Heightmap brush does.

export const TREE_TOOLS = [
  { id: "select", label: "Select", key: "s", hint: "Click a woods patch to set how it is planted, or a placed tree to change it" },
  { id: "add", label: "Add tree", key: "a", hint: "Click to plant a tree. It is a plain tree, and the forest keeps clear of its crown" },
  { id: "remove", label: "Clear", key: "r", hint: "Brush a clearing where the forest plants no trees. Placed trees stay" },
  { id: "erase", label: "Erase", key: "e", hint: "Brush away placed trees and hand-drawn clearings" },
] as const;
export type TreeToolId = (typeof TREE_TOOLS)[number]["id"];
export const isTreeTool = (id: string): id is TreeToolId => TREE_TOOLS.some((t) => t.id === id);

/** Calls back once a frame. Standing in for the browser's here lets a test run frames by hand. */
export type Frames = { request(callback: () => void): number; cancel(id: number): void };
const BROWSER: Frames = { request: (cb) => requestAnimationFrame(cb), cancel: (id) => cancelAnimationFrame(id) };

export type ToolEnv = {
  /** The brush's radius in metres, read whenever it is needed. */
  radius: () => number;
  /** The look's tree kinds, for a new tree's model and height. */
  kinds: () => readonly TreeKind[];
  say: (text: string) => void;
  /** The design changed in a way the build should pick up now: a click, or the end of a stroke. */
  changed: () => void;
  random?: () => number;
  frames?: Frames;
};

/** The point at which a tree is a metre or two wide: the ring drawn for the tools that click. */
const CLICK_RING = { select: 1, add: 2 };

/** Pick an index by weight from a number in [0, 1). All weights zero is an even pick. */
export function pickWeighted(weights: readonly number[], u: number): number {
  const total = weights.reduce((a, w) => a + w, 0);
  if (!(total > 0)) return Math.min(weights.length - 1, Math.floor(u * weights.length));
  let at = u * total;
  for (let i = 0; i < weights.length; i++) {
    at -= weights[i];
    if (at < 0) return i;
  }
  return weights.length - 1;
}

/** Metres between the stamps of a brush stroke: it lays down circles often enough to be a line. */
const spacingOf = (radius: number) => Math.max(1, radius * 0.5);

function along(from: Pt | null, to: Pt, spacing: number): Pt[] {
  if (!from) return [to];
  const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / spacing));
  return Array.from({ length: n }, (_, i) => [from[0] + ((to[0] - from[0]) * (i + 1)) / n, from[1] + ((to[1] - from[1]) * (i + 1)) / n] as Pt);
}

/** One brush stroke: stamps at the pointer every frame, and the whole stroke is one undo step. */
class Stroke {
  private where: (() => Pt | null) | null = null;
  private last: Pt | null = null;
  private frame = 0;

  constructor(private readonly label: string, private readonly stamp: (p: Pt) => void, private readonly env: ToolEnv) {}

  begin(where: () => Pt | null) {
    this.end();
    designStore.getState().begin(this.label);
    this.where = where;
    this.last = null;
    this.tick();
  }

  end() {
    if (!this.where) return;
    this.where = null;
    (this.env.frames ?? BROWSER).cancel(this.frame);
    designStore.getState().end();
    this.env.changed();
  }

  private tick = () => {
    if (!this.where) return;
    this.frame = (this.env.frames ?? BROWSER).request(this.tick);
    const here = this.where();
    if (!here) return;
    for (const p of along(this.last, here, spacingOf(this.env.radius()))) this.stamp(p);
    this.last = here;
  };
}

/** A new tree's height: the model's typical height, a little varied, unless the editor says how tall. */
export function heightOf(kind: TreeKind | undefined, chosen: number | null, u: number): number {
  if (chosen !== null) return chosen;
  const [low, high] = kind?.height ?? [10, 18];
  return +(((low + high) / 2) * (0.85 + 0.3 * u)).toFixed(1);
}

export function makeTreeTool(id: TreeToolId, env: ToolEnv): GroundTool {
  const random = env.random ?? Math.random;
  const none = { shift() {}, end() {} };

  if (id === "select") {
    return {
      ...none,
      ring: { radius: CLICK_RING.select, hardness: 1 },
      begin(where) {
        const p = where();
        if (!p) return;
        const doc = designStore.getState().doc;
        const tree = placedTreeAt(doc, p, 2);
        treesUi.getState().set({ selectedTree: tree });
        designStore.getState().select(tree !== null ? [] : ((patch) => (patch ? [patch] : []))(patchAt(doc, p)));
      },
    };
  }

  if (id === "add") {
    return {
      ...none,
      ring: { radius: CLICK_RING.add, hardness: 1 },
      begin(where) {
        const p = where();
        if (!p) return;
        const doc = designStore.getState().doc;
        const kinds = env.kinds();
        if (!kinds.length) return env.say("There are no tree models yet: add one in the Look editor.");
        const ui = treesUi.getState();
        const settings = forestOf(doc, patchAt(doc, p) ?? "");
        const kind = ui.addKind === "mix" ? pickWeighted(kinds.map((k) => settings.kinds[k.name] ?? 1), random()) : Math.min(ui.addKind, kinds.length - 1);
        if (!addPlacedTree("Plant a tree", { x: +p[0].toFixed(2), z: +p[1].toFixed(2), height: heightOf(kinds[kind], ui.addHeight, random()), kind })) {
          return env.say(`That is the most trees you can place by hand (${MAX_EDITS.toLocaleString()}).`);
        }
        treesUi.getState().set({ selectedTree: designStore.getState().doc.trees.added.length - 1 });
        env.changed();
      },
    };
  }

  const stroke = new Stroke(
    id === "remove" ? "Clear trees" : "Erase",
    id === "remove"
      ? (p) => void addClearing("Clear trees", { x: +p[0].toFixed(2), z: +p[1].toFixed(2), r: +env.radius().toFixed(1) })
      : (p) => {
          const gone = erase("Erase", p[0], p[1], env.radius());
          if (gone.trees) treesUi.getState().set({ selectedTree: null });
        },
    env,
  );
  return {
    get ring() {
      return { radius: env.radius(), hardness: 1 };
    },
    begin: (where) => stroke.begin(where),
    shift() {},
    end: () => stroke.end(),
  };
}
