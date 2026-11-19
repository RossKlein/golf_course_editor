import type { Landmark, TreeKind } from "../../core/api/api";
import type { Pt } from "../../core/geometry/coords";
import { forestOf, isWoods } from "../../model/design/forest";
import type { Doc } from "../../model/design/store";
import { landmarkClearings, placedClearings } from "./clearings";

// What the Trees editor draws over the map, as plain data. The hook turns each into an OpenLayers feature; keeping them as data
// means they are tested without a map.

export type Mark =
  /** A woods patch, tinted darker where it is planted denser. */
  | { type: "patch"; id: string; rings: Pt[][]; alpha: number; selected: boolean }
  /** A tree placed by hand. */
  | { type: "tree"; index: number; x: number; z: number; selected: boolean }
  /** A clearing: `derived` ones are worked out from a placed tree or a landmark, `hand` ones were drawn. */
  | { type: "clearing"; source: "derived" | "hand"; x: number; z: number; r: number };

/** How dark a patch is tinted: 2 m spacing is the darkest, 20 m the faintest. */
export const densityAlpha = (spacing: number) => 0.12 + (0.38 * (20 - Math.min(20, Math.max(2, spacing)))) / 18;

export function marks(doc: Doc, landmarks: readonly Landmark[], kinds: readonly TreeKind[], ui: { showClearings: boolean; selectedTree: number | null }): Mark[] {
  const out: Mark[] = [];
  for (const id of doc.order) {
    const r = doc.regions[id];
    if (!r || !isWoods(r)) continue;
    out.push({ type: "patch", id, rings: [r.outer as Pt[], ...(r.inner as Pt[][])], alpha: densityAlpha(forestOf(doc, id).spacing), selected: false });
  }
  if (ui.showClearings) {
    for (const d of [...landmarkClearings(landmarks), ...placedClearings(doc.trees.added, kinds)]) out.push({ type: "clearing", source: "derived", ...d });
    for (const c of doc.trees.removed) out.push({ type: "clearing", source: "hand", x: c.x, z: c.z, r: c.r });
  }
  doc.trees.added.forEach((t, index) => out.push({ type: "tree", index, x: t.x, z: t.z, selected: index === ui.selectedTree }));
  return out;
}

/** The patches `selected` names are drawn as selected. */
export const withSelection = (list: Mark[], selected: readonly string[]): Mark[] => list.map((m) => (m.type === "patch" ? { ...m, selected: selected.includes(m.id) } : m));
