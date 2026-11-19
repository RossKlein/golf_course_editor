import { VOID_CLASS } from "../model/theme/colours";

/** Class 255 in the class map: no ground (docs/golf-course-format.md, "Void"). */
export const VOID = VOID_CLASS;

/** Just the part of an ImageData that is read. */
export type ClassPixels = { data: ArrayLike<number>; width: number; height: number };

export type SampleGrid = { cols: number; rows: number; valid: Uint8Array };

/** Whether the class map has any void in it. */
export function hasVoid(classes: ClassPixels): boolean {
  const { data } = classes;
  for (let i = 0; i < classes.width * classes.height; i++) if (data[i * 4] === VOID) return true;
  return false;
}

/**
 * Mark the height samples that have no ground, so the terrain is left with a hole there in every pass (the renderer already leaves no
 * mesh where a GeoTIFF has no data). A sample is on a corner of four class cells, and it has no ground when all four are void; so a
 * hole is at least as big as the void it covers whole metres of, and a strip of void thinner than a metre leaves the mesh as it was.
 * `grid.valid` is changed in place (every sample not in a void is marked as having ground). Returns whether anything changed.
 */
export function markVoid(classes: ClassPixels, classRes: number, heightRes: number, grid: SampleGrid): boolean {
  const { cols, rows, valid } = grid;
  const some = hasVoid(classes);
  let changed = false;
  if (!some) {
    for (let i = 0; i < valid.length; i++) {
      if (!valid[i]) {
        valid[i] = 1;
        changed = true;
      }
    }
    return changed;
  }
  const { data, width, height } = classes;
  const per = heightRes / classRes; // class cells to a metre of height grid
  const isVoid = (cx: number, cz: number) => data[(Math.min(height - 1, Math.max(0, cz)) * width + Math.min(width - 1, Math.max(0, cx))) * 4] === VOID;
  for (let r = 0; r < rows; r++) {
    const cz = Math.round(r * per);
    for (let c = 0; c < cols; c++) {
      const cx = Math.round(c * per);
      const ground = isVoid(cx - 1, cz - 1) && isVoid(cx, cz - 1) && isVoid(cx - 1, cz) && isVoid(cx, cz) ? 0 : 1;
      const i = r * cols + c;
      if (valid[i] !== ground) {
        valid[i] = ground;
        changed = true;
      }
    }
  }
  return changed;
}
