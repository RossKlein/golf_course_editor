import { describe, expect, it } from "vitest";
import { SHADERS } from "./shaders";

// The sources are checked as far as they can be without a GPU: no colours written in them, everything resolved, and the
// braces balanced. Compiling them is checkShaders() in the console.
const files = import.meta.glob<string>("./shaders/*.glsl", { query: "?raw", import: "default", eager: true });

describe("no colours in shaders", () => {
  // A colour, a size in metres or a rule about a surface is the course's look, loaded from the bundle (see look.glsl and
  // look.ts). A shader holds maths and structure. This catches a colour written as three or four fractional numbers.
  const COLOUR = /vec[34]\(\s*-?\d*\.\d+\s*,\s*-?\d*\.\d+\s*,\s*-?\d*\.\d+/;

  for (const [path, text] of Object.entries(files)) {
    it(`${path.replace("./shaders/", "")} has none`, () => {
      const offenders = text.split("\n").filter((line) => COLOUR.test(line) && !line.includes("allow-literal"));
      expect(offenders).toEqual([]);
    });
  }

  it("scans every shader file", () => {
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(13);
  });
});

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
    expect(SHADERS.ground.fragment).toMatch(/#define SURFACES 9/);
    expect(SHADERS.tufts.vertex).toMatch(/#define SURFACES 9/);
    expect(SHADERS.ground.fragment).toMatch(/#define SPECKLE_SIZE \d+/);
  });

  it("shares the height lookup instead of copying it", () => {
    for (const s of [SHADERS.flat.fragment, SHADERS.ground.vertex, SHADERS.ground.fragment, SHADERS.tufts.vertex, SHADERS.trees.vertex]) {
      expect(s.match(/vec2 heightAt\(vec2 p\)/g)).toHaveLength(1);
    }
  });
});
