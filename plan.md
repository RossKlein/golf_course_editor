# Golf course game assets: high-level plan

Status: ideas only. Nothing here is decided. To be refined.

## Goal

Turn real golf courses into 3D game assets. The game retextures everything
and uses the source data only for structure: elevation, and the layout of
greens, tee boxes, fairways, rough, bunkers, water and tree lines. We take
creative liberty with the heightmap, especially around greens, to make the
courses more interesting than the raw data.

## What exists today

- `tif_generation/course_bounds.csv`: list of courses with bounds (~805 flagged `in_conus_box`).
- `tif_generation/fetch_3dep.py`: clips the USGS 3DEP 1 m bare-earth DEM to a course.
- `tif_generation/course_stack.py`: builds the per-course raster stack (imagery + elevation).
- `tif_generation/run_all.py`: batch runner (workers, backoff, resumable, `results.csv` log).
- Test runs: ~92 MB per course. 10 workers did ~9 real courses in ~4 min.
  Full set estimated at ~5-6 h and up to ~70 GB. Many in-box entries are
  Canadian (no 3DEP coverage, skipped by design).
- Known issue: `Adios` fails with "elevation does not cover the target grid".
  Not investigated yet.

## Pipeline sketch

1. **Acquire**: DEM, aerial imagery (NAIP incl. NIR), and ideally lidar-derived
   canopy height (surface model minus bare-earth DEM).
2. **Preprocess per course**: hillshade, NDVI, canopy height, web tiles.
3. **Annotate** by hand in a custom web tool (see below).
4. **Build game data**: rasterize annotations to splatmaps, process the
   heightmap, place tree lines from canopy data.
5. **Import into the engine** and retexture.

## Annotation tool (idea)

Small local web app for annotating a course in ~5 minutes.

- Toggleable layers: aerial, hillshade, canopy height, NDVI.
- Hotkeys per surface type (green, fairway, tee, bunker, water, path...).
- Fast polygon drawing with smoothing and shared-edge snapping.
- "Fill the rest as rough" default.
- Hole workflow: draw the tee-to-green line first, then the surfaces;
  hotkey to step between holes. The line gives routing, par and yardage.
- Optional OSM pre-fill where `golf=*` features exist.
- Undo, autosave, per-course progress tracking.
- Output: GeoJSON in the course's UTM coordinates so it lines up exactly with
  the DEM.
- Trees: paint forest / no-tree zones only; individual trees come from
  canopy data and procedural placement.

## Heightmap treatment

- Keep the real macro terrain (1 m DEM is a good fit for game heightmaps).
- 1 m smooths away real green contours and lidar noise is ~10 cm, so greens
  need synthesized detail anyway.
- Add procedural micro-detail: green contours, collars, bunker lips, mounding,
  swales. Real overall tilt and drainage are the constraint; slope limits keep
  greens putt-able.
- The DEM can also help classification: greens are smooth and elevated,
  bunkers are depressions, tees are flat platforms.

## Risks and open issues

- Lidar vintage: courses may have been renovated since the flight.
- Lidar can misclassify bunkers and flatten water.
- Licensing: 3DEP and NAIP are public domain. OSM needs attribution and has
  share-alike terms. Bing tiles (used for Augusta) should not ship. Real
  course names and trademarks are a separate question; "inspired by" is safer.
  Origin of the `.mm` course list is unknown to us and should be checked.
- Scale: probably a curated set of ~20-50 courses, not all 800.

## Open questions

- Engine (Unity / Unreal / Godot / custom)?
- Realistic or stylized look?
- Whole courses or individual holes as the unit of play?
- Commercial or personal project?
- Which course do we start with (good OSM coverage to test end to end, or a
  favourite)?

## Possible next steps

- Investigate the `Adios` failure.
- Check what `course_stack.py` outputs and what the tool needs on top of it.
- Add canopy-height acquisition (3DEP point cloud / surface model).
- Prototype the annotation tool on one course.
- Prototype heightmap detailing on one green.
