import type { Program } from "../../gfx/shader/program";

// How the editor draws its own aids over the terrain: not part of a course's look and never in a bundle. It reaches the
// shaders as uniforms like the look does. (It moves to model/theme in the reorganisation, with this type staying here.)

type Color = [number, number, number];

export type TerrainTheme = {
  /** The ground's colour where there is neither aerial nor the game's look. */
  bare: Color;
  /** The slope palette: under 1%, 2%, 4%, 8% and 15% and over. */
  slope: [Color, Color, Color, Color, Color];
  /** How much a contour line darkens: an ordinary one, and every fifth. */
  contour: [number, number];
};

export const DEFAULT_THEME: TerrainTheme = {
  bare: [0.42, 0.55, 0.3],
  slope: [[0.2, 0.45, 0.95], [0.2, 0.8, 0.4], [0.95, 0.9, 0.2], [0.95, 0.55, 0.15], [0.9, 0.15, 0.15]],
  contour: [0.35, 0.7],
};

export function setThemeUniforms(gl: WebGL2RenderingContext, p: Program, theme: TerrainTheme) {
  gl.uniform3fv(p.u.uBare, theme.bare);
  gl.uniform3fv(p.u.uSlopeColor, theme.slope.flat());
  gl.uniform2fv(p.u.uContourStyle, theme.contour);
}
