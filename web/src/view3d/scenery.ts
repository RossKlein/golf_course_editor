// The things that make the 3D view look like the game rather than a map: trees built from a few flat-shaded primitives, as
// the game builds its own, where trees go in a wood, and which way the mowing stripes run on each hole.

export const WOODS_CLASS = 8;
export const MAX_HOLES = 24;

/** A deterministic number in [0, 1) from two integers. */
export function hash2(a: number, b: number, seed = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export type ClassImage = { data: ArrayLike<number>; width: number; height: number };

/**
 * Trees to show where a bundle has none yet: one in each cell of a jittered grid wherever the class map says woods. The
 * same spacing and look the tree editor will build from, so what you see is roughly what you will get. Returns
 * x, z, height (metres) and kind for each tree, packed four to a tree.
 */
export function scatterWoods(img: ClassImage, res: number, spacing = 5, seed = 1): Float32Array {
  const out: number[] = [];
  const nx = Math.ceil((img.width * res) / spacing), nz = Math.ceil((img.height * res) / spacing);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.15 + 0.7 * hash2(i, j, seed)) * spacing;
      const z = (j + 0.15 + 0.7 * hash2(i, j, seed + 1)) * spacing;
      const c = Math.min(img.width - 1, Math.floor(x / res)), r = Math.min(img.height - 1, Math.floor(z / res));
      if (img.data[(r * img.width + c) * 4] !== WOODS_CLASS) continue;
      const kind = Math.floor(hash2(i, j, seed + 2) * 3);
      out.push(x, z, kind === 1 ? 9 + 6 * hash2(i, j, seed + 3) : 14 + 10 * hash2(i, j, seed + 3), kind);
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

export const TREE_KINDS = 3;

/** Kinds partitioned: the packed trees of each of the model kinds, so each can be drawn with its own mesh. */
export function splitByKind(trees: Float32Array): Float32Array[] {
  const groups: number[][] = Array.from({ length: TREE_KINDS }, () => []);
  for (let i = 0; i < trees.length; i += 4) groups[trees[i + 3] % TREE_KINDS].push(trees[i], trees[i + 1], trees[i + 2], trees[i + 3]);
  return groups.map((g) => new Float32Array(g));
}

/**
 * The direction across a hole's mowing stripes, as a unit (x, z): perpendicular to the line from tee to green, because
 * stripes run along the line of play. A hole without a route gets stripes across x.
 */
export function stripeAcross(route: readonly (readonly [number, number])[]): [number, number] {
  if (route.length < 2) return [1, 0];
  const [x0, z0] = route[0], [x1, z1] = route[route.length - 1];
  const len = Math.hypot(x1 - x0, z1 - z0);
  return len < 1e-6 ? [1, 0] : [-(z1 - z0) / len, (x1 - x0) / len];
}

/** One across-direction per hole number, 24 of them flattened to x, z pairs for a uniform array. */
export function stripeDirections(routes: readonly (readonly (readonly [number, number])[])[]): Float32Array {
  const out = new Float32Array(MAX_HOLES * 2);
  for (let h = 0; h < MAX_HOLES; h++) out.set(stripeAcross(routes[h] ?? []), h * 2);
  return out;
}

// ---- tree meshes -----------------------------------------------------------------------------------------------------

export type Mesh = {
  /** x, y, z per vertex, for a tree 1 unit tall standing on y = 0. Triangles are not indexed, so each face has its own normal. */
  positions: Float32Array;
  normals: Float32Array;
  /** r, g, b per vertex */
  colors: Float32Array;
};

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];

  /**
   * A flat triangle. Its normal and winding are made to face away from `inside`, a point inside the solid it belongs to,
   * so a face is lit the right way round whichever way it was written down. Zero-area triangles (a cone's tip) are dropped.
   */
  tri(a: V, b: V, c: V, color: V, inside: V) {
    let n = cross(sub(b, a), sub(c, a));
    if (Math.hypot(...n) < 1e-9) return;
    n = unit(n);
    const centre: V = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const out = sub(centre, inside);
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) {
      n = [-n[0], -n[1], -n[2]];
      [b, c] = [c, b];
    }
    for (const p of [a, b, c]) {
      this.positions.push(...p);
      this.normals.push(...n);
      this.colors.push(...color);
    }
  }

  /** A cone or a frustum: `sides` faces from a ring at y0 to a ring at y1. The top ring has radius r1, possibly 0. */
  frustum(y0: number, r0: number, y1: number, r1: number, sides: number, color: V, shade = 0.12) {
    const inside: V = [0, (y0 + y1) / 2, 0];
    const p = (a: number, y: number, r: number): V => [Math.cos(a) * r, y, Math.sin(a) * r];
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const lit = 1 - shade * (i % 2); // alternate faces a little darker, the way a low-poly model catches light
      const col: V = [color[0] * lit, color[1] * lit, color[2] * lit];
      this.tri(p(a0, y0, r0), p(a1, y0, r0), p(a1, y1, r1), col, inside);
      this.tri(p(a0, y0, r0), p(a1, y1, r1), p(a0, y1, r1), col, inside);
      if (r0 > 0) this.tri([0, y0, 0], p(a0, y0, r0), p(a1, y0, r0), [color[0] * 0.6, color[1] * 0.6, color[2] * 0.6], [0, y0 + 1, 0]); // underside
    }
  }

  /** A faceted ball of `rings` bands, squashed to (rx, ry, rz) about the centre (cx, cy, cz). */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: V, sides = 7, rings = 3) {
    const centre: V = [cx, cy, cz];
    const at = (i: number, j: number): V => {
      const lat = -Math.PI / 2 + (i / rings) * Math.PI, lon = (j / sides) * Math.PI * 2 + (i % 2) * (Math.PI / sides);
      return [cx + Math.cos(lat) * Math.cos(lon) * rx, cy + Math.sin(lat) * ry, cz + Math.cos(lat) * Math.sin(lon) * rz];
    };
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < sides; j++) {
        const lit = 1 - 0.1 * ((i + j) % 2);
        const col: V = [color[0] * lit, color[1] * lit, color[2] * lit];
        this.tri(at(i, j), at(i, j + 1), at(i + 1, j), col, centre);
        this.tri(at(i, j + 1), at(i + 1, j + 1), at(i + 1, j), col, centre);
      }
    }
  }

  build(): Mesh {
    return { positions: new Float32Array(this.positions), normals: new Float32Array(this.normals), colors: new Float32Array(this.colors) };
  }
}

const TRUNK: V = [0.42, 0.29, 0.18];

/** The tree models, each 1 unit tall on y = 0: a tall pine, a round broadleaf and a layered fir. */
export function treeMesh(kind: number): Mesh {
  const b = new Builder();
  switch (kind % TREE_KINDS) {
    case 0: // pine: a long bare trunk and a narrow crown of stacked cones
      b.frustum(0, 0.028, 0.4, 0.02, 6, TRUNK);
      b.frustum(0.3, 0.17, 0.62, 0.0, 7, [0.16, 0.42, 0.2]);
      b.frustum(0.5, 0.14, 0.82, 0.0, 7, [0.19, 0.48, 0.23]);
      b.frustum(0.7, 0.1, 1.0, 0.0, 7, [0.22, 0.54, 0.26]);
      break;
    case 1: // broadleaf: a short trunk and a wide faceted crown
      b.frustum(0, 0.04, 0.42, 0.03, 6, TRUNK);
      b.blob(0, 0.68, 0, 0.3, 0.3, 0.3, [0.3, 0.6, 0.2]);
      b.blob(0.1, 0.84, 0.05, 0.19, 0.17, 0.19, [0.4, 0.7, 0.25]);
      break;
    default: // fir: dense overlapping cones from low down
      b.frustum(0, 0.03, 0.2, 0.025, 6, TRUNK);
      b.frustum(0.12, 0.26, 0.5, 0.0, 8, [0.1, 0.35, 0.2]);
      b.frustum(0.34, 0.2, 0.74, 0.0, 8, [0.13, 0.41, 0.23]);
      b.frustum(0.56, 0.14, 1.0, 0.0, 8, [0.16, 0.47, 0.26]);
  }
  return b.build();
}
