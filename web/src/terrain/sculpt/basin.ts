// The lake basin: shaping the ground round a lake so that the flat water meets it at the painted outline.
//
// A lake's water is one flat plane, clipped to the outline. The terrain is a 1 m grid of lidar heights that has nothing to do with that
// outline, so where the ground at the outline is higher than the plane it hides the water (a brown rim of lake bed), and where it is
// lower the water floats over a gap. The basin sets the ground from its distance to the outline: inside, a bed that falls away below
// the water; at the outline, a hair below the water; outside, a bank that climbs, then gives way to the natural ground.
// Everything here is plain numbers; the GPU brushes and the saving are elsewhere (sculptor.ts, scene/heightSession.ts).

import { SURFACE_NAMES } from "../limits";

export const WATER_CLASS = SURFACE_NAMES.indexOf("water");

/** The ground at the waterline lies this far below the water, so the water is never under it. Metres. */
export const WATERLINE_SINK = 0.03;
/** How far outside the outline the field of distances reaches, in metres: the widest bank and the largest shift, and some over. */
export const BASIN_REACH = 36;

export type BasinParams = {
  /** Metres the bed lies below the water, far enough from the shore. */
  depth: number;
  /** Metres from the waterline to where the bed reaches that depth: the shore's gentleness. */
  bedWidth: number;
  /** Metres the waterline is moved inside the painted outline (negative: out past it), to meet where the water is actually drawn. */
  shift: number;
  /** Metres the bank stands above the water part way up: a lip along the shore, which gives way to the natural ground behind it. 0 for none. */
  bankRise: number;
  /** Metres outside the waterline over which the bank gives way to the natural ground. */
  bankWidth: number;
  /** 0..1: how much of the natural ground's small bumps the bank keeps. */
  detail: number;
};

export const DEFAULT_BASIN: BasinParams = { depth: 1.5, bedWidth: 6, shift: 0, bankRise: 0.1, bankWidth: 4, detail: 0.5 };

/** The range of each setting: [min, max]. The widest bank and the largest shift are what BASIN_REACH covers. */
export const BASIN_LIMITS: Record<keyof BasinParams, readonly [number, number]> = {
  depth: [0.2, 10],
  bedWidth: [1, 30],
  shift: [-3, 3],
  bankRise: [0, 2],
  bankWidth: [1, 30],
  detail: [0, 1],
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The ground's new height at a point `s` metres outside the painted outline (negative inside it), given its `natural` height, the
 * `bumps` of it above its own surroundings, and the water `level`.
 */
export function basinHeight(s: number, natural: number, bumps: number, level: number, p: BasinParams): number {
  const u = s + p.shift; // metres outside the waterline
  const waterline = level - WATERLINE_SINK;
  if (u <= 0) return waterline - p.depth * smooth(0, p.bedWidth, -u);
  if (u >= p.bankWidth) return natural;
  const climb = smooth(0, 0.5 * p.bankWidth, u); // 0 at the waterline, so the ground starts there, whatever it was
  const bank = waterline + p.bankRise * climb + p.detail * bumps * climb;
  return natural + (bank - natural) * (1 - smooth(0, p.bankWidth, u));
}

// ---- distance to the outline ------------------------------------------------------------------------------------------

const FAR = 1e20;

/** One line of the exact squared distance transform (Felzenszwalb and Huttenlocher): `f` in, the squared distances in `out`. */
function transformLine(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;
  for (let q = 1; q < n; q++) {
    let s = 0;
    for (;;) {
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      if (s > z[k]) break;
      k--;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** For each cell of a `w` x `h` raster, how many cells away the nearest one with `feature` set is (0 on them). */
export function distanceToFeatures(feature: Uint8Array, w: number, h: number): Float32Array {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = feature[i] ? 0 : FAR;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    transformLine(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    transformLine(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(grid[i]);
  return out;
}

/** The class map: RGBA pixels, red the surface class, each `res` metres. */
export type ClassRaster = { data: ArrayLike<number>; width: number; height: number; res: number };

/** The height grid: samples on grid points, `res` metres apart, from `origin`. */
export type SampleGrid = { cols: number; rows: number; res: number; origin: { x: number; z: number } };

/** How far each height sample in a box is from a lake's painted outline: positive outside it, negative inside, in metres. */
export type ShoreField = { x0: number; z0: number; w: number; h: number; s: Float32Array };

/**
 * The shore of the lake that has `anchor` (a point in its water): the signed distance to its outline at every height sample within
 * `reach` metres of the lake. Null when there is no water at the anchor. `surface` is the class to look for: water for a lake, bunker for a
 * sand trap (it is the outline of the painted cells of that class, joined to the anchor's, that is measured from).
 */
export function shoreField(classes: ClassRaster, anchor: readonly [number, number], grid: SampleGrid, reach: number = BASIN_REACH, surface: number = WATER_CLASS): ShoreField | null {
  const { width, height, res: cell, data } = classes;
  const start = Math.floor(anchor[1] / cell) * width + Math.floor(anchor[0] / cell);
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < width && r < height && data[(r * width + c) * 4] === surface;
  if (!inside(Math.floor(anchor[0] / cell), Math.floor(anchor[1] / cell))) return null;

  // the lake: the water cells joined to the anchor's
  const seen = new Uint8Array(width * height);
  const stack = [start];
  seen[start] = 1;
  let c0 = width, c1 = 0, r0 = height, r1 = 0;
  while (stack.length) {
    const at = stack.pop()!;
    const c = at % width, r = (at - c) / width;
    if (c < c0) c0 = c;
    if (c > c1) c1 = c;
    if (r < r0) r0 = r;
    if (r > r1) r1 = r;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (inside(nc, nr) && !seen[nr * width + nc]) {
        seen[nr * width + nc] = 1;
        stack.push(nr * width + nc);
      }
    }
  }

  // the window of cells it and its reach cover
  const pad = Math.ceil(reach / cell) + 2;
  const wc0 = Math.max(0, c0 - pad), wc1 = Math.min(width - 1, c1 + pad);
  const wr0 = Math.max(0, r0 - pad), wr1 = Math.min(height - 1, r1 + pad);
  const w = wc1 - wc0 + 1, h = wr1 - wr0 + 1;
  const lake = new Uint8Array(w * h), land = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const on = seen[(wr0 + r) * width + wc0 + c];
      lake[r * w + c] = on;
      land[r * w + c] = on ? 0 : 1;
    }
  }
  const toLand = distanceToFeatures(land, w, h); // from a lake cell, the cells to the nearest that is not
  const toLake = distanceToFeatures(lake, w, h);
  const signed = new Float32Array(w * h); // metres: the outline is half a cell from the centres either side of it
  for (let i = 0; i < signed.length; i++) signed[i] = lake[i] ? -(toLand[i] - 0.5) * cell : (toLake[i] - 0.5) * cell;

  // sampled at the height grid's points that fall in the window
  const left = wc0 * cell, top = wr0 * cell;
  const i0 = Math.max(0, Math.ceil((left - grid.origin.x) / grid.res)), i1 = Math.min(grid.cols - 1, Math.floor(((wc1 + 1) * cell - grid.origin.x) / grid.res));
  const j0 = Math.max(0, Math.ceil((top - grid.origin.z) / grid.res)), j1 = Math.min(grid.rows - 1, Math.floor(((wr1 + 1) * cell - grid.origin.z) / grid.res));
  if (i1 < i0 || j1 < j0) return null;
  const sw = i1 - i0 + 1, sh = j1 - j0 + 1;
  const s = new Float32Array(sw * sh);
  for (let j = 0; j < sh; j++) {
    for (let i = 0; i < sw; i++) {
      const fx = Math.min(w - 1, Math.max(0, (grid.origin.x + (i0 + i) * grid.res - left) / cell - 0.5));
      const fz = Math.min(h - 1, Math.max(0, (grid.origin.z + (j0 + j) * grid.res - top) / cell - 0.5));
      const cx = Math.min(w - 2, Math.floor(fx)), cz = Math.min(h - 2, Math.floor(fz));
      const tx = fx - cx, tz = fz - cz;
      const at = (a: number, b: number) => signed[(cz + b) * w + cx + a];
      s[j * sw + i] = w < 2 || h < 2 ? at(0, 0) : (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - tz) + (at(0, 1) * (1 - tx) + at(1, 1) * tx) * tz;
    }
  }
  return { x0: i0, z0: j0, w: sw, h: sh, s };
}

// ---- the carve --------------------------------------------------------------------------------------------------------

/** What a field's samples are before the basin: their heights, and how far each stands above the ground round it. */
export type Natural = { heights: Float32Array; bumps: Float32Array; valid: Uint8Array };

const BUMP_RADIUS = 3; // samples: the ground "round" a sample is its average this far

function blur(values: Float32Array, w: number, h: number, radius: number): Float32Array {
  const pass = (src: Float32Array, along: number, across: number, n: number, lines: number) => {
    const out = new Float32Array(src.length);
    for (let line = 0; line < lines; line++) {
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += src[line * across + Math.min(n - 1, Math.max(0, i + k)) * along];
        out[line * across + i * along] = sum / (2 * radius + 1);
      }
    }
    return out;
  };
  return pass(pass(values, 1, w, w, h), w, 1, h, w);
}

/** The heights under a field out of the whole grid (`heights`, `valid`: cols x rows). */
export function naturalOf(field: ShoreField, cols: number, heights: Float32Array, valid: Uint8Array): Natural {
  const out = new Float32Array(field.w * field.h), ok = new Uint8Array(field.w * field.h);
  for (let j = 0; j < field.h; j++) {
    for (let i = 0; i < field.w; i++) {
      const at = (field.z0 + j) * cols + field.x0 + i;
      out[j * field.w + i] = heights[at];
      ok[j * field.w + i] = valid[at];
    }
  }
  const soft = blur(out, field.w, field.h, BUMP_RADIUS);
  const bumps = new Float32Array(out.length);
  for (let i = 0; i < bumps.length; i++) bumps[i] = out[i] - soft[i];
  return { heights: out, bumps, valid: ok };
}

export type Carved = {
  /** The new height of each sample of the field (the natural one where nothing changes). */
  heights: Float32Array;
  /** The most the ground was raised, and lowered, in metres. */
  up: number;
  down: number;
};

/** The ground with the basin cut: every sample of the field, its natural height and its distance to the outline in. */
export function carve(field: ShoreField, natural: Natural, level: number, p: BasinParams): Carved {
  const heights = new Float32Array(natural.heights.length);
  let up = 0, down = 0;
  for (let i = 0; i < heights.length; i++) {
    const was = natural.heights[i];
    heights[i] = natural.valid[i] ? basinHeight(field.s[i], was, natural.bumps[i], level, p) : was;
    up = Math.max(up, heights[i] - was);
    down = Math.max(down, was - heights[i]);
  }
  return { heights, up, down };
}

export type ShoreStats = {
  /** Where the natural ground stands at the outline, against the water: the 5th, 50th and 95th percentile, in metres (positive is above the water). */
  low: number;
  mid: number;
  high: number;
  samples: number;
};

/** How the natural ground meets the water round the outline (within a metre either side of it). */
export function shoreStats(field: ShoreField, natural: Natural, level: number): ShoreStats | null {
  const at: number[] = [];
  for (let i = 0; i < field.s.length; i++) if (natural.valid[i] && Math.abs(field.s[i]) <= 1) at.push(natural.heights[i] - level);
  if (!at.length) return null;
  at.sort((a, b) => a - b);
  const pick = (q: number) => at[Math.min(at.length - 1, Math.floor(q * at.length))];
  return { low: pick(0.05), mid: pick(0.5), high: pick(0.95), samples: at.length };
}
