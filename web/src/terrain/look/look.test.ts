import { describe, expect, it } from "vitest";
import { testLook } from "./look.fixture";
import { SURFACES } from "../limits";
import { FLOATS_PER_SURFACE, packSurfaces } from "./look";

describe("the look as the shader's table", () => {
  const table = packSurfaces(testLook.surfaces);
  const row = (i: number) => Array.from(table.slice(i * FLOATS_PER_SURFACE, (i + 1) * FLOATS_PER_SURFACE));

  it("has a row of five vec4s for each surface", () => {
    expect(FLOATS_PER_SURFACE).toBe(20);
    expect(table.length).toBe(SURFACES * 20);
  });

  it("lays a surface out as (color, stripe), (color2, grain), (earth, mottle), (shade, speckle, tuft), (bump, map)", () => {
    const fairway = row(1).map((v) => Math.round(v * 1000) / 1000);
    expect(fairway).toEqual([0.5, 0.86, 0.3, 2.4, 0.66, 0.95, 0.44, 0.55, 0.5, 0.86, 0.3, 0, 1, 0, 0, 0, 0.35, 0, 0, 0]);
    const bunker = row(5).map((v) => Math.round(v * 1000) / 1000);
    expect(bunker.slice(12)).toEqual([1, 0.1, 0.07, 0, 0.25, 1, 0, 0]); // a bunker is shaded by its slope, and its detail is grain
    const woods = row(8).map((v) => Math.round(v * 1000) / 1000);
    expect(woods.slice(8, 12)).toEqual([0.42, 0.31, 0.2, 1.6]);
    expect(woods[15]).toBe(0.7);
  });

  it("gives a colour a surface lacks the surface's own colour, so a stripe or mottle is never missing one", () => {
    const green = row(2);
    expect(green.slice(4, 7)).toEqual(green.slice(0, 3));
    expect(green.slice(8, 11)).toEqual(green.slice(0, 3));
  });

  it("packs a given list once", () => {
    expect(packSurfaces(testLook.surfaces)).toBe(table);
  });

  it("refuses a look with a surface missing or one that is not a class", () => {
    const { water, ...without } = testLook.surfaces;
    expect(water).toBeDefined();
    expect(() => packSurfaces(without)).toThrow(/no surface named water/);
    expect(() => packSurfaces({ ...testLook.surfaces, lava: water })).toThrow(/no class for: lava/);
  });

  it("puts each surface in the row of its class, whatever order they were written in", () => {
    const entries = Object.entries(testLook.surfaces).reverse();
    const shuffled = Object.fromEntries(entries);
    expect(Array.from(packSurfaces(shuffled))).toEqual(Array.from(table));
  });
});
