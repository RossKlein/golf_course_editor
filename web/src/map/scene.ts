import type { Formatter } from "../units/units";

// What the map draws. World coordinates are metres: x east, z south (the map draws z downwards).

export type Rect = { x: number; z: number; w: number; h: number };

/** View settings some layer images depend on. */
export type Params = { exaggeration: number; hole: number };

export type RasterLayer = {
  image: CanvasImageSource | ((params: Params) => CanvasImageSource | null);
  rect: Rect;
  smooth: boolean;
  /** "multiply" shades whatever is drawn beneath it (hillshade over imagery). */
  blend?: "multiply";
};

export type Layer = {
  id: string;
  label: string;
  visible: boolean;
  opacity: number;
  raster?: RasterLayer;
  /** Vector overlay drawn in world units; px is one device pixel in metres. */
  draw?: (ctx: CanvasRenderingContext2D, px: number) => void;
};

export type ReadoutLine = { text: string; color?: string };

/** Values are metres everywhere; scenes format them for display through the formatter they are given. */

export type Scene = {
  key: string;
  title: string;
  subtitle: (f: Formatter) => string;
  extent: Rect;
  layers: Layer[];
  readout: (x: number, z: number, f: Formatter) => ReadoutLine[];
};

export type LayerState = Record<string, { visible: boolean; opacity: number }>;

export const initialLayerState = (scene: Scene): LayerState =>
  Object.fromEntries(scene.layers.map((l) => [l.id, { visible: l.visible, opacity: l.opacity }]));
