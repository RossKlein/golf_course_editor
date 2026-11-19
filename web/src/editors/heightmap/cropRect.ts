import type { Pt } from "../../core/geometry/coords";

/** The part of the map to keep, in whole course metres, edges included: samples x0..x1 east and z0..z1 south of the 1 m height grid. */
export type CropRect = { x0: number; z0: number; x1: number; z1: number };
/** The map's size in metres (its columns and rows less one). */
export type MapSize = { w: number; h: number };

/** The server refuses a crop smaller than this on a side (course_maker/build/crop.py, MIN_SIDE_M). */
export const MIN_SIDE = 8;

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

export const wholeMap = (m: MapSize): CropRect => ({ x0: 0, z0: 0, x1: m.w, z1: m.h });
export const sizeOf = (r: CropRect) => ({ w: r.x1 - r.x0, h: r.z1 - r.z0 });
export const isWhole = (r: CropRect, m: MapSize) => r.x0 === 0 && r.z0 === 0 && r.x1 === m.w && r.z1 === m.h;
export const sameRect = (a: CropRect, b: CropRect) => a.x0 === b.x0 && a.z0 === b.z0 && a.x1 === b.x1 && a.z1 === b.z1;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Whole metres, inside the map, and at least MIN_SIDE across. */
export function tidy(r: CropRect, m: MapSize): CropRect {
  const x0 = clamp(Math.round(Math.min(r.x0, r.x1)), 0, m.w - MIN_SIDE), z0 = clamp(Math.round(Math.min(r.z0, r.z1)), 0, m.h - MIN_SIDE);
  const x1 = clamp(Math.round(Math.max(r.x0, r.x1)), x0 + MIN_SIDE, m.w), z1 = clamp(Math.round(Math.max(r.z0, r.z1)), z0 + MIN_SIDE, m.h);
  return { x0: Math.min(x0, x1 - MIN_SIDE), z0: Math.min(z0, z1 - MIN_SIDE), x1, z1 };
}

/** What of the rectangle is under the point: a corner, an edge (within `tol` metres of it), or its inside. Null away from it. */
export function hitHandle(r: CropRect, [x, z]: Pt, tol: number): Handle | null {
  const within = x >= r.x0 - tol && x <= r.x1 + tol && z >= r.z0 - tol && z <= r.z1 + tol;
  if (!within) return null;
  const west = Math.abs(x - r.x0) <= tol, east = Math.abs(x - r.x1) <= tol, north = Math.abs(z - r.z0) <= tol, south = Math.abs(z - r.z1) <= tol;
  if (north && west) return "nw";
  if (north && east) return "ne";
  if (south && west) return "sw";
  if (south && east) return "se";
  if (north) return "n";
  if (south) return "s";
  if (west) return "w";
  if (east) return "e";
  return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 ? "move" : null;
}

/** The rectangle after a drag of `handle` from `from` to `to` (both in course metres), starting from `start`. */
export function dragHandle(start: CropRect, handle: Handle, from: Pt, to: Pt, m: MapSize): CropRect {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  if (handle === "move") {
    const w = start.x1 - start.x0, h = start.z1 - start.z0;
    const x0 = clamp(Math.round(start.x0 + dx), 0, m.w - w), z0 = clamp(Math.round(start.z0 + dz), 0, m.h - h);
    return { x0, z0, x1: x0 + w, z1: z0 + h };
  }
  const r = { ...start };
  if (handle.includes("w")) r.x0 = clamp(Math.round(start.x0 + dx), 0, start.x1 - MIN_SIDE);
  if (handle.includes("e")) r.x1 = clamp(Math.round(start.x1 + dx), start.x0 + MIN_SIDE, m.w);
  if (handle.includes("n")) r.z0 = clamp(Math.round(start.z0 + dz), 0, start.z1 - MIN_SIDE);
  if (handle.includes("s")) r.z1 = clamp(Math.round(start.z1 + dz), start.z0 + MIN_SIDE, m.h);
  return r;
}

/** The rectangle drawn by dragging from one corner to the other, or null when it is too small to mean it. */
export function boxFromPoints(a: Pt, b: Pt, m: MapSize): CropRect | null {
  const r = {
    x0: clamp(Math.round(Math.min(a[0], b[0])), 0, m.w),
    z0: clamp(Math.round(Math.min(a[1], b[1])), 0, m.h),
    x1: clamp(Math.round(Math.max(a[0], b[0])), 0, m.w),
    z1: clamp(Math.round(Math.max(a[1], b[1])), 0, m.h),
  };
  return r.x1 - r.x0 < MIN_SIDE || r.z1 - r.z0 < MIN_SIDE ? null : r;
}

/** The mouse cursor for a handle. */
export const CURSORS: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", move: "move" };

/** The rectangle left after trimming these metres off each side (a negative trim is taken as none). */
export function trimmed(m: MapSize, t: { west: number; east: number; north: number; south: number }): CropRect {
  return tidy({ x0: Math.max(0, t.west), z0: Math.max(0, t.north), x1: m.w - Math.max(0, t.east), z1: m.h - Math.max(0, t.south) }, m);
}
