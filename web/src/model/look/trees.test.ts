import { describe, expect, it } from "vitest";
import type { Look } from "../../core/api/api";
import { testLook } from "../../terrain/look/look.fixture";
import { addPart, duplicateKind, duplicatePart, MAX_KINDS, MAX_PARTS, moveKind, movePart, removeKind, removePart } from "./trees";

const fresh = (): Look => structuredClone(testLook);
const names = (l: Look) => l.trees.kinds.map((k) => k.name);

describe("editing the tree models", () => {
  it("duplicates a kind after itself, with its own copy of the parts", () => {
    const l = fresh();
    expect(duplicateKind(l, 0)).toBe(1);
    expect(names(l)).toEqual(["pine", "pine copy", "broadleaf", "fir"]);
    (l.trees.kinds[1].parts[0] as { r0: number }).r0 = 0.9;
    expect((l.trees.kinds[0].parts[0] as { r0: number }).r0).not.toBe(0.9);
  });

  it("stops at eight kinds", () => {
    const l = fresh();
    while (l.trees.kinds.length < MAX_KINDS) expect(duplicateKind(l, 0)).not.toBeNull();
    expect(duplicateKind(l, 0)).toBeNull();
    expect(l.trees.kinds).toHaveLength(MAX_KINDS);
  });

  it("removes a kind but never the last", () => {
    const l = fresh();
    expect(removeKind(l, 1)).toBe(true);
    expect(names(l)).toEqual(["pine", "fir"]);
    expect(removeKind(l, 0)).toBe(true);
    expect(removeKind(l, 0)).toBe(false);
    expect(names(l)).toEqual(["fir"]);
  });

  it("moves a kind, and does nothing for a move that goes nowhere", () => {
    const l = fresh();
    expect(moveKind(l, 0, 2)).toBe(true);
    expect(names(l)).toEqual(["broadleaf", "fir", "pine"]);
    expect(moveKind(l, 0, 0)).toBe(false);
    expect(moveKind(l, 0, 3)).toBe(false);
    expect(moveKind(l, -1, 0)).toBe(false);
  });

  it("adds a cone or a ball to a kind, up to sixteen", () => {
    const l = fresh();
    const before = l.trees.kinds[1].parts.length;
    expect(addPart(l, 1, "frustum")).toBe(before);
    expect(addPart(l, 1, "blob")).toBe(before + 1);
    expect(l.trees.kinds[1].parts.at(-1)?.shape).toBe("blob");
    while (l.trees.kinds[1].parts.length < MAX_PARTS) addPart(l, 1, "blob");
    expect(addPart(l, 1, "blob")).toBeNull();
    expect(addPart(l, 9, "blob")).toBeNull();
  });

  it("duplicates a part after itself", () => {
    const l = fresh();
    const n = l.trees.kinds[0].parts.length;
    expect(duplicatePart(l, 0, 1)).toBe(2);
    expect(l.trees.kinds[0].parts).toHaveLength(n + 1);
    expect(l.trees.kinds[0].parts[2]).toEqual(l.trees.kinds[0].parts[1]);
    expect(l.trees.kinds[0].parts[2]).not.toBe(l.trees.kinds[0].parts[1]);
  });

  it("removes a part but keeps at least one", () => {
    const l = fresh();
    while (l.trees.kinds[1].parts.length > 1) expect(removePart(l, 1, 0)).toBe(true);
    expect(removePart(l, 1, 0)).toBe(false);
    expect(l.trees.kinds[1].parts).toHaveLength(1);
  });

  it("moves a part", () => {
    const l = fresh();
    const first = l.trees.kinds[0].parts[0];
    expect(movePart(l, 0, 0, 3)).toBe(true);
    expect(l.trees.kinds[0].parts[3]).toBe(first);
    expect(movePart(l, 5, 0, 1)).toBe(false);
  });
});
