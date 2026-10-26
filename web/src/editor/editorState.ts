import type { EditorState, Viewport } from "../api/api";
import { initialLayerState, type Scene } from "../map/scene";

// The editor's saved state (.course_maker/editor.json). The shape is defined by the pydantic model EditorState.

export const defaultEditorState = (): EditorState => ({
  version: 1,
  viewport: null,
  layers: {},
  exaggeration: 3,
  hole: 1,
  editor: "view",
  tool: "select",
  activeClass: 1,
  snap: true,
  smoothing: 1.5,
  leftCollapsed: false,
  rightTab: "view",
});

/**
 * The state to show for a scene: the scene's own layer defaults, overlaid with whatever was saved.
 * Layers the scene has but the file lacks keep their defaults (new layers appear normally in old projects);
 * saved layers the scene does not have are dropped. The hole is clamped to the holes that exist.
 */
export function mergeSaved(scene: Scene, saved: EditorState | null, holeCount: number): EditorState {
  const layers = initialLayerState(scene);
  if (saved) {
    for (const id of Object.keys(layers)) {
      const pref = saved.layers[id];
      if (pref) layers[id] = { visible: pref.visible, opacity: pref.opacity };
    }
  }
  const base = saved ?? defaultEditorState();
  return {
    ...base,
    version: 1,
    layers,
    hole: Math.min(Math.max(1, base.hole), Math.max(1, holeCount)),
  };
}

/** A stable string for comparing states: the same state always serialises the same way. */
export function serialise(state: EditorState, viewport: Viewport | null): string {
  const layers: EditorState["layers"] = {};
  for (const id of Object.keys(state.layers).sort()) layers[id] = state.layers[id];
  const v = viewport && { x: viewport.x, z: viewport.z, scale: viewport.scale };
  return JSON.stringify({ ...state, version: 1, viewport: v, layers });
}

/** The state as it is saved: the editor state with the live viewport (which lives outside React state). */
export const withViewport = (state: EditorState, viewport: Viewport | null): EditorState => ({ ...state, viewport });

export function viewportFromView(view: { scale: number; ox: number; oz: number }, width: number, height: number): Viewport {
  return { x: view.ox + width / 2 / view.scale, z: view.oz + height / 2 / view.scale, scale: view.scale };
}

export function viewFromViewport(v: Viewport, width: number, height: number) {
  return { scale: v.scale, ox: v.x - width / 2 / v.scale, oz: v.z - height / 2 / v.scale };
}
