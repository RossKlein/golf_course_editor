import type { Pt } from "../../core/geometry/coords";
import { roundRing, selfIntersects } from "../../core/geometry/geometry";
import { designStore } from "./store";

export type RoundSummary = {
  /** Regions that got more points. */
  rounded: number;
  /** Points added, over every outline and hole. */
  added: number;
  /** Regions left alone because the curve through their corners would have crossed itself. */
  crossed: number;
  /** Regions left alone because every edge was already too short to add a point to. */
  fine: number;
};

/**
 * Round the outlines of regions, as one undo step: a point is added on the smooth curve between every pair of neighbouring corners, in the
 * outer outline and in each hole (see `roundRing`). The corners stay where they are. A region whose curve would cross itself, or cross its
 * own hole's, is left exactly as it was. Press again for more points.
 */
export function roundRegions(label: string, ids: readonly string[]): RoundSummary {
  const doc = designStore.getState().doc;
  const summary: RoundSummary = { rounded: 0, added: 0, crossed: 0, fine: 0 };
  const changes: { id: string; outer: Pt[]; inner: Pt[][] }[] = [];
  for (const id of ids) {
    const r = doc.regions[id];
    if (!r) continue;
    const rings = [r.outer as Pt[], ...(r.inner as Pt[][])];
    const rounded = rings.map((ring) => roundRing(ring));
    if (rounded.every((ring) => !ring)) {
      summary.fine++;
      continue;
    }
    const next = rounded.map((ring, i) => ring ?? rings[i]);
    if (next.some((ring) => selfIntersects(ring))) {
      summary.crossed++;
      continue;
    }
    summary.rounded++;
    summary.added += next.reduce((n, ring, i) => n + ring.length - rings[i].length, 0);
    changes.push({ id, outer: next[0], inner: next.slice(1) });
  }
  if (!changes.length) return summary;
  designStore.getState().commit(label, (d) => {
    for (const c of changes) {
      d.regions[c.id].outer = c.outer;
      d.regions[c.id].inner = c.inner;
    }
  });
  return summary;
}
