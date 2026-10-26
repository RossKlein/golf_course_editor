import { lookAt, multiply, perspective, type Mat4, type Vec3 } from "../../gfx/math/mat4";

/**
 * An orbit camera looking at a point on the ground. Course axes: x east, y up, z south.
 *  - `x`, `z`: the ground point it looks at
 *  - `yaw`: the compass bearing it looks toward, radians clockwise from north
 *  - `pitch`: how far it looks down, radians (0 is the horizon, a quarter turn is straight down)
 *  - `distance`: metres from that point
 */
export type Camera = { x: number; z: number; yaw: number; pitch: number; distance: number };

export const FOV = (45 * Math.PI) / 180;
export const MIN_DISTANCE = 4;
export const MAX_DISTANCE = 8000;
const MIN_PITCH = (4 * Math.PI) / 180;
const MAX_PITCH = (89 * Math.PI) / 180;
/** Metres the eye stays above the ground. */
const CLEARANCE = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The ground height under a point; the camera never goes below it. */
export type Ground = (x: number, z: number) => number;

/** Compass bearing as a horizontal direction in (x, z): north is -z. */
const forward = (yaw: number): [number, number] => [Math.sin(yaw), -Math.cos(yaw)];
const right = (yaw: number): [number, number] => [Math.cos(yaw), Math.sin(yaw)];

export function eyeOf(cam: Camera, ground: Ground): Vec3 {
  const [fx, fz] = forward(cam.yaw);
  const horizontal = cam.distance * Math.cos(cam.pitch);
  const x = cam.x - fx * horizontal;
  const z = cam.z - fz * horizontal;
  const y = ground(cam.x, cam.z) + cam.distance * Math.sin(cam.pitch);
  return [x, Math.max(y, ground(x, z) + CLEARANCE), z];
}

/** Turn around the target: dragging right swings the view left, dragging down tips it toward the horizon. */
export function orbit(cam: Camera, dxPx: number, dyPx: number): Camera {
  return { ...cam, yaw: cam.yaw - dxPx * 0.006, pitch: clamp(cam.pitch + dyPx * 0.005, MIN_PITCH, MAX_PITCH) };
}

/** Metres on the ground that one screen pixel spans at the target. */
const metresPerPixel = (cam: Camera, viewportHeight: number) => (2 * cam.distance * Math.tan(FOV / 2)) / Math.max(1, viewportHeight);

/** Drag the ground: it follows the pointer. */
export function pan(cam: Camera, dxPx: number, dyPx: number, viewportHeight: number): Camera {
  const k = metresPerPixel(cam, viewportHeight);
  const [rx, rz] = right(cam.yaw);
  const [fx, fz] = forward(cam.yaw);
  const along = (k * dyPx) / Math.max(0.2, Math.sin(cam.pitch)); // the ground is foreshortened when looking across it
  return { ...cam, x: cam.x - rx * dxPx * k + fx * along, z: cam.z - rz * dxPx * k + fz * along };
}

/** Move by a fraction of the view, for the keyboard: x to the right, y forward. */
export function nudge(cam: Camera, fx: number, fy: number): Camera {
  const step = cam.distance * 0.5;
  const [rx, rz] = right(cam.yaw);
  const [ax, az] = forward(cam.yaw);
  return { ...cam, x: cam.x + (rx * fx + ax * fy) * step, z: cam.z + (rz * fx + az * fy) * step };
}

/** Dolly toward or away from the target; factor above 1 comes closer. */
export function zoom(cam: Camera, factor: number): Camera {
  return { ...cam, distance: clamp(cam.distance / factor, MIN_DISTANCE, MAX_DISTANCE) };
}

/** Where the 3D view starts when opened over a 2D view `visibleHeight` metres tall, centred on (x, z). */
export function cameraFor(x: number, z: number, visibleHeight: number, previous?: Camera): Camera {
  return {
    yaw: previous?.yaw ?? 0,
    pitch: previous?.pitch ?? (50 * Math.PI) / 180,
    x,
    z,
    distance: clamp(visibleHeight / (2 * Math.tan(FOV / 2)), MIN_DISTANCE, MAX_DISTANCE),
  };
}

/** The ground height, in metres, that the camera sees across the middle of its picture; the inverse of cameraFor. */
export const visibleHeightOf = (cam: Camera) => 2 * cam.distance * Math.tan(FOV / 2);

export type Matrices = { eye: Vec3; view: Mat4; proj: Mat4; viewProj: Mat4 };

export function matricesOf(cam: Camera, aspect: number, ground: Ground): Matrices {
  const eye = eyeOf(cam, ground);
  const target: Vec3 = [cam.x, ground(cam.x, cam.z), cam.z];
  const view = lookAt(eye, target);
  const proj = perspective(FOV, aspect, Math.max(0.5, cam.distance * 0.03), 60000);
  return { eye, view, proj, viewProj: multiply(proj, view) };
}

/**
 * The patch of ground to draw as a mesh. A grid of `quads` squares around the target, with the squares as fine as the
 * camera distance allows, so a close view is detailed and a far one still reaches the horizon. The corner snaps to a
 * whole number of 32 squares so the mesh does not crawl as the camera moves.
 */
/**
 * The square of ground the design is painted onto: a power-of-two size, about four times the camera distance, so the
 * paint stays close to one texel per screen pixel whether you are looking at a green or the whole course. It snaps to
 * an eighth of its size so it is repainted only after a real move.
 */
export function drapeWindow(cam: Camera, minSize = 16, maxSize = 16384): { x: number; z: number; w: number; h: number } {
  const size = Math.min(maxSize, Math.max(minSize, 2 ** Math.ceil(Math.log2(cam.distance * 4))));
  const quantum = size / 8;
  return {
    x: Math.floor((cam.x - size / 2) / quantum) * quantum,
    z: Math.floor((cam.z - size / 2) / quantum) * quantum,
    w: size,
    h: size,
  };
}

export const MESH_QUADS = 512;
const SPACINGS = [0.5, 1, 2, 4, 8, 16, 32];

export type MeshWindow = { spacing: number; quads: number; x0: number; z0: number };
/** How many times coarser each outer ring of terrain is than the one inside it, and how many rings there are. */
export const RING_STEP = 4;
export const RINGS = 3;

/** One ring of the terrain mesh: level 0 is the detailed one around the target, each further level is RING_STEP times coarser. */
export function meshWindow(cam: Camera, level = 0): MeshWindow {
  const spacing = (SPACINGS.find((s) => s * MESH_QUADS >= cam.distance * 5) ?? SPACINGS[SPACINGS.length - 1]) * RING_STEP ** level;
  const quantum = spacing * 32;
  const half = (MESH_QUADS * spacing) / 2;
  return {
    spacing,
    quads: MESH_QUADS,
    x0: Math.floor((cam.x - half) / quantum) * quantum,
    z0: Math.floor((cam.z - half) / quantum) * quantum,
  };
}

/**
 * All the rings, from the outermost to the detailed one in the middle. Each outer ring covers the ones inside it, which
 * leave out of it only what they draw themselves, so the ground reaches the horizon even from low down.
 */
export function meshLevels(cam: Camera): MeshWindow[] {
  return Array.from({ length: RINGS }, (_, i) => meshWindow(cam, RINGS - 1 - i));
}
