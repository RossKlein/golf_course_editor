import type Map from "ol/Map";
import type { Viewport } from "../api/api";
import { fromMap, toMap, type Rect } from "./coords";

/** The saved form of the view: centre in course metres and pixels per metre, independent of the window size. */
export function viewportOf(map: Map): Viewport | null {
  const view = map.getView();
  const center = view.getCenter();
  const res = view.getResolution();
  if (!center || !res) return null;
  const [x, z] = fromMap(center as [number, number]);
  return { x, z, scale: 1 / res };
}

export function applyViewport(map: Map, v: Viewport) {
  const view = map.getView();
  view.setCenter(toMap([v.x, v.z]));
  view.setResolution(1 / v.scale);
}

/** Fit an area (course metres) into the map with a little margin. */
export function fitRect(map: Map, r: Rect) {
  const size = map.getSize();
  if (!size || !size[0] || !size[1]) return;
  const res = Math.max(r.w / size[0], r.h / size[1]) / 0.95;
  const view = map.getView();
  view.setCenter(toMap([r.x + r.w / 2, r.z + r.h / 2]));
  view.setResolution(res);
}

export const sameViewport = (a: Viewport, b: Viewport) =>
  Math.abs(a.x - b.x) < 1e-6 * Math.max(1, Math.abs(a.x)) &&
  Math.abs(a.z - b.z) < 1e-6 * Math.max(1, Math.abs(a.z)) &&
  Math.abs(a.scale - b.scale) < 1e-9 * Math.max(1, a.scale);

/** Zoom about the centre of the view. factor > 1 zooms in. */
export function zoomBy(map: Map, factor: number) {
  const view = map.getView();
  const res = view.getResolution();
  if (res) view.setResolution(res / factor);
}

/** Pan by a fraction of the visible area (positive x is east, positive y is south). */
export function panBy(map: Map, fx: number, fy: number) {
  const view = map.getView();
  const size = map.getSize();
  const res = view.getResolution();
  const c = view.getCenter();
  if (!size || !res || !c) return;
  view.setCenter([c[0] + fx * size[0] * res, c[1] - fy * size[1] * res]);
}
