import type { ForestSettings } from "../../core/api/api";

// The sliders for a patch's forest settings. The ranges are the model's (`ForestSettings` in course_maker/design/models.py);
// forestFields.test.ts checks them against the API schema, so a range changed there fails here until this follows.

export type ForestField = {
  prop: Exclude<keyof ForestSettings, "kinds" | "seed">;
  label: string;
  min: number;
  max: number;
  step: number;
  title: string;
};

export const FOREST_FIELDS: readonly ForestField[] = [
  { prop: "spacing", label: "Spacing (m)", min: 2, max: 20, step: 0.5, title: "Average metres between trees. Closer is a denser forest. It is an average: trees can still stand close, as they do in a real forest" },
  { prop: "heightScale", label: "Height ×", min: 0.5, max: 2, step: 0.05, title: "A scale on each model's height range" },
  { prop: "edgeThinning", label: "Edge thinning (m)", min: 0, max: 30, step: 1, title: "Metres over which the forest thins towards open ground, so a patch does not end in a wall. 0 for none" },
  { prop: "edgeDensity", label: "Density at the edge", min: 0, max: 1, step: 0.05, title: "How full the forest is right at the border with open ground, as a share of its full density" },
];

/** A kind's weight: 0 plants none of it, 1 is the most. */
export const WEIGHT = { min: 0, max: 1, step: 0.05 };

/** A new seed for a reseed. */
export const newSeed = (random: () => number = Math.random) => Math.floor(random() * 2 ** 31);
