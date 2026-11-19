import type { Look } from "../../core/api/api";

// Changes to the list of tree models and their parts. Each takes the look (a draft, or a copy you own) and changes it in place.
// The limits are the model's (course_maker/models.py): 1 to 8 kinds, 1 to 16 parts to a kind.

export const MAX_KINDS = 8;
export const MAX_PARTS = 16;

type Kind = Look["trees"]["kinds"][number];
type Part = Kind["parts"][number];

/** A new cone: a fir-green one in the middle of the tree. */
export const newFrustum = (): Part => ({ shape: "frustum", y0: 0.3, r0: 0.15, y1: 0.7, r1: 0, sides: 7, color: [0.2, 0.5, 0.25], shade: 0.12 });
/** A new crown: a leafy ball near the top of the tree. */
export const newBlob = (): Part => ({ shape: "blob", cx: 0, cy: 0.7, cz: 0, rx: 0.25, ry: 0.25, rz: 0.25, color: [0.3, 0.6, 0.2], sides: 7, rings: 3 });

// a JSON copy, because the look is a draft here (Immer's proxy), which structuredClone cannot copy; the look is JSON through and through
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function move<T>(list: T[], from: number, to: number) {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return false;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return true;
}

/** Add a copy of kind `from` after it, with "copy" in its name. Returns the new kind's index, or null at the limit. */
export function duplicateKind(look: Look, from: number): number | null {
  const kinds = look.trees.kinds;
  if (kinds.length >= MAX_KINDS || !kinds[from]) return null;
  const copy = clone(kinds[from]);
  copy.name = `${copy.name} copy`;
  kinds.splice(from + 1, 0, copy);
  return from + 1;
}

/** Remove a kind. The last one cannot be removed. Returns whether it was. */
export function removeKind(look: Look, index: number): boolean {
  if (look.trees.kinds.length <= 1 || !look.trees.kinds[index]) return false;
  look.trees.kinds.splice(index, 1);
  return true;
}

export const moveKind = (look: Look, from: number, to: number) => move(look.trees.kinds, from, to);

/** Add a part at the end of a kind. Returns its index, or null at the limit. */
export function addPart(look: Look, kind: number, shape: "frustum" | "blob"): number | null {
  const parts = look.trees.kinds[kind]?.parts;
  if (!parts || parts.length >= MAX_PARTS) return null;
  parts.push(shape === "frustum" ? newFrustum() : newBlob());
  return parts.length - 1;
}

/** Add a copy of a part after it. Returns the copy's index, or null at the limit. */
export function duplicatePart(look: Look, kind: number, index: number): number | null {
  const parts = look.trees.kinds[kind]?.parts;
  if (!parts || parts.length >= MAX_PARTS || !parts[index]) return null;
  parts.splice(index + 1, 0, clone(parts[index]));
  return index + 1;
}

/** Remove a part. A kind keeps at least one. Returns whether it was removed. */
export function removePart(look: Look, kind: number, index: number): boolean {
  const parts = look.trees.kinds[kind]?.parts;
  if (!parts || parts.length <= 1 || !parts[index]) return false;
  parts.splice(index, 1);
  return true;
}

export const movePart = (look: Look, kind: number, from: number, to: number) => move(look.trees.kinds[kind]?.parts ?? [], from, to);
