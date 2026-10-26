import { invert, transform, type Mat4, type Vec3 } from "../../gfx/math/mat4";

/** A line of sight: where it starts and the unit direction it looks. Course axes: x east, y up, z south. */
export type Ray = { origin: Vec3; dir: Vec3 };

/** The ground's height in metres (exaggeration applied) at a course point, or null where there is none. */
export type Heights = (x: number, z: number) => number | null;

/** A pixel of a picture `width` by `height` pixels as clip-space x and y (both -1 to 1, y up). */
export const ndcOf = (px: number, py: number, width: number, height: number): [number, number] => [(px / width) * 2 - 1, 1 - (py / height) * 2];

const unproject = (inverse: Mat4, x: number, y: number, z: number): Vec3 => {
  const [px, py, pz, w] = transform(inverse, [x, y, z]);
  return [px / w, py / w, pz / w];
};

/** The line of sight through a point of the picture, given the camera's view-projection matrix. */
export function rayThrough(viewProj: Mat4, x: number, y: number): Ray | null {
  const inverse = invert(viewProj);
  if (!inverse) return null;
  const near = unproject(inverse, x, y, -1), far = unproject(inverse, x, y, 1);
  const d: Vec3 = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
  const length = Math.hypot(...d);
  if (!(length > 0)) return null;
  return { origin: near, dir: [d[0] / length, d[1] / length, d[2] / length] };
}

/** Never step less than this many metres, nor more than this fraction of the way already travelled. */
const MIN_STEP = 0.5;
const STEP_GROWTH = 0.01;
const BISECTIONS = 14;

/**
 * Where a line of sight first meets the ground, as a course point, or null if it never does within `maxDistance` metres.
 * It walks along the ray in steps that grow with distance (a cursor needs no more than a pixel's precision), and once a
 * step ends below the ground it narrows down between the two ends.
 */
export function pickGround(ray: Ray, height: Heights, maxDistance: number): [number, number] | null {
  const at = (t: number): Vec3 => [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
  const below = (t: number) => {
    const p = at(t);
    const h = height(p[0], p[2]);
    return h !== null && p[1] <= h;
  };
  if (below(0)) return null; // the eye is under the ground: nothing sensible to point at
  let near = 0;
  while (near < maxDistance) {
    const far = Math.min(maxDistance, near + Math.max(MIN_STEP, near * STEP_GROWTH));
    if (below(far)) {
      let lo = near, hi = far;
      for (let i = 0; i < BISECTIONS; i++) {
        const mid = (lo + hi) / 2;
        if (below(mid)) hi = mid;
        else lo = mid;
      }
      const p = at(hi);
      return [p[0], p[2]];
    }
    near = far;
  }
  return null;
}

/** Where a line of sight crosses the horizontal plane at height `y`, as a course point, or null if it never does within `maxDistance`. */
export function pickPlane(ray: Ray, y: number, maxDistance: number): [number, number] | null {
  if (Math.abs(ray.dir[1]) < 1e-9) return null;
  const t = (y - ray.origin[1]) / ray.dir[1];
  if (!(t >= 0) || t > maxDistance) return null;
  return [ray.origin[0] + ray.dir[0] * t, ray.origin[2] + ray.dir[2] * t];
}
