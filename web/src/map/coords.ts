import Projection from "ol/proj/Projection";

// Course coordinates are metres: x east, z south. OpenLayers is y-up, so map coordinates are [x, -z].
// One projection in plain metres serves bundles and GeoTIFFs; nothing is geographic and nothing is reprojected.
export const projection = new Projection({ code: "course", units: "m", extent: [-1e6, -1e6, 1e6, 1e6] });

export type Pt = [number, number];
export const toMap = ([x, z]: Pt): Pt => [x, -z];
export const fromMap = ([x, y]: Pt): Pt => [x, -y];

export type Rect = { x: number; z: number; w: number; h: number };
