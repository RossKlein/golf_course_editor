# `src/views`

## Purpose

The two ways to look at a scene: the 2D map and the 3D landscape. A view is for looking; editing is done by `editors/`, which attach tools to the map.

## Belongs here

- `map2d/`: the OpenLayers map (`OlMap`), moving and fitting its view, and the layers that draw the design on it (`design/`)
- `view3d/`: `Terrain3D` (the canvas and the frame loop), `OptionsPanel` (the sliders), `useCameraControls` (orbit, pan, zoom, keyboard), `useDrape` (keeping the design painted over the ground)

## Does not belong here

- Rendering itself: `Terrain3D` asks a `TerrainRenderer` for a frame (`terrain/`)
- Editing tools (`editors/`) and panels around the view (`shell/`)

## Rules

- The 3D view never edits. Its quality settings (grass range and density) belong to whoever is looking, not to the course.
