import type { Look, Surface } from "../../core/api/api";
import type { Program } from "../../gfx/shader/program";
import { SURFACE_NAMES, SURFACES } from "../limits";

// The course's look reaches the shaders as uniforms, so no colour or size is written in a shader. Surfaces are a table, one
// row of five vec4s each (the shader's accessors are in shaders/look.glsl); everything else is a few named uniforms.

export const FLOATS_PER_SURFACE = 20;

const packed = new WeakMap<object, Float32Array>();

/**
 * The surfaces as the shader's table. Per surface, five vec4s: (color, stripe), (color2, grain), (earth, mottle),
 * (shade, speckleDark, specklePale, tuft) and (bump, which map: 0 the grass tile, 1 grain). A colour a surface does not have is its own colour, so it is never missing.
 */
export function packSurfaces(surfaces: Readonly<Record<string, Surface>>): Float32Array {
  const known = packed.get(surfaces);
  if (known) return known;
  const unknown = Object.keys(surfaces).filter((n) => !(SURFACE_NAMES as readonly string[]).includes(n));
  if (unknown.length) throw new Error(`the look has surfaces the renderer has no class for: ${unknown.join(", ")}`);
  const out = new Float32Array(SURFACES * FLOATS_PER_SURFACE);
  SURFACE_NAMES.forEach((name, i) => {
    const s = surfaces[name];
    if (!s) throw new Error(`the look has no surface named ${name}`);
    out.set([...s.color, s.stripe, ...(s.color2 ?? s.color), s.grain, ...(s.earth ?? s.color), s.mottle, s.shade, s.speckleDark, s.specklePale, s.tuft, s.bump ?? 0, s.bumpMap === "grain" ? 1 : 0, 0, 0], i * FLOATS_PER_SURFACE);
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
  if (look.grass.smoothing !== undefined) gl.uniform1f(p.u.uSmoothing, look.grass.smoothing); // missing when the server that sent the look is older than this page: the narrowest spline
  gl.uniform1f(p.u.uTall, look.tufts.height);
  gl.uniform1f(p.u.uTuftWidth, look.tufts.width);
  gl.uniform3fv(p.u.uTuftRoot, look.tufts.root);
  gl.uniform3fv(p.u.uTuftTip, look.tufts.tip);
  gl.uniform3f(p.u.uTreeLight, look.trees.ambient, look.trees.direct, look.trees.base);
  const shadows = look.shadows as Look["shadows"] | undefined; // missing when the server that sent the look is older than this page
  if (shadows) {
    gl.uniform4f(p.u.uShadowLook, shadows.strength, shadows.softness, shadows.distance, 0);
    gl.uniform3fv(p.u.uShadowTint, shadows.tint);
  }
}
