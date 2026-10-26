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
import { SPECKLE_SIZE } from "../scenery/scenery";
import brushFrag from "../sculpt/brush.frag.glsl?raw";
import flatFrag from "../passes/flat/flat.frag.glsl?raw";
import fullscreenVert from "./fullscreen.vert.glsl?raw";
import groundFrag from "../passes/ground/ground.frag.glsl?raw";
import groundVert from "../passes/ground/ground.vert.glsl?raw";
import head from "./head.glsl?raw";
import look from "./look.glsl?raw";
import height from "./height.glsl?raw";
import overlays from "./overlays.glsl?raw";
import treesFrag from "../passes/trees/trees.frag.glsl?raw";
import treesVert from "../passes/trees/trees.vert.glsl?raw";
import tuftsFrag from "../passes/tufts/tufts.frag.glsl?raw";
import tuftsVert from "../passes/tufts/tufts.vert.glsl?raw";
import { SURFACES, TUFT_TILE } from "../limits";

const chunks = { "head.glsl": head, "height.glsl": height, "overlays.glsl": overlays, "look.glsl": look };

const program = (vertex: string, fragment: string, defines: Record<string, number | string> = {}) => ({
  vertex: preprocess(vertex, chunks, defines),
  fragment: preprocess(fragment, chunks, defines),
});

/** Every program's finished source, ready to compile. */
export const SHADERS = {
  flat: program(fullscreenVert, flatFrag),
  ground: program(groundVert, groundFrag, { SPECKLE_SIZE, SURFACES }),
  tufts: program(tuftsVert, tuftsFrag, { TUFT_TILE, SURFACES }),
  trees: program(treesVert, treesFrag),
  brush: program(fullscreenVert, brushFrag),
};
