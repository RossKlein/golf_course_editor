// Limits of the renderer: what keeps the frame rate and the shaders safe, not how the course looks. (How it looks is the
// course's look, in the bundle.) Each is used by a pass and, where a shader needs it, injected as a #define.

/** Tufts are drawn in square tiles of this many across, so a tile that is out of view is never sent to the GPU. */
export const TUFT_TILE = 32;

/** Surface classes in the bundle format (spec.CLASSES): the look has one surface for each, and shaders size their table by it. */
export const SURFACES = 9;

/** Texels across each shadow map (a GPU that allows less gets less), and how many slices of the view each quality uses. */
export const SHADOW_MAP = 2048;
export const SHADOW_SLICES = { low: 1, high: 3 } as const;
/** How far towards the sun, in metres, something can stand and still cast onto the ground in a slice: taller than any tree. */
export const SHADOW_REACH = 150;
/** The most slices the shaders handle. */
export const MAX_SHADOW_SLICES = 3;

/** The ground's own shadow: samples taken along the ray to the sun, and how far in metres it looks. */
export const SELF_SHADOW_STEPS = 16;
export const SELF_SHADOW_REACH = 80;
