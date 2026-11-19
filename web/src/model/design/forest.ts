import type { Clearing, ForestSettings, PlacedTree, Region } from "../../core/api/api";
import { pointInPolygon } from "../../core/geometry/geometry";
import type { Pt } from "../../core/geometry/coords";
import { duplicateKind, moveKind, removeKind } from "../look/trees";
import { designStore, type Doc } from "./store";

// The forest in the design: each woods patch's settings (on its region), the woods defaults, the trees placed by hand and the
// clearings drawn by hand. Every change is one undo step. docs/tree-editor-plan.md.

/** The surface class of woods, the only class with forest settings. */
export const WOODS = 8;
/** The most placed trees, and the most hand-drawn clearings (the server's limit). */
export const MAX_EDITS = 5000;

export const isWoods = (r: Region) => r.class === WOODS;
export const woodsIds = (doc: Doc) => doc.order.filter((id) => doc.regions[id]?.class === WOODS);
/** The settings a woods patch is planted with: its own, or the woods defaults. */
export const forestOf = (doc: Doc, regionId: string): ForestSettings => doc.regions[regionId]?.trees ?? doc.trees.defaults;
export const hasOwnForest = (doc: Doc, regionId: string) => !!doc.regions[regionId]?.trees;

/** The woods patch at a point: the last region painted there, if it is woods (as the build decides, a fairway painted over woods has none). */
export function patchAt(doc: Doc, p: Pt): string | null {
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const r = doc.regions[doc.order[i]];
    if (r && pointInPolygon(r.outer as Pt[], r.inner as Pt[][], p)) return r.class === WOODS ? r.id : null;
  }
  return null;
}

/** The placed tree nearest a point within `reach` metres, as its index, or null. */
export function placedTreeAt(doc: Doc, p: Pt, reach: number): number | null {
  let best: number | null = null, bestD = reach;
  doc.trees.added.forEach((t, i) => {
    const d = Math.hypot(t.x - p[0], t.z - p[1]);
    if (d <= bestD) [best, bestD] = [i, d];
  });
  return best;
}

const copy = (s: ForestSettings): ForestSettings => ({ ...s, kinds: { ...s.kinds } });

/**
 * Change forest settings: a woods patch's own (`regionId`), or the woods defaults (`null`). A patch that has none of its own starts from
 * a copy of the defaults, so from then on it keeps what it had when it was changed.
 */
export function setForest(label: string, regionId: string | null, patch: Partial<ForestSettings> | ((current: ForestSettings) => Partial<ForestSettings>)) {
  designStore.getState().commit(label, (d) => {
    const current = regionId === null ? d.trees.defaults : (d.regions[regionId]?.trees ?? copy(d.trees.defaults));
    const change = typeof patch === "function" ? patch(current) : patch;
    if (regionId === null) {
      Object.assign(d.trees.defaults, change);
      return;
    }
    const r = d.regions[regionId];
    if (!r || r.class !== WOODS) return;
    r.trees = { ...current, ...change };
  });
}

/** Put a patch back on the woods defaults. */
export function resetForest(label: string, regionId: string) {
  designStore.getState().commit(label, (d) => {
    if (d.regions[regionId]) d.regions[regionId].trees = null;
  });
}

export function addPlacedTree(label: string, tree: PlacedTree): boolean {
  if (designStore.getState().doc.trees.added.length >= MAX_EDITS) return false;
  designStore.getState().commit(label, (d) => void d.trees.added.push(tree));
  return true;
}

export function updatePlacedTree(label: string, index: number, patch: Partial<PlacedTree>) {
  designStore.getState().commit(label, (d) => {
    if (d.trees.added[index]) Object.assign(d.trees.added[index], patch);
  });
}

export function removePlacedTree(label: string, index: number) {
  designStore.getState().commit(label, (d) => void d.trees.added.splice(index, 1));
}

/** Add a hand-drawn clearing, unless one that covers the same ground is already there (a stroke stamps often). */
export function addClearing(label: string, c: Clearing): boolean {
  const { removed } = designStore.getState().doc.trees;
  if (removed.length >= MAX_EDITS || removed.some((o) => o.r >= c.r * 0.95 && Math.hypot(o.x - c.x, o.z - c.z) < 0.35 * c.r)) return false;
  designStore.getState().commit(label, (d) => void d.trees.removed.push(c));
  return true;
}

/** The placed trees and hand-drawn clearings a brush of radius `r` at (x, z) touches, by index. */
export function touched(doc: Doc, x: number, z: number, r: number) {
  return {
    trees: doc.trees.added.flatMap((t, i) => (Math.hypot(t.x - x, t.z - z) <= r ? [i] : [])),
    clearings: doc.trees.removed.flatMap((c, i) => (Math.hypot(c.x - x, c.z - z) <= r + c.r ? [i] : [])),
  };
}

/** Erase what a brush touches: placed trees and hand-drawn clearings. Returns how many of each went. */
export function erase(label: string, x: number, z: number, r: number): { trees: number; clearings: number } {
  const hit = touched(designStore.getState().doc, x, z, r);
  if (!hit.trees.length && !hit.clearings.length) return { trees: 0, clearings: 0 };
  designStore.getState().commit(label, (d) => {
    d.trees.added = d.trees.added.filter((_, i) => !hit.trees.includes(i));
    d.trees.removed = d.trees.removed.filter((_, i) => !hit.clearings.includes(i));
  });
  return { trees: hit.trees.length, clearings: hit.clearings.length };
}

// ---- the look's tree kinds, which this document refers to by name (weights) and by index (placed trees) ----------------------------

/** Where a placed tree's kind goes when kind `from` is moved to `to`. */
export function kindAfterMove(k: number, from: number, to: number): number {
  if (k === from) return to;
  if (from < to && k > from && k <= to) return k - 1;
  if (to < from && k >= to && k < from) return k + 1;
  return k;
}

const renameKey = (weights: Record<string, number>, from: string, to: string) => {
  if (from in weights) {
    weights[to] = weights[from];
    delete weights[from];
  }
};
const dropKey = (weights: Record<string, number>, name: string) => void delete weights[name];
const everyWeights = (d: Doc) => [d.trees.defaults.kinds, ...Object.values(d.regions).flatMap((r) => (r.trees ? [r.trees.kinds] : []))];

/**
 * Rename a tree kind in the look, carrying its weight in every patch and in the defaults to the new name, as one undo step. Refuses a
 * blank name or one another kind has (kinds are weighted by name, so names must differ).
 */
export function renameTreeKind(index: number, name: string): "ok" | "blank" | "taken" {
  const kinds = designStore.getState().doc.look?.trees.kinds;
  if (!kinds?.[index]) return "ok";
  if (!name.trim()) return "blank";
  if (kinds.some((k, i) => i !== index && k.name === name)) return "taken";
  const old = kinds[index].name;
  if (old === name) return "ok";
  designStore.getState().commit(`Rename ${old}`, (d) => {
    if (!d.look) return;
    d.look.trees.kinds[index].name = name;
    for (const w of everyWeights(d)) renameKey(w, old, name);
  });
  return "ok";
}

/** Add a copy of a tree kind after it. Placed trees whose kind comes after it move up one place so they keep their model. */
export function duplicateTreeKind(index: number): number | null {
  let made: number | null = null;
  designStore.getState().commit(`Copy ${designStore.getState().doc.look?.trees.kinds[index]?.name ?? "tree model"}`, (d) => {
    if (!d.look) return;
    made = duplicateKind(d.look, index);
    if (made === null) return;
    const kinds = d.look.trees.kinds;
    const taken = (name: string) => kinds.some((k, i) => i !== made && k.name === name); // names must differ: forests weight a model by its name
    const base = kinds[made].name;
    let name = base;
    for (let n = 2; taken(name); n++) name = `${base} ${n}`;
    kinds[made].name = name;
    for (const t of d.trees.added) if (t.kind >= made) t.kind += 1;
  });
  return made;
}

/** Remove a tree kind, and its weights. Placed trees of that kind take the first model; later kinds move down one place. */
export function removeTreeKind(index: number): boolean {
  const name = designStore.getState().doc.look?.trees.kinds[index]?.name;
  let done = false;
  designStore.getState().commit(`Remove ${name ?? "tree model"}`, (d) => {
    if (!d.look || !removeKind(d.look, index)) return;
    done = true;
    for (const w of everyWeights(d)) dropKey(w, name!);
    for (const t of d.trees.added) t.kind = t.kind === index ? 0 : t.kind > index ? t.kind - 1 : t.kind;
  });
  return done;
}

/** Move a tree kind, so the placed trees keep their model. */
export function moveTreeKind(from: number, to: number): boolean {
  let done = false;
  designStore.getState().commit("Move tree model", (d) => {
    if (!d.look || !moveKind(d.look, from, to)) return;
    done = true;
    for (const t of d.trees.added) t.kind = kindAfterMove(t.kind, from, to);
  });
  return done;
}
