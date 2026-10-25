# Handoff: golf course elevation + NAIP imagery GeoTIFF

Written 2026-10-25 from a Claude chat session, to continue in a code session in `B:\code\golf_courses`.

## Goal
Build, for golf courses, one co-registered GeoTIFF with **elevation + aerial imagery**, and ultimately **per-hole map data**.
- The site www.provisualizer.com (3D course planner) is used **only for elevation and course bounds**.
- Imagery comes from **NAIP** (USDA, public domain) via Microsoft Planetary Computer.
- **Bing imagery is out**: it is licensed (Microsoft), so it was dropped on purpose. All Bing-derived files were deleted from the working container.

## Status
| Item | State |
|---|---|
| Augusta National 1 m elevation decoded from the user's HAR to GeoTIFF | Done, verified against USGS |
| Course-bounds list for every course on the site | Done (`course_bounds.csv`) |
| `course_stack.py` (NAIP RGB + elevation -> one GeoTIFF) | Written and tested offline on synthetic data; **never run against real NAIP** |
| Run against live NAIP | **Not done** (see Blockers) |
| Per-hole geometry (tee/green/fairway etc.) | **Not started** |

## Files in this folder
- `course_stack.py`: the main script (usage below).
- `augusta_national_dem_1m.tif`: Augusta elevation, EPSG:4326, float32 metres, 1645x1298, about 1.0 m cells.
- `course_bounds.csv`: 1,301 courses from the site's `terrainList` in `terrain.js` (name, source, min/max lat/lon, nlat, nlon, `encoding_mm`, `in_conus_box`, `res_m_lat`).
- (A stray duplicate of these three files may exist at `C:\Users\Ross\golf-courses`; safe to delete.)

## How to run (Windows PowerShell)
```powershell
cd B:\code\golf_courses
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install pystac-client planetary-computer rasterio pillow numpy shapely
python course_stack.py --dem augusta_national_dem_1m.tif --out augusta
```
Outputs in `augusta\`:
- `course_stack.tif`: float32, 4 bands [red, green, blue, elevation_m], NAIP's UTM CRS (EPSG:26917 for Augusta), pixel = NAIP native (about 0.6 m; `--res` overrides). RGB stored as float 0-255; 0 means no imagery; nodata = NaN.
- `course_rgb.tif`: 8-bit JPEG-compressed RGB of the same grid.
- `preview.jpg`: imagery | hillshade, for an eyeball alignment check.
- `sources.txt`: NAIP item ids / dates / gsd used.

### How the script works
1. Reads the DEM extent to get course bounds, then searches the `naip` collection on Planetary Computer (STAC) for that bbox.
2. Picks the **newest year** and uses all items from that year touching the course (handles quad seams; first item wins, later ones fill empty pixels). Warns if that year does not fully cover the course.
3. Target grid = DEM extent in NAIP's CRS, snapped to the pixel size. Elevation is bilinear-resampled from the 1 m DEM; the grid is cropped slightly so no NaN slivers remain from the lat/lon-vs-UTM rotation.
4. Original snippet change: sorting by "overlap fraction" is meaningless for a small AOI (every covering item scores 1.0), hence year-based selection.
5. `--local-tif` skips STAC and uses given rasters (used for testing).

### Offline test results (synthetic NAIP in EPSG:26917 with position-encoded colours)
- Imagery georeferencing: median error 0.02 m, max 0.04 m (pixel = 0.6 m).
- Elevation vs source DEM at about 3,000 random points: median 0.016 m, 99th percentile 0.17 m.
- USGS EPQS samples: 97.08 vs 97.08 m and 100.90 vs 100.89 m.
This proves the geometry, not the live NAIP search/read (asset name `image`, signed hrefs, COG range reads, datetimes).

## What was learned from the HAR (www_provisualizer_com.har, Augusta National 3D planner, Cesium 1.119)
- 1,384 requests. About 1,300 were **Bing aerial tiles** (`ecn.t0-3.tiles.virtualearth.net`, quadkey URLs). Only 545 unique tiles, zoom 1-20; zoom 21 requests are empty.
- Imagery is **level-of-detail by camera distance**, not whole-course: zoom 19 covered about 10% of the course by area, zoom 20 about 3%. The user's hypothesis that the whole course loaded at high detail was true only for **terrain**, not imagery.
- The site fetches a Bing Maps key from its own `auth.php?req=BingMapsKey` for its pages. **Do not reuse it.**
- **Elevation**: one file, `https://www.provisualizer.com/terrain/AugustaNational.mm.js` (7.3 MB):
  `var encodedTerrain = {encoding:'mm', nlat:1645, nlon:1298, data:[...]};`
- Also present: `terrain.php` (coarse JSON `heights` grids), and USGS `epqs.nationalmap.gov` point queries (1 m 3DEP).

### Decoding the `.mm` terrain (from the site's own `terrain.js`, about line 2543)
```python
data = np.array(<the numbers in data:[...]>, dtype=np.int64)   # length nlat*nlon
h_mm = np.cumsum(data - 50)                                     # running sum of (value - 50), millimetres
h = np.where(h_mm == -9999, np.nan, h_mm / 1000.0).reshape(nlat, nlon)   # metres; -9999 = unknown (none for Augusta)
```
- **Row 0 = NORTH (maxLat)**. Verified: the unflipped orientation failed against USGS, the flipped one matched within about 5 cm.
- Bounds for Augusta (from `terrainList` in `terrain.js`): minLat 33.491873, minLon -82.030731, maxLat 33.50665, maxLon -82.016759. Cells span the bounds (nlat-1 / nlon-1 steps); the GeoTIFF is padded half a cell for pixel-centre registration.
- Range 46.3-103.1 m, no unknown cells. These are the **raw decoded values**; the site additionally smooths them for display (not applied here).
- Open question: after the Augusta entry the site calls `shiftTerrain(0.5, -1.25)`, which moves the bounds 0.5 m east and 1.25 m south. **I did not apply it.** Spot checks vs USGS matched without it, but only 3 points on gentle ground were tested, so a roughly 1 m shift is not ruled out. Hypothesis (unverified): the shift registered terrain to the site's Bing imagery, which we no longer use. Worth testing with more USGS EPQS points.

## Course list (`course_bounds.csv`)
- 1,301 entries, all about 1 m grid spacing. 1,289 names end in `.mm` (the decoder above). The rest (e.g. `AugustaCC`) use the site's older encodings 1/2 (`decodeTerrainRow` in `terrain.js`, integer-metre steps) and would need a different decoder.
- About 805 fall inside a rough lower-48 bounding box (`in_conus_box`; approximate, may include slivers of Canada/Mexico). **NAIP is contiguous-US only**, so the rest cannot use NAIP.
- Per-course terrain URL pattern: `https://www.provisualizer.com/terrain/<name>.js`. Only Augusta's file is in the HAR; fetching others means hitting the site's server, which is the user's call under the site's terms.
- Cleaner alternative for elevation: it originates from USGS 3DEP lidar (public domain). `course_stack.py` accepts **any** elevation GeoTIFF as `--dem`, so a 3DEP clip over a course's bounds would remove the dependency on the site's data.

## Blockers hit this session
- The cloud container's proxy blocks `planetarycomputer.microsoft.com` (policy 403). NAIP could not be downloaded there.
- The Linux shell on the user's laptop failed to start ("Workspace unavailable"), so the script could not be run on the device either. Run it natively in Windows.

## Caveats
- NAIP resolution is typically 0.6 m (sometimes 1 m or 0.3 m); the script prints the actual gsd. Elevation is 1 m, bilinear-resampled to the NAIP grid, so no new detail.
- Datum: the DEM is labelled EPSG:4326 but derived from USGS NAD83 data; the NAD83/WGS84 difference (about 1-2 m) is ignored, consistent with the USGS spot checks.
- NAIP zero pixels are treated as "no data". Real black pixels in all three bands are rare.
- RGB as float32 inflates the stack file; use `course_rgb.tif` for normal viewing.

## Suggested next steps
1. Run `course_stack.py` for Augusta, open `preview.jpg`, and check that greens/bunkers line up with the hillshade.
2. Settle the `shiftTerrain` question with more USGS EPQS points.
3. **Per-hole data** (the original ask): decode the long `c=` parameter in the `3dplanner.php?n=Augusta%20National&c=...` URL (probably tee/green/hole geometry) and inspect `mydata.js` (60 KB) and `satelliteprovider.js` (55 KB) in the site's JS. Not examined yet.
4. Generalize: loop over `course_bounds.csv` (US rows), source each DEM (site file or USGS 3DEP), run `course_stack.py`.
5. Optional: cut XYZ tiles from `course_rgb.tif` with `gdal2tiles`; clip the stack per hole once hole geometry is known.
