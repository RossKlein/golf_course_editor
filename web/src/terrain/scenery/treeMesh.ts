// Tree models built from the look's parts: cones and faceted balls, flat-shaded, each 1 unit tall standing on y = 0.

import type { TreeKind } from "../../core/api/api";

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

/** A tree model built from its look: parts of cones and faceted balls, 1 unit tall standing on y = 0. */
export function treeMesh(kind: TreeKind): Mesh {
  const b = new Builder();
  for (const p of kind.parts) {
    if (p.shape === "frustum") b.frustum(p.y0, p.r0, p.y1, p.r1, p.sides, p.color, p.shade);
    else b.blob(p.cx, p.cy, p.cz, p.rx, p.ry, p.rz, p.color, p.sides, p.rings);
  }
  return b.build();
}
