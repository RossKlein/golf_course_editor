# `src/scene`

## Purpose

Joins the app's data to what is drawn. A `Scene` is what the map shows for something that is open (a bundle or a GeoTIFF): its OpenLayers layers, its readouts, and its terrain source (the `TerrainRenderer` and the ground height). This is the one place that holds both a renderer and the design store, so it is also where a sculpt stroke becomes an undo step. It may use OpenLayers, because a scene's layers are OpenLayers layers.

## Belongs here

- `scene.ts`: the `Scene` and `TerrainSource` types
- `groundTool.ts`: the `GroundTool` type, how a view hands the pointer on the ground to a tool
- `bundleScene.ts`, `tifScene.ts`: loading a bundle or a raster into a scene
- `layers.ts`, `terrainLayer.ts`, `projection.ts`: building the OpenLayers layers a scene is made of
- `heightSession.ts`: sculpting, saved and undone through the design store
- `useDesignSession.ts`: loading and saving the design, and the build status
- `editorState/`: the saved editor state (`.course_maker/editor.json`) merged with a scene's layers, and its persistence hook
- `drape.ts`: painting the design's surfaces and outlines to canvases for the 3D view
- `selection.ts`: which file is open, kept in the URL hash

## Does not belong here

- Components, other than hooks that bind data to React
- Drawing code (`terrain/`) and the map and 3D views (`views/`)
- Editor tools (`editors/`)
