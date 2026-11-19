import { describe, expect, it } from "vitest";
import { SHADERS } from "./shaders";

// The sources are checked as far as they can be without a GPU: no colours written in them, everything resolved, and the
// braces balanced. Compiling them is checkShaders() in the console.
const files = import.meta.glob<string>("../**/*.glsl", { query: "?raw", import: "default", eager: true });

describe("no colours in shaders", () => {
  // A colour, a size in metres or a rule about a surface is the course's look, loaded from the bundle (see look.glsl and
  // look.ts). A shader holds maths and structure. This catches a colour written as three or four fractional numbers.
  const COLOUR = /vec[34]\(\s*-?\d*\.\d+\s*,\s*-?\d*\.\d+\s*,\s*-?\d*\.\d+/;

  for (const [path, text] of Object.entries(files)) {
    it(`${path.split("/").pop()} has none`, () => {
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

  it("defines every constant a program uses, so a missing #define is found here and not by the GPU", () => {
    // a name in capitals is a constant: it must be #defined for the program, or declared const in its source
    const strip = (t: string) => t.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [name, source] of Object.entries(SHADERS)) {
      for (const stage of ["vertex", "fragment"] as const) {
        const text = strip(source[stage]);
        const known = new Set([...text.matchAll(/#define\s+([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]).concat([...text.matchAll(/\bconst\s+\w+\s+([A-Z][A-Z0-9_]*)/g)].map((m) => m[1])));
        const used = new Set([...text.replace(/#define[^\n]*/g, "").matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)].map((m) => m[1]));
        expect([...used].filter((u) => !known.has(u)), `${name} ${stage}`).toEqual([]);
      }
    }
  });

  it("defines what the shaders count on", () => {
    expect(SHADERS.tufts.vertex).toMatch(/#define TUFT_TILE \d+/);
    expect(SHADERS.tufts.vertex).toMatch(/#define BLADE_VERTS 9/);
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


describe("shader derivative and output safety", () => {
  it("samples shadow arrays with explicit gradients after per-fragment exits", () => {
    for (const path of ["../shaders/shadow.glsl", "../lighting/treeShade.frag.glsl"]) {
      const source = Object.entries(files).find(([key]) => key.endsWith("/" + path.split("/").pop()))![1];
      expect(source).toContain("sampler2DArrayShadow");
      expect(source).not.toMatch(/\btexture\(u(?:Shadow|Tile)Map,/);
      expect(source).toMatch(/textureGrad\(u(?:Shadow|Tile)Map,.*vec2\(0\.0\), vec2\(0\.0\)\)/);
    }
  });

  it("keeps ground derivatives outside edge branches and avoids nested derivatives", () => {
    const source = SHADERS.ground.fragment;
    const start = source.indexOf("vec3 gameGround(");
    const body = source.slice(start, source.indexOf("float terrainShadow(", start));
    expect(body.match(/\breturn\b/g)).toHaveLength(1);
    let depth = 0;
    for (const token of body.replace(/\/\/[^\n]*/g, "").matchAll(/[{}]|\b(?:dFdx|dFdy|fwidth)\s*\(/g)) {
      if (token[0] === "{") depth++;
      else if (token[0] === "}") depth--;
      else expect(depth).toBe(1);
    }
    expect(body).not.toMatch(/fwidth\(d\)/);
    expect(source).toMatch(/albedo = gameGround\([^;]+;\s*albedo \*= occlusion;/);
  });

  it("brings a lake bed in through the soil noise at its top edge, and leaves the forest floor and the water's clip as they were", () => {
    const ground = SHADERS.ground.fragment;
    expect(ground).toMatch(/albedo = mix\(albedo, uLakeBedTint, bed\);/);
    expect(ground).toMatch(/soilEarth\(p, soil\.x, soil\.y, coverage, 0\.0\)/); // a forest floor is not softened
    expect(ground).toMatch(/soilEarth\(p, soil\.x, soil\.y, ramp, float\(LAKE_EDGE_SOFTEN\)\)/);
    const water = SHADERS.ground.fragment.slice(0, SHADERS.ground.fragment.lastIndexOf("void main()"));
    expect(water).toContain("out float water, out float bed"); // the water pass still reads `water` as its clip, and passes `bed` too
  });

  it("returns one initialized relief result", () => {
    const source = Object.entries(files).find(([key]) => key.endsWith("/height.glsl"))![1];
    const body = source.slice(source.indexOf("vec2 reliefAt("));
    expect(body).toContain("vec2 slope = vec2(0.0);");
    expect(body.match(/\breturn\b/g)).toHaveLength(1);
    expect(body).toContain("slope = gradientAt(p, s);");
  });
});
