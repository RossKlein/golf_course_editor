import { describe, expect, it } from "vitest";
import { preprocess } from "./preprocess";

const chunks = {
  head: "#version 300 es\nprecision highp float;",
  height: '#include "head"\nfloat heightAt() { return 0.0; }',
  other: '#include "height"\nfloat other() { return 1.0; }',
};

describe("shader preprocessor", () => {
  it("puts an included chunk where the include was", () => {
    const out = preprocess('#include "head"\nvoid main() {}', chunks);
    expect(out).toBe("#version 300 es\nprecision highp float;\nvoid main() {}");
  });

  it("includes a chunk only once however many ask for it", () => {
    const out = preprocess('#include "head"\n#include "height"\n#include "other"\nvoid main() {}', chunks);
    expect(out.match(/#version/g)).toHaveLength(1);
    expect(out.match(/heightAt/g)).toHaveLength(1);
    expect(out).toContain("other()");
  });

  it("writes defines straight after the version line", () => {
    const out = preprocess('#include "head"\nvoid main() { int n = TILE; }', chunks, { TILE: 32, GRAIN: 0.03 });
    const lines = out.split("\n");
    expect(lines[0]).toBe("#version 300 es");
    expect(lines.slice(1, 3)).toEqual(["#define TILE 32", "#define GRAIN 0.03"]);
    expect(lines[3]).toBe("precision highp float;");
  });

  it("takes the version from the shader itself when it has one", () => {
    expect(preprocess("#version 300 es\nvoid main() {}", {}, { A: 1 })).toBe("#version 300 es\n#define A 1\nvoid main() {}");
  });

  it("says which include is missing", () => {
    expect(() => preprocess('#version 300 es\n#include "nope"', chunks)).toThrow(/"nope"/);
  });

  it("needs a version line", () => {
    expect(() => preprocess("void main() {}", {})).toThrow(/#version/);
  });
});
