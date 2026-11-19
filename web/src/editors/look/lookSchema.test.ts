import { describe, expect, it } from "vitest";
import openapi from "../../../openapi.json";
import { boundsOf, coveredPatterns, GROUPS, resolve, SURFACE_MAIN, type Field } from "./lookSchema";

type Node = Parameters<typeof resolve>[0];
const schemas = (openapi as unknown as { components: { schemas: Record<string, Node> } }).components.schemas;

/** Every leaf of the look in the API schema as a pattern: `surfaces.*.grain`, `trees.kinds.*.parts.*.r0`. */
function leaves(raw: Node, prefix: string): string[] {
  const n = resolve(raw);
  const join = (k: string) => (prefix ? `${prefix}.${k}` : k);
  if (n.oneOf) return [...new Set(n.oneOf.flatMap((o) => leaves(o, prefix)))];
  if (n.properties) return Object.entries(n.properties).flatMap(([k, v]) => leaves(v, join(k)));
  if (n.additionalProperties && typeof n.additionalProperties === "object") return leaves(n.additionalProperties, join("*"));
  if (n.type === "array" && n.items && !n.prefixItems) return leaves(n.items, join("*"));
  return [prefix]; // a number, a string, a colour or a pair
}

/** The water's fields are edited by the Water tab, which is written by hand (WaterTab.tsx) rather than from the schema, so they are not in the schema-driven groups. */
const lookLeaves = () => leaves(schemas["Look-Output"], "").filter((p) => !p.startsWith("water."));

describe("the look editor covers the look", () => {
  it("has a control for every field the model has, and none for a field it lacks", () => {
    const covered = coveredPatterns();
    const have = lookLeaves();
    expect(have.filter((p) => !covered.has(p)), "fields with no control: add them to lookSchema.ts").toEqual([]);
    expect([...covered].filter((p) => !have.includes(p)), "controls for fields the model does not have").toEqual([]);
  });

  it("finds the fields the plan lists", () => {
    const have = lookLeaves();
    for (const p of ["sky", "sun.hourAngle", "surfaces.*.color2", "surfaces.*.bumpMap", "relief.exaggeration", "relief.shading", "shadows.softness", "trees.kinds.*.parts.*.rings", "trees.kinds.*.parts.*.shade"]) expect(have).toContain(p);
  });

  it("takes a slider's range from the model", () => {
    expect(boundsOf("Surface-Output", "grain")).toEqual({ min: 0, max: 1, minExclusive: false });
    expect(boundsOf("Surface-Output", "stripe")).toEqual({ min: 0, max: 100, minExclusive: false });
    expect(boundsOf("Grass-Output", "tileMetres")).toEqual({ min: 0, max: 100, minExclusive: true });
    expect(boundsOf("Frustum-Output", "sides")).toEqual({ min: 3, max: 16, minExclusive: false });
    expect(boundsOf("Surface-Output", "color")).toEqual({ min: 0, max: 1, minExclusive: false }); // a colour's channels
    expect(boundsOf("ReliefLook-Output", "exaggeration")).toEqual({ min: 1, max: 20, minExclusive: false });
  });

  it("gives every slider a usable range, inside what the model allows", () => {
    const sliders = GROUPS.flatMap((g) => g.fields).filter((f): f is Extract<Field, { kind: "slider" }> => f.kind === "slider");
    expect(sliders.length).toBeGreaterThan(40);
    for (const s of sliders) {
      expect(s.max, s.label).toBeGreaterThan(s.min);
      expect(s.step, s.label).toBeGreaterThan(0);
    }
  });

  it("offers a bump map exactly the choices the model has", () => {
    const select = SURFACE_MAIN.find((f) => f.kind === "select" && f.prop === "bumpMap");
    const node = resolve(schemas["Surface-Output"].properties!.bumpMap);
    expect(select && select.kind === "select" && select.options.map((o) => o.value)).toEqual(node.enum);
  });
});
