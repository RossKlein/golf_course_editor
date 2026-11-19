import type { Pt } from "../../core/geometry/coords";
import { growRing, ringCoverage } from "../../core/geometry/pathShape";
import { designStore, newId } from "./store";

export const GREEN_CLASS = 2;
export const COLLAR_CLASS = 3;

/** How thick a collar is made, in metres, with the most and least the slider allows. */
export const COLLAR_THICKNESS = { min: 0.3, max: 5, step: 0.1, default: 1.5 } as const;

/** A green is left alone when this much of the ring around it is already collar. */
const ALREADY = 0.85;

export type CollarSummary = {
  /** Greens that now have a collar. */
  made: number;
  /** Greens skipped because a collar already surrounds them. */
  had: number;
};

/**
 * Give greens a collar, as one undo step: for each green, a Collar region that is the green's outline grown outward by `thickness` metres
 * (corners rounded), put directly under the green in painter's order. The green's own outline is the collar's inner edge exactly, and the
 * green covers the collar's middle, so there is no gap and nothing is cut out. Things painted above the green stay above its collar.
 * `ids` are the greens to do, or every green when none are given. A green that already has collar all round it is skipped, so pressing
 * again does not stack copies. The new collars are selected.
 */
export function addCollars(label: string, thickness: number, ids?: readonly string[]): CollarSummary {
  const doc = designStore.getState().doc;
  const greens = (ids ?? doc.order).filter((id) => doc.regions[id]?.class === GREEN_CLASS);
  const covers = doc.order.map((id) => doc.regions[id]).filter((r) => r.class === COLLAR_CLASS).map((r) => [r.outer as Pt[], r.inner as Pt[][]] as const);
  const summary: CollarSummary = { made: 0, had: 0 };
  const made: { under: string; shapes: ReturnType<typeof growRing> }[] = [];
  for (const id of greens) {
    const ring = doc.regions[id].outer as Pt[];
    if (ringCoverage(ring, thickness, covers) >= ALREADY) {
      summary.had++;
      continue;
    }
    const shapes = growRing(ring, thickness);
    if (shapes.length) made.push({ under: id, shapes });
  }
  summary.made = made.length;
  if (!made.length) return summary;

  const created: string[] = [];
  designStore.getState().commit(label, (d) => {
    for (const { under, shapes } of made) {
      const at = d.order.indexOf(under);
      shapes.forEach((s, n) => {
        const id = newId("r", d.regions);
        d.regions[id] = { id, class: COLLAR_CLASS, hole: null, outer: s.outer, inner: s.inner, note: null, trees: null };
        d.order.splice(at + n, 0, id); // directly under the green; the green moves up past it
        created.push(id);
      });
    }
  });
  designStore.getState().select(created);
  return summary;
}
