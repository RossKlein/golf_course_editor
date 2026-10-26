import difference from "@turf/difference";
import type { Region } from "../api/api";
import type { Pt } from "../map/coords";

/** What the build makes of overlapping regions, for display: a later region of another surface covers the ones below. */

type Box = [number, number, number, number];
const boxes = new WeakMap<object, Box>();

/** Bounding box of a region's outline, remembered per region object (the store replaces a region when it changes). */
export function boxOf(r: Region): Box {
  let b = boxes.get(r);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, z] of r.outer as Pt[]) {
      if (x < b[0]) b[0] = x;
      if (z < b[1]) b[1] = z;
      if (x > b[2]) b[2] = x;
      if (z > b[3]) b[3] = z;
    }
    boxes.set(r, b);
  }
  return b;
}

const overlap = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/**
 * The regions that can cover region `i` of `all` (in painter's order): later ones of a different surface whose boxes
 * touch it. Same-surface overlaps are left alone; they look the same either way.
 */
export function coveringRegions(all: readonly Region[], i: number): Region[] {
  const r = all[i];
  const box = boxOf(r);
  const out: Region[] = [];
  for (let j = i + 1; j < all.length; j++) if (all[j].class !== r.class && overlap(box, boxOf(all[j]))) out.push(all[j]);
  return out;
}

const polygon = (r: Region) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [r.outer, ...r.inner] as number[][][] } });

/**
 * The part of `r` still visible under `over`, as MultiPolygon coordinates; null when it is wholly covered; undefined
 * when nothing covers it (or the geometry could not be worked out, in which case it is shown whole).
 */
export function visibleGeometry(r: Region, over: readonly Region[]): Pt[][][] | null | undefined {
  if (!over.length) return undefined;
  try {
    const result = difference({ type: "FeatureCollection", features: [polygon(r), ...over.map(polygon)] });
    if (!result) return null;
    const g = result.geometry;
    return (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as Pt[][][];
  } catch {
    return undefined;
  }
}
