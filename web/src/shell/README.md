# `src/shell`

## Purpose

The app's chrome: the bars, panels and lists around the map.

## Belongs here

- `EditorBar`, `SubBar`: the editor tabs and the tool bar of the open editor
- `RightPanel`, `DataTab`, `HolesPanel`, `LayerControls`, `ReportView`: the panels
- `FileList`, `TifPanel`: the list of bundles and rasters, and a raster's panel (including baking a bundle from it)

## Does not belong here

- The map and 3D view (`views/`), or editing tools (`editors/`)
- State that outlives a panel: that is `scene/` or `model/`
