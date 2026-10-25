# TIF generation

Builds the GeoTIFFs the course maker works from: a course's 1 m elevation (USGS 3DEP) plus NAIP imagery, stacked
into one `course_stack.tif` (4 bands: red, green, blue, elevation_m) in the imagery's UTM CRS. The course maker
bakes bundles from these stacks. Run everything with the repo's venv; scripts can be run from any folder.

| File | Purpose |
| --- | --- |
| `fetch_3dep.py` | Clip the USGS 3DEP 1 m DEM to a course from `course_bounds.csv` |
| `course_stack.py` | Combine a DEM with NAIP imagery into `course_stack.tif` (+ `course_rgb.tif`, `preview.jpg`, `sources.txt`) |
| `run_all.py` | Batch both for every CONUS course (workers, backoff, resumable, `results.csv`) |
| `course_bounds.csv` | 1,301 courses with bounds (`in_conus_box` marks the ~805 inside the lower 48) |
| `sources/` | The original Augusta DEMs, the Bing tile zip and the site HAR capture (reference only; Bing imagery is not used) |
| `HANDOFF.md` | History, findings and caveats from the first session |

```powershell
.\.venv\Scripts\python.exe tif_generation\run_all.py --out courses_test10 --workers 6 --limit 10
.\.venv\Scripts\python.exe tif_generation\fetch_3dep.py --name AugustaNational --out dem.tif
.\.venv\Scripts\python.exe tif_generation\course_stack.py --dem dem.tif --out augusta
```

Relative `--out` paths are relative to where you run the command. Outputs are data and are gitignored.
