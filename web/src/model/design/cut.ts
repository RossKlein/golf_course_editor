import difference from "@turf/difference";
import type { Pt } from "../../core/geometry/coords";
import { ringArea } from "../../core/geometry/geometry";
import { boxOf } from "./layering";
import { designStore, newId } from "./store";

/** One polygon left over after a cut: an outline and the holes in it. */
export type Part = { outer: Pt[]; inner: Pt[][] };

/** A piece smaller than this, in square metres, is a sliver left by two outlines that nearly met, not a part of the course. */
export const MIN_PART_AREA = 0.05;

const areaOf = (p: Part) => ringArea(p.outer) - p.inner.reduce((a, h) => a + ringArea(h), 0);
const feature = (outer: readonly Pt[], inner: readonly (readonly Pt[])[]) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [outer, ...inner] as unknown as number[][][] } });

/**
 * What is left of a polygon when `cutter` is taken out of it, largest piece first. `[]` when it is cut away entirely, and null when the
 * cutter does not touch it (or the shapes could not be worked out), so the caller leaves it alone. A cutter inside the polygon leaves a
 * hole in it; one across it leaves two pieces.
 */
export function cutPolygon(outer: readonly Pt[], inner: readonly (readonly Pt[])[], cutter: readonly Pt[]): Part[] | null {
  let result;
  try {
    result = difference({ type: "FeatureCollection", features: [feature(outer, inner), feature(cutter, [])] });
  } catch {
    return null;
  }
  if (!result) return [];
  const g = result.geometry;
  const polygons = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as Pt[][][];
  const parts = polygons.map((p): Part => ({ outer: p[0], inner: p.slice(1) })).filter((p) => areaOf(p) >= MIN_PART_AREA);
  const before = ringArea(outer as Pt[]) - inner.reduce((a, h) => a + ringArea(h as Pt[]), 0);
  const after = parts.reduce((a, p) => a + areaOf(p), 0);
  if (Math.abs(before - after) <= 1e-6 * Math.max(1, before)) return null; // nothing was taken
  return parts.sort((a, b) => areaOf(b) - areaOf(a));
}

export type CutSummary = {
  /** Regions the cutter touched. */
  touched: number;
  /** Regions that were cut away entirely. */
  removed: number;
  /** New regions made because a cut split one in two. */
  created: number;
};

const bounds = (cutter: readonly Pt[]): [number, number, number, number] => [
  Math.min(...cutter.map((p) => p[0])), Math.min(...cutter.map((p) => p[1])), Math.max(...cutter.map((p) => p[0])), Math.max(...cutter.map((p) => p[1])),
];

/**
 * Cut an outline out of regions, as one undo step: `ids` if given, else every region it touches. A region keeps its largest piece (and
 * its id); another piece becomes a region of its own, with the same surface, hole and forest settings, right after it in painter's order.
 * A region with nothing left is deleted. The ground that was cut away is left to whatever lies under it: with nothing, rough.
 */
export function cutRegions(label: string, cutter: readonly Pt[], ids?: readonly string[]): CutSummary {
  const doc = designStore.getState().doc;
  const [cx0, cz0, cx1, cz1] = bounds(cutter);
  const candidates = (ids ?? doc.order).filter((id) => {
    const r = doc.regions[id];
    if (!r) return false;
    const [x0, z0, x1, z1] = boxOf(r);
    return x0 <= cx1 && x1 >= cx0 && z0 <= cz1 && z1 >= cz0;
  });
  const cuts = candidates.flatMap((id) => {
    const r = doc.regions[id];
    const parts = cutPolygon(r.outer as Pt[], r.inner as Pt[][], cutter);
    return parts ? [{ id, parts }] : [];
  });
  const summary: CutSummary = { touched: cuts.length, removed: cuts.filter((c) => !c.parts.length).length, created: cuts.reduce((n, c) => n + Math.max(0, c.parts.length - 1), 0) };
  if (!cuts.length) return summary;

  designStore.getState().commit(label, (d) => {
    for (const { id, parts } of cuts) {
      const at = d.order.indexOf(id);
      if (!parts.length) {
        delete d.regions[id];
        d.order.splice(at, 1);
        continue;
      }
      const original = d.regions[id];
      original.outer = parts[0].outer;
      original.inner = parts[0].inner;
      parts.slice(1).forEach((part, n) => {
        const made = newId("r", d.regions);
        d.regions[made] = { ...JSON.parse(JSON.stringify({ ...original, outer: part.outer, inner: part.inner })), id: made };
        d.order.splice(at + 1 + n, 0, made);
      });
    }
  });
  const survivors = designStore.getState().selected.filter((id) => designStore.getState().doc.regions[id]);
  designStore.getState().select(survivors);
  return summary;
}

/**
 * Take an outline out of a hole's in-bounds areas, as one undo step: only that hole's areas, and only those the outline touches. An area
 * keeps its largest piece (and its id); another piece becomes an area of its own for the same hole. An area with nothing left is deleted.
 */
export function cutBounds(label: string, cutter: readonly Pt[], hole: number): CutSummary {
  const doc = designStore.getState().doc;
  const [cx0, cz0, cx1, cz1] = bounds(cutter);
  const cuts = Object.values(doc.bounds).flatMap((a) => {
    if (a.hole !== hole) return [];
    const [x0, z0, x1, z1] = bounds(a.outer);
    if (x0 > cx1 || x1 < cx0 || z0 > cz1 || z1 < cz0) return [];
    const parts = cutPolygon(a.outer as Pt[], a.inner as Pt[][], cutter);
    return parts ? [{ id: a.id, parts }] : [];
  });
  const summary: CutSummary = { touched: cuts.length, removed: cuts.filter((c) => !c.parts.length).length, created: cuts.reduce((n, c) => n + Math.max(0, c.parts.length - 1), 0) };
  if (!cuts.length) return summary;

  designStore.getState().commit(label, (d) => {
    for (const { id, parts } of cuts) {
      if (!parts.length) {
        delete d.bounds[id];
        continue;
      }
      d.bounds[id].outer = parts[0].outer;
      d.bounds[id].inner = parts[0].inner;
      for (const part of parts.slice(1)) {
        const made = newId("b", d.bounds);
        d.bounds[made] = { id: made, hole, outer: part.outer, inner: part.inner };
      }
    }
  });
  const survivors = designStore.getState().selected.filter((id) => designStore.getState().doc.bounds[id] || designStore.getState().doc.regions[id]);
  designStore.getState().select(survivors);
  return summary;
}
