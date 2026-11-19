import type { Pt } from "../../core/geometry/coords";
import { pathShapes } from "../../core/geometry/pathShape";
import { designStore, newId } from "./store";

/** The Path surface. */
export const PATH_CLASS = 7;

/** The width a path is drawn at, in metres, and the most and least the slider allows. */
export const PATH_WIDTH = { min: 0.5, max: 16, step: 0.1, default: 2.5 } as const;

/**
 * Turn a line drawn along where a path goes into path regions, as one undo step: the line is smoothed (see `smoothLine`, thinned to
 * `tolerance` metres), grown to `width` metres across with round ends, and added on top of everything as a Path surface. A line that
 * loops over itself makes one region, so there is usually one id; they are selected. Returns none for a line with fewer than two points.
 */
export function addPath(label: string, points: readonly Pt[], width: number, tolerance: number): string[] {
  const shapes = pathShapes(points, width, tolerance);
  if (!shapes.length) return [];
  const ids: string[] = [];
  designStore.getState().commit(label, (d) => {
    for (const s of shapes) {
      const id = newId("r", d.regions);
      d.regions[id] = { id, class: PATH_CLASS, hole: null, outer: s.outer, inner: s.inner, note: null, trees: null };
      d.order.push(id);
      ids.push(id);
    }
  });
  designStore.getState().select(ids);
  return ids;
}
