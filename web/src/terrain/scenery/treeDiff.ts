/** What changed between two sets of trees (packed four to a tree, grouped by kind). */
export type TreeChange = {
  /** Trees added or removed. */
  changed: number;
  /** The larger of the two counts, to say how much of the forest changed. */
  total: number;
  /** The metres they cover (x0 z0 x1 z1), or null when nothing changed. */
  box: { x0: number; z0: number; x1: number; z1: number } | null;
  /** The tallest tree that changed, in metres: its shadow and crown decide how far the change reaches. */
  tallest: number;
};

const NOTHING: TreeChange = { changed: 0, total: 0, box: null, tallest: 0 };

/**
 * Which trees were added or removed, and where. Lighting is baked from the trees, and a tree edit is local (a click, a brush, a patch's
 * slider), so only the ground a changed tree can reach needs baking again, not the whole course.
 */
export function diffTrees(prev: readonly Float32Array[], next: readonly Float32Array[]): TreeChange {
  const keyOf = (kind: number, a: Float32Array, i: number) => `${kind}|${a[i]}|${a[i + 1]}|${a[i + 2]}`;
  const before = new Map<string, number>();
  let nPrev = 0, nNext = 0;
  prev.forEach((a, kind) => {
    for (let i = 0; i < a.length; i += 4) {
      const k = keyOf(kind, a, i);
      before.set(k, (before.get(k) ?? 0) + 1);
      nPrev++;
    }
  });

  const box = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  let changed = 0, tallest = 0;
  const note = (x: number, z: number, h: number) => {
    changed++;
    box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
    box.z0 = Math.min(box.z0, z); box.z1 = Math.max(box.z1, z);
    tallest = Math.max(tallest, h);
  };

  next.forEach((a, kind) => {
    for (let i = 0; i < a.length; i += 4) {
      nNext++;
      const k = keyOf(kind, a, i);
      const left = before.get(k) ?? 0;
      if (left > 0) before.set(k, left - 1);
      else note(a[i], a[i + 1], a[i + 2]); // added
    }
  });
  // what is left of the old trees was removed
  if (before.size) {
    const remaining = new Map(before);
    prev.forEach((a, kind) => {
      for (let i = 0; i < a.length; i += 4) {
        const k = keyOf(kind, a, i);
        const left = remaining.get(k) ?? 0;
        if (left > 0) {
          remaining.set(k, left - 1);
          note(a[i], a[i + 1], a[i + 2]);
        }
      }
    });
  }

  if (!changed) return { ...NOTHING, total: Math.max(nPrev, nNext) };
  return { changed, total: Math.max(nPrev, nNext), box, tallest };
}
