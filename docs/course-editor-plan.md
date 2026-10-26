# Plan: the course editor

Status: plan only, nothing built. **Libraries and the drawing foundation are in `editor-technology.md`, which also
changes one thing here: heights become vector-driven (a `terrain.json` of level/offset/swale shapes, with brush
deltas optional), so the heightmap, patch and greens editors edit shapes first.** Builds on `editor-project-file.md` (the `.course_maker/` folder, autosave, safe
replace) and does **not change the game bundle format** (`golf-course-format.md`). Decisions needed are collected at
the end; the sections before them state a recommendation for each.

## What we are building

A custom editor for turning a baked course (macro heightmap + aerial) into a finished bundle. One general **Course
editor** for the bulk of the work, and six focused editors for the details:

| Editor | Job |
| --- | --- |
| **Course** | Draw regions (tee, green, fairway, rough, water, ...), tie tees/greens/fairways to hole numbers, draw hole routes, edit course metadata |
| **Out of bounds** | Per-hole in-bounds areas (these may overlap) |
| **Hi-res patches** | Choose rectangles that get 0.25 m heights, and sculpt inside them |
| **Greens** | Contour a green: always hi-res, with putting-specific tools and checks |
| **Heightmap** | Sculpt the 1 m macro terrain |
| **Trees** | Forest zones and individual trees |
| **Landmarks** | Place special objects (a famous tree, a clubhouse, a bridge) |

## Units

Everything stored, sent and rasterized is **metres**: the CRS, the bundle format and the game's world are metric.
Units are a display setting only (built): **US** shows long horizontal distances in yards and elevations, heights,
depths and short distances in feet; **Metric** shows metres. Editor inputs such as "flatten to 87 ft" accept the
displayed unit (or a typed suffix: `ft`, `yd`, `in`, `m`) and convert to metres before saving, at full precision.
Technical facts about the files (the 1 m grid, patch limits, UTM coordinates, pixel size) are always shown in metres.
The preference lives in the browser for now and moves into the app-level workspace file when that exists.

## 1. Principles

1. **The bundle is compiled output; the editor edits a design.** Painting straight onto `class.png` throws away
   what you meant (a polygon you could nudge, a hole you assigned). The editor edits design files, and a build step
   turns them into the bundle. Re-bake, resize, change resolution or fix a vertex without redoing work.
2. **WYSIWYG geometry, no duplicated algorithms.** Smoothing and simplification happen as you draw, in the
   browser, and the final vertices are what is stored. The Python build only rasterizes what is stored. There is no
   second smoothing implementation to keep in step.
3. **Interactive work in the browser, deterministic build in Python.** Brushes and drawing run client-side for
   feel. Rasterizing, merging deltas, placing trees and validating run on the server, and are reproducible from the
   design files alone.
4. **Everything is undoable and autosaved.** No save button, no lost work.
5. **Editors are plug-ins into one shell.** Each editor is a module that declares its tools, options, extra layers
   and inspector. Adding the seventh editor does not touch the other six.

## 2. Source of truth: design files and the build

```
bundles/augusta/
  course.json  height.png  class.png  bounds.png  trees.bin  patches/*.png     <- compiled game bundle
  .course_maker/
    project.json  editor.json                                                  <- already built
    design/                                                                    <- the real work product
      layout.json          course metadata, holes (number, par, name, route)
      regions.json         surface polygons, with hole number where owned
      bounds.json          course boundary + per-hole include/exclude polygons
      landmarks.json       placed objects
      forests.json         forest zones, exclusions, tree rules, hand-placed/removed trees
      height/macro.delta   sparse 64x64 tiles of height changes to the 1 m macro grid
      height/p<N>.delta    height detail for each hi-res patch (dense, 0.25 m)
    backups/               rolling snapshots of design/ (see decisions)
```

All JSON is written with stable key order and rounded coordinates (to the millimetre) so diffs are small if you
version it later. All of it is validated by pydantic models in `course_maker/design/`, like `course.json`.

### Design data

- **Region**: `{id, class, hole?, outer: [[x,z]...], inner?: [[[x,z]...]...], note?}`. `hole` is required for the three
  owned classes (fairway, green, tee) and absent for the rest, matching the bundle format. Water regions may carry
  an optional `level` (metres); the default is the lowest height on the region's edge.
- **Precedence**: list order, later wins. Rough is the default fill, so you rarely draw it except to cut a hole in
  something. "Send to back/front" changes order. (A partition that forbids overlaps was considered and rejected as
  too fiddly while drawing; shared edges are handled by vertex snapping instead.)
- **Hole**: `{number, par, name?, route: [[x,z]...]}`. The route's first point is the tee, as in the bundle. Yardage
  is computed from the route; par is yours (the editor suggests one from yardage).
- **Bounds**: one `boundary` polygon set that is out of bounds for every hole outside it, plus per hole `include`
  and `exclude` polygons. In bounds for hole n = inside the boundary, minus n's excludes, plus n's includes.
- **Forest zone**: `{id, polygon, density, kinds: [{kind, weight}], heightRange, spacing, seed}`. **Exclusions**
  (no trees) are zones with density 0. **Manual trees**: `added: [{x, z, height, kind}]` and `removed: [{x, z, r}]`.
- **Height deltas**: heights are `base + delta`. The base is always re-derived from the source stack (cached), so a
  re-bake never loses sculpting. The macro delta is sparse tiles; a patch delta covers its rectangle at 0.25 m.

### The build (design to bundle), in order

1. **Heights.** Macro = base + macro delta. Water regions are flattened to their level.
2. **Patches.** Each patch is `macro_bilinear(x, z) + patch_delta`, with the delta forced to 0 on the border ring and
   feathered in over ~2 m. This makes the spec's "exact border" rule true by construction, and macro edits flow into
   patches automatically.
3. **Class map.** Rasterize regions in order (R = class, G = hole for owned classes). Unclaimed cells are rough.
   Optional rule: a collar ring of a set width is added around every green unless a collar region overrides it.
4. **Bounds.** Rasterize the boundary and per-hole polygons into the 24-bit mask.
5. **Trees.** Place by Poisson-disk sampling inside forest zones, skipping cells of maintained classes (fairway,
   green, tee, collar, bunker, water, path) and exclusions, then apply manual adds and removes. Deterministic from
   the seeds.
6. **`course.json`.** Metadata, holes, patch table, landmarks, counts.
7. **Validate** with the existing validator. The result is the Problems list in the editor.

The build runs on the server (shapely and rasterio are already installed), writes to a `.building` folder and swaps
in exactly like replace-bake does, and runs automatically about a second after the last saved change. Each build gets
an id; the viewer reloads the changed layers when it sees a new one. `bake` stays what it is (import a stack and
produce an empty design); `build` is new.

## 3. The application shell

```
+---------------------------------------------------------------------------------------+
| Course Maker  [Course][Bounds][Patches][Greens][Heightmap][Trees][Landmarks]  undo redo |  editor bar
|                                     saved | built 3.5 MB | 2 problems                  |
+---------------------------------------------------------------------------------------+
| tool options for the active editor: class, hole, brush size, smoothing, snap ...      |  sub-bar
+----+-----------------------------------------------------------+----------------------+
| << | [floating tool palette]        the map                    | View | Data          |
| L  |                                                           |  layers, readout,    |
| e  |                                                           |  selection, holes,   |
| f  |                                                           |  problems            |
| t  |                                                           |                      |
+----+-----------------------------------------------------------+----------------------+
```

- **Left panel** (files): collapsible to a thin strip, toggled by a button and the `[` key. State is saved.
- **Editor bar**: editor tabs, undo/redo, and one status line (autosave, last build, problem count; clicking
  problems opens the Data tab).
- **Sub-bar**: the active editor's options. It holds anything that is a setting rather than a tool.
- **Floating tool palette**: used by the Course editor, which has about ten surface classes plus select, draw,
  route, erase and assign. Other editors have few tools and use the sub-bar alone. The palette is draggable and
  collapsible, and its position is saved.
- **Right panel** keeps the viewer role you like, as two tabs. **View**: layers, relief, readout (as now). **Data**:
  the selected item's properties, the holes table, course metadata, the Problems list and the last build's size
  report. Editing fields like par and name happens here.

### Saved in `editor.json` (additions)

`editor` (active editor id), `tool`, `activeHole`, `activeClass`, per-editor tool options (brush size, smoothing,
snap on/off), `panels` (left collapsed, right tab, palette position). The existing merge-over-defaults and forgiving
read rules apply unchanged.

### Tool system

MapView stops owning "drag = pan". A tool receives pointer events in world metres and returns what to draw:

```
Tool { id, cursor,
       onPointerDown/Move/Up(world, modifiers), onKey, onCancel,
       drawOverlay(ctx, px) }          // previews: the polygon being drawn, brush circle, snap marker
```

Pan is middle-drag, right-drag or space-drag in every editor; the wheel zooms as now. A **select tool** (click a
region, drag a vertex, shift-click to add) is shared by all editors. Hit testing is a linear scan; a course has a
few hundred regions. Snapping (to other regions' vertices and edges) is a shared helper.

### Undo, redo and autosave

The design lives in one client store. Every committed edit is a history entry (vector edits as small diffs of the
affected items; raster brush strokes as the tiles they touched), capped by memory not count. Design files autosave
with the same debounce-and-flush behaviour as `editor.json`, one `PUT` per changed file, validated by pydantic. A
build follows each save.

## 4. The editors

### Course editor (the main one)

- **Tools**: select, polygon, freehand (simplified and smoothed as drawn), edit vertices, erase (subtract a shape),
  hole route, assign hole, snap. Hotkeys per class (G green, F fairway, T tee, B bunker, W water, C collar, P path,
  O woods, R rough); `H` then a number sets the active hole; `Esc` cancels; `Enter` closes a polygon.
- **Hole association**: a new fairway, green or tee takes the active hole. "Assign by nearest route" fixes a
  selection in bulk (the spec's default). Unassigned owned regions are listed as Problems and drawn hatched.
- **Course metadata** (Data tab): name, attribution, holes table with par, name and computed yardage.
- **Assist (later)**: suggest regions from the DEM and imagery (greens are smooth and slightly raised, bunkers are
  depressions), and optional OpenStreetMap pre-fill where `golf=*` features exist. Suggestions land as normal
  regions you can edit or delete.
- **Output**: `class.png`, the hole list in `course.json`.

### Out of bounds editor

- Pick a hole; the map dims everything out of bounds for it. Tools: edit the course boundary, add or remove an
  include/exclude polygon for the hole, copy another hole's bounds, "auto" (a corridor around the hole's route and
  owned surfaces, clipped by the boundary). Problem check: owned cells outside the hole's bounds.
- **Output**: `bounds.png`. Shares the polygon tools with the Course editor, so it is small once that exists.

### Hi-res patch editor

- Create a patch by dragging a rectangle (snapped to 1 m cells, 256 m max, 64 max, no overlap, all enforced as you
  drag), resize, delete. Shows the 0.25 m grid when zoomed in and the feather ring as non-editable.
- Sculpt tools (shared with the heightmap editor): raise/lower with a soft brush, smooth, flatten to a level or to
  the brush centre, and reset to base.
- **Data**: `height/p<N>.delta`. **Output**: `patches/p<N>.png`.

### Greens editor

A specialisation of the patch editor. Choosing a hole zooms to its green, and a patch covering the green and collar
plus a margin is created and kept in step automatically (marked as owned by that hole).

- Tools: the sculpt brushes, ridge and swale stamps, "tilt" (change the overall slope while keeping the contour),
  and a procedural micro-contour generator (seeded, strength set by you) that you then edit by hand.
- Overlays: contour lines (5 cm), slope percentage heat map with a configurable putt-able limit, roll arrows, and
  a preview of random pin positions.
- Checks: slope over the limit, a flat spot big enough for a pin, and the feather ring staying clear of the green.

### Heightmap editor

- Macro sculpting on the 1 m grid: raise/lower, smooth, flatten (for tee platforms), level a region, and
  "restore the original". Optional rule to carve bunker depressions from bunker regions.
- **Data**: `height/macro.delta`. **Output**: `height.png` (and the patches under it follow).

### Trees (forest) editor

- Draw forest zones and no-tree exclusions; set density, kind mix, height range and spacing per zone; a reseed
  button. Brush to add or remove individual trees. The preview shows the compiled trees, and edits show up after
  the next build.
- **Needs new data**: canopy height from the source stack (surface model minus bare-earth DEM, or NIR vegetation
  index) to suggest where forest is. That is a `tif_generation` task, not editor work; until then zones are drawn
  by hand from the aerial.
- **Output**: `trees.bin`.

### Landmark editor

- Place (click), pick the kind, name it, rotate (drag a handle), scale, optional height override, snap to ground. A
  list in the Data tab to find and jump to each. Optionally tag a landmark to a hole for hole intros.
- The kind table lives in the game, so the editor needs a list of valid kinds. For now a `kinds.json` in the
  project that you maintain; later it can be generated from the game repo.
- **Output**: the `landmarks` list in `course.json`.

## 5. Build order

Each phase ends with a bundle that still validates and can be looked at in the viewer.

| Phase | Deliver | Size |
| --- | --- | --- |
| **0. Foundations** | The shell (collapsible left panel, editor bar, sub-bar, right View/Data tabs, editor registry); the tool system in MapView; the design store with undo/redo and autosave; `course_maker/design/` models and endpoints; the build pipeline with build ids and viewer refresh; rolling backups. No editor yet, but you can already see a build. | L |
| **1. Course editor** | Regions, hole routes, ownership, metadata, Problems list. Produces `class.png` and the hole list: the first real bundle. | L |
| **2. Out of bounds** | Reuses phase 1's polygon tools. Makes bundles with holes fully valid. | S |
| **3. Landmarks** | Independent and simple; a good early win. Can be done any time after phase 0. | S |
| **4. Patches and heightmap** | The raster sculpting infrastructure (brushes, sparse deltas, tile-based undo) with the patch and macro editors on top. | L |
| **5. Greens** | Specialisation of phase 4, plus contour overlays and checks. | M |
| **6. Trees** | After the canopy data exists. Zone editor and the placement build step. | M |
| **7. Assist** | Region suggestions from DEM/imagery and OSM. Only after you have drawn a few courses by hand and know what is worth automating. | M |

Landmarks are independent and could go anywhere. Greens come before trees because they affect gameplay directly and
trees need new data first. If you would rather see trees early, only the canopy acquisition has to come first.

## 6. Testing

- **Models**: every design file round-trips; invalid geometry (self-intersecting rings, hole numbers on rough,
  patch overlap) is rejected with a clear message.
- **Build**: a tiny synthetic course with known regions gives an exact expected `class.png`, `bounds.png`,
  `trees.bin` and patch heights (golden files). The build is deterministic (same design, same bytes) and always
  validates. A failed build leaves the previous bundle untouched.
- **Client geometry**: simplify, smooth, snap, point-in-polygon, hit-testing and the undo/redo store, with vitest.
- **In the browser**: draw with real pointer events on the Augusta bundle and check the compiled `class.png`; undo
  and redo; reload and see everything restored; kill the server mid-edit and check nothing is lost.

## 7. Risks

- **Lost work.** The design files are now the irreplaceable thing. Atomic writes and rolling backups are in phase 0
  and not optional. Version control (deferred so far) becomes important here.
- **Drawing feel.** Polygon editing with snapping is where editors live or die. Phase 1 is the largest because of
  this. Keep the first version small: polygon, vertex edit, snap, delete.
- **Large rasters in the browser.** The macro grid is 2.5 M samples and a 256 m patch is 1 M. Sparse tiles and
  typed arrays keep it manageable; brush strokes must only touch affected tiles.
- **Build latency.** Measured (spike): one `rasterize` call with 450 polygons into the full 9.9 M pixel Augusta class map takes about 80 ms, and encoding a PNG of it about 0.55 s (a whole bake is about 3 s), so a feedback loop that waits on a build would still feel slow. Editors draw their own vector preview immediately and the viewer's compiled layers catch up. Builds should only redo the files whose inputs changed.
- **Editing and re-baking.** A re-bake changes the base heights under existing deltas. The design stores deltas, not
  absolute heights, so edits survive, but a changed base can make a sculpt look wrong; the build should report how
  much the base moved.

## 8. Decisions needed

1. **Design files as the source of truth** (section 2), versus painting directly on the PNGs. Recommended: design
   files. It is the biggest decision here because everything else follows from it.
2. **Precedence by list order** (later wins), versus forbidding overlaps. Recommended: list order with snapping.
3. **Right panel as View and Data tabs**, with property editing (par, names) in the Data tab. Or keep it strictly
   read-only and put forms elsewhere.
4. **Floating palette for the Course editor only**, with every other editor on the sub-bar. Or palette everywhere.
5. **Auto-build after each saved change**, versus a Build button. Recommended: automatic, because the viewer shows
   compiled output.
6. **Landmark kinds**: a project-maintained `kinds.json` for now.
7. **Backups and version control.** Minimum: rolling snapshots of `design/` (last 20 builds). Recommended soon: put
   `design/` and `project.json` under git, since they are the work product.
8. **Canopy data** for trees: add it to `tif_generation` before the trees phase, or draw forest zones by hand first.
9. **Build order**: phase 0 then 1 is firm. Landmarks, patches/greens and trees can be reordered.
