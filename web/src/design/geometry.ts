import kinks from "@turf/kinks";
import polygonSmooth from "@turf/polygon-smooth";
import simplify from "@turf/simplify";
import type { Pt } from "../map/coords";

export const closeRing = (ring: Pt[]): Pt[] => {
  const a = ring[0], b = ring[ring.length - 1];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
};

/** Drop consecutive duplicate vertices (tracing and snapping can repeat a point). */
export const dedupe = (ring: Pt[]): Pt[] => ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);

const feature = (ring: Pt[]) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [closeRing(ring)] } }) as const;

/** Freehand to a clean polygon: Douglas-Peucker simplify, then one Chaikin smoothing pass. What comes out is stored. */
export function cleanFreehand(ring: Pt[], tolerance: number): Pt[] {
  const simple = simplify(feature(ring) as never, { tolerance, highQuality: true });
  const smooth = polygonSmooth(simple as never, { iterations: 1 });
  return smooth.features[0].geometry.coordinates[0] as Pt[];
}

export const selfIntersects = (ring: Pt[]) => kinks(feature(ring).geometry as never).features.length > 0;

/** Area in square metres (shoelace). */
export function ringArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a) / 2;
}
