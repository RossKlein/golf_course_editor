import type { Mat4 } from "../../../gfx/math/mat4";
import type { Gl } from "../../context";
import { setLookUniforms } from "../../look/look";
import { sunDirection } from "../../sun";
import { setThemeUniforms } from "../../theme";
import type { World } from "../../world";

/** One ring of the ground mesh: a square of `quads` squares of `spacing` metres with its corner at (x0, z0). */
export type Ring = { spacing: number; quads: number; x0: number; z0: number };

/** How to draw the ground in 3D. */
export type GroundView = {
  viewProj: Mat4;
  /** The mesh as rings, outermost first. */
  meshes: Ring[];
  /** Vertical exaggeration of the geometry. */
  scale: number;
  /** Exaggeration of the relief shading (as the map's), and how strongly it shows. */
  relief: number;
  shading: number;
  aerial: boolean;
  /** The game's look for the ground (needs surfaces). */
  game: boolean;
  /** The ground point the camera looks at, and how far out the grass (and sand speckle) reach from it. */
  target: [number, number];
  tuftRange: number;
  /** How strongly the design's surfaces and outlines show, 0 to 1. */
  fill: number;
  lines: number;
  contour: number;
  slope: boolean;
};

/**
 * The 3D ground: rings of mesh out to the horizon, finer in the middle, each lifted by the height field and lit and
 * coloured per pixel. Where rings overlap the finer one wins, so the coarser ones are pushed back a little in depth, and
 * a quad wholly inside the next finer ring is left to it.
 */
export function drawGround(g: Gl, world: World, v: GroundView) {
  const { gl } = g;
  const mesh = g.mesh;
  if (!mesh) throw new Error("the 3D terrain program did not build; the console has the shader error");
  gl.useProgram(mesh.program);
  world.height.bind(g, mesh);
  world.height.bindRelief(g, mesh);
  world.lighting.bind(g, mesh);
  world.overlays.bind(g, mesh, { aerial: v.aerial, fill: v.fill, lines: v.lines });
  world.surfaces.bindClasses(g, mesh);
  world.surfaces.bindGround(g, mesh);
  world.shadow.bind(g, mesh);

  gl.uniformMatrix4fv(mesh.u.uViewProj, false, v.viewProj);
  gl.uniform3f(mesh.u.uSunDir, ...sunDirection(world.sun));
  setLookUniforms(gl, mesh, world.look);
  setThemeUniforms(gl, mesh, world.theme);
  gl.uniform1f(mesh.u.uRelief, v.relief);
  gl.uniform1f(mesh.u.uShading, v.shading);
  gl.uniform3f(mesh.u.uSpeckle, v.target[0], v.target[1], v.tuftRange); // speckle shows as far as the grass grows
  gl.uniform1f(mesh.u.uScale, v.scale);
  gl.uniform1f(mesh.u.uContour, v.contour);
  gl.uniform1f(mesh.u.uSlope, v.slope ? 1 : 0);
  gl.uniform1f(mesh.u.uGame, v.game && world.surfaces.has ? 1 : 0);

  gl.enable(gl.POLYGON_OFFSET_FILL);
  v.meshes.forEach((m, i) => {
    const finer = v.meshes[i + 1];
    gl.polygonOffset(finer ? 2 : 0, finer ? 2 : 0);
    gl.uniform2f(mesh.u.uWindow, m.x0, m.z0);
    gl.uniform1f(mesh.u.uSpacing, m.spacing);
    gl.uniform1i(mesh.u.uQuads, m.quads);
    const inner = finer ? [finer.x0, finer.z0, finer.x0 + finer.quads * finer.spacing, finer.z0 + finer.quads * finer.spacing] : [0, 0, 0, 0];
    gl.uniform4f(mesh.u.uInner, inner[0], inner[1], inner[2], inner[3]);
    gl.drawArrays(gl.TRIANGLES, 0, m.quads * m.quads * 6);
  });
  gl.disable(gl.POLYGON_OFFSET_FILL);
}
