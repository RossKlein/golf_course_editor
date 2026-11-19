import openapi from "../../../openapi.json";
import { angleFromHours, datesOfDeclination, describeHours, hoursFromAngle } from "../../model/look/sun";

// Every field of the look, and the control it gets. Ranges are not written here: they are read from the API schema, which is
// generated from the pydantic models (python -m course_maker openapi), so a range changed in models.py moves the slider. Where the
// model sets no range (a tree part's position) or a slider would be unusable over the whole of it (a stripe up to 100 m), the
// field says so with `min`, `max` or `soft`. lookSchema.test.ts fails when the model has a field with no control here.

type Node = { $ref?: string; anyOf?: Node[]; prefixItems?: Node[]; items?: Node; properties?: Record<string, Node>; additionalProperties?: Node; oneOf?: Node[]; [key: string]: unknown };
const schemas = (openapi as unknown as { components: { schemas: Record<string, Node> } }).components.schemas;

/** Follow a `$ref`. */
export const resolve = (n: Node): Node => (n.$ref ? resolve(schemas[n.$ref.split("/").pop()!]) : n);

export type Bounds = { min?: number; max?: number; minExclusive: boolean };

function boundsOfNode(raw: Node): Bounds {
  const n = raw.anyOf ? resolve(raw.anyOf.find((a) => a.type !== "null") ?? raw.anyOf[0]) : resolve(raw);
  const num = (k: string) => (typeof n[k] === "number" ? (n[k] as number) : undefined);
  const gt = num("gt") ?? num("exclusiveMinimum");
  return { min: gt ?? num("ge") ?? num("minimum"), max: num("le") ?? num("maximum") ?? num("lt") ?? num("exclusiveMaximum"), minExclusive: gt !== undefined };
}

/** The range the API schema gives `model.prop` (for a colour or a pair, of one number in it). */
export function boundsOf(model: string, prop: string, index = 0): Bounds {
  const node = schemas[model]?.properties?.[prop];
  if (!node) throw new Error(`${model}.${prop} is not in the API schema`);
  const real = node.anyOf ? resolve(node.anyOf.find((a) => a.type !== "null") ?? node.anyOf[0]) : resolve(node);
  return boundsOfNode(real.prefixItems ? real.prefixItems[Math.min(index, real.prefixItems.length - 1)] : real);
}

/** How a slider shows a field that is not best shown as it is kept: the sun's hour angle as hours, say. */
export type Display = {
  to: (stored: number) => number;
  from: (shown: number) => number;
  min: number;
  max: number;
  step: number;
  format?: (shown: number) => string;
  caption?: (stored: number) => string;
};

type Common = { prop: string; label: string; title?: string };
export type SliderField = Common & { kind: "slider"; min: number; max: number; step: number; integer?: boolean; display?: Display };
export type ColorFieldSpec = Common & { kind: "color" };
export type OptionalColorFieldSpec = Common & { kind: "optionalColor"; /** What it becomes when switched on: another field of the same object. */ fallbackProp: string };
export type SelectFieldSpec = Common & { kind: "select"; options: { value: string; label: string }[] };
export type TextFieldSpec = Common & { kind: "text" };
/** A tree kind's name: it is also the key of its forest weights, so renaming it carries them, and two kinds cannot share one. */
export type KindNameFieldSpec = Common & { kind: "kindName" };
export type ReadonlyFieldSpec = Common & { kind: "readonly" };
/** A pair of numbers, `[low, high]`, as two sliders. */
export type RangeFieldSpec = Common & { kind: "range"; min: number; max: number; step: number };
export type Field = SliderField | ColorFieldSpec | OptionalColorFieldSpec | SelectFieldSpec | TextFieldSpec | KindNameFieldSpec | ReadonlyFieldSpec | RangeFieldSpec;

type SliderOpts = { step?: number; title?: string; min?: number; max?: number; soft?: [number, number]; integer?: boolean; display?: Display };

/** A slider whose range is the model's, unless the field says otherwise (`soft` limits only how far the slider travels). */
function slider(model: string, prop: string, label: string, o: SliderOpts = {}): SliderField {
  const b = boundsOf(model, prop);
  const step = o.step ?? (o.integer ? 1 : 0.01);
  const min = o.soft?.[0] ?? o.min ?? (b.minExclusive && b.min !== undefined ? Math.max(b.min, step) : b.min);
  const max = o.soft?.[1] ?? o.max ?? b.max;
  if (min === undefined || max === undefined) throw new Error(`${model}.${prop} has no range in the API schema; give the field min and max`);
  return { kind: "slider", prop, label, title: o.title, min, max, step, integer: o.integer, display: o.display };
}

const color = (prop: string, label: string, title?: string): ColorFieldSpec => ({ kind: "color", prop, label, title });
const optionalColor = (prop: string, label: string, fallbackProp: string, title?: string): OptionalColorFieldSpec => ({ kind: "optionalColor", prop, label, fallbackProp, title });

// ---- sun ----------------------------------------------------------------------------------------------------------------------

const timeOfYear: Display = {
  to: (dec) => dec,
  from: (shown) => shown,
  min: -23.44,
  max: 23.44,
  step: 0.1,
  format: (v) => `${(Math.round(v * 10) / 10).toFixed(1)}°`,
  caption: (dec) => datesOfDeclination(dec).filter((d, i, all) => all.indexOf(d) === i).join(" or "),
};

const timeOfDay: Display = {
  to: hoursFromAngle,
  from: angleFromHours,
  min: -7,
  max: 7,
  step: 0.1,
  format: (v) => `${v < 0 ? "−" : ""}${Math.abs(Math.round(v * 10) / 10).toFixed(1)} h`,
  caption: (angle) => describeHours(hoursFromAngle(angle)),
};

export const SUN_FIELDS: Field[] = [
  slider("Sun", "latitude", "Latitude", { step: 0.1, title: "How far north or south the course is. It sets how high the sun climbs." }),
  slider("Sun", "declination", "Time of year", { title: "The sun's latitude through the year: 23.4° at the June solstice, 0° at the equinoxes, −23.4° in December. Shown with the dates it falls on.", display: timeOfYear }),
  slider("Sun", "hourAngle", "Time of day", { title: "Hours from solar noon, negative in the morning. Solar noon is when the sun is due south and highest, not 12 o'clock on a clock.", display: timeOfDay }),
];

/** The raw numbers behind the sun's words, for typing an exact value. */
export const SUN_RAW_FIELDS: Field[] = [
  slider("Sun", "declination", "Declination (°)", { step: 0.01 }),
  slider("Sun", "hourAngle", "Hour angle (°)", { step: 0.5, title: "15° an hour from solar noon, negative in the morning." }),
];

// ---- surfaces -----------------------------------------------------------------------------------------------------------------

const S = "Surface-Output";

/** A length kept in metres, shown in centimetres with the inches beside it. `soft` and the slider's own range are in centimetres. */
function centimetres(): Display {
  return {
    to: (m) => m * 100,
    from: (cm) => cm / 100,
    min: 0,
    max: 12,
    step: 0.1,
    format: (cm) => `${(Math.round(cm * 10) / 10).toFixed(1)} cm`,
    caption: (m) => `${(m * 39.3701).toFixed(2)} in`,
  };
}
export const SURFACE_MAIN: Field[] = [
  color("color", "Colour"),
  slider(S, "height", "Grass height", {
    step: 0.1,
    soft: [0, 12],
    title: "How tall the grass is. Where two surfaces meet, the ground steps from one height to the other, and the sun lights the step. A green is a few millimetres, a fairway 1 to 2 cm, rough 5 to 8 cm; sand, water and paths are 0.",
    display: centimetres(),
  }),
  slider(S, "grain", "Grass grain", { title: "How much of the grass texture shows through the colour." }),
  slider(S, "bump", "Bump", { step: 0.01, title: "How steep the fine detail is, as a slope (0.3 is about 17°). 0 for none." }),
  { kind: "select", prop: "bumpMap", label: "Bump comes from", options: [{ value: "grass", label: "The grass (blades and clumps)" }, { value: "grain", label: "Fine grain (sand and paths)" }], title: "Where the detail comes from." },
  slider(S, "shade", "Slope shading", { title: "How much the slope shades this surface; 1 as for grass." }),
  slider(S, "tuft", "Standing grass", { title: "Height of standing grass, as a multiple of the tufts' height. 0 for none." }),
  slider(S, "tuftDensity", "Standing grass density", { title: "How much of the standing grass grows here, as a share of what the viewer or the game's grass level would plant: 1 is all of it, 0.5 half, so a forest floor can be sparse." }),
  slider(S, "tuftClump", "Standing grass clumping", { title: "How much the standing grass gathers into patches of taller grass with bare ground between. 0 is an even spread, 1 is tussocks." }),
];

/** Fields most surfaces have no use for. They sit under "More" until a surface uses them (a fairway's stripes, a bunker's speckle). */
export const SURFACE_MORE: Field[] = [
  slider(S, "stripe", "Stripe width (m)", { step: 0.1, soft: [0, 10], title: "Metres across one mowing stripe. 0 for none." }),
  optionalColor("color2", "Second stripe colour", "color", "The colour of the other stripe."),
  slider(S, "speckleDark", "Dark speckle", { title: "Salt and pepper: how much a dark grain darkens." }),
  slider(S, "specklePale", "Pale speckle", { title: "How much a pale grain lightens." }),
  optionalColor("earth", "Soil colour", "color", "A second colour the surface is mottled with, as the forest floor is."),
  slider(S, "mottle", "Soil patchiness", { step: 0.05, title: "How much of the surface is flecked with soil: crisp specks of bare earth among the grass, about half the ground at 1.6 and nearly all of it at 10. 0 for none." }),
];

// ---- grass and tufts ----------------------------------------------------------------------------------------------------------

export const GRASS_FIELDS: Field[] = [
  { kind: "readonly", prop: "tile", label: "Grass texture", title: "The seamless grass image the ground is tiled with. The viewer loads game/grass.png whatever this says." },
  slider("Grass-Output", "tileMetres", "Texture size (m)", { step: 0.1, soft: [0.5, 20], title: "Ground one tile of the grass texture covers." }),
  slider("Grass-Output", "wobble", "Edge wobble", { title: "How far surface edges are wobbled by the texture, in class cells. 0 for clean edges." }),
  slider("Grass-Output", "speckleGrain", "Speckle grain (m)", { step: 0.005, soft: [0.005, 0.2], title: "Metres across one grain of speckle." }),
  slider("Grass-Output", "smoothing", "Edge smoothing (m)", { step: 0.1, title: "Metres either side of a surface edge averaged to draw it as a smooth curve. More gives rounder curves and loses thin features." }),
];

/** How the steps between surfaces of different heights look. */
export const GRASS_EDGE_FIELDS: Field[] = [
  slider("Grass-Output", "edgeGain", "Step exaggeration ×", { step: 0.5, title: "How much taller the step between two heights of grass looks than it is, so a few millimetres show. 1 is true. The surfaces' own heights are not changed." }),
  slider("Grass-Output", "edgeWidth", "Step width", { step: 0.1, soft: [0.5, 30], display: { ...centimetres(), min: 0.5, max: 30 }, title: "How wide the step between two heights of grass is. Narrower is sharper, and catches the light more; a step is never narrower than a pixel." }),
  slider("Grass-Output", "edgeRagged", "Ragged edge", { step: 0.1, soft: [0, 10], display: { ...centimetres(), max: 10 }, title: "How far the grass texture pushes the line between surfaces about, so it is not a perfect curve." }),
  slider("Grass-Output", "edgeShadow", "Shade at the foot", { title: "How much the shorter grass at the foot of a step is darkened, as in the shade of the taller. It falls on the side away from the sun. 0 for none." }),
];

export const TUFT_FIELDS: Field[] = [
  slider("Tufts-Output", "height", "Height (m)", { step: 0.01, soft: [0.05, 1.5], title: "Height of the tallest blade of a clump where a surface's standing grass is 1." }),
  slider("Tufts-Output", "spread", "Clump width (m)", { step: 0.05, title: "Metres across one clump of blades, whatever its height. Wider clumps cover more ground with fewer of them, and cost less." }),
  slider("Tufts-Output", "blades", "Blades in a clump", { integer: true, title: "Blades in a clump seen close up. Further off a clump is drawn with half and then a quarter of them, each wider, so this is what the nearest grass costs. More blades make denser grass, but every blade is nine vertices." }),
  slider("Tufts-Output", "bladeWidth", "Blade thickness", { step: 0.1, soft: [0.1, 10], display: { ...centimetres(), min: 0.1, max: 10 }, title: "How thick a blade is at its foot. It tapers to a point." }),
  color("root", "Root colour"),
  color("tip", "Tip colour"),
];

// ---- light, shadows, relief and the sky ---------------------------------------------------------------------------------------

export const SKY_FIELDS: Field[] = [color("sky", "Sky colour")];

export const SHADOW_FIELDS: Field[] = [
  slider("Shadows", "strength", "Strength", { title: "How much a shadow darkens lit ground. 0 for none." }),
  color("tint", "Shadow tint", "What shadowed ground is multiplied by, cooler than lit ground."),
  slider("Shadows", "softness", "Edge softness (m)", { step: 0.05, title: "Metres across the soft edge of a shadow." }),
  slider("Shadows", "distance", "Fade distance (m)", { step: 5, soft: [10, 1000], title: "Metres from the camera where shadows have faded out." }),
];

export const RELIEF_FIELDS: Field[] = [
  slider("ReliefLook-Output", "exaggeration", "Exaggeration ×", { step: 0.5, title: "How much steeper the slope looks in the shading than it is, so gentle ground shows. 1 is true. The ground itself keeps its shape." }),
  slider("ReliefLook-Output", "shading", "Shading", { step: 0.05, title: "How strongly the slope shades the sun's light: 0 is flat light, 1 as lit. The sky's light is not shaded." }),
  slider("ReliefLook-Output", "smoothing", "Smoothing (m)", { step: 0.1, title: "Metres over which the heights are averaged before the slope is taken. More gives broader shading and ignores smaller bumps." }),
];

export const TREE_LIGHT_FIELDS: Field[] = [
  slider("Trees-Output", "ambient", "Ambient light", { title: "Light a tree takes from every side." }),
  slider("Trees-Output", "direct", "Sun light", { title: "Light from the sun, on faces turned towards it." }),
  slider("Trees-Output", "base", "Brightness at the foot", { title: "How bright a tree is at its foot, rising to full at the top." }),
];

// ---- tree models --------------------------------------------------------------------------------------------------------------

export const TREE_KIND_FIELDS: Field[] = [
  { kind: "kindName", prop: "name", label: "Name", title: "Forest patches weight this model by its name; renaming it keeps the weights." },
  { kind: "range", prop: "height", label: "Typical height (m)", min: 1, max: 60, step: 0.5, title: "A typical tree's height range, for scattering trees where the bundle has no tree data." },
];

const F = "Frustum-Output";
export const FRUSTUM_FIELDS: Field[] = [
  slider(F, "y0", "Bottom", { min: -0.1, max: 1.2, title: "Where the shape starts, as a fraction of the tree's height." }),
  slider(F, "r0", "Bottom radius", { max: 0.6, title: "Radius at the bottom, as a fraction of the tree's height." }),
  slider(F, "y1", "Top", { min: -0.1, max: 1.2 }),
  slider(F, "r1", "Top radius", { max: 0.6 }),
  slider(F, "sides", "Sides", { integer: true, step: 1 }),
  color("color", "Colour"),
  slider(F, "shade", "Face shading", { title: "How much alternate faces are darkened." }),
];

const B = "Blob-Output";
export const BLOB_FIELDS: Field[] = [
  slider(B, "cx", "Centre across", { min: -0.6, max: 0.6 }),
  slider(B, "cy", "Centre height", { min: -0.1, max: 1.2 }),
  slider(B, "cz", "Centre along", { min: -0.6, max: 0.6 }),
  slider(B, "rx", "Radius across", { min: 0.02, max: 0.8 }),
  slider(B, "ry", "Radius up", { min: 0.02, max: 0.8 }),
  slider(B, "rz", "Radius along", { min: 0.02, max: 0.8 }),
  slider(B, "sides", "Sides", { integer: true, step: 1 }),
  slider(B, "rings", "Rings", { integer: true, step: 1 }),
  color("color", "Colour"),
];

// ---- coverage -----------------------------------------------------------------------------------------------------------------

/** Where each group of fields is in the look: `*` stands for a surface, a tree kind or a part. */
export const GROUPS: { prefix: string; fields: Field[] }[] = [
  { prefix: "", fields: SKY_FIELDS },
  { prefix: "sun", fields: [...SUN_FIELDS, ...SUN_RAW_FIELDS] },
  { prefix: "surfaces.*", fields: [...SURFACE_MAIN, ...SURFACE_MORE] },
  { prefix: "grass", fields: [...GRASS_FIELDS, ...GRASS_EDGE_FIELDS] },
  { prefix: "tufts", fields: TUFT_FIELDS },
  { prefix: "shadows", fields: SHADOW_FIELDS },
  { prefix: "relief", fields: RELIEF_FIELDS },
  { prefix: "trees", fields: TREE_LIGHT_FIELDS },
  { prefix: "trees.kinds.*", fields: TREE_KIND_FIELDS },
  { prefix: "trees.kinds.*.parts.*", fields: [...FRUSTUM_FIELDS, ...BLOB_FIELDS] },
];

/** The fields that are not edited: `shape` says which kind of part it is, and is set when a part is added. */
export const NOT_EDITED = ["trees.kinds.*.parts.*.shape"];

/** Every pattern some control covers, such as `surfaces.*.grain`. */
export const coveredPatterns = (): Set<string> =>
  new Set([...GROUPS.flatMap((g) => g.fields.map((f) => (g.prefix ? `${g.prefix}.${f.prop}` : f.prop))), ...NOT_EDITED]);
