import { invert, lookAt, multiply, ortho, project, type Mat4, type Vec3 } from "../../../gfx/math/mat4";

// Fitting the sun's shadow maps to what the camera sees. The view is cut into slices by distance, nearest first, and each
// slice gets its own orthographic map along the sun's direction, so shadows are crisp close up and coarser far away. Pure
// maths: the GPU side is shadow.ts.

/** One slice's map: where a world point lands in it, and what a texel of it covers. */
export type Cascade = {
  /** World to the light's clip space (for drawing casters into the map). */
  viewProj: Mat4;
  /** World to the map's texture coordinates, u and v and depth each 0 to 1 (for looking a shadow up). */
  texMat: Mat4;
  /** Distance along the view direction where this slice ends. */
  far: number;
  /** Metres one texel covers. */
  texel: number;
  /** Metres from the map's near plane to its far plane, to turn a depth bias in metres into the map's units. */
  range: number;
};

export type Fit = {
  cascades: Cascade[];
  /** Unit vector of the view direction, to tell which slice a point is in. */
  forward: Vec3;
};

export type FitInput = {
  /** The camera's view-projection. */
  viewProj: Mat4;
  eye: Vec3;
  /** Unit vector towards the sun. */
  sunDir: Vec3;
  /** Shadows fade out at this many metres from the camera. */
  distance: number;
  count: number;
  /** Texels across each map. */
  size: number;
  /** How far towards the sun, in metres, things that can cast onto a slice may be. */
  reach: number;
};

const BIAS = Float32Array.from([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1]);

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1));
const mean = (ps: Vec3[]): Vec3 => scale(ps.reduce(add), 1 / ps.length);

/**
 * Where each of `count` slices ends, as distances along the view direction between `near` and `far`: a blend of even and
 * logarithmic spacing, so the nearest slices are thin and detailed. The last is `far`.
 */
export function splitDistances(near: number, far: number, count: number, blend = 0.6): number[] {
  const out: number[] = [];
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    const even = near + (far - near) * t;
    const log = near * Math.pow(far / near, t);
    out.push(i === count ? far : blend * log + (1 - blend) * even);
  }
  return out;
}

/** The camera's view volume as eight corners: the four on the near plane, then the four on the far plane. */
function corners(viewProj: Mat4): Vec3[] | null {
  const inv = invert(viewProj);
  if (!inv) return null;
  const out: Vec3[] = [];
  for (const z of [-1, 1]) for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push(project(inv, [x, y, z]));
  return out;
}

/** The corners of the part of the view volume between two distances along the view direction. */
export function sliceCorners(viewProj: Mat4, eye: Vec3, d0: number, d1: number): Vec3[] | null {
  const c = corners(viewProj);
  if (!c) return null;
  const forward = unit(sub(mean(c.slice(4)), mean(c.slice(0, 4))));
  const near = dot(sub(mean(c.slice(0, 4)), eye), forward), far = dot(sub(mean(c.slice(4)), eye), forward);
  const at = (d: number) => c.slice(0, 4).map((n, k) => add(n, scale(sub(c[4 + k], n), (d - near) / (far - near))));
  return [...at(d0), ...at(d1)];
}

/**
 * The shadow maps for a camera and a sun, or null if the view cannot be fitted (or nothing is within range). Each map is
 * a box around the slice's bounding sphere, moved in whole texels so that edges do not shimmer as the camera moves.
 */
export function fitCascades(inp: FitInput): Fit | null {
  const c = corners(inp.viewProj);
  if (!c) return null;
  const nearC = c.slice(0, 4), farC = c.slice(4);
  const forward = unit(sub(mean(farC), mean(nearC)));
  const near = dot(sub(mean(nearC), inp.eye), forward), far = dot(sub(mean(farC), inp.eye), forward);
  const reach = Math.min(far, inp.distance);
  if (!(reach > near) || inp.count < 1) return null;

  const toSun = unit(inp.sunDir);
  const back = toSun; // the light's z axis points at the sun: it looks down -z
  const up = Math.abs(back[1]) > 0.99 ? ([1, 0, 0] as Vec3) : ([0, 1, 0] as Vec3);
  const xAxis = unit(cross(up, back));
  const yAxis = cross(back, xAxis);

  const splits = splitDistances(near, reach, inp.count);
  const cascades: Cascade[] = splits.map((end, i) => {
    const start = i === 0 ? near : splits[i - 1];
    const pts = [start, end].flatMap((d) => nearC.map((n, k) => add(n, scale(sub(farC[k], n), (d - near) / (far - near)))));
    const mid = mean(pts);
    const r = Math.ceil(Math.max(...pts.map((p) => Math.hypot(...sub(p, mid)))) * 8) / 8; // quantised, so the size is steady
    const texel = (2 * r) / inp.size;
    // snap the centre to the map's texel grid, in the light's own axes
    const sx = Math.round(dot(mid, xAxis) / texel) * texel - dot(mid, xAxis);
    const sy = Math.round(dot(mid, yAxis) / texel) * texel - dot(mid, yAxis);
    const centre = add(mid, add(scale(xAxis, sx), scale(yAxis, sy)));
    const range = inp.reach + 2 * r;
    const lightEye = add(centre, scale(toSun, inp.reach + r));
    const viewProj = multiply(ortho(-r, r, -r, r, 0, range), lookAt(lightEye, centre, up));
    return { viewProj, texMat: multiply(BIAS, viewProj), far: end, texel, range };
  });
  return { cascades, forward };
}
