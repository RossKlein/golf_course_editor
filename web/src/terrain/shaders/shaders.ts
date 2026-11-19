// The terrain shaders. Their source is in shaders/*.glsl; this joins each program's pieces and builds the defines that
// give a shader a number defined once in TypeScript.
//
// Heights are sampled exactly as the game does (bilinear between grid points), so the ground on screen is the ground the ball
// will see. The lighting of the 3D ground reads a baked relief instead (the slope of a spline over the heights, see
// relief/), because the slope of a bilinear surface is faceted. The programs:
//  - flat: a top-down shade for the map (one full-screen triangle, every pixel looks up the ground under it);
//  - ground: a 3D mesh whose vertices are lifted by the same lookup, textured with the aerial and the design;
//  - tufts and trees: the standing things drawn on the ground, placed entirely in the vertex shader;
//  - brush: one pass of the sculpting brush over a box of heights;
//  - relief: bakes the smoothed slope into a texture, all of it or the part a brush changed;
//  - sky and canopy: bake how much sky each height sample can see, from the ground and then from the trees (the lighting bakes are in lighting/).
// The reference maths for the 2D lighting lives in reference.ts, pinned by tests to the old CPU hillshade.

import { preprocess } from "../../gfx/shader/preprocess";
import { BUMP_RANGE } from "../surfaces/bump";
import { EDGE_FULL_STEP, EDGE_SHADE_AMBIENT, EDGE_SPREAD_BASE, EDGE_SPREAD_PER_METRE } from "../surfaces/grassEdge";
import { SPECKLE_SIZE } from "../surfaces/speckle";
import brushFrag from "../sculpt/brush.frag.glsl?raw";
import flatFrag from "../passes/flat/flat.frag.glsl?raw";
import fullscreenVert from "./fullscreen.vert.glsl?raw";
import groundFrag from "../passes/ground/ground.frag.glsl?raw";
import groundVert from "../passes/ground/ground.vert.glsl?raw";
import head from "./head.glsl?raw";
import look from "./look.glsl?raw";
import height from "./height.glsl?raw";
import lighting from "./lighting.glsl?raw";
import overlays from "./overlays.glsl?raw";
import canopyFrag from "../lighting/canopy.frag.glsl?raw";
import canopyVert from "../lighting/canopy.vert.glsl?raw";
import skyFrag from "../lighting/sky.frag.glsl?raw";
import sunFrag from "../lighting/sun.frag.glsl?raw";
import treeShadeFrag from "../lighting/treeShade.frag.glsl?raw";
import reliefFrag from "../relief/relief.frag.glsl?raw";
import shadow from "./shadow.glsl?raw";
import noise from "./noise.glsl?raw";
import tree from "./tree.glsl?raw";
import depthFrag from "../passes/shadow/depth.frag.glsl?raw";
import depthVert from "../passes/shadow/depth.vert.glsl?raw";
import treesFrag from "../passes/trees/trees.frag.glsl?raw";
import treesVert from "../passes/trees/trees.vert.glsl?raw";
import tuftsFrag from "../passes/tufts/tufts.frag.glsl?raw";
import tuftsVert from "../passes/tufts/tufts.vert.glsl?raw";
import { BLADE_VERTS, EDGE_BLOCK, EDGE_TAPS_MAX, LAKE_EDGE_METRES, LAKE_EDGE_SMOOTH, LAKE_EDGE_SOFTEN, MAX_SHADOW_SLICES, RELIEF_TAPS_MAX, SELF_SHADOW_REACH, SELF_SHADOW_STEPS, SKY_DIRS, SKY_STEPS, SOIL_CONTRAST, SOIL_FINE_METRES, SOIL_FINER_METRES, SOIL_FINEST_METRES, SOIL_GRAIN_METRES, SOIL_HOLE_SHARE, SUN_REACH, SUN_STEPS, SUN_TEXELS, SURFACES, TUFT_EDGE_MARGIN, TUFT_PATCH_METRES, TUFT_TILE } from "../limits";

const chunks = { "head.glsl": head, "height.glsl": height, "lighting.glsl": lighting, "overlays.glsl": overlays, "look.glsl": look, "noise.glsl": noise, "shadow.glsl": shadow, "tree.glsl": tree };

const SHADOWS = { MAX_SHADOW_SLICES };

const program = (vertex: string, fragment: string, defines: Record<string, number | string> = {}) => ({
  vertex: preprocess(vertex, chunks, defines),
  fragment: preprocess(fragment, chunks, defines),
});

/** Every program's finished source, ready to compile. */
export const SHADERS = {
  flat: program(fullscreenVert, flatFrag),
  ground: program(groundVert, groundFrag, { SPECKLE_SIZE, BUMP_RANGE, SURFACES, SELF_SHADOW_STEPS, SELF_SHADOW_REACH, EDGE_TAPS_MAX, EDGE_BLOCK, EDGE_SPREAD_BASE, EDGE_SPREAD_PER_METRE, EDGE_FULL_STEP, EDGE_SHADE_AMBIENT, SOIL_GRAIN_METRES, SOIL_FINE_METRES, SOIL_FINER_METRES, SOIL_FINEST_METRES, SOIL_CONTRAST, SOIL_HOLE_SHARE, LAKE_EDGE_METRES, LAKE_EDGE_SOFTEN, LAKE_EDGE_SMOOTH, ...SHADOWS }),
  tufts: program(tuftsVert, tuftsFrag, { TUFT_TILE, EDGE_BLOCK, BLADE_VERTS, TUFT_PATCH_METRES, TUFT_EDGE_MARGIN, SURFACES, ...SHADOWS }),
  trees: program(treesVert, treesFrag, SHADOWS),
  shadowDepth: program(depthVert, depthFrag),
  brush: program(fullscreenVert, brushFrag),
  relief: program(fullscreenVert, reliefFrag, { RELIEF_TAPS_MAX }),
  sky: program(fullscreenVert, skyFrag, { SKY_DIRS, SKY_STEPS }),
  canopy: program(canopyVert, canopyFrag),
  sun: program(fullscreenVert, sunFrag, { SUN_TEXELS, SUN_STEPS, SUN_REACH }),
  treeShade: program(fullscreenVert, treeShadeFrag, { SUN_TEXELS }),
};
