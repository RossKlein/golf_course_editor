import { useMemo, useSyncExternalStore } from "react";
import { makeFormatter, type Formatter, type Units } from "../core/units/units";

// A per-user display preference, kept in this browser. (When an app-level workspace file exists it can move there.)
const KEY = "course-maker.units";
const DEFAULT: Units = "us";

function read(): Units {
  try {
    const v = localStorage.getItem(KEY);
    return v === "us" || v === "metric" ? v : DEFAULT;
  } catch {
    return DEFAULT; // storage can be blocked; the preference then lasts until reload
  }
}

let current: Units = read();
const listeners = new Set<() => void>();

export function setUnits(units: Units) {
  if (units === current) return;
  current = units;
  try {
    localStorage.setItem(KEY, units);
  } catch {
    // not persisted, still applied
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useUnits = (): Units => useSyncExternalStore(subscribe, () => current);

export function useFormatter(): Formatter {
  const units = useUnits();
  return useMemo(() => makeFormatter(units), [units]);
}
