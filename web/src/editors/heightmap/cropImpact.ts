import type { Pt } from "../../core/geometry/coords";
import type { Doc } from "../../model/design/store";
import type { CropRect } from "./cropRect";

/** What a crop would touch in the design, counted before it is made. The server does the real cutting and reports what it did. */
export type CropImpact = {
  /** Surfaces and bounds areas with nothing inside the rectangle: they go. */
  gone: number;
  /** Those with some inside and some out: they are cut to the rectangle. */
  cut: number;
  /** Holes whose routes leave the rectangle. */
  routes: number[];
  /** Placed trees and landmarks outside it. */
  trees: number;
  landmarks: number;
};

type Box = [number, number, number, number]; // minX, minZ, maxX, maxZ

const boxOf = (ring: readonly Pt[]): Box => {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of ring) {
    if (x < b[0]) b[0] = x;
    if (z < b[1]) b[1] = z;
    if (x > b[2]) b[2] = x;
    if (z > b[3]) b[3] = z;
  }
  return b;
};

const inside = (b: Box, r: CropRect) => b[0] >= r.x0 && b[1] >= r.z0 && b[2] <= r.x1 && b[3] <= r.z1;
const apart = (b: Box, r: CropRect) => b[2] < r.x0 || b[0] > r.x1 || b[3] < r.z0 || b[1] > r.z1;
const pointIn = (p: Pt, r: CropRect) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.z0 && p[1] <= r.z1;

export function cropImpact(doc: Doc, landmarks: readonly { x: number; z: number }[], r: CropRect): CropImpact {
  const out: CropImpact = { gone: 0, cut: 0, routes: [], trees: 0, landmarks: 0 };
  for (const shape of [...Object.values(doc.regions), ...Object.values(doc.bounds)]) {
    const b = boxOf(shape.outer as Pt[]);
    if (inside(b, r)) continue;
    if (apart(b, r)) out.gone++;
    else out.cut++;
  }
  for (const h of doc.layout.holes) if (h.route.some((p) => !pointIn(p as Pt, r))) out.routes.push(h.number);
  out.trees = doc.trees.added.filter((t) => !pointIn([t.x, t.z], r)).length;
  out.landmarks = landmarks.filter((m) => !pointIn([m.x, m.z], r)).length;
  return out;
}

export const touchesDesign = (i: CropImpact) => i.gone + i.cut + i.routes.length + i.trees + i.landmarks > 0;

/** The box round everything that is the course (surfaces, routes, placed trees, landmarks) and `margin` metres more, or null when there is none. */
export function contentBox(doc: Doc, landmarks: readonly { x: number; z: number }[], margin: number): CropRect | null {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (pts: readonly Pt[]) => {
    const g = boxOf(pts);
    b[0] = Math.min(b[0], g[0]);
    b[1] = Math.min(b[1], g[1]);
    b[2] = Math.max(b[2], g[2]);
    b[3] = Math.max(b[3], g[3]);
  };
  for (const r of Object.values(doc.regions)) grow(r.outer as Pt[]);
  for (const h of doc.layout.holes) if (h.route.length) grow(h.route as Pt[]);
  for (const t of doc.trees.added) grow([[t.x, t.z]]);
  for (const m of landmarks) grow([[m.x, m.z]]);
  if (!isFinite(b[0])) return null;
  return { x0: Math.floor(b[0] - margin), z0: Math.floor(b[1] - margin), x1: Math.ceil(b[2] + margin), z1: Math.ceil(b[3] + margin) };
}
