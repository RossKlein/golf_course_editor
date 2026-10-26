import type { Pt, Rect } from "../../core/geometry/coords";
import type { Doc } from "./store";

/** Classes that belong to a hole: fairway, green, tee. Every other surface is shared. */
export const OWNED = [1, 2, 4];
const FAIRWAY = 1, GREEN = 2, TEE = 4;
export const MAX_HOLES = 24; // spec.MAX_HOLES

/** Length of a route in metres, flat (the map view's distance, not along the ground). */
export function routeLength(route: readonly Pt[]): number {
  let m = 0;
  for (let i = 1; i < route.length; i++) m += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
  return m;
}

type Box = [number, number, number, number]; // minX, minZ, maxX, maxZ

const grow = (box: Box | null, pts: readonly Pt[]): Box | null => {
  for (const [x, z] of pts) {
    if (!box) box = [x, z, x, z];
    else {
      if (x < box[0]) box[0] = x;
      if (z < box[1]) box[1] = z;
      if (x > box[2]) box[2] = x;
      if (z > box[3]) box[3] = z;
    }
  }
  return box;
};

const rectOf = (b: Box, margin: number): Rect => ({ x: b[0] - margin, z: b[1] - margin, w: b[2] - b[0] + 2 * margin, h: b[3] - b[1] + 2 * margin });

/** Everything that is the hole's own: its route and the fairways, greens and tees assigned to it. Null when it has none. */
export function holeExtent(doc: Doc, hole: number, margin = 0): Rect | null {
  let box: Box | null = grow(null, doc.layout.holes.find((h) => h.number === hole)?.route as Pt[] ?? []);
  for (const id of doc.order) {
    const r = doc.regions[id];
    if (r.hole === hole && OWNED.includes(r.class)) box = grow(box, r.outer as Pt[]);
  }
  return box && rectOf(box, margin);
}

/** The area to show when going to a hole: its extent with some room around it, never smaller than a short hole's worth. */
export function holeView(doc: Doc, hole: number, withBounds = false): Rect | null {
  let e = holeExtent(doc, hole);
  if (withBounds) {
    let box: Box | null = e && [e.x, e.z, e.x + e.w, e.z + e.h];
    for (const a of Object.values(doc.bounds)) if (a.hole === hole) box = grow(box, a.outer as Pt[]);
    e = box && rectOf(box, 0);
  }
  if (!e) return null;
  const pad = Math.max(15, 0.12 * Math.max(e.w, e.h));
  const w = Math.max(e.w + 2 * pad, 80), h = Math.max(e.h + 2 * pad, 80);
  return { x: e.x + e.w / 2 - w / 2, z: e.z + e.h / 2 - h / 2, w, h };
}

/** How far around a hole its shared surfaces (bunkers, water, paths...) still count as "near" when other holes are hidden. */
const NEAR_M = 40;

/**
 * Which regions to draw while other holes are hidden: the hole's own fairways, greens and tees, owned surfaces nobody
 * has claimed yet (so they can be assigned), shared surfaces near the hole, and anything in `keep` (the selection).
 */
export function visibleRegionIds(doc: Doc, hole: number, keep: readonly string[] = []): Set<string> {
  const near = holeExtent(doc, hole, NEAR_M);
  const out = new Set<string>(keep.filter((id) => doc.regions[id]));
  for (const id of doc.order) {
    const r = doc.regions[id];
    if (OWNED.includes(r.class)) {
      if (r.hole === hole || r.hole == null) out.add(id);
    } else if (near) {
      const b = grow(null, r.outer as Pt[])!;
      if (b[0] <= near.x + near.w && b[2] >= near.x && b[1] <= near.z + near.h && b[3] >= near.z) out.add(id);
    }
  }
  return out;
}

// ---- assigning surfaces to holes ----------------------------------------------------------------------------------

const centroid = (ring: readonly Pt[]): Pt => {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cz += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const b = grow(null, ring)!;
    return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  }
  return [cx / (3 * a), cz / (3 * a)];
};

export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

export function distanceToRoute(p: Pt, route: readonly Pt[]): number {
  let d = Infinity;
  for (let i = 1; i < route.length; i++) d = Math.min(d, distanceToSegment(p, route[i - 1], route[i]));
  return d;
}

/** Further than this from every route and a surface is left unassigned rather than guessed. */
const ASSIGN_MAX_M = 200;

/**
 * Suggest a hole for every unassigned fairway, green and tee: the hole whose route is nearest, measuring a tee to the
 * route's start, a green to its end and a fairway to the whole line. Holes without a route are not candidates.
 */
export function suggestHoles(doc: Doc): Record<string, number> {
  const holes = doc.layout.holes.filter((h) => h.route.length >= 2);
  const out: Record<string, number> = {};
  for (const id of doc.order) {
    const r = doc.regions[id];
    if (!OWNED.includes(r.class) || r.hole != null) continue;
    const c = centroid(r.outer as Pt[]);
    let best = ASSIGN_MAX_M, pick = 0;
    for (const h of holes) {
      const route = h.route as Pt[];
      const d = r.class === TEE ? Math.hypot(c[0] - route[0][0], c[1] - route[0][1]) : r.class === GREEN ? Math.hypot(c[0] - route[route.length - 1][0], c[1] - route[route.length - 1][1]) : r.class === FAIRWAY ? distanceToRoute(c, route) : Infinity;
      if (d < best) {
        best = d;
        pick = h.number;
      }
    }
    if (pick) out[id] = pick;
  }
  return out;
}

export const unassignedCount = (doc: Doc) => doc.order.filter((id) => OWNED.includes(doc.regions[id].class) && doc.regions[id].hole == null).length;
