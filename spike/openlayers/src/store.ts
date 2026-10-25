import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";
import { createStore } from "zustand/vanilla";
import type { Pt } from "./geom";

enablePatches();

export type Region = { id: string; cls: number; hole?: number; outer: Pt[]; inner: Pt[][] };
export type Doc = { order: string[]; regions: Record<string, Region> };

type Entry = { label: string; patches: Patch[]; inverse: Patch[] };

type State = {
  doc: Doc;
  past: Entry[];
  future: Entry[];
  group: Entry | null;
  commit: (label: string, recipe: (draft: Doc) => void) => void;
  begin: (label: string) => void;
  end: () => void;
  undo: () => void;
  redo: () => void;
  reset: (doc: Doc) => void;
};

export const emptyDoc = (): Doc => ({ order: [], regions: {} });

/** Document with undo/redo built on Immer patches: each edit stores its patches and inverse patches. */
export const store = createStore<State>((set, get) => ({
  doc: emptyDoc(),
  past: [],
  future: [],
  group: null,

  commit(label, recipe) {
    const [doc, patches, inverse] = produceWithPatches(get().doc, recipe);
    if (!patches.length) return;
    const { group } = get();
    if (group) {
      // inside a group: one undo step. Inverses of later edits must be applied first.
      group.patches.push(...patches);
      group.inverse = [...inverse, ...group.inverse];
      set({ doc });
    } else {
      set((s) => ({ doc, past: [...s.past, { label, patches, inverse }], future: [] }));
    }
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
  },

  redo() {
    const { future, doc } = get();
    const entry = future[future.length - 1];
    if (!entry) return;
    set((s) => ({ doc: applyPatches(doc, entry.patches), future: s.future.slice(0, -1), past: [...s.past, entry] }));
  },

  reset: (doc) => set({ doc, past: [], future: [], group: null }),
}));

let nextId = 1;
export const newId = () => `r${nextId++}`;

export const addRegion = (label: string, region: Omit<Region, "id">) => {
  const id = newId();
  store.getState().commit(label, (d) => {
    d.regions[id] = { id, ...region };
    d.order.push(id);
  });
  return id;
};

export const updateRegion = (label: string, id: string, patch: Partial<Region>) =>
  store.getState().commit(label, (d) => {
    Object.assign(d.regions[id], patch);
  });

export const removeRegion = (label: string, id: string) =>
  store.getState().commit(label, (d) => {
    delete d.regions[id];
    d.order = d.order.filter((x) => x !== id);
  });
