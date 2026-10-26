import kinks from "@turf/kinks";
import simplify from "@turf/simplify";
import type { Pt } from "../map/coords";

export const closeRing = (ring: Pt[]): Pt[] => {
  const a = ring[0], b = ring[ring.length - 1];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
};

/** Drop consecutive duplicate vertices (tracing and snapping can repeat a point). */
export const dedupe = (ring: Pt[]): Pt[] => ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);

const feature = (ring: Pt[]) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [closeRing(ring)] } }) as const;

/**
 * The outline for freehand points: duplicates removed, then simplified (Douglas-Peucker) to `tolerance` metres and
 * closed. There is deliberately no smoothing pass: the points are already dense, and smoothing would only cut corners.
 * A tolerance of 0 keeps every point. What comes out is stored as drawn.
 */
export function outlineFromPoints(points: Pt[], tolerance: number): Pt[] {
  const ring = dedupe(points);
  if (ring.length < 3 || tolerance <= 0) return ring.length < 3 ? ring : closeRing(ring);
  const simple = (simplify(feature(ring) as never, { tolerance, highQuality: true }) as unknown as { geometry: { coordinates: Pt[][] } }).geometry.coordinates[0];
  return simple.length >= 4 ? simple : closeRing(ring);
}

export const selfIntersects = (ring: Pt[]) => kinks(feature(ring).geometry as never).features.length > 0;

/** Area in square metres (shoelace). */
export function ringArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a) / 2;
}

/**
 * Snap a point to the nearest vertex of any ring within `tolerance`; failing that, to the nearest point on an edge
 * within `tolerance`; failing that, leave it alone. Vertices win so two borders can meet exactly.
 */
export function snapToRings(p: Pt, rings: readonly (readonly Pt[])[], tolerance: number): Pt {
  let best: Pt | null = null;
  let bestD = tolerance;
  for (const ring of rings) {
    for (const v of ring) {
      const d = Math.hypot(v[0] - p[0], v[1] - p[1]);
      if (d < bestD) {
        bestD = d;
        best = v as Pt;
      }
    }
  }
  if (best) return [best[0], best[1]];
  bestD = tolerance;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, az] = ring[i - 1], [bx, bz] = ring[i];
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / len2));
      const q: Pt = [ax + t * dx, az + t * dz];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
  }
  return best ?? p;
}
