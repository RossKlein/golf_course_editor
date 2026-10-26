import type { Look, Surface } from "../../api/api";
import type { Program } from "../../gfx/shader/program";
import { SURFACES } from "./limits";

// The course's look reaches the shaders as uniforms, so no colour or size is written in a shader. Surfaces are a table, one
// row of four vec4s each (the shader's accessors are in shaders/look.glsl); everything else is a few named uniforms.

export const FLOATS_PER_SURFACE = 16;

const packed = new WeakMap<readonly Surface[], Float32Array>();

/**
 * The surfaces as the shader's table. Per surface, four vec4s: (color, stripe), (color2, grain), (earth, mottle) and
 * (shade, speckleDark, specklePale, tuft). A colour a surface does not have is its own colour, so it is never missing.
 */
export function packSurfaces(surfaces: readonly Surface[]): Float32Array {
  const known = packed.get(surfaces);
  if (known) return known;
  if (surfaces.length !== SURFACES) throw new Error(`the look has ${surfaces.length} surfaces but the renderer is built for ${SURFACES}`);
  const out = new Float32Array(SURFACES * FLOATS_PER_SURFACE);
  surfaces.forEach((s, i) => {
    out.set([...s.color, s.stripe, ...(s.color2 ?? s.color), s.grain, ...(s.earth ?? s.color), s.mottle, s.shade, s.speckleDark, s.specklePale, s.tuft], i * FLOATS_PER_SURFACE);
  });
  packed.set(surfaces, out);
  return out;
}

/** Set every uniform the look feeds, on whichever of them `p` has (a program without one ignores it). */
export function setLookUniforms(gl: WebGL2RenderingContext, p: Program, look: Look) {
  gl.uniform4fv(p.u.uSurface, packSurfaces(look.surfaces));
  gl.uniform1f(p.u.uSpeckleGrain, look.grass.speckleGrain);
  gl.uniform1f(p.u.uTileMetres, look.grass.tileMetres);
  gl.uniform1f(p.u.uWobble, look.grass.wobble);
  gl.uniform1f(p.u.uTall, look.tufts.height);
  gl.uniform1f(p.u.uTuftWidth, look.tufts.width);
  gl.uniform3fv(p.u.uTuftRoot, look.tufts.root);
  gl.uniform3fv(p.u.uTuftTip, look.tufts.tip);
  gl.uniform3f(p.u.uTreeLight, look.trees.ambient, look.trees.direct, look.trees.base);
}
