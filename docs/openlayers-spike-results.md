# OpenLayers spike: results

The spike code is archived on the `archive/spike` branch (`spike/openlayers/`); this is its decision record.

Run 2026-10-25 on the Augusta bundle. Throwaway code: Vite + React + OpenLayers 10.11 in this folder, a Python
rasterizer in `py/`, and a test harness (`src/tests.ts`, run in the page with `window.spike.runAll()`).
**26 of 26 checks pass.** Recommendation: **go with OpenLayers.**

Run it: start `python -m course_maker serve --port 8766` from the repo root, then `npx vite --port 5199` here, and
open http://127.0.0.1:5199. The `window.spike` object has the map, the store and the test runner.

## The acceptance checks

| Check | Result |
| --- | --- |
| Custom metric projection (`units: 'm'`), aerial, hillshade and class raster stacked | Works. No lon/lat, no proj4. |
| Server raster edges drawn where the projection says | Within 0 to 1 screen px at 0.05 m/px (1 px is 5 cm, a tenth of a class cell), on all four edges of a test polygon |
| Server raster vs Shapely point-in-polygon | 0 mismatches on 5,996 points (2 regions) and 5,661 points (450 regions); points within 0.75 m of an edge are skipped |
| Draw polygon by clicks, close by clicking the first point | Works |
| Draw freehand, then simplify and smooth | Works: 161 raw points to 87 stored, not self-intersecting (tolerance could be larger; see below) |
| Modify: drag a vertex | Works, one history entry |
| Modify: drag from an edge to insert a vertex | Works |
| Modify: alt+click deletes a vertex | Works (needs a 250 ms wait: OpenLayers delays `singleclick` to rule out a double click) |
| Polygons with holes | Modify edits a vertex of an inner ring and keeps the ring structure. Draw cannot create holes; `polygon-clipping` `difference` makes holes, notches and splits, which is the erase tool |
| Snap to an existing vertex | Lands exactly on the target coordinates |
| Snap onto an existing edge | Lands exactly on the edge |
| Trace along a neighbour's border | Works: the corner between two clicks was added without clicking it |
| Immer patches: undo and redo across add, modify (grouped) and remove | Every intermediate state restored exactly; a group is one entry; a new edit clears redo |
| Map features follow undo and redo | Yes (store to map, one way) |
| 450 regions + 31,250 trees (WebGL layer) | Loads in about 0.1 s and 0.5 s; renders at 8 to 14 ms per frame on average, p95 17 to 26 ms |
| Save and load through the server | Round-trips exactly; 463 KB of JSON for 450 regions, saved in under 30 ms |
| `react-resizable-panels` 4.15 collapse | `usePanelRef().collapse()` and `expand()` work; the map fills the freed space and expand restores the size |

## Findings that change the plan

1. **Rasterize with one call per channel, in list order.** A call per region took 3.7 s for 450 regions (it copies the
   whole 10 MB array each call). One `rasterio.features.rasterize` call with all shapes takes **80 ms**, and within a
   call later shapes overwrite earlier ones, which is exactly the painter's-order rule. Owner (hole) is one more
   call, then masked to the owned classes.
2. **PNG encoding is the slow step of the build, not rasterizing.** Two PNGs with `optimize=True` took 1.1 s, so about
   0.55 s each. The real build writes `class.png` once; lowering the compression level is available if it matters.
3. **Clean rings before validating.** Tracing and snapping repeat vertices, and the kink check treats a duplicate as a
   self-intersection. Remove consecutive duplicates first (done in the spike).
4. **`react-resizable-panels` v4 changed units:** a bare number is **pixels** and a string is a percentage (v2 used
   percent). The panel handle is `usePanelRef` with `collapse`, `expand` and `isCollapsed`.
5. **OpenLayers does not resize itself when its container does.** Add a `ResizeObserver` calling `map.updateSize()`
   (the spike does), or the map stays at its first size when a panel collapses.
6. **Edit modes are separate interactions, with `Snap` added last.** The spike switches modes by removing and adding
   interactions; this is how OpenLayers is designed to be used.
7. **Freehand tolerance should be larger.** 0.6 m simplify plus one Chaikin pass gave 87 vertices for a hand-drawn
   loop. Try about 1.5 m, or simplify after smoothing, and let the user tune it.

## What this spike did not show

- **How drawing feels.** Everything was driven by synthetic pointer events, which proves the behaviour and not the
  feel. Use it yourself: open the page, choose a mode, and draw.
- **Touch input**, and keyboard shortcuts.
- **Inserting a vertex into a hole's ring** and deleting a vertex from one (editing an existing hole vertex works).
- **Trace in other situations** (several features, a ring end, closed loops). One case worked.
- **Frame rate in a visible browser.** Timings come from `renderSync` in the automated pane, which was not painting
  frames, so they measure the work but not compositing. They are comfortable, and the p95 suggests an occasional
  dropped frame when the whole course is on screen with every layer.
- **The test harness patches `Image.decode()`.** The pane only resolves it while painting frames and OpenLayers waits
  on it, so image layers never finished loading there. This is a harness workaround, not something the app needs.

## What would be kept

The pattern, not the code: a store with Immer patches as the document, a one-way mirror into an OpenLayers source,
interaction end events turned into store actions, `Snap` last, design coordinates `[x, z]` mapped to map `[x, -z]` at
one boundary, and the Python rasterize step. The spike's `store.ts`, `sync.ts` and `geom.ts` are close to what the
editor needs.
