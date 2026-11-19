# Look editor: plan

Status: built (steps 1 to 7 of section 7; step 8, the polish, is not). Not yet looked at in the browser. Written for the project owner.

The course's look (`course.json` → `look`) holds about 150 values: nine surfaces of eleven fields each, the sun, sky,
shadows, relief, grass, tufts and three tree models built from primitives. Today the only way to change one is to edit the
JSON and rebuild. This adds a **Look** editor: colour pickers, sliders and selects for every field, in a panel floating over
the 3D view, so the effect of a change is seen on the course a moment after the change is made.

## 1. What it is

- A new editor in the editor bar, **Look**, after Heightmap. Opening it switches to the 3D view (the Look editor has nothing to
  show on the 2D map).
- The panel **floats** over the 3D view: a card inset from the edges of the view (not a column of the page), with the course
  visible around it. About 40% of the view's width (at least 380 px, at most 50%), and as tall as the view less its margin,
  scrolling inside. A button collapses it to a small tab so the whole course can be seen. It is not draggable or resizable in
  v1. The camera works on the part of the view the card does not cover.
- Every change goes through the one sequence in section 3: shown in the panel at once, applied to the 3D view after a pause,
  saved after that.
- The 3D view's own sliders (grass range and density, shadow quality, Height ×) move into a **Viewer** tab of the same card
  while Look is open, so two panels do not fight for one corner. Shading and Relief × leave the viewer's sliders and become look
  fields (section 2).

Not in scope: look options the model does not have yet (water animation, fog, flag colours). They are added to the `Look` model
first; the completeness test (section 6) then fails until the editor has a control for them, which is how "everything" stays
true.

## 2. Every option, and what applying it costs

The last column says what the debounced apply (section 3, step 5) has to do. Most fields reach the GPU as a uniform and are
free; a few trigger a bake, which takes visibly longer, and the panel says so while it runs.

Costs: **A** uniform only, one redraw. **B** re-bakes the ground's sun lighting (the heaviest: tree shadows are baked a tile at
a time). **C** re-bakes the relief texture. **D** rebuilds the tree models and re-bakes the sky occlusion from the crowns.
**E** reloads a file.

| Group | Field | Control | Range (from the model) | Cost |
| --- | --- | --- | --- | --- |
| Sky | `sky` | colour | 0 to 1 each | A |
| Sun | `sun.latitude` | slider, number | -90 to 90 | B |
| | `sun.declination` | **Time of year** slider in degrees, with the two dates it falls on beside it | -23.5 to 23.5 | B |
| | `sun.hourAngle` | **Time from solar noon** slider, hours | -180 to 180 degrees | B |
| Surfaces (×9: rough, fairway, green, collar, tee, bunker, water, path, woods) | `color` | colour | | A |
| | `color2` | colour, with an "off" switch (a surface may have none) | | A |
| | `stripe` | slider, metres, 0 is none | 0 to 100 | A |
| | `grain` | slider | 0 to 1 | A |
| | `shade` | slider | 0 to 2 | A |
| | `speckleDark`, `specklePale` | sliders | 0 to 1 | A |
| | `earth` | colour, with an "off" switch | | A |
| | `mottle` | slider | 0 to 10 | A |
| | `tuft` | slider (multiple of `tufts.height`, 0 is none) | 0 to 4 | A |
| | `tuftDensity`, `tuftClump` | sliders | 0 to 1 | A |
| | `bump` | slider | 0 to 3 | A |
| | `bumpMap` | select: grass / grain | | A |
| | `height` | slider, shown in centimetres with the inches beside it | 0 to 0.5 m | A |
| Grass | `grass.tile` | read-only name in v1 (the loader reads `/game/grass.png` whatever it says) | | E |
| | `grass.tileMetres` | slider | >0 to 100 | A |
| | `grass.wobble` | slider | 0 to 4 | A |
| | `grass.speckleGrain` | slider | >0 to 1 | A |
| | `grass.smoothing` | slider | 1 to 3 | A |
| | `grass.edgeWidth`, `grass.edgeRagged` | sliders, centimetres | >0 to 0.5 m, 0 to 0.3 m | A |
| | `grass.edgeShadow` | slider | 0 to 1 | A |
| | `grass.edgeGain` | slider | 1 to 10 | A |
| Tufts | `tufts.height`, `tufts.spread`, `tufts.bladeWidth` | sliders (the blade's in centimetres) | >0 to 5, >0 to 2, >0 to 10 cm | A |
| | `tufts.blades` | slider, whole numbers | 3 to 64 | A |
| | `tufts.root`, `tufts.tip` | colours | | A |
| Shadows | `shadows.strength` | slider | 0 to 1 | A |
| | `shadows.tint` | colour | | A |
| | `shadows.softness` | slider, metres | 0 to 5 | B |
| | `shadows.distance` | slider, metres | >0 to 2000 | A |
| Relief | `relief.smoothing` | slider, metres | 1 to 6 | C |
| | `relief.exaggeration` **(new)** | slider, how much steeper the slope looks in the shading; 1 is true | 1 to 20, default 3 | A |
| | `relief.shading` **(new)** | slider, how strongly the slope shades the sun's light | 0 to 3, default 1 | A |
| Tree light | `trees.ambient`, `trees.base` | sliders | 0 to 1 | A |
| | `trees.direct` | slider | 0 to 2 | A |
| Tree kinds (1 to 8) | `name`, `height` (min, max) | text, two numbers | >0 | A |
| | add, remove, duplicate, reorder a kind | buttons | 1 to 8 kinds | D |
| Tree parts (1 to 16 a kind) | frustum: `y0`, `r0`, `y1`, `r1`, `sides` (3 to 16), `color`, `shade` (0 to 1) | sliders, colour | | D (colour and shade alone: models rebuilt, nothing baked) |
| | blob: `cx`, `cy`, `cz`, `rx`, `ry`, `rz`, `sides`, `rings` (2 to 8), `color` | sliders, colour | | D (colour alone: models rebuilt, nothing baked) |
| | add, remove, reorder a part | buttons | | D |

Decided and folded in:

- **Shading and Relief × are look fields.** They change how the course is lit, so the game needs them too. The defaults are
  today's (exaggeration 3, shading 1), so nothing changes on screen. It is a format change: `ReliefLook` gains the two fields in
  `models.py` and `look_defaults.py`, a look without them gets the defaults (the pattern `grass.smoothing` used),
  `golf-course-format.md` is updated, and the types are regenerated. In the app, `Terrain3D` takes them from the look
  instead of its props, and the two sliders leave `OptionsPanel`. For a bundle, the 2D map's exaggeration slider and the Look
  panel edit the same value; for a GeoTIFF, which has no saved look, the slider stays the editor's own, as now.
- **Sun controls are friendly, with the raw numbers behind them.** The panel shows **Latitude** (degrees), **Time of year**
  (the declination, -23.44° to 23.44°, with the dates it falls on beside it: each declination is reached twice a year, so a
  date slider could not be read back unambiguously, and the sun's path is the same on both) and **Time of day** (-7 to +7 hours
  from solar noon, written as the hour angle at 15° an hour). Solar noon is local, so a clock time is not offered. A fold
  shows the raw declination and hour angle as numbers. The date formula `23.44 × sin(360° × (day + 284) / 365)` is good to
  about a degree.
- **Per-surface relevance.** `color2` and `stripe` only matter on mown surfaces, `earth` and `mottle` on woods, speckle on
  sand. Every field is reachable, but the fields that are on for the surface come first and the rest sit under "More", so a
  bunker is not a wall of zero-valued sliders.
- **Viewer settings are not look.** Grass range and density, shadow quality, Game look, Height ×, surface opacity and outlines
  stay the viewer's (`views/view3d/options.ts`).

## 3. The sequence on any change

One path for every control: a slider, a colour, a number box, a select, a switch, a button that adds a tree part, and undo and
redo. Nothing else touches the look.

1. **Tweak.** The control changes the value. The panel always shows the latest value at once; it never waits for the
   renderer.
2. **Store.** The new look is committed to the design store (`doc.look`) as an Immer patch. A drag is one undo step: the group
   starts when the pointer goes down and ends when it is released (for typing, when the box loses focus or Enter is pressed).
3. **Finish or pause.** The change is applied when it is finished or when the hand has paused:
   - **Finishing events apply at once:** releasing a slider or a colour drag, Enter or leaving a number box, and picking from a
     select, flipping a switch or pressing a button (each a single, complete event).
   - **A gesture still in progress applies after a pause.** Every commit during a drag or while typing starts or restarts one
     timer, `LOOK_QUIET_MS`, **300 ms**; if the hand stops for that long without letting go, the change applies then. While
     the timer runs the 3D view keeps showing the last applied look and the panel shows a small "pending" marker. This one
     constant is the only knob; 250 to 500 ms is the range to try.
   
   The point of both rules is the same: never apply while a change is still being made, and never leave a finished one waiting.
4. **Compare.** When the timer fires, `diffLook(applied, latest)` says what changed: nothing to bake (uniforms only), the sun
   lighting, the relief, the tree models.
5. **Apply.** `renderer.setLook(latest)` invalidates exactly what the diff says and no more, and the view redraws. The bakes
   run on the GPU in the next frames; the panel shows "Updating…" until they are done. `applied` becomes `latest`.
6. **Save.** Straight after step 5, with no second timer, the look is sent to the server (`PUT /api/bundle/look`). A pending
   look is also sent when the tab hides or another bundle is opened, as the design is now. The editor bar's existing
   "Saving… / Saved" line covers it. A look change schedules no build: it changes no raster.
7. **Server.** The look is validated by the same pydantic model, then written into `course.json` under a per-bundle lock
   (temp file and `os.replace`). A value outside its range is a 422 naming the field; the panel marks that field and the editor
   bar says "Couldn't save". The edit stays in the store (undo still works) and the 3D view shows it.

Rules that keep it clear:

- **Latest wins, no queue.** A change during steps 4 to 6 starts the finish-or-pause wait again. A bake already running finishes (a
  frame's GPU work cannot be taken back), and the next apply follows it.
- **Undo and redo are changes.** They go through the same steps 3 to 7, so the view and the file always match the store.
- **One reader of the look.** The 3D view, the 2D map and the save all read `doc.look`. After a build the scene reloads from
  disk but keeps the store's look (section 4.3), so a late build never puts an old look back on screen.

## 4. What has to change underneath

**4.1 `setLook` re-bakes everything on every call.** `TerrainRenderer.setLook` ([terrain.ts:66](../web/src/terrain/terrain.ts))
calls `lighting.touchAll()`, and `TreesPass.ready` rebuilds the tree models whenever `made.look !== look`
([trees.ts:113](../web/src/terrain/passes/trees/trees.ts)). With the pause in section 3 that is once a pause rather than sixty
times a second, but still a sun re-bake and a tree rebuild to change a fairway colour. So `setLook` compares old and new and
invalidates only what changed:

```ts
// terrain/look/diff.ts, pure and tested
type LookChange = { sunBake: boolean; relief: boolean; treeModels: boolean; grassTile: boolean };
function diffLook(prev: Look, next: Look): LookChange
```

`sunBake` is any `sun.*` or `shadows.softness`; `treeModels` is any change to a kind's geometry (not its colour); the tree pass
keys on the geometry, not the look object. Class A fields need no invalidation: `setLookUniforms` runs every frame and
`packSurfaces` is memoised on the `surfaces` object, which an immutable edit replaces.

**4.2 Where the look is saved.** `build_bundle` reads `course.json` at the start of a build and writes it at the end
([build.py:112](../course_maker/build/build.py), [build.py:151](../course_maker/build/build.py)), so a look saved during a
build would be overwritten by the build's stale copy. The fix keeps the earlier decision (one copy, in `course.json`, none in
`.course_maker/`): the PUT and the build's final write take the same per-bundle lock, and the build re-reads the look from
`course.json` just before it writes. `GET /api/bundle/design` also returns the look, so the editor loads it with the rest of
the document.

**4.3 The build poll must not undo edits.** `useDesignSession` refreshes the scene when a build finishes, and `setScenery` then
calls `renderer.setLook(course.look)` with the look it just loaded ([bundleScene.ts:104](../web/src/scene/bundleScene.ts)). The
scene's refresh takes the look from the store instead.

**4.4 Undo and autosave exist; the look joins them.** `model/design/store.ts` has Immer patches and `begin`/`end` grouping,
and `useDesignSession` saves changed parts of the document. The look becomes a fourth part of `Doc` beside regions, bounds
and layout, edited with `commit("Fairway colour", d => { d.look.surfaces.fairway.color = c })`. The look's save is the one
change to that session: it fires from the binding (step 6) rather than from the design's own 600 ms debounce.

## 5. Layout in the code

Follows the layer rule in `frontend-architecture.md`; nothing here points up.

```
model/design/store.ts         Doc gains `look`; docFromApi reads it
model/look/                   pure: getPath/setPath, rgb01 <-> hex <-> hsv, sun <-> (date, time from noon), + tests
terrain/look/diff.ts          diffLook, used by TerrainRenderer.setLook
scene/useLookBinding.ts       steps 3 to 6: the quiet timer (LOOK_QUIET_MS), diff, setLook, redraw, save, and the
                              pending / updating state the panel shows
ui/                           generic widgets: ColorField, SliderField, SelectField, Section, FloatingCard (radix-ui has
                              Slider, Popover, Collapsible, Select already; no new dependency)
editors/look/
  README.md
  lookSchema.ts               one entry per field: path, label, widget, range (from the generated OpenAPI), cost,
                              relevance rule, tooltip
  useLookEditor.ts            the hook: commands (reset section, collapse), `active`, as the other editors
  LookPanel.tsx               the floating card and its tabs
  SkySunTab.tsx  SurfacesTab.tsx  GrassTab.tsx  LightTab.tsx  TreesTab.tsx  ViewerTab.tsx
editors/registry.ts           { id: "look", label: "Look", goto: "g k", ... }
app/App.tsx                   entering Look turns the 3D view on; the card is rendered inside <main> over Terrain3D
course_maker/models.py        ReliefLook: exaggeration, shading
course_maker/server/app.py    PUT /api/bundle/look; GET design includes look
course_maker/build/build.py   re-read the look under the lock before the final write
```

Notes:

- **Ranges are not copied by hand.** `python -m course_maker openapi` already writes `web/openapi.json`, whose `Look` schema
  carries every `minimum`, `maximum` and description from the pydantic model. `lookSchema.ts` reads ranges from it, so changing
  a range in `models.py` changes the slider.
- **Defaults and reset.** `/api/look/default` already serves the default look. A field shows a dot when it differs from the
  default; clicking it resets that field (one undo step); each section has "Reset section".
- **Colours.** A swatch opens a popover with an HSV area, a hue bar, three number boxes (0 to 1, as the file stores them) and
  a hex box. Values are written as the file stores them (0 to 1, as the shaders use them).
- **Surfaces tab.** Nine chips, each a swatch of the surface's colour. Clicking the ground in the 3D view selects the surface
  under the pointer (the class map is already on the CPU, and `pick.ts` finds the ground point).

## 6. Tests

- `diffLook`: every class A field gives no flag; each B, C and D field sets exactly its flag.
- `useLookBinding` with fake timers: ten commits inside 300 ms give one apply and one save; a finishing event (release, Enter,
  select) applies at once without waiting; a commit during an apply starts the wait again; undo goes through the same path; a
  failed save leaves the store as it was.
- **Completeness:** walk the default look and assert every leaf path is in `lookSchema.ts` or in a short explicit exclusion
  list. A new field in the model fails this until it has a control.
- `model/look`: colour conversions round-trip; date and time conversions against known sun positions (June solstice declination
  23.44; 11 am at Augusta is an hour angle of -36°); `setPath` is immutable.
- Store: a look edit undoes and redoes; a dragged slider is one undo step.
- Python: the new relief fields have defaults, validate, and a look without them gets them; `PUT /api/bundle/look` persists and
  returns 422 with the field for a bad value; a build started before a look save and finished after it keeps the new look; a
  build keeps an edited look (exists today, extended).
- `architecture.test.ts` stays strict.
- Visual checks (by you) after steps 6 and 7.

## 7. Steps

Each is a commit (or a short run), ending green on `tsc`, `vitest` and the Python tests. Steps 1 to 7 are built, in the order
1, 2, 3, 4, 5, 7 and 6 (the trees tab was written with the others). Step 8 is not built.

1. **Granular `setLook`.** `diffLook` and its tests; `setLook` and the trees pass invalidate only what changed. No UI yet;
   call `setLook` from the console with a changed colour and watch the frame cost. *Done when* a colour change costs one
   redraw and no bake.
2. **Model and saving.** `relief.exaggeration` and `relief.shading` (model, defaults, format doc, regenerated types, and
   `Terrain3D`/`OptionsPanel`/`RightPanel` switched to read them from the look; for a bundle, the sliders for them are in
   the Look editor and the 2D map's one writes the look); the lock, `PUT /api/bundle/look`, the
   build's re-read, `look` in the design GET; Python tests. *Done when* the app looks identical and the relief sliders
   write the look.
3. **Store and binding.** `doc.look`, `useLookBinding` with the sequence in section 3, the scene refresh keeping the store's
   look (4.3). Still no panel: edit with `designStore.getState().commit(...)` from the console, watch the view follow
   300 ms after the last edit (or at once after a `finish()` call, which the widgets will make on release), undo included.
4. **Widgets.** `ui/` ColorField, SliderField, SelectField, Section, FloatingCard, with `model/look` colour and sun maths and
   tests.
5. **Schema.** `lookSchema.ts` for every field, ranges from the OpenAPI, the completeness test.
6. **The editor, without trees.** Registry entry, App switches to 3D, `LookPanel` with Sky & Sun, Surfaces, Grass, Light &
   shadows, Viewer tabs. *(visual)*
7. **Trees tab.** Kind and part lists, add, remove, duplicate, reorder, all primitive fields. *(visual)*
8. **Polish, each separate:** click the ground to pick a surface; hold a key to flash the saved look (A/B); camera offset so
   the course is centred in the part the card leaves open; copy and paste a look as JSON, and export one to use on another
   course.

Then: `editors/look/README.md`, the editors README, a "Look editor" entry under "After the plan" in
`frontend-architecture.md`, and the main README's list of editors.

## 8. Still open

Decided: the hotkey is `g k` (`g l` is Landmarks), and finishing events apply at once (section 3, step 3).

1. **Grass tile.** The loader ignores `grass.tile` and always fetches `/game/grass.png`, so v1 shows the name read-only. Making
   it a real choice means serving the tile from the bundle or a tiles folder; not planned unless you want several tiles.
