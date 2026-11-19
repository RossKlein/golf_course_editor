// The sand trap: shaping the ground inside a painted bunker.
//
// Like the lake basin this works from the signed distance to the painted outline (basin.ts), and is plain numbers; the GPU brushes and the
// saving are elsewhere (sculptor.ts, scene/heightSession.ts). How deep the ground is at a point depends on how far in from the outline it is:
// it falls from the rim to the floor over `wall` metres. That one setting, against the size of the outline, is what makes the shapes: a wall
// as wide as the trap is a round bowl; a narrow wall is a flat floor with steep sides; and in a long thin trap the floor never gets wider than
// the trap, so it is a trough with rounded ends. The rest of the settings (tilt, the facing lip, roughness, a wobbly edge) make each one different.

import { SURFACE_NAMES } from "../limits";
import type { Carved, Natural, SampleGrid, ShoreField } from "./basin";

export const BUNKER_CLASS = SURFACE_NAMES.indexOf("bunker");
/** How far outside the outline the field of distances reaches, in metres: the widest lip, and some over. */
export const TRAP_REACH = 16;

export type TrapParams = {
  /** Metres the floor lies below the rim, at its deepest. */
  depth: number;
  /** Metres from the edge to where the ground reaches the floor: the gentleness of the sides. */
  wall: number;
  /** The curve of the sides: below 1 they drop quickly and the floor is flat, above 1 they ease in and it is round. */
  shape: number;
  /** The floor is level (cut into a slope) rather than following the ground's slope. */
  level: boolean;
  /** Metres deeper the floor is on the side the trap faces than on the other. */
  tilt: number;
  /** The way the trap faces (towards the green), in degrees clockwise from north. */
  facing: number;
  /** Metres the floor is roughened by, and how big the bumps are. */
  rough: number;
  roughSize: number;
  /** Metres the rim stands above the rim's ground, as a lip all round it, and how far out it gives way to the natural ground. */
  lip: number;
  lipWidth: number;
  /** Metres more the lip stands on the side the trap faces: the face of a greenside bunker. */
  face: number;
  /** 0..1: how much of the natural ground's small bumps the lip keeps. */
  detail: number;
  /** Metres the edge is pushed about by noise, so the walls are not the same all round. */
  wobble: number;
  /** Which random arrangement the roughness and wobble make. */
  seed: number;
};

export const DEFAULT_TRAP: TrapParams = { depth: 0.9, wall: 2.5, shape: 1, level: false, tilt: 0.2, facing: 0, rough: 0.05, roughSize: 2.5, lip: 0.15, lipWidth: 3, face: 0.25, detail: 0.4, wobble: 0.6, seed: 1 };

type Numbers = Omit<TrapParams, "level">;

/** The range of each number: [min, max]. The widest lip is what TRAP_REACH covers. */
export const TRAP_LIMITS: Record<keyof Numbers, readonly [number, number]> = {
  depth: [0.2, 3],
  wall: [0.5, 12],
  shape: [0.3, 3],
  tilt: [0, 1.5],
  facing: [0, 359],
  rough: [0, 0.3],
  roughSize: [0.8, 8],
  lip: [0, 1],
  lipWidth: [1, 12],
  face: [0, 1],
  detail: [0, 1],
  wobble: [0, 2],
  seed: [0, 9999],
};

export type TrapPreset = "bowl" | "flat" | "trough" | "greenside";
export const TRAP_PRESETS: { id: TrapPreset; label: string; hint: string }[] = [
  { id: "bowl", label: "Bowl", hint: "Round and smooth: the sides run all the way in to the middle" },
  { id: "flat", label: "Flat floor", hint: "A level floor with steep sides, like a dug-out pit" },
  { id: "trough", label: "Trough", hint: "A floor no wider than a long, thin trap, with the sides sloping in and the ends rounded" },
  { id: "greenside", label: "Greenside", hint: "Deeper and more tilted towards the green, with a higher lip on that side" },
];

/** Settings to start from, for a trap whose widest part is `radius` metres from its edge. The sliders take it from there. */
export function presetFor(kind: TrapPreset, radius: number, from: TrapParams = DEFAULT_TRAP): TrapParams {
  const r = Math.max(1, radius);
  const clamp = (key: keyof Numbers, v: number) => Math.min(TRAP_LIMITS[key][1], Math.max(TRAP_LIMITS[key][0], v));
  const base = { ...from, seed: from.seed };
  switch (kind) {
    case "bowl":
      return { ...base, depth: 1, wall: clamp("wall", r), shape: 1.4, level: false, tilt: 0, rough: 0.03, lip: 0.15, face: 0 };
    case "flat":
      return { ...base, depth: 0.8, wall: clamp("wall", Math.max(0.8, r * 0.25)), shape: 0.6, level: true, tilt: 0, rough: 0.02, lip: 0.2, face: 0 };
    case "trough":
      return { ...base, depth: 0.9, wall: clamp("wall", r), shape: 0.7, level: false, tilt: 0, rough: 0.04, lip: 0.15, face: 0 };
    case "greenside":
      return { ...base, depth: 1.2, wall: clamp("wall", r * 0.8), shape: 1, level: false, tilt: 0.5, rough: 0.05, lip: 0.2, face: 0.5 };
  }
}

// ---- noise ------------------------------------------------------------------------------------------------------------

const fade = (t: number) => t * t * (3 - 2 * t);

/** A hash of a lattice point and a seed, in [0, 1). */
function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1], one lattice cell to the unit. */
export function noise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = fade(x - x0), fz = fade(z - z0);
  const a = hash(x0, z0, seed), b = hash(x0 + 1, z0, seed), c = hash(x0, z0 + 1, seed), d = hash(x0 + 1, z0 + 1, seed);
  return ((a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz) * 2 - 1;
}

/** Two octaves of noise, still in [-1, 1]. */
const fbm = (x: number, z: number, seed: number) => 0.65 * noise(x, z, seed) + 0.35 * noise(2 * x + 17.3, 2 * z + 31.7, seed + 101);

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- the rim ----------------------------------------------------------------------------------------------------------

export type Rim = {
  /** The ground's height at a point (metres), on the plane that best fits the natural ground round the outline. */
  at: (x: number, z: number) => number;
  /** A height a quarter of the way up the rim's heights: where a level floor is measured from, so the floor is never above any of the rim. */
  low: number;
  /** The plane's slope, as rise over run. */
  slope: number;
};

/** Course metres of a field's sample (i, j). */
const place = (field: ShoreField, grid: SampleGrid, i: number, j: number): [number, number] => [grid.origin.x + (field.x0 + i) * grid.res, grid.origin.z + (field.z0 + j) * grid.res];

/** Fit a plane to the natural ground within a metre of the outline. Null when there is none (the outline is on ground with no data). */
export function rimOf(field: ShoreField, natural: Natural, grid: SampleGrid): Rim | null {
  const xs: number[] = [], zs: number[] = [], hs: number[] = [];
  for (let j = 0; j < field.h; j++) {
    for (let i = 0; i < field.w; i++) {
      const k = j * field.w + i;
      if (!natural.valid[k] || Math.abs(field.s[k]) > 1) continue;
      const [x, z] = place(field, grid, i, j);
      xs.push(x);
      zs.push(z);
      hs.push(natural.heights[k]);
    }
  }
  if (!hs.length) return null;
  const n = hs.length;
  const mx = xs.reduce((a, v) => a + v, 0) / n, mz = zs.reduce((a, v) => a + v, 0) / n, mh = hs.reduce((a, v) => a + v, 0) / n;
  // least squares for h = mh + b (x - mx) + c (z - mz)
  let sxx = 0, sxz = 0, szz = 0, sxh = 0, szh = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dz = zs[i] - mz, dh = hs[i] - mh;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
    sxh += dx * dh;
    szh += dz * dh;
  }
  const det = sxx * szz - sxz * sxz;
  const flat = !(Math.abs(det) > 1e-6 * Math.max(1, sxx * szz));
  const b = flat ? 0 : (sxh * szz - szh * sxz) / det;
  const c = flat ? 0 : (szh * sxx - sxh * sxz) / det;
  const sorted = [...hs].sort((p, q) => p - q);
  return { at: (x, z) => mh + b * (x - mx) + c * (z - mz), low: sorted[Math.floor(0.25 * (sorted.length - 1))], slope: Math.hypot(b, c) };
}

// ---- the carve --------------------------------------------------------------------------------------------------------

export type TrapInfo = {
  /** Metres from the edge to the middle of the widest part: a wall this wide makes the trap a bowl. */
  radius: number;
  /** Square metres inside the outline. */
  area: number;
  /** The slope of the ground round the rim, as a percentage. */
  slope: number;
};

/** What the sliders need to know of the bunker. Null when it has no ground to work on. */
export function trapInfo(field: ShoreField, natural: Natural, grid: SampleGrid): TrapInfo | null {
  const rim = rimOf(field, natural, grid);
  if (!rim) return null;
  let radius = 0, cells = 0;
  for (let i = 0; i < field.s.length; i++) {
    if (field.s[i] < 0) {
      cells++;
      radius = Math.max(radius, -field.s[i]);
    }
  }
  return { radius, area: cells * grid.res * grid.res, slope: rim.slope * 100 };
}

/** The ground with the trap cut: every sample of the field, its natural height and its distance to the outline in. */
export function carveTrap(field: ShoreField, natural: Natural, grid: SampleGrid, p: TrapParams): Carved {
  const heights = Float32Array.from(natural.heights);
  const rim = rimOf(field, natural, grid);
  if (!rim) return { heights, up: 0, down: 0 };

  // where the trap is centred and how far across it goes the way it faces, so the tilt reaches -1 to 1 across it
  const angle = (p.facing * Math.PI) / 180;
  const fx = Math.sin(angle), fz = -Math.cos(angle); // course z runs south
  let cx = 0, cz = 0, cells = 0;
  for (let j = 0; j < field.h; j++) {
    for (let i = 0; i < field.w; i++) {
      if (field.s[j * field.w + i] >= 0) continue;
      const [x, z] = place(field, grid, i, j);
      cx += x;
      cz += z;
      cells++;
    }
  }
  if (!cells) return { heights, up: 0, down: 0 };
  cx /= cells;
  cz /= cells;
  let reach = 1;
  for (let j = 0; j < field.h; j++) {
    for (let i = 0; i < field.w; i++) {
      if (field.s[j * field.w + i] >= 0) continue;
      const [x, z] = place(field, grid, i, j);
      reach = Math.max(reach, Math.abs((x - cx) * fx + (z - cz) * fz));
    }
  }

  let up = 0, down = 0;
  for (let j = 0; j < field.h; j++) {
    for (let i = 0; i < field.w; i++) {
      const k = j * field.w + i;
      const was = natural.heights[k];
      if (!natural.valid[k]) continue;
      const [x, z] = place(field, grid, i, j);
      const s = field.s[k];
      const ref = p.level ? rim.low : rim.at(x, z);
      let h = was;
      if (s <= 0) {
        // inside: down from the rim to the floor, over `wall` metres counted from a wobbly edge
        const edge = Math.max(0, -s + p.wobble * fbm(x / 3, z / 3, p.seed));
        const t = Math.min(1, edge / p.wall);
        const slope = Math.pow(smooth(0, 1, t), p.shape);
        const across = ((x - cx) * fx + (z - cz) * fz) / reach;
        const depth = Math.max(0, p.depth + p.tilt * across + p.rough * fbm(x / p.roughSize, z / p.roughSize, p.seed + 7));
        h = ref - depth * slope;
      } else if (s < p.lipWidth) {
        // outside: a lip that stands above the rim and gives way to the natural ground, higher on the side the trap faces
        const dx = x - cx, dz = z - cz;
        const away = Math.hypot(dx, dz) || 1;
        const lip = p.lip + p.face * Math.max(0, (dx * fx + dz * fz) / away);
        const climb = smooth(0, 0.5 * p.lipWidth, s);
        const bank = ref + lip * climb + p.detail * natural.bumps[k] * climb;
        h = was + (bank - was) * (1 - smooth(0, p.lipWidth, s));
      }
      heights[k] = h;
      up = Math.max(up, h - was);
      down = Math.max(down, was - h);
    }
  }
  return { heights, up, down };
}
