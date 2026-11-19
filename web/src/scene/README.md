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
- `lookApplier.ts`, `useLookBinding.ts`, `lookSession.ts`, `useLookEditing.ts`: what happens to a change of look. The applier waits for a finishing event or a 300 ms pause, then applies the look to the renderer and saves it; the binding connects it to the design store; the session is how the panel reads its state and says an edit is finished; the editing hook is how a control changes the look
- `treePreview.ts`, `useTreesPreview.ts`: showing the trees of unsaved forest settings as a slider is dragged, one request at a time
- `buildFiles.ts`: which files a finished build changed (it reports a hash of each), so a refresh reads only those; `palette.ts`: colouring the class map's images through a table
- `drape.ts`: painting the design's surfaces and outlines to canvases for the 3D view
- `selection.ts`: which file is open, kept in the URL hash

## Does not belong here

- Components, other than hooks that bind data to React
- Drawing code (`terrain/`) and the map and 3D views (`views/`)
- Editor tools (`editors/`)
