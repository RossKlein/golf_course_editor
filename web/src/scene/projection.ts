import Projection from "ol/proj/Projection";

// One projection in plain metres serves bundles and GeoTIFFs; nothing is geographic and nothing is reprojected. (Course
// coordinates are metres, x east and z south; see core/geometry/coords.ts.)
export const projection = new Projection({ code: "course", units: "m", extent: [-1e6, -1e6, 1e6, 1e6] });
