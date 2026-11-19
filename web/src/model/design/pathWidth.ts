import type { Pt } from "../../core/geometry/coords";
import { offsetShape, shapeWidth } from "../../core/geometry/pathShape";
import { PATH_CLASS } from "./path";
import { designStore } from "./store";

/** The narrowest a path may be made, in metres: below this it is a line, and a shrink that would take it all leaves it this wide. */
export const MIN_PATH_WIDTH = 0.3;

/** The selected regions that are paths. */
export const selectedPaths = (): string[] => {
  const { doc, selected } = designStore.getState();
  return selected.filter((id) => doc.regions[id]?.class === PATH_CLASS);
};

/** How wide a path region is, edge to edge, worked out from its outline (see `shapeWidth`). */
export const pathWidthOf = (id: string): number => {
  const r = designStore.getState().doc.regions[id];
  return r ? shapeWidth(r.outer as Pt[], r.inner as Pt[][]) : 0;
};

export type WidthSession = {
  /** The width of the first path when the session began: where the slider starts. */
  readonly start: number;
  /** Set the width of the first path; the others change by the same amount, never below `MIN_PATH_WIDTH`. */
  set: (width: number) => void;
  /** Finish: everything the session changed is one undo step. Returns how many paths lost a piece to a shrink that split them. */
  end: () => number;
};

/**
 * Change the width of paths while a slider is dragged. Every `set` works from the outlines as they were when the session began, never from
 * the last result, so dragging back and forth does not drift. Each path's edge moves in or out by half the change (`offsetShape`). Where a
 * shrink splits a path in two, the larger piece is kept (and counted in what `end` returns). All of it is one undo step.
 */
export function startWidthSession(ids: readonly string[], label = "Change path width"): WidthSession | null {
  const doc = designStore.getState().doc;
  const paths = ids.flatMap((id) => {
    const r = doc.regions[id];
    return r && r.class === PATH_CLASS ? [{ id, outer: r.outer as Pt[], inner: r.inner as Pt[][], width: shapeWidth(r.outer as Pt[], r.inner as Pt[][]) }] : [];
  });
  if (!paths.length) return null;
  const start = paths[0].width;
  const split = new Set<string>();
  designStore.getState().begin(label);
  return {
    start,
    set(width) {
      const change = width - start;
      const results = paths.map((p) => {
        const delta = Math.max(change, MIN_PATH_WIDTH - p.width) / 2; // not so far in that nothing is left
        const shapes = offsetShape(p.outer, p.inner, delta);
        if (shapes.length > 1) split.add(p.id);
        else split.delete(p.id);
        return shapes[0] ? { id: p.id, outer: shapes[0].outer, inner: shapes[0].inner } : null;
      });
      designStore.getState().commit(label, (d) => {
        for (const r of results) {
          if (!r || !d.regions[r.id]) continue;
          d.regions[r.id].outer = r.outer;
          d.regions[r.id].inner = r.inner;
        }
      });
    },
    end() {
      designStore.getState().end();
      return split.size;
    },
  };
}
