// What a brush does, as numbers. The GPU runs the same formulas per sample (terrain/sculptor.ts); these are the reference
// the tests pin, and the part that decides how a drag turns into stamps.

export type BrushKind = "raise" | "lower" | "smooth" | "flatten" | "restore" | "clone";

export const BRUSHES: { id: BrushKind; label: string; key: string; hint: string }[] = [
  { id: "raise", label: "Raise", key: "r", hint: "Hold and drag to build the ground up. Shift lowers instead" },
  { id: "lower", label: "Lower", key: "l", hint: "Hold and drag to dig the ground down. Shift raises instead" },
  { id: "smooth", label: "Smooth", key: "s", hint: "Evens out bumps and rough edits" },
  { id: "flatten", label: "Flatten", key: "f", hint: "Levels the ground to the height where the stroke began, for a tee or a platform" },
  { id: "restore", label: "Restore", key: "e", hint: "Brushes your edits away, back to the original terrain" },
  { id: "clone", label: "Clone", key: "d", hint: "Ctrl+click a hill or hollow to copy from, then paint where you want it: its shape is stamped there, rising out of the ground where you start. Each stroke starts again from the spot you picked" },
];

export type Brush = {
  kind: BrushKind;
  /** Metres from the centre to the edge. */
  radius: number;
  /** 0 is a soft dome, 1 is full strength right out to a sharp edge. */
  hardness: number;
  /** 0..1 */
  strength: number;
};

export const MIN_RADIUS = 1;
export const MAX_RADIUS = 120;
/** Metres per second a raise or lower brush moves the ground at its centre, at full strength. */
export const MAX_RATE = 4;
/** How quickly smooth, flatten and restore close the gap, per second, at full strength. */
export const MAX_PULL = 12;

/** How much of the brush reaches a point `d` metres from its centre: 1 in the core, easing to 0 at the edge. */
export function falloff(d: number, radius: number, hardness: number): number {
  if (d >= radius) return 0;
  const core = radius * hardness;
  if (d <= core) return 1;
  const t = (d - core) / (radius - core);
  return 1 - t * t * (3 - 2 * t); // smoothstep
}

/**
 * The effect of one stamp on one sample: the new offset from the original terrain, given the sample's `base` height, its
 * current `offset`, the brush weight `w` there, and for each kind the strength of the stamp: `amount` metres for raise
 * and lower, a pull of `k` (0..1) towards `target` for smooth, flatten and clone and towards zero for restore. (The target of a clone is
 * `cloneTarget`.)
 */
export function stampSample(kind: BrushKind, base: number, offset: number, w: number, amount: number, k: number, target: number): number {
  if (w <= 0) return offset;
  const limit = 32;
  const clamp = (v: number) => Math.max(-limit, Math.min(limit, v));
  switch (kind) {
    case "raise":
      return clamp(offset + amount * w);
    case "lower":
      return clamp(offset - amount * w);
    case "smooth":
    case "flatten":
    case "clone": {
      const height = base + offset;
      return clamp(height + (target - height) * Math.min(1, k * w) - base);
    }
    case "restore":
      return offset * (1 - Math.min(1, k * w));
  }
}

/**
 * The height a clone stamp pulls the ground towards: the source's height `src`. Copying the shape only (`relative`), it is how far the source
 * is above or below the spot it was picked at (`srcLevel`), added to the ground where the stroke began (`level`), so a hill on the source sits
 * on the new ground instead of standing at the old one's height. Copying exactly, it is just `src`. (The sculpt shader does the same.)
 */
export const cloneTarget = (src: number, srcLevel: number, level: number, relative: boolean) => (relative ? src - srcLevel + level : src);

/** Strength of one stamp when `stamps` of them share a frame of `dt` seconds. */
export function perStamp(brush: Brush, dt: number, stamps: number): { amount: number; k: number } {
  const n = Math.max(1, stamps);
  const amount = (brush.strength * MAX_RATE * dt) / n;
  const pullFrame = Math.min(0.95, brush.strength * MAX_PULL * dt);
  return { amount, k: 1 - Math.pow(1 - pullFrame, 1 / n) }; // n small pulls add up to the one big pull
}

/** Points to stamp when the pointer moves from `from` to `to`: close enough together to paint a smooth line. */
export function stampPoints(from: [number, number] | null, to: [number, number], radius: number): [number, number][] {
  if (!from) return [to];
  const spacing = Math.max(0.5, radius / 4);
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const n = Math.max(1, Math.ceil(dist / spacing));
  return Array.from({ length: n }, (_, i) => [from[0] + ((to[0] - from[0]) * (i + 1)) / n, from[1] + ((to[1] - from[1]) * (i + 1)) / n] as [number, number]);
}

/** The next brush size for a `[` or `]` press: 20% steps, within limits. */
export const resized = (radius: number, grow: boolean) => Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, +(radius * (grow ? 1.2 : 1 / 1.2)).toFixed(2)));
