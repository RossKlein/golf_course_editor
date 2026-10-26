# `src/views`

## Purpose

The two ways to look at a scene: the 2D map and the 3D landscape. A view is for looking; editing is done by `editors/`, which attach tools to the map or, through a `GroundTool` (`scene/groundTool.ts`), to the 3D ground.

## Belongs here

- `map2d/`: the OpenLayers map (`OlMap`), moving and fitting its view, and the layers that draw the design on it (`design/`)
- `view3d/`: `Terrain3D` (the canvas and the frame loop), `OptionsPanel` (the sliders), `useCameraControls` and `dragMode` (orbit, pan, zoom, keyboard; which button does what), `useDrape` (keeping the design painted over the ground), `useGroundTool` and `ring` (finding the ground under the pointer for a tool, and drawing its ring over the picture)

## Does not belong here

- Rendering itself: `Terrain3D` asks a `TerrainRenderer` for a frame (`terrain/`)
- Editing tools (`editors/`) and panels around the view (`shell/`)

## Rules

- The 3D view never edits. A tool is handed to it and it only finds the ground for the tool; it does not know what the tool does. Its quality settings (grass range and density) belong to whoever is looking, not to the course.
- While a tool works on the ground, the left button is the tool's and the camera moves to the others. A stroke draws only the ground (no grass, trees or shadows) so the picture keeps up; they return a moment after it ends.
