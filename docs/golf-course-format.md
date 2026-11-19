# Golf course bundle format

The contract between the course compiler (developed outside this repository, in Python) and the golf game's loader. The compiler turns a real course's GeoTIFF stack into one **bundle** of static files. The game downloads the whole bundle at match start behind a loading screen and does all rendering and physics sampling on the client. The server only hosts the files.

Pre-production: there is a single format and no compatibility layer. Change the format and both sides together.

## Design rules

- **One lookup, two uses.** Rendering and ball physics read terrain through the same sampler (below). The ball must always agree with what is drawn.
- **No runtime blending between height sources.** The compiler guarantees patches meet the macro grid exactly, so the sampler never has to blend or pick a winner.
- **Nothing in the bundle is hidden state.** Pin positions are not in the bundle: the host client chooses them procedurally from the class map (green cells owned by the hole) and synchronizes them in game state.



## Files


| File               | Contents                                              |
| ------------------ | ----------------------------------------------------- |
| `course.json`      | Metadata, grids, holes, patch table                   |
| `height.png`       | Macro heightmap, whole course, 1 m                    |
| `class.png`        | Surface class and hole ownership, whole course, 0.5 m |
| `bounds.png`       | Per-hole in-bounds mask, whole course, 1 m            |
| `patches/p<N>.png` | Optional 0.25 m height patches                        |
| `trees.bin`        | Tree placements                                       |


PNG files are decoded with `createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" })` and read through a canvas or `OffscreenCanvas`, never through a color-managed path. A decoded image is converted once into typed arrays for physics and uploaded as a texture for rendering.

## Coordinates

Course-local metres. **x** is east, **y** is up, **z** is south (right-handed). The course origin (0, 0) is the north-west corner of the macro grid. Image row 0 is the north edge, so image rows increase with z.

The compiler also records the geographic placement in `course.json` (`crs`, `originEasting`, `originNorthing`), for traceability only; the game ignores it.

## Heightmap encoding

Heights are 16-bit, stored in an 8-bit RGBA PNG: **R is the high byte, G is the low byte, B = 0, A = 255**. Browsers decode this natively without losing precision.

```
v = R * 256 + G                      // 0..65535
height_m = hMin + v / 65535 * (hMax - hMin)
```

`hMin` and `hMax` (in `course.json`) are shared by the macro grid and every patch.

## Sample positions

**Height samples sit on grid points.** Sample (col, row) of a grid with origin (x0, z0) and spacing `res` is at x = x0 + col × res, z = z0 + row × res. A grid with N samples across spans (N − 1) × res.

**Class cells cover areas.** Class pixel (col, row) covers [col × res, (col+1) × res) in x and the same in z. The class at (x, z) is `floor((x − x0)/res)`, `floor((z − z0)/res)`, nearest-neighbour, never filtered.

## Macro heightmap

`height.png`: spacing 1 m, origin (0, 0). `cols × rows` samples, so the course spans (cols − 1) × (rows − 1) m. Heights between samples are **bilinear**.

Outside the macro grid, `height()` clamps to the nearest edge sample. The compiler pads the grid so the playable area and visible scenery are well inside it.

## Patches

A patch replaces the macro heights inside a rectangle with 4× finer samples.

Rules, all enforced by the compiler and verified by the loader:

1. **Snapped.** A patch covers a whole number of macro cells. Its origin (x0, z0) is a macro grid point, and its size is `cellsX × cellsZ` macro cells. It has `4 × cellsX + 1` by `4 × cellsZ + 1` samples at 0.25 m. Patch sample lines therefore coincide with macro sample lines.
2. **No overlap.** Patches may touch along an edge but not overlap. There is no precedence rule because there is never a conflict.
3. **Exact border.** Every sample on a patch's outer ring equals the macro bilinear height at that point (within 2 mm, i.e. a few quantization steps). The compiler achieves this by forcing the ring to the macro surface and blending detail in over the next ~2 m. Result: the terrain is continuous across every patch edge and no runtime blending is needed.
4. **Limits.** At most 1024 × 1024 samples per patch (256 m square) and 64 patches per course.
5. **Heights only.** Patches never change the class map. Surface type always comes from `class.png`.

Each patch is its own PNG, `patches/p<N>.png`, listed in `course.json`. One file per patch avoids filtering bleed that a shared atlas would need gutters to prevent.

## Terrain sampler

`height(x, z)`: if the point is inside a patch rectangle (edges inclusive; on a shared edge either answer is identical), bilinear-sample that patch; otherwise bilinear-sample the macro grid.

`normal(x, z)`: central differences of `height()` at ±0.25 m. Physics and shading use this, not a precomputed normal map.

`surface(x, z)`: nearest cell of `class.png`.

## Class map

`class.png`: 8-bit RGBA. **R is the surface class, G is the hole number**, B = 0, A = 255. Spacing 0.5 m, origin (0, 0), `2·(cols−1) × 2·(rows−1)` pixels (`cols`, `rows` from the macro grid), covering exactly the macro extent.


| Value | Class                                   |
| ----- | --------------------------------------- |
| 0     | rough (default: anything not annotated) |
| 1     | fairway                                 |
| 2     | green                                   |
| 3     | collar / fringe                         |
| 4     | tee                                     |
| 5     | bunker                                  |
| 6     | water                                   |
| 7     | cart path                               |
| 8     | woods floor / unmaintained              |
| 255   | void: no ground                         |


**Hole number (G):** only fairway (1), green (2) and tee (4) cells are owned: for those, 1 to 99 is the owning hole. Every other class (rough, collar, bunker, water, path, woods) is shared between holes on real courses and always has G = 0, as do unannotated cells. Ownership is the only thing that ties a fairway, green or tee to a hole. The compiler's default gives each owned cell to the hole whose route is nearest, and the editor can repaint it. Class and hole number are both read with nearest-neighbour, never filtered or blurred.

**Edges.** Golf courses have clean edges, so surfaces are never blended into each other. Where two surfaces meet the renderer draws one line, as narrow as a pixel, and makes it a smooth curve: each surface's weight is averaged over the cells within the look's `grass.smoothing` of the point with a cubic B-spline, and the edge is where the two heaviest surfaces weigh the same. The class map is one surface per cell, so the curve is only as true as 0.5 m cells allow: a wider spline gives bigger, rounder curves and smooths long, shallow edges better, but rounds corners and loses features thinner than about half its radius.

**Void (255).** A cell of class 255 has no ground: the island's sea, a pit cut right through, the corner of a rectangle that the course does not fill. The renderer draws nothing there and leaves a hole in the terrain mesh, the ball has nothing to land on (it is out of bounds), and there is no surface in the look for it, so the blur below leaves it out: the cells round a void are weighted without it, and it is not one of the surfaces. G is 0, as for every class that is not owned. The compiler writes the same cells as out of bounds in `bounds.png` (every hole's bit clear where all the class cells of a bounds cell are void), so a reader that only looks at the bounds map is right too. The heights under a void are whatever the heightmap holds there; nothing reads them.

The client blurs the class (R) channel into per-surface weights for rendering (a shader or a one-time load pass), with noise-broken edges. Physics reads the raw class directly. Water is a class here; the water *surface height* is the heightmap value at that cell (the compiler flattens it).

## Bounds map

Out-of-bounds is defined per hole, and holes' in-bounds areas may overlap (a neighbouring hole's fairway is usually in bounds for you, a road or another course is not). `bounds.png` is an 8-bit RGB mask, one bit per hole:

- bit (n − 1) of the 24-bit value `R + 256·G + 65536·B` is set when the cell is **in bounds** for hole n. R holds holes 1 to 8, G holes 9 to 16, B holes 17 to 24. A course has at most 24 holes.
- Resolution 1 m, origin (0, 0), aligned with the macro heightmap: `(cols−1) × (rows−1)` cells covering exactly the macro extent, `floor((x − x0)/res)` lookup, nearest-neighbour, never filtered.
- A ball whose cell has the current hole's bit clear is out of bounds (penalty and replay). Water is not out of bounds; it is the water class. Cells outside the image are out of bounds for every hole.
- Every tee, fairway and green cell owned by hole n must be in bounds for hole n.
- Void ground (class 255) is out of bounds for every hole: the compiler clears every hole's bit in a bounds cell whose class cells are all void.



## Trees

`trees.bin`: little-endian, no header, 12-byte records until end of file:


| Offset | Type | Field                                 |
| ------ | ---- | ------------------------------------- |
| 0      | f32  | x (m)                                 |
| 4      | f32  | z (m)                                 |
| 8      | u16  | height in cm                          |
| 10     | u8   | kind (index into the game's tree set) |
| 11     | u8   | reserved, 0                           |


The tree's base y comes from `height(x, z)`. The file length must be a multiple of 12.

## Landmarks

Landmarks are individually placed objects that matter to a course: a famous tree, a clubhouse, a bridge, a statue. They are listed in `course.json` (there are few) rather than in `trees.bin`. A landmark tree is simply a landmark whose kind is a tree.

Each entry names a **kind**. The kind table lives in the game (`src/golf/`), not in the bundle, and defines the kind's model and its collision shape (cylinder, box or ellipsoid). The bundle carries only placement:


| Field       | Meaning                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`      | Display name, used by hole intros and fly-by cameras                                                                                         |
| `kind`      | Id of an entry in the game's landmark table                                                                                                  |
| `x`, `z`    | Position in course metres                                                                                                                    |
| `rotation`  | Yaw in degrees (optional, default 0)                                                                                                         |
| `scale`     | Uniform scale (optional, default 1)                                                                                                          |
| `y`         | Height override in metres (optional; default is `height(x, z)`, so bridges and elevated objects set it)                                      |
| `clearance` | Metres around the landmark where the course maker's build plants no forest trees (optional; the game ignores it; unset is 4 m times `scale`) |


Landmarks are always rendered at full detail (never collapsed into far-distance impostors) and take part in ball collision exactly like trees, using the same broad-phase grid.

## `course.json`

```json
{
  "name": "Augusta National",
  "attribution": "Elevation: USGS 3DEP. Imagery: NAIP.",
  "crs": "EPSG:26917",
  "originEasting": 0,
  "originNorthing": 0,
  "hMin": 46.338,
  "hMax": 103.077,
  "height": { "file": "height.png", "cols": 1406, "rows": 1761, "res": 1 },
  "class": { "file": "class.png", "cols": 2810, "rows": 3520, "res": 0.5 },
  "bounds": { "file": "bounds.png", "cols": 1405, "rows": 1760, "res": 1 },
  "patches": [
    { "file": "patches/p0.png", "x0": 812, "z0": 640, "cellsX": 40, "cellsZ": 36 }
  ],
  "trees": { "file": "trees.bin", "count": 31250 },
  "landmarks": [
    { "name": "Eisenhower Tree", "kind": "loblolly-pine-tall", "x": 1020.5, "z": 790.0, "scale": 1.2 }
  ],
  "holes": [
    {
      "number": 1,
      "par": 4,
      "route": [[812.0, 640.0], [840.5, 700.2], [902.3, 811.7]]
    }
  ],
  "look": { "...": "see Look" }
}
```

- `look` is how the course is drawn (see Look below). The compiler always writes one; a `course.json` without it is read with the default look.
- `landmarks` may be empty or omitted.
- `holes[].route` is the annotated tee-to-green polyline in course metres. The first point is the tee, and yardage is derived from the line. It is also the camera and aiming reference.
- A hole's tee, fairway and green are the cells of those classes in `class.png` whose hole number matches. Its green is the green (2) cells it owns; the loader derives the green's centre from them for camera and aim.
- **Pins.** The host picks a pin by trying random cells that are green (2) and owned by the hole, and accepting the first whose surrounding ring of cells (about 3 m out) is also green and owned by the hole, so the pin is never near an edge. After a few failed tries it falls back to the green's centre. The pin is never stored in the map.
- Hole numbers are 1-based and contiguous.
- `kind` is `course` or `range`. A file that omits it is a course.



## Range

A range is a practice ground, not a sequence of holes. `kind` is `range`, `holes` is empty, and the class map's hole channel (G) is 0 everywhere. The steps the game follows are in [range.md](range.md).

The class map is the whole description, the same files a course uses:

- **One tee.** The tee cells (class 4) are a single connected region. That is the teebox.
- **Any number of greens.** Each 4-connected group of green cells (class 2) is a target. Groups need not touch. The game places one flag on each group, using the same pin rule as a hole's green (a cell whose surrounding ring is also that green, or the group's centre).
- **Any number of fairways.** Fairway cells (class 1) are the landing ground and may be several separate pieces.
- **Bounds are unused.** With no holes there is no per-hole in-bounds mask. The range is in play across the map.



## Look

`course.json`'s `look` holds everything an artist would change about how the course is drawn. The editor and the game read the same values, so no colour or size is written into a shader. The schema is the `Look` model in `course_maker/models.py` (its ranges are validated there) and the defaults are `course_maker/look_defaults.py`. Colours are `[r, g, b]`, each 0 to 1.


| Field      | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sky`      | the sky colour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `sun`      | `latitude`, `declination` (23.44 at the June solstice) and `hourAngle` (15 degrees an hour from solar noon, negative in the morning). The default is 11 am daylight time in midsummer on the US east coast: about 98 degrees round and 57 degrees up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `surfaces` | an object with exactly one entry for each surface class, keyed by its name: `rough`, `fairway`, `green`, `collar`, `tee`, `bunker`, `water`, `path` and `woods` (the order they are written in does not matter; the class map's numbers are their positions in that list). Each has `color`; optional `color2` and `stripe` (metres across one mowing stripe, 0 for none) for mown surfaces; `grain` (how much grass texture shows); `shade` (how much the relief shading applies, 1 normally); `speckleDark` and `specklePale` (salt and pepper, 0 for none); optional `earth` and `mottle` (a second colour the surface is flecked with, as the forest floor is, and how much of the surface it covers: `1 - exp(-0.4 * mottle)`, so about half at 1.6; the specks are crisp, each the one colour or the other, not a blend, and far off they average to that share); `tuftDensity` (the share, 0 to 1, of the clumps the renderer would grow that do grow here, default 1) and `tuftClump` (0 to 1, how much they gather into patches of taller grass with bare ground between, default 0; the forest's are 0.55 and 0.7), each defaulting to its class's value in a look written without them, and `tuft` (height of standing grass as a multiple of `tufts.height`, 0 for none), `bump` (how steep the surface's normal-map detail is, 0 to 3, as a root-mean-square slope: 0.3 is about 17 degrees; 0 for none) and `bumpMap` (`grass`, the grass tile's own light and dark read as height, or `grain`, tileable noise, for sand and paths). The renderer makes both normal maps itself, so the bundle adds nothing; a look without them has no detail. `height` (metres, 0 to 0.5) is how tall the grass is: where two surfaces meet, the ground steps from one height to the other and the sun lights the step (Augusta's: a green is about 3 mm, a fairway 15 mm, rough 6 cm, woods 4 cm; sand 2 mm, water 0, a path 10 cm). A surface without one gets its class's default |
| `grass`    | `tile` (the seamless grass texture, by file name), `tileMetres` (ground one tile covers), `wobble` (how far surface edges are wobbled by the grass texture, in class cells; 0 for clean edges, which is the default), `speckleGrain` (metres across one grain), `smoothing` (metres either side of a surface edge that are averaged to draw it as a smooth curve, 1 to 3: more gives bigger, rounder curves and loses features thinner than about half of it; a look without it gets the default, 2), `edgeWidth` (metres across the wall of the step between two heights of grass, above 0 to 0.5, default 0.08; the wall is the taller grass's own side, from the line between the surfaces up into the taller surface, and is textured as it; never narrower than a pixel and a half), `edgeRagged` (metres the grass texture pushes the line between surfaces about, 0 to 0.3, default 0.03) `edgeShadow` (how much the shorter grass at the foot of a step is darkened, 0 to 1, default 0.5; the shade falls on the side away from the sun, with a quarter of it kept whichever way the sun is) and `edgeGain` (how many times taller than it is a step is drawn, 1 to 10, default 2: it multiplies the difference between two surfaces' `height`s in the step's lighting and shade, and the heights themselves stay true; a look without it gets the default)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `tufts`    | the standing grass, drawn as clumps of blades: `height` (metres, the tallest blade of a clump on a surface with `tuft` 1), `spread` (metres across a clump, above 0 to 2, default 1.2, whatever its height), `bladeWidth` (metres thick at the foot of a blade, above 0 to 0.1, default 0.025), `blades` (blades in a clump seen close up, 3 to 64, default 32; the renderer draws a half and then a quarter of them further off, each wider) and the `root` and `tip` colours. A look written before clumps has a `width` here, which is read and ignored, and gets the defaults for the rest. How many clumps there are to the square metre is the renderer's own grass level, not the course's: a surface says what share of them grow (`tuftDensity`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `relief`   | how the ground's slope is worked out for lighting: `smoothing` (metres either side of a point over which the heights are averaged by a cubic B-spline before the slope is taken, 1 to 6; more gives smoother, broader shading and ignores smaller bumps). The renderer bakes the smoothed slope into a texture once, so lighting is smooth and the same at every distance; ground shape and what the ball touches are the raw heights, unchanged. A look without it gets the default, 2. `exaggeration` (1 to 20, default 3) is how much steeper the slope looks in the shading than it is, so gentle ground shows; 1 is true, and the ground itself keeps its shape. `shading` (0 to 3, default 1) is how strongly the slope shades the sun's light: 0 is flat light, 1 as lit; the sky's light is not shaded. A look without them gets the defaults.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `shadows`  | how the sun's shadows look: `strength` (how much a shadow darkens lit ground), `tint` (what shadowed ground is multiplied by, cooler than lit), `softness` (metres across the soft edge) and `distance` (metres from the camera where shadows have faded out). A look without it gets the default. Shadowed ground is lit by the sky alone, `mix(1, tint, strength)`, and the sun supplies the rest, so open lit ground is its colour exactly; the renderer bakes where the sun and the sky reach, so how crisp shadows are is not a setting of the course. Whether the viewer has shadows at all is the viewer's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `trees`    | `kinds`, each a tree model 1 unit tall made of `parts` (a cone or frustum, or a faceted ball: size, position and colour) with a `name` and a typical `height` range in metres; and the light trees take: `ambient`, `direct` and `base` (brightness at the foot). A tree's `kind` in `trees.bin` picks a model, wrapping past the last. Kind names must differ: the course maker weights a forest's models by name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |


What the look does not hold: how the editor draws its own aids (slope colours, contour strength, overlay colours), and quality settings of whoever is viewing (grass range and density, shadow quality). Those are not part of the course.

## Validation

The compiler runs these before writing a bundle. The loader repeats the cheap ones and fails loudly (the match does not start with a broken course).

- All files listed exist; `trees.bin` length matches `count × 12`.
- Image dimensions match `course.json`.
- `class.png` classes (R) are all in the table.
- Patches: snapped, non-overlapping, inside the macro grid, within limits, border ring within 2 mm of the macro surface.
- Every hole has a route of at least 2 points, owns at least one tee (4) cell and one green (2) cell, and its green cells form one connected region. A range skips this: it has no holes, one tee, and its greens need not touch.
- Every landmark `kind` exists in the game's landmark table; an unknown kind fails the load.
- Hole numbers in `class.png` are 0 or a number listed in `holes`, and nonzero only on classes 1, 2 and 4.
- `bounds.png` matches `course.json` dimensions, at most 24 holes, and every owned tee, fairway and green cell is in bounds for its hole.



## Size budget (Augusta, estimated)

Measured: the 1 m macro heightmap is 2.7 MB as 16-bit PNG. Class map and trees are expected to be well under 1 MB each. Patches are the open cost; the budget is a total bundle of **8 MB or less**. The compiler should print the bundle size and per-file breakdown.

## Where the loader lives

`src/golf/course/` (a sport-mirrored folder): the course types and parser, the sampler, and the texture builders. The sampler and parser are pure TypeScript with unit tests against a tiny fixture bundle so physics and the compiler's output are tested without a browser.

Optional `waterMesh` names an immutable v1 JSON asset containing indexed lake positions and normals in course metres. Its source controls live in `look.water` (bedColor, tint, shallow, clarity, ripples, and per-lake anchor/level/offset/curvature/excess settings). Consumers draw these vertices directly. A lake with `cut: true` is a mesh cut at its shore, with its edge vertices along the shore, running a little past the exact shore: draw it whole, with the depth test on and without clipping it, and cut it at the exact shore from the heights (not drawn where the water is not above the ground), with the look's `shallow`, `tint` and `clarity` for its colour and opacity by depth. A lake without `cut` (an older file) is a rectangular carrier that is clipped with the terrain's shared spline coverage unless its `excess` is above 0. See water-editor.md.