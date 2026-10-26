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

/**
 * The most cells across (each way) the ground shader averages to smooth a surface edge: a spline reaching the look's most
 * (grass.smoothing, 3 m, over 0.5 m cells) is 12. Pixels away from any edge skip it, using a mask of blocks of EDGE_BLOCK cells
 * that is marked within EDGE_REACH cells of an edge.
 */
export const EDGE_TAPS_MAX = 12;
export const EDGE_BLOCK = 4;
export const EDGE_REACH = EDGE_TAPS_MAX / 2 + 1;

/** The most samples across (each way) the relief bake averages: a spline reaching the look's most (relief.smoothing, 6 m, over 1 m samples) is 12. */
export const RELIEF_TAPS_MAX = 12;

/** The sky bake: directions around each point, steps along each, and how far out in metres the ground is looked at. */
export const SKY_DIRS = 16;
export const SKY_STEPS = 12;
export const SKY_REACH = 48;

/** The ground's own shadow: samples taken along the ray to the sun, and how far in metres it looks. */
export const SELF_SHADOW_STEPS = 16;
export const SELF_SHADOW_REACH = 80;
