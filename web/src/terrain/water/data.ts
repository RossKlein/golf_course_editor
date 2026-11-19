export type WaterMesh = { version: 1; lakes: LakeMesh[] };
export type LakeMesh = {
  id: string;
  anchor: [number, number];
  estimatedLevel: number;
  level: number;
  /** Metres the water may spread past the painted outline where the ground is lower than it. */
  excess: number;
  /** The mesh is already cut at its shore, so it is drawn whole. Otherwise (an older mesh) it is a carrier the painted outline clips, unless it has an excess. */
  cut: boolean;
  positions: number[];
  normals: number[];
  indices: number[];
};
/** Reject corrupt geometry before allocating GPU buffers. */
export function parseWaterMesh(value: unknown): WaterMesh {
  const v = value as WaterMesh;
  if (
    !v ||
    v.version !== 1 ||
    !Array.isArray(v.lakes) ||
    v.lakes.length > 10000
  )
    throw new Error("Invalid water mesh version or lake list");
  let count = 0;
  const ids = new Set<string>();
  for (const l of v.lakes) {
    if (
      !l ||
      typeof l.id !== "string" ||
      ids.has(l.id) ||
      !Array.isArray(l.anchor) ||
      l.anchor.length !== 2 ||
      !l.anchor.every(Number.isFinite) ||
      !Number.isFinite(l.level) ||
      !Number.isFinite(l.estimatedLevel)
    )
      throw new Error("Invalid lake metadata");
    ids.add(l.id);
    l.excess ??= 0; // a mesh from before the setting existed
    l.cut ??= false;
    if (!Number.isFinite(l.excess) || l.excess < 0) throw new Error("Invalid lake metadata");
    if (
      !Array.isArray(l.positions) ||
      !Array.isArray(l.normals) ||
      !Array.isArray(l.indices) ||
      l.positions.length % 3 ||
      l.normals.length !== l.positions.length ||
      l.indices.length % 3 ||
      !l.positions.every(Number.isFinite) ||
      !l.normals.every(Number.isFinite) ||
      !l.indices.every(
        (i) => Number.isInteger(i) && i >= 0 && i < l.positions.length / 3,
      )
    )
      throw new Error("Invalid water geometry");
    count += l.positions.length + l.indices.length;
    if (count > 15000000) throw new Error("Water mesh exceeds geometry budget");
  }
  return v;
}
