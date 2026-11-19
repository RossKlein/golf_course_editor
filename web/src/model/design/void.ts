import type { Pt } from "../../core/geometry/coords";
import { VOID_CLASS } from "../theme/colours";
import { cutPolygon } from "./cut";
import { addRegion, designStore } from "./store";

export { VOID_CLASS };

const closed = (x0: number, z0: number, x1: number, z1: number): Pt[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];

/** Cut a hole right through the map: a void region on top of whatever is there. One undo step. Returns its id. */
export function cutHole(outline: Pt[]): string {
  return addRegion("Cut a hole", { class: VOID_CLASS, hole: null, outer: outline, inner: [] });
}

/**
 * Keep the land inside an outline and make the rest of the map void, so the land is an island. The void is the map's whole rectangle (a
 * metre past it each way, so no edge is left) with the outline cut out of it: one region with a hole in it, or several where the outline
 * reaches the map's edge. One undo step. Returns how many void regions were made, 0 when the outline is not on the map or covers all of it.
 */
export function makeIsland(outline: Pt[], map: { w: number; h: number }): number {
  const parts = cutPolygon(closed(-1, -1, map.w + 1, map.h + 1), [], outline);
  if (!parts?.length) return 0;
  const s = designStore.getState();
  s.begin("Make an island");
  for (const p of parts) addRegion("Make an island", { class: VOID_CLASS, hole: null, outer: p.outer, inner: p.inner });
  s.end();
  return parts.length;
}
