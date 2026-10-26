// Where trees are: a bundle's trees.bin, a scatter over the woods where there is none yet, and the grouping the renderer
// draws them in. A tree is x, z, height (metres) and kind, packed four to a tree.

import type { TreeKind } from "../../api/api";
import { hash2 } from "./hash";

export const WOODS_CLASS = 8;

export type ClassImage ={ data: ArrayLike<number>; width: number; height: number };

/**
 * Trees to show where a bundle has none yet: one in each cell of a jittered grid wherever the class map says woods. The
 * same spacing and look the tree editor will build from, so what you see is roughly what you will get. A tree's kind is
 * one of the look's, and its height is within that kind's range. Returns x, z, height (metres) and kind for each tree,
 * packed four to a tree.
 */
export function scatterWoods(img: ClassImage, res: number, kinds: readonly TreeKind[], spacing = 5, seed = 1): Float32Array {
  const out: number[] = [];
  const nx = Math.ceil((img.width * res) / spacing), nz = Math.ceil((img.height * res) / spacing);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.15 + 0.7 * hash2(i, j, seed)) * spacing;
      const z = (j + 0.15 + 0.7 * hash2(i, j, seed + 1)) * spacing;
      const c = Math.min(img.width - 1, Math.floor(x / res)), r = Math.min(img.height - 1, Math.floor(z / res));
      if (img.data[(r * img.width + c) * 4] !== WOODS_CLASS) continue;
      const kind = Math.min(kinds.length - 1, Math.floor(hash2(i, j, seed + 2) * kinds.length));
      const [low, high] = kinds[kind].height;
      out.push(x, z, low + (high - low) * hash2(i, j, seed + 3), kind);
    }
  }
  return new Float32Array(out);
}

/** Trees from a bundle's trees.bin as x, z, height (metres), kind. */
export function treesFromBin(bytes: ArrayBuffer): Float32Array {
  const dv = new DataView(bytes);
  const n = Math.floor(dv.byteLength / 12);
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = dv.getFloat32(i * 12, true);
    out[i * 4 + 1] = dv.getFloat32(i * 12 + 4, true);
    out[i * 4 + 2] = dv.getUint16(i * 12 + 8, true) / 100;
    out[i * 4 + 3] = dv.getUint8(i * 12 + 10);
  }
  return out;
}

/** Kinds partitioned: the packed trees of each of the look's `kinds` models, so each can be drawn with its own mesh. A kind past the last wraps. */
export function splitByKind(trees: Float32Array, kinds: number): Float32Array[] {
  const groups: number[][] = Array.from({ length: kinds }, () => []);
  for (let i = 0; i < trees.length; i += 4) groups[trees[i + 3] % kinds].push(trees[i], trees[i + 1], trees[i + 2], trees[i + 3]);
  return groups.map((g) => new Float32Array(g));
}

/** A square of ground's trees, as a run of the sorted array: `first` and `count` are in trees, the bounds are in metres. */
export type TreeChunk = { first: number; count: number; x0: number; z0: number; x1: number; z1: number; tallest: number };

/** Metres across a chunk of trees: small enough to rule out most of the course from one view, large enough to be few draws. */
export const CHUNK_METRES = 100;

/**
 * Trees sorted into squares of ground, so a draw can skip the squares that are out of view. `sorted` has the same packed
 * trees as the input, ordered chunk by chunk; `chunks` say where each run is and how much ground (and height) it covers.
 */
export function chunkTrees(trees: Float32Array, size = CHUNK_METRES): { sorted: Float32Array; chunks: TreeChunk[] } {
  const n = trees.length / 4;
  const keyOf = (i: number) => `${Math.floor(trees[i * 4] / size)},${Math.floor(trees[i * 4 + 1] / size)}`;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = keyOf(i);
    const list = buckets.get(key);
    if (list) list.push(i);
    else buckets.set(key, [i]);
  }
  const sorted = new Float32Array(trees.length);
  const chunks: TreeChunk[] = [];
  let first = 0;
  for (const list of buckets.values()) {
    const c: TreeChunk = { first, count: list.length, x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity, tallest: 0 };
    for (const i of list) {
      const x = trees[i * 4], z = trees[i * 4 + 1], h = trees[i * 4 + 2];
      c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x);
      c.z0 = Math.min(c.z0, z); c.z1 = Math.max(c.z1, z);
      c.tallest = Math.max(c.tallest, h);
      sorted.set(trees.subarray(i * 4, i * 4 + 4), first * 4);
      first++;
    }
    chunks.push(c);
  }
  return { sorted, chunks };
}
