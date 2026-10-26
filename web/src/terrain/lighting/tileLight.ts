import { lookAt, multiply, ortho, transform, type Mat4, type Vec3 } from "../../gfx/math/mat4";

/** A rectangle of ground, in course metres. */
export type TileRect = { x0: number; z0: number; x1: number; z1: number };

/**
 * The sun's view of one tile of the ground, for a shadow map of a fixed density: an orthographic camera looking along the sun
 * that takes in the tile and everything standing above it that could shade it. A caster is on the ray from a point on the
 * ground toward the sun, so it lands on the same place in the map as the point and nearer the camera; the map has to reach
 * back toward the sun as far as the tallest caster can shade, which is `casterTop` metres tall at the sun's angle.
 *
 * `yLo` and `yHi` bound the ground, `casterTop` is the height of the tallest thing standing on it, `sun` is the unit vector
 * toward the sun (x east, y up, z south), and `reachCap` limits how far back toward a low sun it looks. Returns the matrix
 * from world to clip space and the depth the map spans in metres, or null if the sun is too low to light the ground.
 */
export function tileLight(rect: TileRect, yLo: number, yHi: number, casterTop: number, sun: Vec3, reachCap: number): { viewProj: Mat4; range: number } | null {
  const horizontal = Math.hypot(sun[0], sun[2]);
  if (sun[1] <= 0.02) return null;
  const reach = Math.min(reachCap, casterTop / (sun[1] / Math.max(horizontal, 1e-6)));
  const [dx, dz] = horizontal > 1e-6 ? [sun[0] / horizontal, sun[2] / horizontal] : [0, 0];
  const corners: Vec3[] = [];
  for (const x of [rect.x0, rect.x1]) for (const z of [rect.z0, rect.z1]) for (const y of [yLo, yHi + casterTop]) {
    corners.push([x, y, z], [x + dx * reach, y, z + dz * reach]); // and the same, back toward the sun
  }
  const centre = corners.reduce((a, c) => [a[0] + c[0] / corners.length, a[1] + c[1] / corners.length, a[2] + c[2] / corners.length] as Vec3, [0, 0, 0] as Vec3);
  const eye: Vec3 = [centre[0] + sun[0] * 1000, centre[1] + sun[1] * 1000, centre[2] + sun[2] * 1000];
  const view = lookAt(eye, centre, Math.abs(sun[1]) > 0.99 ? [0, 0, -1] : [0, 1, 0]);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of corners) {
    const [x, y, z] = transform(view, c);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const near = -maxZ - 1, far = -minZ + 1; // the camera looks down -z, so the nearest points have the greatest z
  return { viewProj: multiply(ortho(minX, maxX, minY, maxY, near, far), view), range: far - near };
}
