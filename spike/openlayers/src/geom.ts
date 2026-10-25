import kinks from "@turf/kinks";
import polygonSmooth from "@turf/polygon-smooth";
import simplify from "@turf/simplify";
import polygonClipping from "polygon-clipping";

export type Pt = [number, number];

// Design coordinates are course metres (x east, z south). OpenLayers is y-up, so map coordinates are [x, -z].
export const toMap = ([x, z]: Pt): Pt => [x, -z];
export const fromMap = ([x, y]: Pt): Pt => [x, -y];

export const closeRing = (ring: Pt[]): Pt[] => {
  const a = ring[0], b = ring[ring.length - 1];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
};

/** Drop consecutive duplicate vertices (tracing and snapping can repeat a point). */
export const dedupe = (ring: Pt[]): Pt[] => ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);

const feature = (ring: Pt[]) =>
  ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [closeRing(ring)] } }) as const;

/** Freehand to a clean polygon: Douglas-Peucker simplify, then Chaikin smoothing. The result is what gets stored. */
export function cleanFreehand(ring: Pt[], tolerance: number, iterations = 1): Pt[] {
  const simple = simplify(feature(ring) as never, { tolerance, highQuality: true });
  const smooth = polygonSmooth(simple as never, { iterations });
  return smooth.features[0].geometry.coordinates[0] as Pt[];
}

export const selfIntersects = (ring: Pt[]) => kinks(feature(ring).geometry as never).features.length > 0;

type Poly = { outer: Pt[]; inner: Pt[][] };

/** outer minus cut, as polygons with holes (Martinez). A cut fully inside makes a hole; one crossing the edge splits or notches. */
export function subtract(outer: Pt[], cut: Pt[]): Poly[] {
  const result = polygonClipping.difference([closeRing(outer)], [closeRing(cut)]);
  return result.map((poly) => ({ outer: poly[0] as Pt[], inner: poly.slice(1) as Pt[][] }));
}

export function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const pointInPoly = (p: Pt, poly: Poly) => pointInRing(p, poly.outer) && !poly.inner.some((h) => pointInRing(p, h));
