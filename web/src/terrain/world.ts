import type { Look } from "../core/api/api";
import type { Frustum } from "../gfx/math/frustum";
import type { HeightField } from "./heightfield/heightfield";
import type { Overlays } from "./passes/drape/overlays";
import type { Sun } from "./sun";
import type { Surfaces } from "./surfaces/surfaces";
import type { TerrainTheme } from "./theme";

/** What a pass reads to draw: the ground's heights and surfaces, what is draped over it, and how the course looks. */
export type World = {
  height: HeightField;
  surfaces: Surfaces;
  overlays: Overlays;
  look: Look;
  sun: Sun;
  theme: TerrainTheme;
};

/** What is in view this frame, for passes that skip what is not: the view volume and bounds on the ground's height (metres, exaggeration applied). */
export type Cull = { frustum: Frustum; y0: number; y1: number };
