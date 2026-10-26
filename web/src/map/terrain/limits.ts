// Limits of the renderer: what keeps the frame rate and the shaders safe, not how the course looks. (How it looks is the
// course's look, in the bundle.) Each is used by a pass and, where a shader needs it, injected as a #define.

/** Tufts are drawn in square tiles of this many across, so a tile that is out of view is never sent to the GPU. */
export const TUFT_TILE = 32;
