import type BaseLayer from "ol/layer/Base";
import type { Formatter } from "../core/units/units";
import type { HeightSession } from "./heightSession";
import type { TerrainRenderer } from "../terrain/terrain";
import type { Rect } from "../core/geometry/coords";

export type { Rect };

/** View settings some layers depend on. */
export type Params = { exaggeration: number; hole: number; /** metres between contour lines, 0 for none */ contour: number; slope: boolean };

export type SceneLayer = {
  id: string;
  label: string;
  visible: boolean;
  opacity: number;
  /** Raster layers get an opacity slider; vector overlays only a visibility toggle. */
  adjustable: boolean;
  olLayer: BaseLayer;
  /** Called when the view settings (relief, contours, slope) or the selected hole change, so the layer can redraw. */
  onParams?: (params: Params) => void;
  /** Free GPU memory when the scene is taken off the map. The layer still works if it is shown again. */
  dispose?: () => void;
};

/** What the 3D view needs from a scene with elevation. */
export type TerrainSource = {
  renderer: TerrainRenderer;
  /** Ground height in metres at a course point; null where there is no data. */
  ground: (x: number, z: number) => number | null;
  /** The imagery to drape over the ground, with the area it covers (course metres). */
  aerial: { image: HTMLImageElement; rect: Rect } | null;
  /** Redraw the map's terrain layer after the heights changed. */
  redraw: () => void;
  /** Where the trees come from: the bundle's own, or (when it has none yet) a preview scattered over its woods. */
  treeInfo?: { preview: boolean };
  /** Sculpting, for bundles whose GPU can do it. */
  sculpt?: HeightSession;
};

export type ReadoutLine = { text: string; color?: string };

export type Scene = {
  key: string;
  kind: "tif" | "bundle";
  title: string;
  subtitle: (f: Formatter) => string;
  /** The area to fit, in course metres. */
  extent: Rect;
  /** Present when the scene has elevation, so it can be shown in 3D. */
  terrain?: TerrainSource;
  layers: SceneLayer[];
  readout: (x: number, z: number, f: Formatter) => ReadoutLine[];
  /** Re-read what a build changed (class, ownership, bounds, holes). Bundles only. */
  refresh?: () => Promise<void>;
};

export type LayerState = Record<string, { visible: boolean; opacity: number }>;

export const initialLayerState = (scene: Scene): LayerState =>
  Object.fromEntries(scene.layers.map((l) => [l.id, { visible: l.visible, opacity: l.opacity }]));
