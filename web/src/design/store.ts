import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";
import { useSyncExternalStore } from "react";
import { createStore } from "zustand/vanilla";
import type { DesignDoc, Layout, Region } from "../api/api";

enablePatches();

/** The document the editor edits: regions in painter's order, plus course metadata and holes. */
export type Doc = { order: string[]; regions: Record<string, Region>; layout: Layout };

type Entry = { label: string; patches: Patch[]; inverse: Patch[] };

type State = {
  doc: Doc;
  past: Entry[];
  future: Entry[];
  group: Entry | null;
  /** Selected region ids. UI state, not part of the document, so it is not undoable. */
  selected: string[];
  commit: (label: string, recipe: (draft: Doc) => void) => void;
  /** Everything committed until end() is one undo step. */
  begin: (label: string) => void;
  end: () => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  reset: (doc: Doc) => void;
};

export const emptyLayout = (): Layout => ({ name: null, attribution: null, holes: [] });
export const emptyDoc = (): Doc => ({ order: [], regions: {}, layout: emptyLayout() });

export function docFromApi(d: DesignDoc): Doc {
  const doc = emptyDoc();
  for (const r of d.regions.regions) {
    doc.order.push(r.id);
    doc.regions[r.id] = r;
  }
  doc.layout = d.layout;
  return doc;
}

export const regionList = (doc: Doc): Region[] => doc.order.map((id) => doc.regions[id]);

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
    set((s) => ({ doc: applyPatches(doc, entry.inverse), past: s.past.slice(0, -1), future: [...s.future, entry] }));
    prune();
  },

  redo() {
    const { future, doc } = get();
    const entry = future[future.length - 1];
    if (!entry) return;
    set((s) => ({ doc: applyPatches(doc, entry.patches), future: s.future.slice(0, -1), past: [...s.past, entry] }));
    prune();
  },

  select: (ids) => set({ selected: ids }),
  reset: (doc) => set({ doc, past: [], future: [], group: null, selected: [] }),
}));

/** Drop selected ids that no longer exist (after a delete or an undo). */
function prune() {
  const { selected, doc } = designStore.getState();
  const kept = selected.filter((id) => doc.regions[id]);
  if (kept.length !== selected.length) designStore.setState({ selected: kept });
}

export function useDesign<T>(select: (s: State) => T): T {
  return useSyncExternalStore(designStore.subscribe, () => select(designStore.getState()));
}

// ---- actions ------------------------------------------------------------------------------------------------------

export const newRegionId = () => {
  const taken = designStore.getState().doc.regions;
  let id: string;
  do id = `r-${Math.random().toString(36).slice(2, 8)}`;
  while (taken[id]);
  return id;
};

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

export const canUndo = () => designStore.getState().past.length > 0;
export const canRedo = () => designStore.getState().future.length > 0;
