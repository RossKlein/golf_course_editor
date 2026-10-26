import { describe, expect, it } from "vitest";
import { SHADERS } from "./shaders";

// The sources are checked as far as they can be without a GPU: everything resolved, nothing left from the template
// strings they came from, and the braces balanced. Compiling them is checkShaders() in the console.
describe("shader sources", () => {
  for (const [name, source] of Object.entries(SHADERS)) {
    for (const stage of ["vertex", "fragment"] as const) {
      const text = source[stage];
      it(`${name} ${stage} is finished source`, () => {
        expect(text.startsWith("#version 300 es\n")).toBe(true);
        expect(text.match(/#version/g)).toHaveLength(1);
        expect(text).not.toContain("#include");
        expect(text).not.toContain("${");
        expect(text).not.toContain("`");
        expect(text).toMatch(/void main\(\)/);
        expect(text.split("{").length).toBe(text.split("}").length);
      });
    }
  }

  it("defines what the shaders count on", () => {
    expect(SHADERS.tufts.vertex).toMatch(/#define TUFT_TILE \d+/);
    expect(SHADERS.ground.fragment).toMatch(/#define SPECKLE_GRAIN 0\.\d+/);
    expect(SHADERS.ground.fragment).toMatch(/#define SPECKLE_SIZE \d+/);
  });

  it("shares the height lookup instead of copying it", () => {
    for (const s of [SHADERS.flat.fragment, SHADERS.ground.vertex, SHADERS.ground.fragment, SHADERS.tufts.vertex, SHADERS.trees.vertex]) {
      expect(s.match(/vec2 heightAt\(vec2 p\)/g)).toHaveLength(1);
    }
  });
});
