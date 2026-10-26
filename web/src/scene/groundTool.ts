import type { Pt } from "../core/geometry/coords";

/**
 * A tool that works on the ground under the pointer. A view (the 3D one, or the map) finds the ground and feeds the tool;
 * the tool never learns how the view does it, so the same tool works in both.
 */
export type GroundTool = {
  /** The cursor to draw: a ring `radius` metres out, with a second ring inside it where the core ends. */
  ring: { radius: number; hardness: number };
  /** The primary button went down on the ground. `where` follows the pointer from then on, and is null when it is off the ground. */
  begin(where: () => Pt | null, shift: boolean): void;
  /** Shift went down or up during the stroke. */
  shift(down: boolean): void;
  /** The button came up, or the stroke was interrupted. */
  end(): void;
};
