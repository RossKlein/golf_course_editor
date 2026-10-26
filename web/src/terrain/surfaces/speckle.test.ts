import { describe, expect, it } from "vitest";
import { speckleTexels } from "./speckle";

describe("sand speckle", () => {
  const t = speckleTexels(128);

  const share = (pick: (v: number) => boolean) => t.filter(pick).length / t.length;

  it("is mostly plain sand with three kinds of grain: dark and barely dark each about 7%, pale about 14%", () => {
    expect(t.length).toBe(128 * 128);
    expect(share((v) => v === 0)).toBeGreaterThan(0.05);
    expect(share((v) => v === 0)).toBeLessThan(0.09);
    expect(share((v) => v === 64)).toBeGreaterThan(0.05);
    expect(share((v) => v === 64)).toBeLessThan(0.09);
    expect(share((v) => v === 255)).toBeGreaterThan(0.11);
    expect(share((v) => v === 255)).toBeLessThan(0.17);
  });

  it("is as dark as it is pale, as the shader weighs them (darks 0.1, pales 0.07), so it averages to plain sand", () => {
    const effect = t.reduce((sum, v) => {
      const s = (v / 255 - 0.5) * 2;
      return sum + (s < 0 ? s * 0.1 : s * 0.07);
    }, 0) / t.length;
    expect(Math.abs(effect)).toBeLessThan(0.002);
  });

  it("is deterministic", () => {
    expect(Array.from(speckleTexels(16))).toEqual(Array.from(speckleTexels(16)));
  });
});
