import type BaseLayer from "ol/layer/Base";
import type { Formatter } from "../units/units";
import type { Rect } from "./coords";

export type { Rect };

/** View settings some layers depend on. */
export type Params = { exaggeration: number; hole: number };

export type SceneLayer = {
  id: string;
  label: string;
  visible: boolean;
  opacity: number;
  /** Raster layers get an opacity slider; vector overlays only a visibility toggle. */
  adjustable: boolean;
  olLayer: BaseLayer;
  /** Called when exaggeration or the selected hole change, so the layer can rebuild its image. */
  onParams?: (params: Params) => void;
};

export type ReadoutLine = { text: string; color?: string };

export type Scene = {
  key: string;
  kind: "tif" | "bundle";
  title: string;
  subtitle: (f: Formatter) => string;
  /** The area to fit, in course metres. */
  extent: Rect;
  layers: SceneLayer[];
  readout: (x: number, z: number, f: Formatter) => ReadoutLine[];
  /** Re-read what a build changed (class, ownership, bounds, holes). Bundles only. */
  refresh?: () => Promise<void>;
};

export type LayerState = Record<string, { visible: boolean; opacity: number }>;

export const initialLayerState = (scene: Scene): LayerState =>
  Object.fromEntries(scene.layers.map((l) => [l.id, { visible: l.visible, opacity: l.opacity }]));
