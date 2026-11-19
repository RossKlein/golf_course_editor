import kinks from "@turf/kinks";
import simplify from "@turf/simplify";
import type { Pt } from "./coords";

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

/** The vertex of a ring or line nearest `p`, within `tolerance`. A closed ring's repeated last point is not a vertex of its own. */
export function nearestVertex(points: readonly Pt[], p: Pt, tolerance: number): { index: number; distance: number } | null {
  const closed = points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1];
  const n = closed ? points.length - 1 : points.length;
  let best: { index: number; distance: number } | null = null;
  for (let i = 0; i < n; i++) {
    const distance = Math.hypot(points[i][0] - p[0], points[i][1] - p[1]);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { index: i, distance };
  }
  return best;
}

/** A closed ring without one vertex, or null if that would leave fewer than three. */
export function withoutRingVertex(ring: readonly Pt[], index: number): Pt[] | null {
  const pts = ring.slice(0, -1);
  if (pts.length <= 3 || index < 0 || index >= pts.length) return null;
  pts.splice(index, 1);
  return closeRing(pts);
}

/** An open line without one vertex, or null if that would leave fewer than two. */
export function withoutLineVertex(line: readonly Pt[], index: number): Pt[] | null {
  if (line.length <= 2 || index < 0 || index >= line.length) return null;
  return line.filter((_, i) => i !== index);
}

/** Edges shorter than this, in metres, get no new point from `roundRing`: they are already finer than anything drawn by hand, and repeating would only pile up points. */
export const ROUND_MIN_EDGE = 0.5;

/**
 * A closed ring with a point added on the smooth curve between every pair of neighbouring corners: a centripetal Catmull-Rom spline through
 * the corners (Barry and Goldman's pyramid), taken half way along each edge. Every existing corner stays exactly where it is, so a border
 * shared with a neighbouring region still meets it. The centripetal form does not loop or overshoot at a sharp corner or beside a long
 * edge. One call adds one point per edge, so calling it again on its result halves the segments again and the outline gets rounder to
 * look at; the curve itself, passing through the same corners, does not change. Null when nothing was added (every edge is shorter than
 * `minEdge`, or the ring has fewer than three corners).
 */
export function roundRing(ring: Pt[], minEdge: number = ROUND_MIN_EDGE): Pt[] | null {
  const pts = dedupe(closeRing(ring)).slice(0, -1);
  const n = pts.length;
  if (n < 3) return null;
  const knot = (a: Pt, b: Pt) => Math.sqrt(Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), 1e-6));
  const lerp = (a: Pt, b: Pt, ta: number, tb: number, t: number): Pt => {
    const w = (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const out: Pt[] = [];
  let added = 0;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    out.push(p1);
    if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < minEdge) continue;
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    const t = (t1 + t2) / 2;
    const a1 = lerp(p0, p1, t0, t1, t), a2 = lerp(p1, p2, t1, t2, t), a3 = lerp(p2, p3, t2, t3, t);
    const b1 = lerp(a1, a2, t0, t2, t), b2 = lerp(a2, a3, t1, t3, t);
    out.push(lerp(b1, b2, t1, t2, t));
    added++;
  }
  return added ? closeRing(out) : null;
}

/** Whether `p` is inside a closed ring (even-odd rule). On the boundary it may be either. */
export function pointInRing(ring: readonly Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether `p` is inside a polygon: inside its outer ring and outside every hole. */
export const pointInPolygon = (outer: readonly Pt[], holes: readonly (readonly Pt[])[], p: Pt) => pointInRing(outer, p) && !holes.some((h) => pointInRing(h, p));
