// The terrain shaders. Their source is in shaders/*.glsl; this joins each program's pieces and builds the defines that
// give a shader a number defined once in TypeScript.
//
// Heights are sampled exactly as the game does (bilinear between grid points) and normals come from central differences of
// that surface, so the relief on screen is the relief the ball will see. The programs:
//  - flat: a top-down shade for the map (one full-screen triangle, every pixel looks up the ground under it);
//  - ground: a 3D mesh whose vertices are lifted by the same lookup, textured with the aerial and the design;
//  - tufts and trees: the standing things drawn on the ground, placed entirely in the vertex shader;
//  - brush: one pass of the sculpting brush over a box of heights.
// The reference maths for the 2D lighting lives in reference.ts, pinned by tests to the old CPU hillshade.

import { preprocess } from "../../gfx/shader/preprocess";
import { SPECKLE_GRAIN, SPECKLE_SIZE } from "../../view3d/scenery";
import brushFrag from "./shaders/brush.frag.glsl?raw";
import flatFrag from "./shaders/flat.frag.glsl?raw";
import fullscreenVert from "./shaders/fullscreen.vert.glsl?raw";
import groundFrag from "./shaders/ground.frag.glsl?raw";
import groundVert from "./shaders/ground.vert.glsl?raw";
import head from "./shaders/head.glsl?raw";
import height from "./shaders/height.glsl?raw";
import overlays from "./shaders/overlays.glsl?raw";
import treesFrag from "./shaders/trees.frag.glsl?raw";
import treesVert from "./shaders/trees.vert.glsl?raw";
import tuftsFrag from "./shaders/tufts.frag.glsl?raw";
import tuftsVert from "./shaders/tufts.vert.glsl?raw";
import { TUFT_TILE } from "./limits";

const chunks = { "head.glsl": head, "height.glsl": height, "overlays.glsl": overlays };

const program = (vertex: string, fragment: string, defines: Record<string, number | string> = {}) => ({
  vertex: preprocess(vertex, chunks, defines),
  fragment: preprocess(fragment, chunks, defines),
});

/** Every program's finished source, ready to compile. */
export const SHADERS = {
  flat: program(fullscreenVert, flatFrag),
  ground: program(groundVert, groundFrag, { SPECKLE_GRAIN, SPECKLE_SIZE }),
  tufts: program(tuftsVert, tuftsFrag, { TUFT_TILE }),
  trees: program(treesVert, treesFrag),
  brush: program(fullscreenVert, brushFrag),
};
