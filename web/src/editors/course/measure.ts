import { useSyncExternalStore } from "react";
import type { Pt } from "../../core/geometry/coords";

/** Shorter than this is the same point twice, not a segment worth labelling. */
const MIN_SEGMENT_M = 0.05;

/** Straight-line length of a polyline, in the same units as the coordinates (metres on a course). */
export function pathLength(pts: readonly Pt[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return n;
}

/**
 * The polyline on screen. While the measurement is still open, the pointer is the last vertex, so the last leg follows
 * the cursor. A pointer sitting on the last click adds nothing.
 */
export function measurePoints(committed: readonly Pt[], cursor: Pt | null, open: boolean): Pt[] {
  if (!open || !cursor || !committed.length) return [...committed];
  const last = committed[committed.length - 1];
  if (Math.hypot(cursor[0] - last[0], cursor[1] - last[1]) < MIN_SEGMENT_M) return [...committed];
  return [...committed, cursor];
}

/** One label per segment, at its midpoint. A repeated point is not a segment. */
export function segments(pts: readonly Pt[]): { mid: Pt; metres: number }[] {
  const out: { mid: Pt; metres: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const metres = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (metres < MIN_SEGMENT_M) continue;
    out.push({ mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], metres });
  }
  return out;
}

/**
 * The distance to show beside the tool. One leg is just its length; more than one is the whole path, because each leg
 * is already labelled on the map. Empty until there is a segment. The pointer counts only while the measurement is open.
 */
export function measureReadout(committed: readonly Pt[], cursor: Pt | null, open: boolean, format: (metres: number) => string): string {
  const pts = measurePoints(committed, cursor, open);
  if (pts.length < 2) return "";
  const total = format(pathLength(pts));
  return pts.length === 2 ? total : `${total} total`;
}

// The bar reads this. The map updates it on every move; only this text re-renders, not the whole editor.
let label = "";
const listeners = new Set<() => void>();

export function setMeasureLabel(next: string) {
  if (next === label) return;
  label = next;
  listeners.forEach((l) => l());
}

export function useMeasureLabel(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => label,
  );
}
