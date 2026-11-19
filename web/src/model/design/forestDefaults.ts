import type { ForestSettings, TreeEdits } from "../../core/api/api";

/**
 * How a woods patch is planted when nothing says otherwise. These are the server's defaults (`ForestSettings` in
 * course_maker/design/models.py), for a document with no bundle behind it and for "Reset to defaults"; forest.test.ts checks them
 * against the API schema so they cannot drift.
 */
export const DEFAULT_FOREST: Readonly<ForestSettings> = { spacing: 5, kinds: {}, heightScale: 1, edgeThinning: 8, edgeDensity: 0.3, seed: 0 };

export const emptyTreeEdits = (): TreeEdits => ({ defaults: { ...DEFAULT_FOREST, kinds: {} }, added: [], removed: [] });
