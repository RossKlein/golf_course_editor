// Where two surfaces meet, their grass is not the same height: a green is cut to a few millimetres, a fairway to a centimetre or two,
// rough is five or six. The ground does not move by that much (the mesh could not show it), so the step is only lit: the slope of the
// step is added to the surface's normal-map detail, so the side facing the sun is brighter and the far side darker, as a real edge is.
// The wall of the step is the taller grass's own side, so it lies on the taller surface's side of the line (the foot is at the line,
// the top `width` metres in), and is coloured and textured as the taller grass; the shorter side is level up to the foot, where it is
// darkened a little (it is in the taller's shade), and only where the sun is on the taller grass's side: the shade falls away from the sun.
// The step is drawn as if the difference in height were `gain` times what it is (the look's grass.edgeGain), because a few millimetres of
// real step is too little to see. ground.frag.glsl does the same sums per pixel (gameGround), with the same numbers.

/** Metres of shade at the foot of a step however small. */
export const EDGE_SPREAD_BASE = 0.03;
/** And how many metres more for each metre the step is tall: a tall step shades further. */
export const EDGE_SPREAD_PER_METRE = 3;
/** A step this tall, in metres, gets the whole of the look's shade; a shorter one gets less. */
export const EDGE_FULL_STEP = 0.02;
/** The share of the foot's shade that does not depend on the sun (the grass is always a little shaded by the taller grass beside it). */
export const EDGE_SHADE_AMBIENT = 0.25;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How a value changes per metre of ground, from how it changes per pixel. `dd` is how it changes a pixel across and a pixel down
 * (the screen derivatives); `dpx` and `dpy` are the ground (x, z) a pixel across and a pixel down covers. Zero where the pixel
 * covers no ground (an edge-on view).
 */
export function worldGradient(dd: readonly [number, number], dpx: readonly [number, number], dpy: readonly [number, number]): [number, number] {
  const det = dpx[0] * dpy[1] - dpx[1] * dpy[0];
  if (Math.abs(det) < 1e-12) return [0, 0];
  return [(dpy[1] * dd[0] - dpx[1] * dd[1]) / det, (dpx[0] * dd[1] - dpy[0] * dd[0]) / det];
}

export type EdgeInput = {
  /** Metres from the line between the surfaces, positive on the side of surface a (the heavier one), negative on b's. */
  dist: number;
  /** The unit direction across the line, towards a. */
  normal: readonly [number, number];
  /** The grass height of a and of b, in metres. */
  heightA: number;
  heightB: number;
  /** The look's grass.edgeWidth: metres across the wall of the step, on the taller side. */
  width: number;
  /** The look's grass.edgeShadow: how much the foot of the taller grass is darkened, 0 to 1. */
  shadow: number;
  /** The look's grass.edgeGain: how many times taller than it is the step is drawn, 1 or more. */
  gain: number;
  /** The direction to the sun along the ground (x east, z south), any length; (0, 0) when it is overhead or down. */
  sun: readonly [number, number];
  /** Metres of ground one pixel covers across the line (the larger of the two screen steps projected on `normal`): the step is never narrower than 1.5 pixels, so it does not shimmer, and fades out as pixels grow. */
  pixel: number;
};

export type EdgeResult = {
  /** The ground's height from the step, in metres: the shorter grass's up to the line, rising to the taller's across the wall. */
  height: number;
  /** The slope the step adds to the lighting, (x, z): metres of height per metre of ground, `gain` times the true wall's. Nonzero only on the wall, on the taller side. */
  slope: [number, number];
  /** What the colour is multiplied by, 0 to 1: below 1 on the shorter side, darkest at the foot. */
  occlusion: number;
};

/** The step between two heights of grass at a point near the line between the surfaces. */
export function edgeStep(e: EdgeInput): EdgeResult {
  const rise = (e.heightA - e.heightB) * e.gain;
  const width = Math.max(e.width, 1.5 * e.pixel);
  const into = rise > 0 ? e.dist : -e.dist; // metres into the taller grass from the line
  const t = Math.min(1, Math.max(0, into / width));
  const along = (Math.abs(rise) * 6 * t * (1 - t)) / width; // the wall's slope, up towards the taller grass
  const toward = rise > 0 ? 1 : -1; // which way is the taller grass
  const lower = -into; // metres into the shorter grass
  const spread = EDGE_SPREAD_BASE + EDGE_SPREAD_PER_METRE * Math.abs(rise);
  const sunLength = Math.hypot(e.sun[0], e.sun[1]);
  // the shade is cast away from the sun: full when the sun is over the taller grass, only the ambient share when it is on the shorter
  const facing = sunLength > 1e-4 ? (toward * (e.normal[0] * e.sun[0] + e.normal[1] * e.sun[1])) / sunLength : 0;
  const cast = EDGE_SHADE_AMBIENT + (1 - EDGE_SHADE_AMBIENT) * Math.min(1, Math.max(0, facing));
  const strength = e.shadow * cast * smoothstep(0, EDGE_FULL_STEP, Math.abs(rise)) * (1 - smoothstep(0.5 * spread, 2 * spread, e.pixel));
  return {
    height: Math.min(e.heightA, e.heightB) + Math.abs(e.heightA - e.heightB) * (t * t * (3 - 2 * t)), // the true height: only the lighting is exaggerated
    slope: [e.normal[0] * along * toward + 0, e.normal[1] * along * toward + 0], // + 0 turns -0 into 0
    occlusion: 1 - strength * smoothstep(-0.5 * e.pixel, 0.5 * e.pixel, lower) * (1 - smoothstep(0, spread, lower)),
  };
}
