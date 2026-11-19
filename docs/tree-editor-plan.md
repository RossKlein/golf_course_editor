# Tree editor: plan

Status: built, steps 1 to 7 of section 13 (step 8, the follow-ups, is not). Not yet looked at in the browser. Section 15 says where the build differs from this plan.
Written for the project owner, as the plan to build from.

Today `trees.bin` is empty for every bundle, and the 3D view fakes a forest by dropping a tree on a fixed 5 m jittered grid wherever
the class map says woods. This plan makes trees real: the **build** places them from settings kept on each forest patch, plus a small
list of hand edits, and writes `trees.bin`, which is what the game reads. A new **Trees editor** sets the patch settings and makes the
edits.

It has two parts. Part 1 is the design: what you see and do, and why. Part 2 is the technical design: data, algorithms, files, code
and tests. Section 13 lists the steps, and section 14 what is still open.

---

# Part 1. Design

## 1. What `trees.bin` is for, and what that implies

`trees.bin` is the game's list of tree placements: for each tree, x, z, a height in centimetres and a kind (an index into the tree
models). The tree stands on `height(x, z)`, so it is not stored. The game draws trees from this list, in chunks of ground so those out of
view are skipped, and uses it for ball collision (the format doc, "Trees" and "Landmarks").

So the file only says "a tree here". It has no notion of density, patches or clearings. **Density is therefore a build-time setting that
decides how many records are written**, never something stored in the file. The game needs no change.

## 2. The model in one picture

There are three sources of trees and one rule that combines them.

| Source | What it is | Where it lives | Looks like |
| --- | --- | --- | --- |
| **Forest patches** | Procedural trees, from settings on each woods region | the region, in `regions.json` | a woods polygon with a density, a kind mix, a height scale |
| **Placed trees** | Ordinary trees you put down by hand, anywhere | `trees.json` (`added`) | a dot you click |
| **Landmarks** | Trees (or anything) that matter: named, with a game-defined shape | `course.json` (`landmarks`) | the Landmark editor's, later |

And the rule: **procedural trees are never placed inside a clearing.** A clearing is a place where procedural trees are removed. There
are three kinds:

1. **Around a placed tree:** derived from its crown. Move or delete the tree and its clearing goes with it.
2. **Around a landmark:** derived from the landmark's footprint (a new optional `clearance`, with a default).
3. **Hand-drawn:** circles you brush on to open a sight line or clear a spot. These are the only clearings that are stored.

The first two are **derived**: worked out at build time from the things they belong to, never written down, so they cannot go stale.
The third is the `removed` list.

**There is deliberately no clearing along a hole's line of play.** A tree standing in the way is often the point of a hole, so the
forest is never kept off the route automatically. If you want a gap, you brush one.

Why not make every hand-placed tree a landmark: landmarks name a *game* model and collision shape, which the editor cannot show; they are
meant to be few and are always drawn at full detail; they live in `course.json`; and they can only add, never remove. Ordinary placed
trees are plain trees: the same drawing, chunking and collision as the forest. The dividing line: **if it has a name or a game-defined
shape it is a landmark; otherwise it is a placed tree.** A "Make landmark" button on a placed tree could convert it later.

## 3. The forest patch settings

A **forest patch** is a woods region, the polygon you already draw in the Course editor (Augusta has 23). Each can carry:

| Setting | Meaning | Range, default |
| --- | --- | --- |
| **Spacing** | Average metres between trees. Shown with trees per hectare and the tree count beside it | 2 to 20 m, **5 m** (400 a hectare) |
| **Kind mix** | A weight for each tree model by name (pine, broadleaf, fir), shown as shares of 100% | 0 to 1 each, equal |
| **Height** | A scale on each kind's height range | 0.5 to 2, **1** |
| **Edge thinning** | Metres over which the forest thins towards the border with open ground, so a patch does not end in a wall | 0 to 30 m, **8 m** (0 for none) |
| **Edge density** | How full the forest is right at the border, as a share of its full density. The thinning ramps from this up to 100% over the edge-thinning distance | 0 to 1, **0.3** |
| **Seed** | Which random arrangement. A button picks a new one | any whole number |

A patch with no settings of its own uses the **woods defaults** (the same fields, edited in the same panel), so one change thins every
patch that has not been set by hand. What to expect at Augusta's 272,000 m² of woods:

| Spacing | Trees a hectare | Trees |
| --- | --- | --- |
| 3 m | 1,111 | about 30,000 |
| 5 m | 400 | about 10,900 |
| 8 m | 156 | about 4,200 |
| 10 m | 100 | about 2,700 |

At 12 bytes a tree even 30,000 is 360 KB. The costs that matter are drawing and baking, not the file (section 11).

**Stability is a requirement, not a nicety.** While you drag a slider, trees must not shuffle:
- Raising a patch's density **only adds** trees; lowering it only removes some. The ones that remain have not moved.
- Reshaping a patch moves nothing except where its edge moved.
- Editing one patch, placing a tree or adding a landmark never changes the trees of another patch.
- Only the **Seed** button rearranges a patch.

## 4. The Trees editor

The existing, disabled **Trees** tab (`g t`) becomes the editor. Like the Look editor it has a floating card; unlike it, it works in both
the 2D map (where polygons are chosen) and the 3D view (where the result is seen).

**The card**
- **Selected patch** (when a woods region is selected): the six settings above, a "Reset to defaults" button, and a line such as
  "about 3,400 trees, 7 of them cleared".
- **Woods defaults**: the same fields, for every patch without its own.
- **Clearings**: a switch to show the clearing circles, and a count of what has been cleared by landmarks, placed trees and by hand.
- **Tools**: Select patch, Add tree, Remove, Erase.

**The tools**
- **Select patch:** click a woods patch in the 2D map (as in the Course editor), or in the 3D view the patch under the pointer.
- **Add tree:** click to place one. The card sets its kind ("random from the mix" or a model) and height (the model's middle, with a
  small variation). Click a placed tree to select it: change kind or height, move it by dragging, delete it.
- **Remove:** a brush. Dragging draws circles that clear procedural trees. Radius is the editor's brush radius.
- **Erase:** the same brush, but it deletes hand-drawn clearings and placed trees.

**What is drawn**
- 2D map: each woods patch tinted by density (denser is darker); placed trees as dots; **derived** clearings as faint dashed circles;
  **hand-drawn** clearings in a different colour, so you can tell what the build worked out from what you did on purpose.
- 3D: the real trees, after the build.

**How a change reaches the screen.** A change to a slider is a change to the design: it is saved, the build runs (about a second),
the trees are re-placed, and the view reloads them. The Look editor's "finish or pause" rule applies to the sliders. Placing a tree is a
single event. Every edit is one undo step. (Section 12 describes showing a placed tree at once, before the build returns.)

## 5. Worked example

A dogleg has a woods patch down the left, and the Eisenhower Tree is a landmark at its corner.
1. Select the patch, set spacing 4 m and edge thinning 12 m: the forest fills in and thins towards the fairway.
2. The landmark's clearing (a default 4 m × its scale) appears as a dashed circle, and no procedural tree is in it. Move the landmark
   and the circle follows; no trees elsewhere change.
3. With Add tree, plant three trees guarding the inside of the dogleg on the rough. Each gets a small clearing; none of them is a landmark.
4. With Remove, brush a gap in the woods to open a view of the green. That is stored as a few circles. (Nothing clears the line of play for
   you: the forest can stand across it.)
5. Raise the patch to 3 m: more trees appear; the ones you saw before are where they were, the gaps and the landmark's clearing hold.

## 6. Not in scope

- **Canopy data.** The original plan placed trees from lidar canopy height. That needs a new data step in `tif_generation` and is
  separate; forest patches are drawn by hand from the aerial until then.
- **A tree-line tool**, where you draw a polyline and give a spacing, jitter and mix, stored as a recipe like a patch. It fits this
  design (it is another source of procedural trees with its own clearings) and is the first follow-up.
- **The Landmark editor.** This plan only adds the optional `clearance` field and reads landmarks; creating them is its own editor. The
  default clearance (4 m × scale) is a stand-in until then, when the real footprints can be set.
- **Keeping the line of play clear.** Decided against: a tree in the way can be a feature of the hole.
- Wind, tree level of detail and the game's collision shapes.

---

# Part 2. Technical design

## 7. Data

### 7.1 Forest settings on a region

`course_maker/design/models.py`: `Region` gains an optional block, valid only on a woods region (as `hole` is only valid on owned
classes):

```python
class ForestSettings(Model):
    spacing: Annotated[Number, Field(ge=2, le=20)] = 5.0       # metres between trees on average
    kinds: Annotated[dict[Name, Annotated[Number, Field(ge=0, le=1)]], Field(max_length=8)] = {}  # weight of each tree kind by its name; missing is 1
    heightScale: Annotated[Number, Field(ge=0.5, le=2)] = 1.0
    edgeThinning: Annotated[Number, Field(ge=0, le=30)] = 8.0  # metres over which the forest thins towards open ground; 0 for none
    edgeDensity: Annotated[Number, Field(ge=0, le=1)] = 0.3    # how full it is right at the border, as a share of full density
    seed: Annotated[Int, Field(ge=0, le=2**31 - 1)] = 0

class Region(Model):
    ...
    trees: ForestSettings | None = None   # woods only; None uses the woods defaults
```

**Kind weights are keyed by name**, so reordering the look's tree kinds does not move a weight to another model. Two consequences, both
handled:
- **Names must be unique.** The `Trees` model in the look gets a validator that refuses two kinds with the same name (a format check, no
  new field). The Look editor's "Copy model" already names its copy "... copy"; a rename to a taken name is refused with the reason shown.
- **A rename must carry its weights.** Renaming a kind in the Look editor rewrites the key in every region's settings and in the woods
  defaults **in the same design-store commit**, so it is one undo step and nothing is orphaned. (The look and the regions are in the same
  document, which is what makes this a single commit.) A weight whose name matches no kind (the file edited by hand) is ignored, and the
  build says so in its notes.

### 7.2 Tree edits and defaults: `.course_maker/design/trees.json`

A fourth design file beside layout, regions and bounds, so it gets the existing atomic writes, backups and versioning.

```python
class PlacedTree(Model):   x, z: Number; height: Number (gt 0, le 60); kind: Int (ge 0, le 7)
class Clearing(Model):     x, z: Number; r: Number (gt 0, le 100)           # hand-drawn
class TreeEdits(Model):
    defaults: ForestSettings = ForestSettings()                              # for woods patches with none of their own
    added: list[PlacedTree] = []        # max 5,000
    removed: list[Clearing] = []        # max 5,000
```

`DesignResponse` (the API's design) gains `trees: TreeEdits`; a new `PUT /api/bundle/design/trees` writes it and schedules a build, like
the other three.

### 7.3 Landmarks

`Landmark` (in `models.py`, so in `course.json` and `docs/golf-course-format.md`) gains an optional `clearance: Number | None` (metres,
gt 0). It is read only by the editor's build; the game ignores it. Unset means a default of `4.0 × scale`. This is a format addition, so
the format doc gets a row in its landmark table.

### 7.4 `trees.bin` and `course.json`

Unchanged format. The build now writes `trees.bin` and `course.trees.count`; it joins `class.png` and `bounds.png` in `GENERATED`
(`build.py`), so the previous file is replaced atomically with the rest, `course.json` last.

## 8. Placement (the build step)

New module `course_maker/build/trees.py`: pure functions of numpy arrays and models, no file access, so everything is testable. Called
from `build_bundle` after the class map, before `course.json` is written.

### 8.1 Which patch owns a cell

A second raster, `region_index` (uint16, the class map's size and resolution), rasterized in the same painter's-order pass as the class
map: each region writes its position in the list plus one. A cell is woods when the class map says so, and its settings are those of
`regions[index - 1]` (its own, or the defaults). This keeps painter's order: a woods polygon drawn over part of an older one wins there.
It costs one more `rasterio.features.rasterize` call over the same shapes.

### 8.2 A progressive sequence, so density is stable

For each woods region R with spacing s, the points are the first K of a **progressive low-discrepancy sequence** over the whole course
extent (width W, height H):

```
d      = 1 / s²                              trees per square metre
K      = ceil(d · W · H)                     how many sequence points to consider
p_i    = frac(o_R + (i + 0.5) · (α1, α2)) · (W, H)       i = 0 .. K-1   (the R2 sequence, a = 1/φ2, 1/φ2²)
p_i   += (j1_i, j2_i) · JITTER                           hashed, a fixed ± JITTER metres (1.0), not a fraction of s
keep   if region_index[p_i] == R and class[p_i] == woods
```

`o_R` is an offset in [0,1)² from `hash(seed, R's id)`. Properties, which are why this was chosen over a jittered grid:

- **Prefix-stable.** Point i is at the same place for any K, so raising density adds points and never moves the existing ones. The jitter
  is a fixed number of metres for the same reason.
- **Even.** Any prefix of R2 covers any shape evenly, so a patch of any outline gets roughly the right density and no visible grid.
- **Edit-stable.** Positions depend only on `(seed, id, i)`, not on the patch's outline; reshaping a patch changes only which points fall inside.
- **Cheap.** Closed form per point, vectorised. At 3 m spacing K is 330,000 per patch; 23 patches take well under 100 ms.

The alternative, a jittered grid (what the preview does), is simpler but re-lays every tree when the spacing changes.

**There is no minimum-distance rule.** Spacing is an *average*. Two trees can end up close, as they do in a real forest, and where they
crowd it is the course designer's call: raise the spacing, or brush a clearing. The build never moves or drops a tree to enforce a gap.
A test records the nearest-neighbour distances so a change to the placement that makes them worse is noticed (section 10).

### 8.3 Edge thinning

`dist` is the metres from a point to the nearest cell that is not woods: `scipy.ndimage.distance_transform_edt` on a 1 m grid of the
class map (about 2.7 million cells), which is exact and takes a fraction of a second. `scipy` is added to `requirements.txt` for this;
it is the right tool because an exact Euclidean distance transform is its job and writing one in numpy would be slower and approximate.
A point is kept if its own hashed `u2_i < f(dist)`, with
`f = E + (1 - E) · smoothstep(0, T, dist)`, where `T` is the patch's `edgeThinning` and `E` its `edgeDensity`, and `f = 1` when `T = 0`.
Because `u2_i` is fixed per point, thinning keeps stability. Edges between two woods patches do not thin (they are not "non-woods").

### 8.4 Kind and height

From fixed hashed numbers of the point: `kind = first k with cumsum(weights)[k] > u3_i · total` (weights from `kinds`, missing as 1, all
zero as equal), and `height = lerp(kind.height[0], kind.height[1], u4_i) · heightScale`, stored in centimetres, clamped to 1 to 60,000.
Kind weights and kinds come from the **look** in `course.json`, so the look's kind list is read at build time.

### 8.5 Clearings

Built as one boolean raster (0.5 m cells) of everything that clears, by rasterizing shapes with the same call as the class map:

| Source | Shape |
| --- | --- |
| Placed tree | circle of radius `crown(kind) · height + 0.5 m`; `crown(kind)` is the widest part radius of the look's kind, as a fraction of height |
| Landmark | circle of radius `clearance ?? 4 · scale` |
| Hand-drawn | circle `r` |

Procedural trees whose cell is set are dropped. Placed trees are not affected by clearings, including each other and the hand-drawn
ones: you put them there. The build appends them after the procedural trees. (The editor draws derived clearings itself, from the same
rule, so `crown` has a golden test in both languages.)

### 8.6 Output and limits

`trees = procedural ++ added`, written as `TREE_DTYPE`, count stored. Positions are clamped inside the course (the validator errors on
a tree outside it). A **cap of 250,000 trees** (`MAX_TREES` in `spec.py`) so a spacing typo cannot make a runaway build. If the patches would
exceed it, every patch's point count `K` is scaled by the same fraction. The prefix property makes that exactly "a lower density
everywhere", so the forest thins evenly and no patch is left bare. Placed trees are never cut. The build adds a note ("capped at 250,000
trees: patches thinned to 62%; raise the spacing"), and the editor's card shows the estimated count and warns as it nears the cap. The build notes say how many procedural trees were cleared and by what; `BuildOutcome` gains `trees`.

## 9. API and the web app

### 9.1 Server

- `design/models.py`: `ForestSettings`, `PlacedTree`, `Clearing`, `TreeEdits`; `Region.trees`; `DesignResponse.trees`.
- `design/store.py`: `FILES["trees"] = ("trees.json", TreeEdits)`, `read_trees`, in `read_design`. Backups already fingerprint every `*.json`.
- `server/app.py`: `PUT /api/bundle/design/trees`.
- `build/build.py`: the region-index raster, the call to `build/trees.py`, `trees.bin` in `GENERATED` and `replaced`, the count in `course.json`.
- `models.py`: `Landmark.clearance`. Then `python -m course_maker openapi` and `npm run types`.
- `requirements.txt`: `scipy`.

### 9.2 Store and saving

- `model/design/store.ts`: `Doc` gains `treeEdits: TreeEdits`, read by `docFromApi`. A region's `trees` rides in the regions the store
  already holds. Helpers like the others: `setForest(regionId, settings)`, `addTree`, `removeTrees`, `addClearing`, `eraseAt`, each
  one undo step (a brush stroke is a `begin`/`end` group).
- `scene/useDesignSession.ts`: saves `trees.json` as it saves regions, layout and bounds (debounce, flush on hide).

### 9.3 Showing the result

- `scene/bundleScene.ts`: `refresh` now **re-fetches `trees.bin`** after each build (it does not today), and calls `renderer.setTrees`
  only when the bytes changed, because `setTrees` re-bakes the sun and sky lighting, which is the slowest thing in the app.
- `scatterWoods`, `treeInfo.preview` and the "(preview)" label are removed: with `trees.bin` real they have no purpose. A bundle built
  before this step has an empty `trees.bin` until its next build, which any design save triggers.
- `terrain/` is unchanged: it already draws trees from the look's kinds and the packed array.

### 9.4 The editor

```
editors/trees/
  README.md
  useTreesEditor.ts      the hook: tools on the map and, through a GroundTool, in 3D; commands; selection
  TreesPanel.tsx         the floating card (FloatingCard, Section, SliderField from ui/)
  PatchFields.tsx        the six settings, for a patch or for the defaults
  clearings.ts           pure: the derived clearing discs from landmarks and placed trees (the same rule as the build)
  overlays.ts            OpenLayers layers: patch tint, placed trees, derived and hand-drawn clearings
editors/registry.ts      "trees": enabled
```

The patch fields use `SliderField`, with the "finish or pause" rule through the same applier idea as the Look editor, except that the
change goes to the design store, which already autosaves and builds. 3D picking reuses `terrain/camera/pick.ts` and `scene/groundTool.ts`
as the Heightmap brush does.

## 10. Tests

**Python (unit, no files):**
- same inputs give the same trees; a different seed gives different ones;
- **prefix stability:** the trees at spacing `s2 < s1` include every tree at `s1`, unmoved;
- **edit stability:** reshaping a patch changes no tree further than a metre from the changed edge; editing one patch changes none of another's;
- every procedural tree is on a woods cell of its own patch; none on fairway, green, water or paths;
- kind shares match the weights within tolerance over thousands of trees; heights stay in the kind's range times the scale;
- edge thinning: density rises with distance from open ground, and is flat when `edgeThinning` is 0;
- clearings: none inside a landmark's, a placed tree's or a hand-drawn circle; **moving a landmark moves its clearing**; a placed tree is not removed by a clearing; and **a route clears nothing**: trees stand across a hole's line of play;
- `count × 12` equals the file size, the bundle validates, and nothing is outside the course;
- the 250,000 cap holds, thins every patch by the same fraction (none is left empty), keeps the placed trees, and adds a note;
- kind weights are by name: reordering the look's kinds changes nothing; a rename through the Look editor rewrites the weights in one undo step; a weight for an unknown name is ignored with a note; the look refuses two kinds with one name;
- edge density: at the border the keep rate is `edgeDensity`, rising to 1 at `edgeThinning`; with `edgeThinning` 0 it is 1 everywhere;
- nearest-neighbour distances (a record, not a rule): the test computes the median and 1st percentile at 3, 5 and 10 m and compares them with the figures measured in step 1, so a change that crowds trees more is caught; there is no minimum distance;
- performance: the placement for a course the size of Augusta's at 4 m takes under 0.5 s (a soft check that prints the time).

**Server:** the design carries `trees`; `PUT .../trees` persists and rejects a value out of range with the field named; a region with
`trees` that is not woods is rejected; a design save triggers a build whose `trees.bin` changes.

**Web:** the derived discs match the Python golden numbers; a stroke is one undo step; `refresh` re-fetches trees and does not re-bake
when `trees.bin` is unchanged; the patch fields cover every field of `ForestSettings` (the same completeness idea as the Look editor).

**Visual checks (by you):** forest at several spacings; reshuffling while dragging (there should be none); a landmark's clearing;
trees standing across a hole's line of play (they should); the edge thinning against a fairway.

## 11. Costs

- **Build time:** the placement is vectorised and the region-index raster is one more rasterize call; budget 0.5 s on top of today's build.
- **Drawing:** trees are instanced and culled by chunk already. 30,000 trees is fine; shadows and the baked canopy lighting are what grow.
- **Re-baking:** each change to the tree set re-bakes sky and sun lighting. The finish-or-pause rule and the unchanged-bytes check above
  keep this to one bake per edit; a dense forest will still show it in the "Updating..." state.
- **File size:** 12 bytes a tree, 360 KB at 30,000, inside the format doc's budget of well under 1 MB.

## 12. Showing an edit before the build returns

A slider change shows after about a second (build, then reload), which matches the rest of the editor. Placing a tree should not feel
laggy, so v2 keeps a short list of **pending placed trees** on the client, drawn at once with the rest and dropped when the next
`trees.bin` contains them. Not needed for v1.

## 13. Steps

Each is a commit or a short run, ending green on `tsc`, `vitest` and the Python tests. Steps marked *(visual)* need a look from you.

1. **Placement core.** `build/trees.py` and its unit tests (sections 8.2 to 8.4): the sequence, edge thinning, kind and height, the cap, and the nearest-neighbour record. No files, no UI. *Done when* the tests, including prefix stability, pass.
2. **Into the build.** `ForestSettings` on `Region`, the region-index raster, `trees.bin` written with its count, the validator passes, the viewer re-fetches trees and drops the preview. Defaults only, no UI. *(visual)* *Done when* Augusta builds a forest of about 10,900 trees that looks like today's preview and stays put across builds.
3. **Tree edits file and API.** `trees.json`, `TreeEdits`, the route, the store and saving, regenerated types. Edit by hand or from the console.
4. **Clearings.** Section 8.5, `Landmark.clearance` and the format doc row, build notes. Tests for each source.
5. **The Trees editor card.** Patch selection, the six settings, the defaults, counts. *(visual)*
6. **Tools.** Add tree, Remove, Erase, in 2D and 3D, with undo. *(visual)*
7. **Overlays and readouts.** Density tint, placed trees, derived and hand-drawn clearings, per-patch counts. *(visual)*
8. **Follow-ups, each separate:** the tree-line tool; "Make landmark"; pending placed trees (section 12); copying settings between patches.

## 14. Decided, and still open

**Decided**
- **Distance transform:** `scipy` (exact), added as a dependency.
- **Landmark clearance:** the default `4 m × scale` stays until the Landmark editor, which will set real footprints.
- **Line of play:** never cleared automatically. A tree in the way can be the point of the hole.
- **Kind weights** are keyed by tree-kind name, with unique names enforced and renames carrying the weights (section 7.1).
- **Edge thinning** has two settings: the distance and the density at the border (`edgeDensity`, default 0.3).
- **A cap on the tree count**, 250,000, applied as an even thinning of every patch (section 8.6).
- **No minimum-distance rule.** Spacing is an average; crowding is for the course designer to adjust.

**Still open:** nothing that blocks step 1.

## 15. Where the build differs from the plan

- **Jitter is 0.6 m**, not 1 m. Measured: 1 m crowded a 3 m spacing (1st percentile of nearest-neighbour distance 0.16 of the spacing), and no jitter is
  a visible lattice. It is fixed in metres to keep density changes stable, so at wide spacings (10 m and up) the arrangement is closer to a lattice.
  `JITTER` in `course_maker/build/trees.py`.
- **The edge of a clearing is accurate to a class cell (half a metre)**, because clearings are painted on the class grid. A tree a hair inside the
  edge can stay. The tests allow for it.
- **Kind picking walks the kinds in name order**, so reordering the look's kinds changes nothing about which model a tree is. The plan said
  "by weight"; this is how that is made independent of order.
- **Kind operations on the look** (copy, remove, move, rename) are done on the whole document in one commit (`model/design/forest.ts`), so the weights
  (by name) and the placed trees (by index) follow. The Look editor's tree buttons call these. This was not in the plan's file list.
- **Select picks placed trees too**: a click within 2 m of a placed tree selects it (to change its model or height, or delete it); otherwise it selects
  the woods patch.
- **Tools are GroundTools**, so each works on the map and in 3D from the same code; the map's pointer is read by the hook, as the Heightmap editor does.
- **The build is asked for on release** (`session.buildNow`) rather than waiting for the autosave and build debounces, so a slider or a click shows in
  about a second.
- **Not built:** the clearing circles and patch tints are drawn on the 2D map only, not draped on the 3D ground; pending placed trees (section 12); the
  tree-line tool; "Make landmark"; copying settings between patches.
- **Found on the way:** `structuredClone` cannot copy Immer's draft proxies, so "Copy model" and "Copy part" in the Look editor would have thrown. They
  now copy through JSON (`model/look/trees.ts`).

## 16. Why the editor stuttered after a release, and what was done

Releasing a slider or clicking a tool asks for a build (section 15). That was doing far more than a tree edit needs, mostly on the browser's one
main thread (there are no web workers; only image decoding runs off it). Measured on an Augusta-size bundle:

| Where | What it did on every release | Now |
| --- | --- | --- |
| Server, 2 builds | The save scheduled a debounced build, and the editor's own request built at once: the waiting one was dropped from a dict but never cancelled, so it ran again | the request cancels the waiting build: one build |
| Server, heights (2.6 to 3.7 s) | Decoded the base height PNG, added the sculpting and re-encoded it, though no height had changed | skipped when the base, the sculpting and the range are as last time (`build/cache.py`) |
| Server, encoding (0.5 to 0.7 s) | Re-encoded class.png and bounds.png | copied when the raster is unchanged |
| Browser, refresh x 2 or 3 | The poll and the request both refreshed the scene | one refresh per build; a build already shown costs nothing |
| Browser, files | Re-fetched and decoded the class and bounds maps (10 million cells each), re-ran validation, rebuilt the edge mask and re-uploaded the class texture, for a tree edit that changed none of them | each build reports a hash per file (`BuildStatus.files`); only changed files are read, and the surface work is skipped unless the class map or the routes changed |
| Browser, two hidden layers | Painted the class and hole images (about 0.4 s of per-pixel arrays), though both layers start hidden | a table lookup, made only when a layer is drawn |
| GPU | Any tree change re-baked the sky and sun lighting for the whole course in a single frame, holding the GPU long enough to freeze the screen | only the ground the changed trees can reach is baked (`Lighting.touchTrees`); a big bake is done a strip a frame (`Bake.strip`) |

A repeat build is about 1.8 s instead of 5.5 s (planting 0.5 s, validation 0.6 s, rasterizing 0.25 s remain). The server build is a separate
process and was never what froze the mouse; the refresh and the lighting bake were.

Not done: the relief bake (`height.prepare`) is still one frame on first load, and a look change to the sun or to a tree's shape re-bakes
everything (now a strip a frame, so it shows as a few moments of partly updated lighting, not a freeze).

## 17. Making the forest sliders live

Section 16 cut the cost of a build. A slider still waited for a save, a build and a refresh before it showed anything, and every build replanted
all 23 patches. What was changed:

- **The server remembers what a design's geometry fixes** (`trees.Forest`): the class and region rasters, the distance to open ground, and each
  patch's trees as last planted, keyed by the patch's id, settings and the look's tree kinds. Changing one patch's spacing replants that patch only.
  The memo is per bundle, in memory (about 50 MB), and is dropped when any outline changes (`geometry_key`). The build uses it too, so the build
  after a drag plants nothing.
- **A preview endpoint** (`POST /api/bundle/trees/preview`, `build/preview.py`) plants from the editor's unsaved tree edits and each patch's
  settings, over the saved outlines, and returns trees.bin's bytes. It writes nothing and builds nothing. Measured on an Augusta-size bundle: the
  first preview 0.5 s, then 12 to 70 ms while dragging one patch's spacing.
- **The editor previews as the hand moves** (`scene/useTreesPreview.ts`, `treePreview.ts`): one request in flight, newer asks collapse into one, and
  the answer goes straight to the 3D view and the map. Releasing still saves and builds; the build writes exactly what was shown, so the refresh finds
  nothing to re-bake.
- **The map's tree dots are one MultiPoint feature**, not ten thousand features, and the Trees overlay keeps each patch's polygon between redraws and
  only restyles it when its tint changes.

Not done: the preview uses the saved outlines (an outline being edited at the same time shows after it is autosaved), and in 3D each preview
re-bakes the lighting around the changed trees, a strip a frame, so a drag over a big patch loads the GPU while it lasts.
