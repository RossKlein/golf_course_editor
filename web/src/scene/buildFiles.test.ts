import { describe, expect, it } from "vitest";
import { changedFiles, touches } from "./buildFiles";

const files = { "class.png": "a1", "bounds.png": "b1", "trees.bin": "t1", "course.json": "c1", "height.png": "h1" };

describe("what a build changed", () => {
  it("is everything when the viewer has nothing to compare with", () => {
    expect(changedFiles(null, files)).toBe("all");
  });

  it("is everything when the server did not say, rather than a guess", () => {
    expect(changedFiles(files, undefined)).toBe("all");
    expect(changedFiles(files, {})).toBe("all");
  });

  it("is nothing when every hash is the same", () => {
    expect(changedFiles(files, { ...files })).toEqual(new Set());
  });

  it("is the files whose hash differs", () => {
    const next = { ...files, "trees.bin": "t2", "course.json": "c2" };
    expect(changedFiles(files, next)).toEqual(new Set(["trees.bin", "course.json"]));
  });

  it("counts a file the viewer has not seen as changed", () => {
    expect(changedFiles({ "class.png": "a1" }, files)).toEqual(new Set(["bounds.png", "trees.bin", "course.json", "height.png"]));
  });

  it("asks of a file whether it changed", () => {
    expect(touches("all", "anything")).toBe(true);
    expect(touches(new Set(["trees.bin"]), "trees.bin")).toBe(true);
    expect(touches(new Set(["trees.bin"]), "class.png")).toBe(false);
  });
});
