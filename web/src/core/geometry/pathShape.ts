import polygonClipping from "polygon-clipping";
import simplify from "@turf/simplify";
import type { Pt } from "./coords";
import { closeRing, dedupe } from "./geometry";

/** One polygon: an outline and the holes in it, each ring closed. */
export type Shape = { outer: Pt[]; inner: Pt[][] };

type Ring = [number, number][];
type Poly = Ring[];

/** The most a round end or corner may stray from a true circle, in metres. */
const ARC_ERROR = 0.02;

/** A shape smaller than this, in square metres, is a sliver left by rounding and is dropped. */
const MIN_AREA = 0.05;

/** The outlines are thinned to this many metres of tolerance: far below what the build resolves, but it drops the points a union leaves on straight edges. */
const THIN = 0.02;

const area = (ring: readonly Pt[]) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a) / 2;
};

const shapeArea = (s: Shape) => area(s.outer) - s.inner.reduce((a, h) => a + area(h), 0);

/** Thin a closed ring with Douglas-Peucker, keeping it closed and never below a triangle. */
function thin(ring: Pt[], tolerance: number): Pt[] {
  if (ring.length < 6) return ring;
  const out = (simplify({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } } as never, { tolerance, highQuality: true }) as unknown as { geometry: { coordinates: Pt[][] } }).geometry.coordinates[0];
  return out.length >= 4 ? out : ring;
}

/** The union of polygons as shapes, largest first, thinned. */
function union(polys: Poly[]): Shape[] {
  if (!polys.length) return [];
  return shapesOf(polygonClipping.union(polys[0] as never, ...(polys.slice(1) as never[])) as unknown as Pt[][][]);
}

/** Clipped polygons as shapes: thinned, slivers dropped, largest first. */
function shapesOf(result: Pt[][][]): Shape[] {
  return result
    .map((p): Shape => ({ outer: thin(p[0], THIN), inner: p.slice(1).map((h) => thin(h, THIN)) }))
    .filter((s) => shapeArea(s) >= MIN_AREA)
    .sort((a, b) => shapeArea(b) - shapeArea(a));
}

/** The stadium round `a` to `b`: every point within `r` of the segment. A zero-length segment is a circle. */
function stadium(a: Pt, b: Pt, r: number): Poly {
  const steps = Math.max(6, Math.ceil(Math.PI / Math.acos(1 - Math.min(ARC_ERROR / r, 1))));
  const heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const ring: Ring = [];
  for (let i = 0; i <= steps; i++) {
    const t = heading - Math.PI / 2 + (Math.PI * i) / steps; // the half-circle round b, from its right side to its left
    ring.push([b[0] + r * Math.cos(t), b[1] + r * Math.sin(t)]);
  }
  for (let i = 0; i <= steps; i++) {
    const t = heading + Math.PI / 2 + (Math.PI * i) / steps; // and round a
    ring.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]);
  }
  ring.push(ring[0]);
  return [ring];
}

/**
 * The line grown by `distance` metres on every side, ends rounded: the union of a stadium along each segment. Where the line loops back
 * over itself the result is one shape (with a hole if it encloses ground). Shapes come out largest first.
 */
export function growLine(line: readonly Pt[], distance: number): Shape[] {
  const pts = dedupe([...line]);
  if (pts.length < 2 || distance <= 0) return [];
  return union(pts.slice(1).map((p, i) => stadium(pts[i], p, distance)));
}

/**
 * The polygon grown outward by `distance` metres, corners rounded, as the union of the polygon and a stadium along each edge. The
 * polygon's own outline is the inner edge of the new ring, exactly. Holes in the polygon are ignored (they are filled).
 */
export function growRing(ring: readonly Pt[], distance: number): Shape[] {
  const pts = dedupe([...ring]);
  if (pts.length < 4 || distance <= 0) return [];
  const closed = closeRing(pts);
  return union([[closed as Ring], ...closed.slice(1).map((p, i) => stadium(closed[i], p, distance))]);
}

/**
 * How much of the ring around a polygon is already covered by `covers`: 1 when the ground within `distance` of the polygon (but not in it)
 * is entirely inside one of them, 0 when none of it is.
 */
export function ringCoverage(ring: readonly Pt[], distance: number, covers: readonly (readonly [readonly Pt[], readonly (readonly Pt[])[]])[]): number {
  const grown = growRing(ring, distance);
  if (!grown.length || !covers.length) return 0;
  const hollow = polygonClipping.difference(
    grown.map((s) => [s.outer, ...s.inner]) as never,
    [closeRing([...ring])] as never,
  ) as unknown as Pt[][][];
  const zone = hollow.reduce((a, p) => a + area(p[0]) - p.slice(1).reduce((b, h) => b + area(h), 0), 0);
  if (zone <= 0) return 0;
  const covered = polygonClipping.intersection(
    hollow as never,
    ...(covers.map(([outer, inner]) => [outer, ...inner]) as never[]),
  ) as unknown as Pt[][][];
  return covered.reduce((a, p) => a + area(p[0]) - p.slice(1).reduce((b, h) => b + area(h), 0), 0) / zone;
}

/**
 * The shape with its whole edge moved `delta` metres: outward when positive, inward when negative, corners rounded (the same offset on the
 * outline and on each hole, so a hole closes up as the shape grows). It is the shape joined with a stadium along every edge, or with them
 * taken out of it. More than one shape comes back when shrinking splits it, largest first; none when nothing is left.
 */
export function offsetShape(outer: readonly Pt[], inner: readonly (readonly Pt[])[], delta: number): Shape[] {
  const rings = [outer, ...inner].map((r) => closeRing(dedupe([...r])));
  const base: Poly = rings as Ring[];
  if (delta === 0) return shapesOf([base as Pt[][]]);
  const r = Math.abs(delta);
  const stadiums = rings.flatMap((ring) => ring.slice(1).map((p, i) => stadium(ring[i], p, r)));
  if (delta > 0) return union([base, ...stadiums]);
  return shapesOf(polygonClipping.difference(base as never, ...(stadiums as never[])) as unknown as Pt[][][]);
}

/**
 * How wide a long thin shape (a path) is, edge to edge: twice its area over its perimeter. Exact for a long strip, a little low for a short one,
 * and for a shape that is not thin it is only a measure of how much of it is near an edge.
 */
export function shapeWidth(outer: readonly Pt[], inner: readonly (readonly Pt[])[]): number {
  const perimeter = [outer, ...inner].reduce((a, ring) => a + ring.reduce((b, p, i) => (i ? b + Math.hypot(p[0] - ring[i - 1][0], p[1] - ring[i - 1][1]) : 0), 0), 0);
  return perimeter > 0 ? (2 * shapeArea({ outer: [...outer], inner: inner.map((h) => [...h]) })) / perimeter : 0;
}

// ---- smoothing a drawn line -----------------------------------------------------------------------------------------------------

/**
 * A smooth curve through the points: they are thinned to `tolerance` metres (so a hand-drawn wobble is not followed), then a centripetal
 * Catmull-Rom spline is run through what is left and sampled about every `step` metres. It passes through every kept point, never
 * overshoots or loops at an uneven spacing, and keeps both ends where they were drawn.
 */
export function smoothLine(points: readonly Pt[], tolerance: number, step: number): Pt[] {
  const pts = dedupe([...points]);
  if (pts.length < 3) return pts;
  const kept: Pt[] =
    tolerance > 0
      ? ((simplify({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts } } as never, { tolerance, highQuality: true }) as unknown as { geometry: { coordinates: Pt[] } }).geometry.coordinates)
      : pts;
  if (kept.length < 3) return kept;

  // the end points are doubled by reflection so the curve has a tangent there
  const first: Pt = [2 * kept[0][0] - kept[1][0], 2 * kept[0][1] - kept[1][1]];
  const n = kept.length;
  const last: Pt = [2 * kept[n - 1][0] - kept[n - 2][0], 2 * kept[n - 1][1] - kept[n - 2][1]];
  const p = [first, ...kept, last];
  const out: Pt[] = [kept[0]];
  const dist = (a: Pt, b: Pt) => Math.max(Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])), 1e-6); // alpha 0.5: the chord length to the power 0.5
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    const t0 = 0, t1 = t0 + dist(p0, p1), t2 = t1 + dist(p1, p2), t3 = t2 + dist(p2, p3);
    const along = (a: Pt, b: Pt, ta: number, tb: number, t: number): Pt => [a[0] + ((b[0] - a[0]) * (t - ta)) / (tb - ta), a[1] + ((b[1] - a[1]) * (t - ta)) / (tb - ta)];
    const pieces = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 1; k <= pieces; k++) {
      const t = t1 + ((t2 - t1) * k) / pieces;
      const a1 = along(p0, p1, t0, t1, t), a2 = along(p1, p2, t1, t2, t), a3 = along(p2, p3, t2, t3, t);
      const b1 = along(a1, a2, t0, t2, t), b2 = along(a2, a3, t1, t3, t);
      out.push(k === pieces ? p2 : along(b1, b2, t1, t2, t));
    }
  }
  return out;
}

/** The sampling step for a path of this width: fine enough that the grown outline follows the curve closely, coarse enough to stay quick. */
export const pathStep = (width: number) => Math.min(1, Math.max(0.4, width / 2));

/** The path a line of points makes: smoothed, then grown to `width` metres. None (an empty list) when it is too short to make one. */
export function pathShapes(points: readonly Pt[], width: number, tolerance: number): Shape[] {
  return growLine(smoothLine(points, tolerance, pathStep(width)), width / 2);
}
