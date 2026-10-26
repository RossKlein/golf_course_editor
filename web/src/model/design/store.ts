import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";
import { useSyncExternalStore } from "react";
import { createStore } from "zustand/vanilla";
import type { BoundsArea, DesignDoc, DesignHole, Layout, Region } from "../../core/api/api";
import { MAX_HOLES } from "./holes";

enablePatches();

/**
 * The document the editor edits: regions in painter's order, each hole's in-bounds areas (order does not matter: a hole's
 * ground is their union), plus course metadata and holes.
 */
export type Doc = { order: string[]; regions: Record<string, Region>; bounds: Record<string, BoundsArea>; layout: Layout };

/** One undo step: document patches, or (for edits that live outside the document, like sculpting) a pair of functions. */
type Entry = { label: string; patches: Patch[]; inverse: Patch[]; external?: { undo: () => void; redo: () => void } };

type State = {
  doc: Doc;
  past: Entry[];
  future: Entry[];
  group: Entry | null;
  /** Selected region or bounds area ids. UI state, not part of the document, so it is not undoable. */
  selected: string[];
  commit: (label: string, recipe: (draft: Doc) => void) => void;
  /** Add an undo step for an edit made outside the document. Its functions must undo and redo exactly that edit. */
  pushExternal: (label: string, external: { undo: () => void; redo: () => void }) => void;
  /** Everything committed until end() is one undo step. */
  begin: (label: string) => void;
  end: () => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  reset: (doc: Doc) => void;
};

export const emptyLayout = (): Layout => ({ name: null, attribution: null, holes: [] });
export const emptyDoc = (): Doc => ({ order: [], regions: {}, bounds: {}, layout: emptyLayout() });

export function docFromApi(d: DesignDoc): Doc {
  const doc = emptyDoc();
  for (const r of d.regions.regions) {
    doc.order.push(r.id);
    doc.regions[r.id] = r;
  }
  for (const a of d.bounds.areas) doc.bounds[a.id] = a;
  doc.layout = d.layout;
  return doc;
}

export const regionList = (doc: Doc): Region[] => doc.order.map((id) => doc.regions[id]);
export const boundsList = (doc: Doc): BoundsArea[] => Object.values(doc.bounds);

/** Document with undo/redo built on Immer patches: each edit stores its patches and the inverse patches. */
export const designStore = createStore<State>((set, get) => ({
  doc: emptyDoc(),
  past: [],
  future: [],
  group: null,
  selected: [],

  commit(label, recipe) {
    const [doc, patches, inverse] = produceWithPatches(get().doc, recipe);
    if (!patches.length) return;
    const { group } = get();
    if (group) {
      group.patches.push(...patches);
      group.inverse = [...inverse, ...group.inverse]; // later edits must be undone first
      set({ doc });
    } else {
      set((s) => ({ doc, past: [...s.past, { label, patches, inverse }], future: [] }));
    }
    prune();
  },

  pushExternal(label, external) {
    set((s) => ({ past: [...s.past, { label, patches: [], inverse: [], external }], future: [] }));
  },

  begin(label) {
    if (!get().group) set({ group: { label, patches: [], inverse: [] } });
  },

  end() {
    const { group } = get();
    if (!group) return;
    set((s) => (group.patches.length ? { group: null, past: [...s.past, group], future: [] } : { group: null }));
  },

  undo() {
    const { past, doc } = get();
    const entry = past[past.length - 1];
    if (!entry) return;
    entry.external?.undo();
    set((s) => ({ doc: entry.external ? doc : applyPatches(doc, entry.inverse), past: s.past.slice(0, -1), future: [...s.future, entry] }));
    prune();
  },

  redo() {
    const { future, doc } = get();
    const entry = future[future.length - 1];
    if (!entry) return;
    entry.external?.redo();
    set((s) => ({ doc: entry.external ? doc : applyPatches(doc, entry.patches), future: s.future.slice(0, -1), past: [...s.past, entry] }));
    prune();
  },

  select: (ids) => set({ selected: ids }),
  reset: (doc) => set({ doc, past: [], future: [], group: null, selected: [] }),
}));

/** Drop selected ids that no longer exist (after a delete or an undo). */
function prune() {
  const { selected, doc } = designStore.getState();
  const kept = selected.filter((id) => doc.regions[id] || doc.bounds[id]);
  if (kept.length !== selected.length) designStore.setState({ selected: kept });
}

export function useDesign<T>(select: (s: State) => T): T {
  return useSyncExternalStore(designStore.subscribe, () => select(designStore.getState()));
}

// ---- actions ------------------------------------------------------------------------------------------------------

const newId = (prefix: string, taken: Record<string, unknown>) => {
  let id: string;
  do id = `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  while (taken[id]);
  return id;
};
export const newRegionId = () => newId("r", designStore.getState().doc.regions);

export function addRegion(label: string, region: Omit<Region, "id" | "note"> & { note?: string | null }): string {
  const id = newRegionId();
  designStore.getState().commit(label, (d) => {
    d.regions[id] = { note: null, ...region, id };
    d.order.push(id);
  });
  return id;
}

export const updateRegion = (label: string, id: string, patch: Partial<Region>) =>
  designStore.getState().commit(label, (d) => {
    if (d.regions[id]) Object.assign(d.regions[id], patch);
  });

export const removeRegions = (label: string, ids: string[]) =>
  designStore.getState().commit(label, (d) => {
    for (const id of ids) delete d.regions[id];
    d.order = d.order.filter((id) => !ids.includes(id));
  });

/** Move regions in the painter's order: later is drawn over earlier. */
export function reorderRegions(label: string, ids: string[], where: "front" | "back") {
  designStore.getState().commit(label, (d) => {
    const rest = d.order.filter((id) => !ids.includes(id));
    const moved = d.order.filter((id) => ids.includes(id));
    d.order = where === "front" ? [...rest, ...moved] : [...moved, ...rest];
  });
}

// ---- holes and course details ---------------------------------------------------------------------------------------

/** Holes are numbered 1..n with no gaps, so every hole up to `n` exists once `n` does. */
function fillHoles(d: Doc, n: number) {
  while (d.layout.holes.length < Math.min(n, MAX_HOLES)) d.layout.holes.push({ number: d.layout.holes.length + 1, par: 4, name: null, route: [] });
}

/** Add the next hole. Returns its number, or null at the limit. */
export function addHole(): number | null {
  let n: number | null = null;
  designStore.getState().commit("Add hole", (d) => {
    if (d.layout.holes.length >= MAX_HOLES) return;
    fillHoles(d, d.layout.holes.length + 1);
    n = d.layout.holes.length;
  });
  return n;
}

/** Remove a hole. Later holes move down a number, surfaces that belonged to it become unassigned and its bounds are removed. */
export const removeHole = (n: number) =>
  designStore.getState().commit(`Remove hole ${n}`, (d) => {
    if (!d.layout.holes.some((h) => h.number === n)) return;
    d.layout.holes = d.layout.holes.filter((h) => h.number !== n);
    d.layout.holes.forEach((h, i) => (h.number = i + 1));
    for (const r of Object.values(d.regions)) {
      if (r.hole === n) r.hole = null;
      else if (r.hole != null && r.hole > n) r.hole -= 1;
    }
    for (const a of Object.values(d.bounds)) {
      if (a.hole === n) delete d.bounds[a.id]; // its bounds go with it; they mean nothing for another hole
      else if (a.hole > n) a.hole -= 1;
    }
  });

export const updateHole = (n: number, patch: Partial<Pick<DesignHole, "par" | "name">>) =>
  designStore.getState().commit(`Edit hole ${n}`, (d) => {
    const h = d.layout.holes.find((x) => x.number === n);
    if (h) Object.assign(h, patch);
  });

/** Set a hole's route, creating the hole (and any before it) if it does not exist yet. */
export const setRoute = (n: number, route: [number, number][]) =>
  designStore.getState().commit(`Set route of hole ${n}`, (d) => {
    fillHoles(d, n);
    const h = d.layout.holes.find((x) => x.number === n);
    if (h) h.route = route;
  });

// ---- bounds ------------------------------------------------------------------------------------------------------

export function addBoundsArea(label: string, area: Omit<BoundsArea, "id">): string {
  const id = newId("b", designStore.getState().doc.bounds);
  designStore.getState().commit(label, (d) => void (d.bounds[id] = { ...area, id }));
  return id;
}

export const updateBoundsArea = (label: string, id: string, patch: Partial<BoundsArea>) =>
  designStore.getState().commit(label, (d) => void (d.bounds[id] && Object.assign(d.bounds[id], patch)));

export const removeBoundsAreas = (label: string, ids: string[]) =>
  designStore.getState().commit(label, (d) => void ids.forEach((id) => delete d.bounds[id]));

export const updateLayout = (label: string, patch: Partial<Pick<Layout, "name" | "attribution">>) =>
  designStore.getState().commit(label, (d) => void Object.assign(d.layout, patch));

/** Give surfaces their holes: `{ regionId: holeNumber }`, as one undo step. */
export const assignHoles = (assignment: Record<string, number>) =>
  designStore.getState().commit("Assign surfaces to holes", (d) => {
    for (const [id, hole] of Object.entries(assignment)) if (d.regions[id]) d.regions[id].hole = hole;
  });

export const canUndo = () => designStore.getState().past.length > 0;
export const canRedo = () => designStore.getState().future.length > 0;
