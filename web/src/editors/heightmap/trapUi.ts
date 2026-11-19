import { useSyncExternalStore } from "react";
import { createStore } from "zustand/vanilla";
import type { Pt } from "../../core/geometry/coords";

/** What the Sand trap tool holds that is not the design: the bunker that was picked, as a point in it. */
type State = {
  anchor: Pt | null;
  set: (patch: Partial<Omit<State, "set">>) => void;
};

export const trapUi = createStore<State>((set) => ({ anchor: null, set: (patch) => set(patch) }));

export function useTrapUi<T>(select: (s: State) => T): T {
  return useSyncExternalStore(trapUi.subscribe, () => select(trapUi.getState()));
}
