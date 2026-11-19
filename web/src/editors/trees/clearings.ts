import type { Landmark, PlacedTree, TreeKind } from "../../core/api/api";

// Where the build keeps the forest out: around each placed tree and each landmark, worked out from the thing itself, so they cannot
// go stale. This is the same rule as course_maker/build/trees.py (placed_clearings, landmark_clearings); clearings.test.ts and
// test_trees.py check the same numbers. The editor draws them; the build is what decides.

/** Metres of clear ground beyond a placed tree's crown. */
export const PLACED_MARGIN = 0.5;
/** Metres around a landmark, times its scale, when it does not say. */
export const LANDMARK_CLEARANCE = 4;

/** A circle: x, z and radius in metres. */
export type Disc = { x: number; z: number; r: number };

/** How far a tree of this kind reaches from its trunk, as a fraction of its height: the widest of its parts. */
export function crownFraction(kind: TreeKind): number {
  let reach = 0;
  for (const part of kind.parts) {
    reach = Math.max(reach, part.shape === "frustum" ? Math.max(part.r0, part.r1) : Math.hypot(part.cx, part.cz) + Math.max(part.rx, part.rz));
  }
  return reach;
}

/** The clearing around each placed tree: its crown and a margin. A kind past the last wraps, as it does when the trees are drawn. */
export function placedClearings(added: readonly PlacedTree[], kinds: readonly TreeKind[]): Disc[] {
  if (!kinds.length) return [];
  const crown = kinds.map(crownFraction);
  return added.map((t) => ({ x: t.x, z: t.z, r: crown[t.kind % kinds.length] * t.height + PLACED_MARGIN }));
}

/** The clearing around each landmark: its `clearance`, or a few metres times its scale. */
export const landmarkClearings = (landmarks: readonly Landmark[]): Disc[] =>
  landmarks.map((m) => ({ x: m.x, z: m.z, r: m.clearance ?? LANDMARK_CLEARANCE * (m.scale ?? 1) }));
