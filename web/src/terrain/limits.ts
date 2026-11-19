// Limits of the renderer: what keeps the frame rate and the shaders safe, not how the course looks. (How it looks is the
// course's look, in the bundle.) Each is used by a pass and, where a shader needs it, injected as a #define.

/** Tufts are drawn in square tiles of this many clumps across (16 m of ground at the default spacing), so a tile that is out of view is never sent to the GPU. */
export const TUFT_TILE = 16;
/** A tuft's blade is two quads and a tip, nine vertices, built in the vertex shader from the vertex's number. */
export const BLADE_VERTS = 9;
/** Metres across the patches the grass gathers into where a surface's clumping is up (a size of the engine's noise, not of the course's look). */
export const TUFT_PATCH_METRES = 1.5;
/**
 * A forest floor's soil is two thresholded noises: chunks of soil and grass (layers 30 and 12 cm across) and, flipping the colour wherever they
 * are on, holes (layers 5 and 2 cm across, plus the grass texture's own light and dark), a share of the ground, so each kind of chunk has holes
 * of the other kind in it. The sums are stretched by a contrast so they spread over 0 to 1 and a threshold can pick a share of them. Engine
 * settings, not the course's look; how much of the ground is soil is the surface's `mottle`.
 */
export const SOIL_GRAIN_METRES = 0.3;
export const SOIL_FINE_METRES = 0.12;
export const SOIL_FINER_METRES = 0.05;
export const SOIL_FINEST_METRES = 0.02;
export const SOIL_CONTRAST = 2;
/** The share of the ground, 0 to 1, that is a hole in its chunk. */
export const SOIL_HOLE_SHARE = 0.27;
/**
 * Where a lake's bed meets the ground beside it, the bed's colour comes in through the forest floor's soil noise (a lake edge's distance in
 * place of the coverage), so the grass crumbles into the bed. Engine settings, not the course's look. The blend is LAKE_EDGE_METRES wide,
 * measured from the painted outline into the lake. LAKE_EDGE_SOFTEN widens the soil noise's own edges (0 is as crisp as the forest floor,
 * 1 is a haze), and LAKE_EDGE_SMOOTH is the share of the smooth ramp mixed in with the noise (0 is the noise alone).
 */
export const LAKE_EDGE_METRES = 1.0;
export const LAKE_EDGE_SOFTEN = 0.2;
export const LAKE_EDGE_SMOOTH = 0.4;
/** Metres beyond a clump's own radius that must be the same grass for it to grow whole; closer to an edge it shrinks (a blade leans a little past its root). */
export const TUFT_EDGE_MARGIN = 0.25;

/**
 * Surface classes in the bundle format, in class order (spec.CLASSES; a test in the Python suite checks they agree): the look has
 * one surface for each, by name, and the class map and the shaders' table go by the number.
 */
export const SURFACE_NAMES = ["rough", "fairway", "green", "collar", "tee", "bunker", "water", "path", "woods"] as const;
export const SURFACES = SURFACE_NAMES.length;

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

/** The sun bake: texels to a height sample along each side, steps of the ray toward the sun, and how far it looks in metres. */
export const SUN_TEXELS = 2;
export const SUN_STEPS = 24;
export const SUN_REACH = 120;
/** Tree shadows are baked a tile at a time: texels across a tile of the sun bake, and texels across each tile's shadow map. */
export const SUN_TILE = 512;
export const SUN_TILE_MAP = 2048;

/** The ground's own shadow: samples taken along the ray to the sun, and how far in metres it looks. */
export const SELF_SHADOW_STEPS = 16;
export const SELF_SHADOW_REACH = 80;
