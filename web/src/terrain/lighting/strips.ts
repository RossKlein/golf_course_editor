import type { Box } from "./bake";

/**
 * A bake of a big box takes the GPU long enough to freeze the whole screen if it is all done in one frame, so it is done a strip of
 * rows at a time, one strip a frame. Strips are cut at multiples of `strip` rows, so a strip never straddles two of the tile rows the
 * tree shadows are baked in (a tile is then drawn once, not twice). `now` is the strip to bake this frame; `rest` is what is left.
 */
export function takeStrip(box: Box, strip: number): { now: Box; rest: Box | null } {
  const z1 = Math.min(box.z1, (Math.floor(box.z0 / strip) + 1) * strip - 1);
  return { now: { ...box, z1 }, rest: z1 < box.z1 ? { ...box, z0: z1 + 1 } : null };
}

/** How many frames a box takes at `strip` rows a frame. */
export const framesFor = (box: Box, strip: number): number => {
  let frames = 0;
  for (let at: Box | null = box; at; at = takeStrip(at, strip).rest) frames++;
  return frames;
};
