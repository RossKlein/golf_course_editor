import type { ShadowQuality } from "../../terrain/passes/shadow/shadow";
import { TUFT_RANGE } from "../../terrain/passes/tufts/tufts";

/** What the 3D view's panel sets. Grass range and density and the shadow quality are the viewer's settings, not part of the course's look. */
export type Options = {
  aerial: boolean;
  game: boolean;
  tufts: boolean;
  grassRange: number;
  grassDensity: number;
  trees: boolean;
  surfaces: number;
  outlines: boolean;
  scale: number;
  shading: number;
  shadows: ShadowQuality;
};

/** How the view starts: in the game's look when the terrain has the surfaces for it. */
export const defaultOptions = (hasSurfaces: boolean): Options => ({
  aerial: true,
  game: hasSurfaces,
  tufts: true,
  grassRange: TUFT_RANGE,
  grassDensity: 1,
  trees: true,
  surfaces: hasSurfaces ? 0 : 0.5,
  outlines: true,
  scale: 1,
  shading: 1,
  shadows: "low",
});
