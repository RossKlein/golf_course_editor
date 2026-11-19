import { BRUSHES } from "../../terrain/sculpt/brush";

/** The tool that is not a brush: it works on a whole lake at a time, from its panel, and takes no strokes. */
export const BASIN_TOOL = {
  id: "basin",
  label: "Lake basin",
  key: "b",
  hint: "Cuts a lake's bed and banks so its flat water meets the ground at the painted outline. Pick the lake in the panel",
};

/** The tool that shapes the ground inside a bunker: click one to pick it, and tune it from its panel. */
export const TRAP_TOOL = {
  id: "trap",
  label: "Sand trap",
  key: "a",
  hint: "Click a bunker (painted in the Course editor) to shape the ground inside it: a round bowl, a flat floor, a trough. Tune it in the panel, then finish it with the brushes",
};

/** Every tool of the Heightmap editor's first bar (the brushes, the basin and the sand trap), in order. */
export const HEIGHT_TOOLS = [...BRUSHES, BASIN_TOOL, TRAP_TOOL];

export const isBasin = (tool: string) => tool === BASIN_TOOL.id;
export const isBrushTool = (tool: string) => BRUSHES.some((b) => b.id === tool);

/** The tools of the second bar, which change the shape of the map rather than the height of the ground under a brush. */
export const CROP_TOOL = {
  id: "crop",
  label: "Crop",
  key: "w",
  hint: "Makes the map smaller. Drag the handles to choose the part to keep (drag outside to draw a new box, inside to move it); the rest is cut away",
};
export const CUT_TOOL = {
  id: "cut",
  label: "Cut",
  key: "x",
  hint: "Cuts a hole right through the map. Click to add points; click the first point or press Enter to finish; Esc cancels. The ground inside is gone (a void). The Course editor can reshape or delete it later",
};
export const ISLAND_TOOL = {
  id: "island",
  label: "Island",
  key: "i",
  hint: "Keeps the land inside an outline and makes everything else on the map void, so it stands alone. Click to add points; click the first point or press Enter to finish; Esc cancels",
};
export const MESH_TOOLS = [CROP_TOOL, CUT_TOOL, ISLAND_TOOL];
/** The tools that take an outline drawn on the map. */
export const isOutlineTool = (tool: string) => tool === CUT_TOOL.id || tool === ISLAND_TOOL.id;
/** The tools with a panel of settings (the others have none). */
export const hasPanel = (tool: string) => tool === BASIN_TOOL.id || tool === CROP_TOOL.id || tool === TRAP_TOOL.id;
export const isMeshTool = (tool: string) => MESH_TOOLS.some((t) => t.id === tool);

/** Every tool the Heightmap editor has, for the app to know which tool ids are its own. */
export const ALL_HEIGHT_TOOLS = [...HEIGHT_TOOLS, ...MESH_TOOLS];
