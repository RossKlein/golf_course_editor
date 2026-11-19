import { useSyncExternalStore } from "react";
import { createStore } from "zustand/vanilla";

/** What the Trees editor holds that is not the design: how the next tree is made, what is shown, and which placed tree is selected. */
type State = {
  /** Which model a placed tree gets: one of the look's, by index, or "mix" for a random one weighted as the patch under it is planted. */
  addKind: number | "mix";
  /** Metres a placed tree is tall, or null for its model's typical height, a little varied. */
  addHeight: number | null;
  /** Draw the clearings (around placed trees and landmarks, and the ones drawn by hand). */
  showClearings: boolean;
  /** The selected placed tree, as an index into the design's `trees.added`. */
  selectedTree: number | null;
  set: (patch: Partial<Omit<State, "set">>) => void;
};

export const treesUi = createStore<State>((set) => ({
  addKind: "mix",
  addHeight: null,
  showClearings: true,
  selectedTree: null,
  set: (patch) => set(patch),
}));

export function useTreesUi<T>(select: (s: State) => T): T {
  return useSyncExternalStore(treesUi.subscribe, () => select(treesUi.getState()));
}
