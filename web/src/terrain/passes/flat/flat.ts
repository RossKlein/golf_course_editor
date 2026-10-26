import { resizeCanvas } from "../../../gfx/device/device";
import type { Gl } from "../../context";
import { setThemeUniforms } from "../../theme";
import type { World } from "../../world";

export type TerrainStyle = {
  /** Relief exaggeration for the lighting. */
  exaggeration: number;
  /** Metres between contour lines; 0 for none. */
  contour: number;
  /** Colour the ground by slope. */
  slope: boolean;
};

/**
 * The map's pass: a top-down hillshade of the part of the course in `extent` (map coordinates: minX, minY, maxX, maxY),
 * drawn into the shared canvas `size` pixels across. Every pixel looks up the ground under it, so there is nothing to build.
 */
export function drawFlat(g: Gl, world: World, extent: number[], size: number[], style: TerrainStyle): HTMLCanvasElement {
  const { gl, canvas, flat } = g;
  const { w, h } = resizeCanvas(g, size);
  gl.disable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(flat.program);
  world.height.bind(g, flat);
  gl.uniform2f(flat.u.uMapOrigin, extent[0], extent[1]);
  gl.uniform2f(flat.u.uMapPerPixel, (extent[2] - extent[0]) / w, (extent[3] - extent[1]) / h);
  gl.uniform1f(flat.u.uExaggeration, style.exaggeration);
  gl.uniform1f(flat.u.uContour, style.contour);
  gl.uniform1f(flat.u.uSlope, style.slope ? 1 : 0);
  gl.uniform2f(flat.u.uSun, world.sun.azimuth, world.sun.altitude);
  setThemeUniforms(gl, flat, world.theme);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return canvas;
}
