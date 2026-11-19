import type { EditorState, Viewport } from "../../core/api/api";
import { TUFT_RANGE } from "../../terrain/passes/tufts/tufts";
import { initialLayerState, type Scene } from "../scene";

// The editor's saved state (.course_maker/editor.json). The shape is defined by the pydantic model EditorState.

/** The 3D view's settings, which are saved with the rest of the editor's state. */
export type Viewer = NonNullable<EditorState["viewer"]>;

/** How the 3D view starts: in the game's look when the terrain has the surfaces for it. */
export const defaultViewer = (hasSurfaces: boolean): Viewer => ({
  aerial: true,
  game: hasSurfaces,
  tufts: true,
  grassRange: TUFT_RANGE,
  grassDensity: 1,
  trees: true,
  water: true,
  surfaces: hasSurfaces ? 0 : 0.5,
  outlines: true,
  scale: 1,
  shading: 1,
  shadows: "low",
  leanStrokes: true,
});

export const defaultEditorState = (): EditorState => ({
  version: 1,
  viewport: null,
  layers: {},
  exaggeration: 3,
  contourInterval: 0,
  slopeMap: false,
  hole: 1,
  editor: "view",
  tool: "select",
  activeClass: 1,
  snap: true,
  overlayOpacity: 1,
  hideOthers: false,
  boundsFeatures: "hole",
  boundsAllHoles: false,
  boundsAllBounds: false,
  brushRadius: 10,
  brushStrength: 0.3,
  brushHardness: 0.5,
  cloneRelative: true,
  smoothing: 0.1,
  pathWidth: 2.5,
  collarThickness: 1.5,
  leftCollapsed: false,
  rightTab: "view",
  view3d: false,
  viewer: null,
  lookTab: "sky",
});

/**
 * The state to show for a scene: the scene's own layer defaults, overlaid with whatever was saved.
 * Layers the scene has but the file lacks keep their defaults (new layers appear normally in old projects);
 * saved layers the scene does not have are dropped. The hole is clamped to the holes that exist. The 3D view's settings are the
 * saved ones, or the defaults for the scene's terrain when none were saved; the game's look is only kept on if the terrain can show it.
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
  const hasSurfaces = !!scene.terrain?.renderer.hasSurfaces;
  const viewer = base.viewer ? { ...defaultViewer(hasSurfaces), ...base.viewer, game: base.viewer.game && hasSurfaces } : defaultViewer(hasSurfaces);
  return {
    ...base,
    version: 1,
    viewer,
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
