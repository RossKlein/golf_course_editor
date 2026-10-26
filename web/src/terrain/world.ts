import type { Look } from "../core/api/api";
import type { Device } from "../gfx/device/device";
import type { Frustum } from "../gfx/math/frustum";
import type { Program } from "../gfx/shader/program";
import type { HeightField } from "./heightfield/heightfield";
import type { Overlays } from "./passes/drape/overlays";
import type { Sun } from "./sun";
import type { Surfaces } from "./surfaces/surfaces";
import type { TerrainTheme } from "./theme";

/** This frame's shadow maps, ready for a pass to read: it binds them and the numbers that describe them to its program. */
export type ShadowState = { bind(d: Device, p: Program): void };

/** What a pass reads to draw: the ground's heights and surfaces, what is draped over it, and how the course looks. */
export type World = {
  height: HeightField;
  surfaces: Surfaces;
  overlays: Overlays;
  look: Look;
  sun: Sun;
  theme: TerrainTheme;
  /** Set by the shadow pass each 3D frame, before the passes that read it. */
  shadow: ShadowState;
};

/** What is in view this frame, for passes that skip what is not: the view volume and bounds on the ground's height (metres, exaggeration applied). */
export type Cull = { frustum: Frustum; y0: number; y1: number };
