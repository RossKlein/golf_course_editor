import type { Pt } from "../../core/geometry/coords";
import { ringArea } from "../../core/geometry/geometry";
import { forestOf, isWoods } from "../../model/design/forest";
import type { Doc } from "../../model/design/store";

/** The most trees a build writes (`MAX_TREES` in spec.py); past it every patch is thinned evenly. */
export const MAX_TREES = 250_000;

/** Trees to the hectare at an average spacing. */
export const perHectare = (spacing: number) => 10_000 / (spacing * spacing);

/** The area of a region in square metres: its outer ring less its holes. Where woods overlap other regions it is the whole of the polygon. */
export const regionArea = (outer: readonly Pt[], inner: readonly (readonly Pt[])[]) => ringArea(outer as Pt[]) - inner.reduce((a, h) => a + ringArea(h as Pt[]), 0);

/**
 * About how many trees a patch will have: its area over the spacing squared. It ignores the edge thinning, other regions painted over
 * it and the clearings, so it is a ceiling to read as "about", not what the build writes.
 */
export function estimatePatch(doc: Doc, id: string): number {
  const r = doc.regions[id];
  if (!r || !isWoods(r)) return 0;
  const s = forestOf(doc, id).spacing;
  return Math.round(regionArea(r.outer as Pt[], r.inner as Pt[][]) / (s * s));
}

/** About how many trees the whole course will have: every woods patch, and the trees placed by hand. */
export const estimateTotal = (doc: Doc): number => doc.order.reduce((n, id) => n + estimatePatch(doc, id), 0) + doc.trees.added.length;

/** A count as a short phrase: "about 1,200 trees". */
export const about = (n: number) => `about ${(n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n / 10) * 10).toLocaleString()} trees`;
