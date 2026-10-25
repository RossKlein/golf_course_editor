import type { Pt } from "./geom";
import type { Region } from "./store";

// A seeded generator so every run builds the same course.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n random smooth-ish 24-gons across the course: roughly a full course's regions. */
export function syntheticRegions(n: number, w: number, h: number, seed = 1): Region[] {
  const r = rng(seed);
  const out: Region[] = [];
  for (let i = 0; i < n; i++) {
    const cx = 60 + r() * (w - 120), cz = 60 + r() * (h - 120), radius = 6 + r() * 50;
    const angles = Array.from({ length: 24 }, () => r() * Math.PI * 2).sort((a, b) => a - b);
    const ring: Pt[] = angles.map((a) => {
      const rr = radius * (0.65 + r() * 0.35);
      return [cx + rr * Math.cos(a), cz + rr * Math.sin(a)];
    });
    ring.push(ring[0]);
    const cls = i % 9;
    out.push({ id: `s${i}`, cls, hole: [1, 2, 4].includes(cls) ? (i % 18) + 1 : undefined, outer: ring, inner: [] });
  }
  return out;
}

export function syntheticTrees(n: number, w: number, h: number, seed = 2): Pt[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => [r() * w, r() * h] as Pt);
}
