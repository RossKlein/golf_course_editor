import { describe, expect, it } from "vitest";
import openapi from "../../../openapi.json";
import type { Region } from "../../core/api/api";
import { setForest } from "../../model/design/forest";
import { DEFAULT_FOREST } from "../../model/design/forestDefaults";
import { designStore, emptyDoc } from "../../model/design/store";
import { about, estimatePatch, estimateTotal, MAX_TREES, perHectare, regionArea } from "./estimate";
import { FOREST_FIELDS, newSeed, WEIGHT } from "./forestFields";

const box = (x: number, z: number, w: number): [number, number][] => [[x, z], [x + w, z], [x + w, z + w], [x, z + w], [x, z]];
const region = (id: string, cls: number, outer: [number, number][], inner: [number, number][][] = []): Region => ({ id, class: cls, hole: null, outer, inner, note: null, trees: null });

describe("estimates", () => {
  it("are the area over the spacing squared", () => {
    const d = emptyDoc();
    d.regions = { w: region("w", 8, box(0, 0, 100)), f: region("f", 1, box(0, 0, 100)) };
    d.order = ["w", "f"];
    expect(estimatePatch(d, "w")).toBe(400); // 10,000 m² at 5 m
    expect(estimatePatch(d, "f")).toBe(0); // not woods
    expect(estimatePatch(d, "nope")).toBe(0);
    expect(estimateTotal(d)).toBe(400);
  });

  it("take away the holes and use the patch's own spacing", () => {
    const d = emptyDoc();
    d.regions = { w: { ...region("w", 8, box(0, 0, 100), [box(20, 20, 50)]), trees: { ...DEFAULT_FOREST, spacing: 2 } } };
    d.order = ["w"];
    expect(regionArea(d.regions.w.outer as [number, number][], d.regions.w.inner as [number, number][][])).toBe(7500);
    expect(estimatePatch(d, "w")).toBe(1875);
  });

  it("count the trees placed by hand too", () => {
    designStore.getState().reset({ ...emptyDoc(), regions: { w: region("w", 8, box(0, 0, 100)) }, order: ["w"] });
    designStore.getState().commit("t", (d) => void d.trees.added.push({ x: 1, z: 1, height: 10, kind: 0 }));
    setForest("s", null, { spacing: 10 });
    expect(estimateTotal(designStore.getState().doc)).toBe(101);
  });

  it("know the trees to the hectare", () => {
    expect(perHectare(5)).toBe(400);
    expect(perHectare(10)).toBe(100);
    expect(perHectare(3)).toBeCloseTo(1111.1, 1);
  });

  it("are said as about", () => {
    expect(about(7)).toBe("about 10 trees");
    expect(about(432)).toBe("about 430 trees");
    expect(about(10_872)).toBe("about 10,900 trees");
  });

  it("know the build's limit", () => {
    expect(MAX_TREES).toBe(250_000);
  });
});

describe("the forest sliders", () => {
  type Prop = { ge?: number; le?: number; gt?: number; lt?: number; minimum?: number; maximum?: number; default?: number };
  const props = (openapi as unknown as { components: { schemas: Record<string, { properties: Record<string, Prop> }> } }).components.schemas["ForestSettings-Output"].properties;

  it("have the ranges and defaults the model has", () => {
    for (const f of FOREST_FIELDS) {
      const p = props[f.prop];
      expect(f.min, f.prop).toBe(p.ge ?? p.minimum);
      expect(f.max, f.prop).toBe(p.le ?? p.maximum);
      expect(p.default, f.prop).toBe(DEFAULT_FOREST[f.prop]);
      expect(f.step, f.prop).toBeGreaterThan(0);
      expect(DEFAULT_FOREST[f.prop], f.prop).toBeGreaterThanOrEqual(f.min);
      expect(DEFAULT_FOREST[f.prop], f.prop).toBeLessThanOrEqual(f.max);
    }
  });

  it("cover every setting but the weights and the seed, which have their own controls", () => {
    expect(FOREST_FIELDS.map((f) => f.prop).sort()).toEqual(Object.keys(props).filter((k) => k !== "kinds" && k !== "seed").sort());
  });

  it("weights run from 0 to 1, as the model says", () => {
    const weight = (props.kinds as unknown as { patternProperties: Record<string, Prop> }).patternProperties[String.raw`\S`]; // keyed by a non-blank name
    expect([weight.ge, weight.le]).toEqual([WEIGHT.min, WEIGHT.max]);
  });

  it("a new seed is a whole number the server accepts", () => {
    for (const u of [0, 0.5, 0.999999]) {
      const s = newSeed(() => u);
      expect(Number.isInteger(s) && s >= 0 && s <= 2 ** 31 - 1).toBe(true);
    }
  });
});
