# Editor technology: what we use instead of writing

Status: recommendation, not built. Companion to `course-editor-plan.md` (what the editor does). This says what it is
made of. The principle: **use a maintained library for every solved problem** (map interaction, polygon editing,
geometry, rasterizing, undo, panels), and write code only for what is specific to golf courses.

Research was done in October 2026. Each pick says how well it was checked: **verified** means I read current docs or
release notes this session; **from experience** means I know it but did not re-check it, so treat it as a candidate
to confirm during the spike (section 5).

## 1. The shape of the system

Almost all input is "draw a vector, rasterize it later", so the whole system is vector-first:

```
 browser                                              server (Python)
 -------                                              ---------------
 draw / edit vectors  ->  design files (JSON)  ->  build: validate + clean geometry
 (OpenLayers)             .course_maker/design     rasterize (rasterio) -> class.png, bounds.png
 undo/redo (Immer)                                 distance falloff (scipy) -> heights, patches
 geometry ops (Turf)                               place trees (Poisson disk) -> trees.bin
                                                   write bundle + validate
```

Vectors are stored as drawn. The browser never rasterizes the real output; the server does, deterministically.

## 2. Recommended stack

| Concern | Pick | Checked | Why |
| --- | --- | --- | --- |
| Map, pan/zoom, layers, drawing, vertex editing, snapping | **OpenLayers 10** (`ol`) | verified | Works in plain metres; has Draw, Modify, Snap, Select; GPU vector rendering |
| Local coordinates | OpenLayers `Projection` with `units: 'm'` and the course extent; no proj4 | verified | Their own static-image example does this for pixel units; we use metres |
| Freehand to clean polygon | **Turf.js** (`@turf/simplify`, `polygonSmooth`) | from experience | Draw freehand, simplify, smooth once, store the final vertices |
| Polygon erase/merge in the browser | **polygon-clipping** (Martinez) | verified (README) | Union/difference with holes and self-intersections; Turf 7 uses the same family |
| Offsets / buffers in the browser, if needed | **Clipper2** (`clipper2-wasm`, BSL-1.0) | verified (package pages) | Union, difference, offsetting; fastest of the candidates by its own benchmarks |
| State store | **Zustand** with the Immer middleware | from experience | Small store, immutable updates written as mutations |
| Undo/redo for vector edits | **Immer patches** (`produceWithPatches`) | verified | Each edit yields patches and inverse patches; undo applies the inverse; history is small |
| Undo/redo for raster brush strokes | Our own tile-diff entries on the same history stack | n/a | No library fits sparse height tiles; the stack API is the shared part |
| Contour lines, slope shading in the Greens editor | **d3-contour** (marching squares) | verified | Grid of numbers in, GeoJSON isolines out |
| GPU hillshade and colour ramps | OpenLayers `WebGLTile` style expressions | verified (official example) | Shaded relief and elevation tint computed on the GPU, live while sculpting |
| Compress deltas, decode PNGs | **fflate**; **fast-png** (16-bit) | verified | Pure JS, typed arrays, fast-png builds on fflate |
| Panels | **react-resizable-panels** (left collapse, right) | verified (README), pin a version | Collapsible panels; v4 API differs from v2, so check the collapse API when pinning |
| UI primitives (toolbar, tabs, tooltips, sliders, popovers) | **Radix UI** primitives, styled with our CSS | from experience | Accessible, unstyled; avoids hand-rolled widgets |
| Hotkeys | **react-hotkeys-hook** or `tinykeys` | from experience | Scoped keyboard shortcuts |
| API types and calls | `openapi-typescript` (have) + `openapi-fetch`, **TanStack Query** for build status and caching | from experience | Typed from the pydantic models, already working |
| Server | FastAPI + pydantic (have) | n/a | |
| Polygon cleaning, booleans, buffers (server) | **Shapely 2** (installed) | measured | `make_valid`, `unary_union`, `buffer`, `simplify` are authoritative; browser geometry is for feedback only |
| Vector to raster | **`rasterio.features.rasterize`** (installed) | measured | 450 polygons into the 9.9 M pixel class map in 72 ms |
| Distance falloff, blur, bilinear resample | **SciPy** (`ndimage.distance_transform_edt`, `gaussian_filter`, `map_coordinates`) | from experience | New dependency; covers feathering and smoothing without hand-written loops |
| Tree placement | **SciPy `stats.qmc.PoissonDisk`** | verified | Poisson-disk sampler with minimum radius and seed; docs warn it suits low dimensions and modest counts, which 2-D trees are |
| Procedural contour noise | `opensimplex` or numpy fBm | from experience | For the greens micro-contour generator |
| Design-file history | **`dulwich`** (pure-Python git) or plain rolling backups | not researched | Could give real version history of `design/`; decide with the versioning question |
| Real-world coordinates (OSM, geodesy) | **pyproj**, Overpass API | from experience | Only when OpenStreetMap pre-fill is built |
| Later: 3D preview of the built course | **three.js** | n/a | The game uses it, so a preview can share the loader |

## 3. What the research changed

1. **Terra Draw is out, even though it is the nicest drawing library.** It supports snapping in polygon and select
   modes, vertex move and delete, midpoint insert, validation (not self-intersecting, min area), and has a freehand
   mode. But its geometry is lon/lat GeoJSON with web-mercator or globe projection, and the docs mention no
   projected or local coordinates. Our rasters are aligned in local metres, and forcing them through fake lon/lat
   would put a distortion between what you draw and what we rasterize. Freehand mode also does not list snapping.
2. **OpenLayers can work in plain metres.** A custom `Projection` with its own units and extent (their static-image
   example uses pixels) puts the aerial, hillshade, class and bounds rasters and all vectors in one coordinate
   system with no reprojection. Draw supports `freehand`, `trace` (follow another feature's edge, useful for shared
   borders), `minPoints`, `finishCondition`, and abort/finish/remove-last-point methods. Modify moves and deletes
   vertices. Snap works together with both.
3. **`ol-ext`'s undo/redo is not for us.** Its own pages call the interaction experimental and possibly buggy. We
   own the document in a store and mirror it into OpenLayers one way (store to map), turning Draw and Modify end
   events into store actions. Then Immer patches give undo for free.
4. **OpenSeadragon** (found by you) is a viewer for very large tiled images: DZI, IIIF, TMS and Zoomify out of the box,
   plugins for GeoTIFF and OME-Zarr, overlays, multi-image modes, rotation and a navigator. It has no drawing or
   vector editing of its own. That comes from plugins (Annotorious has polygon and rectangle tools with an edit
   mode; there is a Fabric.js overlay), and I found nothing about vertex snapping in any of them. It solves a problem
   we do not have yet: our aerial is a 2346 x 2938 px, 1.7 MB image. It becomes interesting if a stack outgrows
   one decimated image (the 205 MB stack is shown at one third resolution today), but OpenLayers can serve tiles
   too. Not the foundation; **Annotorious on OpenSeadragon is a second possible fallback** if the OpenLayers spike
   fails, weaker than Leaflet with Geoman on snapping as far as the docs show.
5. **MapLibre was ruled out** for the same reason as Terra Draw (web-mercator only). **Leaflet + Leaflet-Geoman**
   is a credible fallback: Leaflet has `CRS.Simple` for non-geographic grids and Geoman covers drawing, editing,
   snapping, cutting and splitting. I could not confirm snapping works on a CRS.Simple image map, so it stays the
   fallback, not the pick. **Konva, Fabric, Paper.js and PixiJS** would make us build vertex editing, snapping and
   hit testing ourselves (Paper.js is strong at path maths; the others are scene graphs).
6. **A bigger change to the plan: heights should be vector-driven too.** Sculpting with brushes is raster work, but
   most terrain intent is a shape: flatten this tee platform to 87.4 m, carve this bunker 0.6 m deep with a lip,
   draw a swale along this line, level the water. These are vectors with parameters, and the server turns them into
   heights with a distance transform for the falloff. See section 4.

## 4. Impact on the plan

**Terrain features as vectors** (new design file `design/terrain.json`), applied in order by the build:

| Feature | Geometry | Parameters |
| --- | --- | --- |
| `level` | polygon | target height (or "match edge"), feather distance |
| `offset` | polygon | raise or lower by d, feather, optional lip |
| `smooth` | polygon | strength, feather |
| `swale` / `ridge` | line | width, depth or height, falloff profile |
| `spot` | point | height, radius |

Compile: rasterize each shape to a mask, `distance_transform_edt` for the feather, blend into the height grid. This
is resolution independent, so the same feature gives macro and hi-res patch results, survives a re-bake, and is a few
kilobytes instead of megabytes. Brush sculpting remains as an optional raster delta on top for freehand detail,
mostly on greens. Bunker depressions, tee platforms and water levels can then be derived from regions with defaults
(a bunker region implies an `offset` unless you override it).

**Existing code.** `MapView.tsx` is replaced by an OpenLayers map. Our scene and layer model survives: each layer
becomes an OpenLayers layer (`ImageStatic` or canvas for the aerial, hillshade and class rasters, a vector layer
for regions, a WebGL vector layer for the ~31 000 trees). The state, persistence, bundle loading and API code do not
change. The tool system in the plan becomes thin: OpenLayers interactions are the tools, wired to the store.

**Coordinates.** Design files keep the bundle's course metres (x east, z south). OpenLayers is y-up, so one helper
at the boundary maps `[x, z]` to `[x, -z]`.

## 5. Spike result: OpenLayers confirmed

Run on 2026-10-25 against the Augusta bundle; code and full results in `spike/openlayers/` (`RESULTS.md`).
**26 of 26 checks pass**, so OpenLayers is the foundation and Leaflet/Geoman and OpenSeadragon stay unused fallbacks.

- **Alignment**: raster edges from the server's rasterizer land within 0 to 1 screen pixel (5 cm at the test zoom) of
  where the metric projection puts them. Zero mismatches against Shapely on about 5,700 sampled points, for 2 and for
  450 regions.
- **Editing**: click and freehand drawing, vertex drag, edge-drag insert, alt+click delete, editing a vertex of a hole,
  exact vertex and edge snapping, and tracing along a neighbour's border all work. Holes are made with
  `polygon-clipping` (Draw cannot create them), which is also the erase tool.
- **Undo/redo**: Immer patches restore every intermediate state exactly, groups are one step, and the map follows.
- **Scale**: 450 regions plus 31,250 trees on a WebGL layer render at 8 to 14 ms per frame on average (p95 17 to 26).
- **Panels**: `react-resizable-panels` 4.15 collapses and expands the left panel. A bare number is pixels in v4.
- **Not shown**: how drawing feels (events were synthetic), touch, vertex insertion into a hole, other trace cases.

Findings that change the plan: rasterize with **one** `rasterio.features.rasterize` call per channel in list order
(**80 ms** for 450 regions; a call per region was 3.7 s); **PNG encoding** (about 0.55 s each) is the slower build
step; remove duplicate vertices before validating traced or snapped rings; add a `ResizeObserver` that calls
`map.updateSize()`; try a larger freehand tolerance (about 1.5 m).

## 6. Not researched, to confirm when reached

`react-hotkeys-hook`, Radix and shadcn specifics (one source says shadcn's default base moved from Radix to Base UI
in July 2026), `openapi-fetch` and TanStack Query versions, `dulwich`, `opensimplex`, OSM tooling. None is
architecture-defining; each is a swap-in choice.

## 7. Decisions needed

1. ~~OpenLayers as the foundation~~ Decided: OpenLayers, confirmed by the spike.
2. **Vector-driven terrain** (`terrain.json`) with brushes as an optional layer, instead of brush-only height edits.
3. **Add SciPy** to the Python side for distance transforms and Poisson-disk placement.
4. **Pick UI primitives**: Radix with our own CSS, or a ready-made kit (shadcn) now that the base library may have changed.
5. **Design-file history** via `dulwich` versus rolling backups (still tied to the versioning decision).

## Sources

- Terra Draw: [modes guide](https://github.com/JamesLMilner/terra-draw/blob/main/guides/4.MODES.md),
  [repository](https://github.com/JamesLMilner/terra-draw),
  [changelog](https://github.com/JamesLMilner/terra-draw/blob/main/packages/terra-draw/CHANGELOG.md)
- OpenSeadragon: [home page and plugin list](https://openseadragon.github.io),
  [Annotorious OpenSeadragon annotator](https://annotorious.dev/api-reference/openseadragon-annotator)
- OpenLayers: [static image example](https://openlayers.org/en/latest/examples/static-image.html),
  [Draw API](https://openlayers.org/en/latest/apidoc/module-ol_interaction_Draw-Draw.html),
  [Modify API](https://openlayers.org/en/latest/apidoc/module-ol_interaction_Modify-Modify.html),
  [snap example](https://openlayers.org/en/latest/examples/snap.html),
  [WebGL shaded relief example](https://openlayers.org/en/latest/examples/webgl-shaded-relief.html),
  [10.x changelog (WebGL vector layer)](https://gitcode.com/gh_mirrors/op/openlayers/blob/main/changelog/v10.4.0.md),
  [ol-ext undo/redo](https://eap.ucr.ac.cr/mapas/ol-ext-master/examples/interaction/map.interaction.undoredo.html)
- Leaflet: [CRS.Simple](https://leafletjs.com/examples/crs-simple/crs-simple.html),
  [Leaflet-Geoman](https://github.com/Future-Position-X/leaflet-geoman)
- Canvas libraries: [Konva comparison](https://konvajs.org/docs/guides/best-canvas-library.html) (written by Konva's author),
  [2026 comparison](https://www.pkgpulse.com/guides/fabricjs-vs-konva-vs-pixijs-canvas-2d-graphics-2026)
- Undo/redo: [Immer patches](https://tessl.io/registry/tessl/npm-immer/files/docs/patches-system.md),
  [Zundo vs patch-based history](https://dev.to/unadlib/rethinking-undoredo-why-we-need-travels-2lcc)
- Geometry: [Martinez / polygon-clipping](https://cdn.jsdelivr.net/npm/martinez-polygon-clipping@0.9.0/README.md),
  [clipper2-wasm](https://classic.yarnpkg.com/en/package/clipper2-wasm),
  [clipper2-ts](https://cdn.jsdelivr.net/npm/clipper2-ts@2.0.1-17/README.md)
- Raster and files: [d3-contour](https://arches.lcc.ufmg.br/static/d3-contour/README.md) (README mirror),
  [fast-png](https://classic.yarnpkg.com/en/package/fast-png),
  [fflate](https://docsearch.algolia.com/mcp/docs/repo/101arrowz/fflate),
  [SciPy PoissonDisk](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.qmc.PoissonDisk.html)
- UI: [react-resizable-panels](https://cdn.jsdelivr.net/npm/react-resizable-panels@4.7.6/README.md),
  [dockview](https://dockview.dev/),
  [Radix vs shadcn (2026)](https://designrevision.com/compare/radix-ui-vs-shadcn.md)
