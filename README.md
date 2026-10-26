# Golf course maker

Turns real golf courses (USGS 3DEP elevation + NAIP imagery) into baked bundles for the Rally Club golf game.
The bundle format is specified in the game repo: `docs/golf-course-format.md`. This repo is the producer; the
game's loader is the consumer.

- `course_maker/`: Python package: the compiler (bake, validate) and the FastAPI server that uses it.
  All types are pydantic models (`course_maker/models.py`).
- `web/`: React + Vite app (TypeScript). Its API types are generated from the pydantic models.
- `tif_generation/`: scripts that acquire a course's DEM and imagery as `course_stack.tif` (`fetch_3dep.py`,
  `course_stack.py`, `run_all.py`), their course list (`course_bounds.csv`), the Augusta source files in
  `sources/`, and `HANDOFF.md`. See `tif_generation/README.md`.
- `augusta/`, `courses_test10/`: generated course stacks (data, gitignored). `bundles/`: baked bundles.
- `docs/`: the plans and specs. Start with `frontend-architecture.md` (how the web app and its renderer are organised, and
  the reorganisation under way), `course-editor-plan.md` (what the editor does) and `golf-course-format.md` (the bundle
  format). `course-asset-plan.md` is the original high-level plan; `openlayers-spike-results.md` records why the map uses
  OpenLayers.

## Setup (once)

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd web
npm install
npm run build
```

## Run

```powershell
.\.venv\Scripts\python.exe -m course_maker serve
```

Open http://127.0.0.1:8765. The server indexes the current folder (or `--data <folder>`) for GeoTIFFs and
bundles, skipping hidden folders and `.venv`.

- **GeoTIFFs**: pick one to view its imagery and/or elevation (as hillshade), with pixel, coordinate and
  elevation readouts. Works for `course_stack.tif`, plain RGB images and 1-band DEMs (including lat/lon ones).
  Large rasters are shown decimated. Renders are cached in `.course_maker_cache/`.
- **Units**: a US / Metric toggle in the left panel. US shows yards for distances and feet for elevations; files and
  the API are always metres. UTM coordinates, grid and pixel sizes stay metric.
- **Load TIF…** (or drop .tif files on the map) copies GeoTIFFs into `uploads/` and indexes them.
- **Bake**: a projected, metre-based raster with an elevation band (a `course_stack.tif`) can be baked into a
  bundle from its panel. An existing bundle is only rebuilt when you tick Replace, and even then the old bundle is
  never deleted first: the new one is built beside it, `.course_maker/` is carried over, and it is swapped in only
  if it validates.
- **Bundles**: view a bundle exactly as the game will decode it: aerial (from the stack it was baked from),
  hillshade, surface class, hole ownership and out-of-bounds layers, patches, trees, routes, landmarks, and the
  validation report.

## Develop the web app

Run the server as above, then in `web/`:

```powershell
npm run dev
```

and open http://127.0.0.1:5173. Vite proxies `/api` and `/files` to the server on 8765.

After changing a pydantic model, regenerate the TypeScript types:

```powershell
.\.venv\Scripts\python.exe -m course_maker openapi   # writes web/openapi.json
cd web; npm run types                               # writes web/src/core/api/schema.d.ts
```

## Command line

```powershell
.\.venv\Scripts\python.exe -m course_maker bake augusta/course_stack.tif --name "Augusta National" --out bundles/augusta
.\.venv\Scripts\python.exe -m course_maker validate bundles/augusta
```

Add `--replace` to rebuild an existing bundle (safely, as above).

## Editor state

Each bundle has a hidden `.course_maker/` folder (like `.vscode/`):

- `editor.json`: how you were working: map view, layer visibility and opacity, relief exaggeration, selected hole.
  Saved automatically, restored when you reopen the bundle. Per user; gitignored by a `.gitignore` inside the folder.
- `project.json`: the source stack and bake settings. Records the stack for the aerial layer.

Neither is part of the game bundle, and neither is served to the browser as a bundle file. See
`docs/editor-project-file.md`.

## Tests

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s course_maker/tests -t .
cd web; npm run typecheck
```
