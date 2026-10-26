import type { Crown } from "./canopyMath";

/**
 * The crown of a tree model one unit tall, from its mesh (x, y, z for each vertex): the cylinder that stands in for its
 * leaves when working out how much sky it hides. The foliage is the vertices well out from the trunk; the crown starts
 * at the lowest of them and reaches the top of the tree, and is as wide as those vertices are far from the trunk on average.
 * Heights and the radius come out as fractions of the tree's height.
 */
export function crownOfMesh(positions: ArrayLike<number>): Crown {
  let widest = 0, top = 0;
  for (let i = 0; i < positions.length; i += 3) {
    widest = Math.max(widest, Math.hypot(positions[i], positions[i + 2]));
    top = Math.max(top, positions[i + 1]);
  }
  const foliage = 0.3 * widest;
  let bottom = top, sum = 0, n = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const r = Math.hypot(positions[i], positions[i + 2]);
    if (r <= foliage) continue;
    bottom = Math.min(bottom, positions[i + 1]);
    sum += r;
    n++;
  }
  return { radius: n ? sum / n : widest, bottom: n ? bottom : 0, top };
}
