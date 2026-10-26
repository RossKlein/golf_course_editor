# Frontend architecture and reorganisation plan

Status: proposal, nothing moved yet. This covers `web/` and the one place it reaches into the bundle format (the look,
section 3.4). The Python side is already layered (`compiler`, `build`, `design`, `project`, `server`) and needs only the
small tidy in step 1 and the `Look` model in step 3.

Three things are decided here, and then the steps to get there:

1. **The rendering engine.** The terrain view is a small graphics engine: a shared GL context, textures, programs, passes,
   culling, a sculpting brush that runs on the GPU. It has grown as one renderer class and a few shader strings. This
   describes the engine it should be.
2. **How the engine is driven: by data, not by constants in shaders.** The golf game's engine will be this one, because the
   course is built before the game. Colours, sizes and rules belong in the map's metadata and are loaded.
3. **The layout of the whole frontend**, with a dependency rule that a test enforces.

## 1. Why: what the code does today

The folder-level import graph (generated from the sources) has these cycles:

| Cycle | Evidence |
| --- | --- |
| `map` and `map/terrain` | `map` imports `map/terrain`; `map/terrain` imports `map` |
| `map/terrain` and `view3d` | the renderer and shaders import `view3d/scenery`, `view3d/frustum`, `view3d/mat4`; `Terrain3D` imports back |
| `design`, `bundle` and `heights` | `design` imports `bundle`, `bundle` imports `heights`, and `heights` imports `design` |
| `decode`, `heights` and `map/terrain` | the PNG decoder imports the terrain folder, which imports `decode` and `heights` back |
| `commands` and `editors` | `commands` imports `editors`; every editor imports `commands` |
| `editors/shared` and `editors/course` | the shared folder imports from one of its own consumers |

Problems with single files:

- `renderer.ts` (388 lines) is the 2D map pass, the 3D mesh pass, every texture, the sculptor hookup and the scenery hookup.
- `sceneryGpu.ts` holds two shader programs, instancing, tile culling and the tree buffers.
- `scenery.ts` holds tree meshes, tree scatter, stripe directions and the sand texture.
- Nothing stops new code from importing in the wrong direction, so it does.

Problems with hard-coded looks (the reason for section 3.4). Today these are literals in shader strings or TypeScript:

- every surface's colour, stripe width and grain amount (rough, fairway, green, collar, tee, sand, water, path, forest floor),
  and the earth colour the forest floor mixes with;
- the tuft root and tip colours, their height, and the rule for where they grow (`cls < 0.5 || cls == 8`);
- the tree colours and shapes, and the light each tree takes;
- the sand speckle strengths and grain size, and the grass tile size (3 m);
- the sun (`solarPosition(33.5, 23.44, -36)`) and the sky colour;
- the slope palette and the class and hole overlay colours (these are editor colours, not the course's look; see 3.4).

And in the shaders there are hand-maintained uniform name lists (`gl.ts`) and template strings where a stray backtick has
broken the build twice.

## 2. Principles

- **The engine is the game's engine.** The golf game will load a bundle and draw it with `core`, `gfx` and `terrain`. So
  those three layers import no React, no OpenLayers, no design document and no editor code, and could be lifted into a
  shared package unchanged. The editor is one client of the engine; the game is the other.
- **Data, not literals.** A colour, a size or a per-surface rule that an artist might want to change is data in the bundle.
  Shaders and passes contain maths and structure only (3.4).
- **Golf only.** The engine loads golf maps with the features already outlined (height, classes, holes, bounds, trees,
  landmarks, patches). It is not a general engine: no scene graph, no material system, no render graph, no plugin
  interface. Where a general thing and a golf thing differ, take the golf thing.
- **Layers with a one-way dependency rule.** A folder may import only from layers below it. A test checks this.
- **A folder's main module is named after the folder** (`terrain/terrain.ts`), with no `index.ts` barrels. This is the
  convention in Rally_Club's `src/shared`.
- **Every layer has a `README.md`** saying what belongs there and what does not.
- **Pure first.** Anything that can be plain data and functions is (camera maths, culling, brush maths, tile selection), so
  it can be unit-tested without a GPU. GPU code is thin and drives those.
- **Tests stay next to the code** (`thing.test.ts`), as now.

## 3. The engine

### 3.1 Two parts, and what it is not

- `gfx/` is a thin WebGL2 layer: a device, resources, shader programs, the pass interface, maths and culling. It contains
  only what the golf renderer needs.
- `terrain/` is the golf renderer built on it: the height field, the ground mesh, the 2D map pass, tufts and trees, the
  drape, the sculpt brush, and the loader for a bundle. It knows what a height grid, a class map, a hole and a look are.

The GPU API is **WebGL2**, as today. Non-goals: arbitrary meshes and materials, a scene graph, post-processing, and
WebGPU (the newer browser API that will eventually replace WebGL; we are not planning a move to it, though the device,
resource and pass split would allow one later behind the same interfaces). Shadows are in scope: see 3.5.

### 3.2 `gfx/`

```
gfx/
  device/        the one shared context: creation, loss and restore, capabilities (float targets, anisotropy, max texture size),
                 a generation counter so stale GPU objects are recognised
  resource/      Texture (lazy, uploaded per device generation), Buffer, VertexArray, RenderTarget, UniformBlock; a Scope that
                 owns what it made and frees it all in one call
  shader/        Program, the .glsl preprocessor, error reporting
  pass/          the Pass interface and the Frame passed to it
  math/          mat4, vec3, frustum extraction and box tests
  cull/          pure helpers that decide what to draw: tile and chunk selection
  stats/         draw calls, instances sent, frame time; feeds the on-screen counters
```

**Shaders are files.** `*.glsl` next to the pass that owns them, imported with Vite's `?raw`. A tiny preprocessor resolves
`#include "height.glsl"` and injects `#define`s from TypeScript (so the tuft tile size has one definition). This removes
the template-string and backtick problem and the duplicated chunks.

**Programs introspect their own uniforms.** `Program` reads `getActiveUniform` once after linking, so there are no uniform
name lists to keep in step with the shader. Setting is by name and typed:

```ts
program.use();
program.set({ uScale: 1, uSun: [x, y, z], uViewProj: m });   // skips unchanged values
program.texture("uTile", tileTexture);                        // unit numbers are assigned, not hand-picked
program.block("Look", lookBlock);                             // a uniform block, bound by name
```

**Resources are lazy and survive context loss.** A `Texture` is described on the CPU (size, format, data source) and
uploaded the first time it is bound on the current device generation. This is what `LazyTexture` does now, made general.
A `Scope` ties lifetimes together: a view creates one, everything it makes goes in it, and `scope.dispose()` frees it.

**Passes.** A pass is a small object:

```ts
interface Pass { setup(d: Device): void; draw(d: Device, frame: Frame): void; dispose(d: Device): void }
```

`Frame` carries what every pass needs: camera matrices and frustum, eye, the look, the viewport, the quality settings for
this frame, and a `stats` collector. Order is explicit in the view that owns the passes.

### 3.3 `terrain/`

```
terrain/
  course/        CourseData: the typed bundle (course.json, the textures, trees.bin, the look) and the loader that fetches it.
                 The editor and the game both load a course through this and nothing else.
  look/          the Look type (generated from the bundle format), its defaults, and LookBlock: the uniform block that carries
                 it to the shaders
  heightfield/   HeightField: owns the base height texture and the sculpt-offset texture; binds both to a program and supplies
                 the GLSL chunk (height.glsl) with the one sampling routine. CPU twin: exact bilinear sampling.
  passes/
    flat/        2D map pass (hillshade, contours, slope colour) for OpenLayers
    ground/      3D ground mesh: the three rings, the inner-collapse logic, lighting, the game look, surface speckle
    tufts/       grass tufts: tile selection, instancing, shader
    trees/       tree models from the look, chunking, instancing, shader
    shadow/      the sun's shadow map: cascade fitting (pure), the depth pass for trees and landmarks, the GLSL chunk that
                 every receiving pass includes
    drape/       paints design surfaces and outlines to canvases and uploads them (editor only)
  sculpt/        the GPU brush pass, tile readback, the delta file format, brush maths (pure), undo hooks (editor only)
  surfaces/      the class map texture, stripe directions, the grass tile and its average colour
  scenery/       pure data: woods scatter, trees.bin reader, tree model geometry from the look
  camera/        orbit camera maths, mesh and drape windows (pure)
  sun.ts         solar position from the look's latitude, declination and hour angle
  terrain.ts     TerrainRenderer: assembles the passes and exposes render2d / render3d / sculpt / stats
```

Rules for this layer:

- A pass owns its programs and buffers and nothing else. It reads the world through `HeightField`, `Surfaces`, the look and
  its own inputs, so no pass needs to know how another works.
- Anything a pass decides before drawing (which tiles, which chunks, how many instances) is a pure function in the same
  folder, with a test. Culling lives next to the thing it culls.
- The shader chunks `height.glsl`, `hash.glsl`, `sun.glsl` and `class.glsl` are included, never copied.
- The editor-only parts (`drape`, `sculpt`) are separate folders the game's build does not need.
- `TerrainRenderer` stays the only thing the rest of the app talks to. Its surface is small and typed: set data, render a
  frame, sculpt, read stats.

### 3.4 The look: data in the map, not literals in the shaders

**Rule.** A shader or pass may contain maths, structure and hash constants. It may not contain a colour, a size in metres,
a strength, or a rule about which surface does what. Those are fields of the **look**, loaded from the bundle.

Three kinds of value, and where each lives:

| Kind | Example | Where |
| --- | --- | --- |
| **Course look**: what an artist would change, and what the game needs too | fairway colours, stripe width, tuft height, tree colours, sun, sky | the `look` in `course.json` (this section) |
| **Editor theme**: how the editor draws its own aids | slope palette, contour style, class and hole overlay colours, selection colours | a theme module in `model/theme/`, passed to shaders as uniforms; never in the bundle |
| **Engine limit**: quality and performance caps, not looks | mesh ring count and size, the tuft patch cap, polygon offsets, tuft tile size | named constants in one `terrain/limits.ts`, injected with `#define` or a uniform |

The test for a value: *would the game artist change it for this course?* Look. *Does it only keep the frame rate or the
maths safe?* Limit. *Does it only help the editor?* Theme.

**The look in the bundle.** `course.json` gets a `look` object. Its single source of truth is a pydantic `Look` model in
`course_maker/models.py`, with ranges validated there, so the generated TypeScript types, the compiler and the game's loader
all agree. The authored copy lives in the project folder beside the design (with the same backups) and the build copies it
into `course.json`. Defaults live in `spec.py` and are exactly today's values, so adopting the look changes nothing
visible.

What the look holds, from the inventory in section 1:

- **sky**: clear colour.
- **sun**: latitude, declination, hour angle (the renderer derives direction and height), and the light the trees take
  (ambient and direct).
- **shadows**: how dark they are, the tint of shadowed ground (cooler than lit), how soft their edge is, and how far from
  the camera they reach before fading out. How crisp they are (map size, cascade count) is a quality setting, not look.
- **surfaces**: one entry per class id (9 today), each with its colour, an optional second colour and stripe width for
  mown surfaces, how much grass grain shows through, and an optional speckle (grain size, strength of the dark and pale
  grains, and their share). The forest floor is a surface with an `earth` colour to mix with the rough and a patchiness
  strength, not a special case in the shader.
- **grass**: the tile texture (a file in the bundle), how many metres it covers, and how far surface edges are wobbled.
- **tufts**: per surface class, a height factor (0 for none), so "grows on rough and woods, shorter in woods" is data; and
  the root and tip colours, base height, and width ratio.
- **trees**: the model kinds, each a short list of primitives (a frustum or a blob: size, position, colour). Tree models are
  data too. When the game's own tree models arrive from the Rally_Club project, they replace these entries.

**How it reaches the GPU.** `terrain/look/LookBlock` describes the look's fields once and from that table produces both the
GLSL declaration (`uniform Look { ... }`, std140) and the packing code, so the shader and the TypeScript cannot drift. The
surface table is an array of structs in the block. The tuft and tree passes read the same block. Changing a colour in the
editor changes the block's data, not a shader.

**How it is kept honest.**

- A test scans every `.glsl` file for colour-like literals (a `vec3` or `vec4` built from three or four fractional numbers)
  and fails on any that is not marked `// allow-literal`. Maths vectors such as directions or axes are marked.
- A test loads the default look and checks it equals the values the shaders used before (until step 3 lands, this is the
  regression guard for "no visible change").
- The look is edited in the editor later (a Look panel, with live update and undo through the design store); this plan only
  makes that possible and does not build the panel.

**Format and the game.** Adding `look` to `course.json` is a format change. `docs/golf-course-format.md` is updated in
step 3, and the game-side loader reads it through the same `terrain/course/` loader the editor uses.

### 3.5 Shadows

Shadows are part of the engine, as a pass that every receiving pass reads. Two techniques, because the two jobs differ:

- **Trees and landmarks cast onto everything: a shadow map.** One depth pass from the sun draws only the casters (trees, later
  the clubhouse and other landmarks) into a depth texture (WebGL2 depth textures and `sampler2DShadow`, which gives a free
  2x2 filtered compare). The ground, the tufts and the trees themselves sample it.
- **Terrain shadows itself: a short ray march, no map.** The ground fragment steps toward the sun through the height field
  (about a dozen samples over some tens of metres) and darkens where the ground rises above the ray. It uses the same
  `heightAt` as everything else, so sculpted changes shadow correctly the moment they are made, and the terrain never has
  to be drawn into a shadow map, which keeps that map cheap.

Details that matter:

- The sun is high at the default time (about 57 degrees at 11 am), so shadows are short (a 20 m tree throws about 13 m).
  That lets a small number of **cascades** cover what is visible: the camera's view is cut into two or three slices, each
  with its own fitted shadow map, and shadows fade out at the look's distance. Cascade fitting is a pure function with
  tests.
- The map is snapped to whole texels as the camera moves, so shadow edges do not shimmer. Bias is slope-scaled to avoid
  acne and peter-panning.
- Tufts do not cast (too small, too many) but they receive: a tuft takes the ground's shadow at its root, so grass under a
  tree darkens with the ground.
- Casters are culled per cascade with the same chunk logic as the trees' main draw (`gfx/cull`), so the shadow pass costs
  roughly the visible trees once more.
- Quality is a setting of the viewer, not of the map: **off**, **low** (one cascade, 2048, trees only, no ray march),
  **high** (three cascades, 2048, soft filter, terrain self-shadow). The default must run on an older PC; the stats counter
  shows what the pass costs.
- Everything that tunes how shadows look is in the look (3.4); the map size and cascade count are engine limits.

### 3.6 What the app sees

```
core ─► gfx ─► terrain ─┐
core ─► model ──────────┼─► scene ─► views ─► editors ─► shell ─► app
                        │      (joins app data to the renderer)
```

`scene/` is the only place that holds both a `TerrainRenderer` and the design store. It turns the bundle and the design
into the plain inputs the renderer takes, and turns sculpt commits into undo entries. Editors and views ask `scene/` for
things; they never reach into `terrain/` internals.

### 3.7 Performance policy

- **Draw only what can be seen.** Passes cull to the frustum and to their own range before issuing a draw (tufts by tile,
  trees by chunk; ground rings by row is a later step).
- **Budgets are visible.** The stats feed a small counter in the 3D panel (tufts sent, trees drawn, draw calls, frame ms),
  so a slider that costs too much is obvious.
- **Cost knobs are explicit and capped** (grass range, density, the patch cap). They are quality settings of whoever is
  viewing, not part of the look.
- **Later, same structure:** wind is a new input to the existing passes; tree LOD is a change inside `passes/trees`.
  Nothing needs the layout to change.

### 3.8 Testing the engine

- Pure code: unit tests as now (camera, frustum, culling, brush, tiles, chunking, textures as data).
- Shaders: a smoke check that compiles every program in headless Chromium and fails on any compile or link error. This
  would have caught both backtick breaks and the speckle uniform mistake before the build.
- Look: the literal scan and the defaults-equal-today test from 3.4; a round-trip test that the pydantic model, the
  generated type and the `LookBlock` agree on every field.
- Context loss: a test that loses and restores the context and checks that textures and passes come back.
- Shadows: pure tests for cascade fitting (slices cover the view, maps are texel-snapped, a moved camera does not change a
  cascade's texel grid) and for the ray march's CPU twin against a known hill.

## 4. Layout of the whole frontend

```
web/src/
  main.tsx
  core/        api/ (client + generated types), units/, decode/ (PNG and TIF readers), geometry/ (polygon and line maths)
  gfx/         the engine's GL layer, as in 3.2
  terrain/     the golf renderer, as in 3.3 (includes course/ and look/)
  model/       design/ (document, store, holes, layering, selection), editorState/ (persisted state), theme/ (editor
               palette: overlay colours, slope palette, contour style). No DOM, no GL, no OpenLayers.
  commands/    keymap, scopes, hotkey hook. Defines the command registry; editors register into it.
  scene/       the terrain scene (renderer + design + session), heightmap session (sculpt <-> undo), TIF scene, the
               design-to-drape bridge
  ui/          generic widgets: Hint, sliders, dialogs, panels with no app knowledge
  views/
    map2d/     OpenLayers: OlMap, layers, coords, view, design layers, the terrain layer adapter
    view3d/    Terrain3D component, orbit and pan controls, the options panel
  editors/     registry.ts; _shared/ (polygon tools, hole navigation); course/, bounds/, heightmap/, and later hires/,
               greens/, landmarks/, trees/, look/. Each folder: its hook, its tools, its panel
  shell/       the app chrome: SubBar, EditorBar, RightPanel, HolesPanel, DataTab, FileList, ReportView
  app/         App.tsx, layout, app.css
```

### Dependency rule

A folder may import only from folders earlier in this list. `terrain` and `model` are siblings: neither imports the other.

1. `core`
2. `gfx`
3. `terrain`, `model` (siblings)
4. `commands`
5. `scene`
6. `ui`
7. `views`
8. `editors`
9. `shell`
10. `app`

`architecture.test.ts` reads every import in `web/src`, maps it to a layer, and fails on any import that points the wrong
way. It also fails if `core`, `gfx` or `terrain` import `react`, `ol`, or anything outside the web platform, which is what
keeps them movable into the game. It starts with an allowlist of the current violations and the allowlist only ever
shrinks; when it is empty the test is strict.

### Where today's files go

| Today | Becomes |
| --- | --- |
| `api/` | `core/api/` |
| `units/` | `core/units/` |
| `decode/` | `core/decode/` |
| `design/geometry*`, `editors/shared/polygonTools` (pure parts) | `core/geometry/` |
| `view3d/mat4.ts`, `view3d/frustum*` | `gfx/math/` |
| `map/terrain/gl.ts` | `gfx/device/`, `gfx/resource/`, `gfx/shader/` |
| `map/terrain/shaders.ts` and shader strings in `sceneryGpu.ts` | `.glsl` files under `terrain/passes/*`, with colours and sizes moved into the look |
| `map/terrain/renderer.ts` | `terrain/terrain.ts` plus `terrain/passes/*` and `terrain/heightfield/` |
| `map/terrain/sculptor.ts`, `heights/tiles`, `heights/brush` | `terrain/sculpt/` |
| `map/terrain/sceneryGpu.ts`, `view3d/scenery.ts` | `terrain/passes/tufts`, `terrain/passes/trees`, `terrain/scenery/`, `terrain/surfaces/` |
| `view3d/camera*`, `map/terrain/sun.ts` | `terrain/camera/`, `terrain/sun.ts` |
| `map/terrain/contours.ts`, `reference.ts`, `terrain.test.ts` | `terrain/passes/flat/` |
| `view3d/drape*` | `terrain/passes/drape/` |
| bundle loading in `bundle/bundleScene.ts` (fetch and decode) | `terrain/course/` |
| `design/` (document, store, holes, layering) | `model/design/` |
| `selection/`, `editor/` | `model/design/`, `model/editorState/` |
| `bundle/colours.ts` (class and hole overlay colours), slope palette | `model/theme/` |
| `design/ol*.ts`, `design/useDesignLayers.ts` | `views/map2d/design/` |
| `design/useDesignSession.ts`, `heights/session.ts`, `bundle/bundleScene.ts` (scene part), `map/scene.ts`, `tif/tifScene.ts` | `scene/` |
| `map/OlMap.tsx`, `layers`, `coords`, `view`, `terrainLayer` | `views/map2d/` |
| `view3d/Terrain3D.tsx` | `views/view3d/` (split into component, controls, options panel) |
| `panel/`, `ui/` | `ui/` and `views/` as their content decides |
| `commands/` | `commands/` (inverted: editors register) |
| `editors/shared/` | `editors/_shared/` |
| `shell/`, `files/`, `report/`, `tif/TifPanel` | `shell/` |
| `app/` | `app/` |

## 5. The steps

Each step is one commit (or a short run of commits), moves files with `git mv`, rewrites imports with a script, and ends
green on `tsc --noEmit`, `vitest run` and `vite build`. There are no visible changes in any step: the look's defaults are
today's values. Steps marked **visual** need a look in the browser from you before the next one starts.

**Step 0: baseline and guard.**
Commit the untracked docs (`course-editor-plan.md`, `editor-technology.md`, `golf-course-format.md`) and `run.ps1`. Add
`architecture.test.ts` with the layer table and an allowlist of today's violations (so the test passes now). *Done when:*
the test runs and lists the violations it is tolerating.

**Step 1: repo root.**
Move `augusta/` and `courses_test10/` under one ignored `data/` folder (and update `run.ps1`, the README and the `--data`
default). Delete the `.lnk`. Move `plan.md` into `docs/` and mark what is done. Archive `spike/` to a branch and remove it.
Add a README to `course_maker/` and its packages. *Done when:* the root has `course_maker/`, `web/`, `tif_generation/`,
`docs/`, `data/` and the usual files.

**Step 2: shaders become files.** *(visual)*
Add `gfx/shader/` (`Program` with uniform introspection, the `#include` and `#define` preprocessor). Move every shader
string to `.glsl` files with the same text; replace the hand-written uniform lists. Add the headless shader smoke check.
*Done when:* every program builds through the new path, the smoke check passes, and the 2D and 3D views look identical.

**Step 3: the look.** *(visual)*
Add the pydantic `Look` model and its defaults (today's values, from the inventory in section 1), validated. Authored copy
in the project folder, written into `course.json` by the build; regenerate the TypeScript types; update
`docs/golf-course-format.md`. Add `terrain/look/` with the `LookBlock` uniform block. Move the surface colours, stripe
widths, grain amounts, forest earth, tuft colours and height rules, tree models and colours, speckle, grass tile size, sun
and sky out of the shaders and `scenery.ts` into the look. Move the slope palette and the overlay colours into
`model/theme/`. Move the engine limits into `terrain/limits.ts`. Add the literal-scan test. *Done when:* no `.glsl` file has
a colour literal, the defaults-equal-today test passes, and everything looks identical. The data in `augusta` gets a `look`
on its next build.

**Step 4: `gfx/` core.**
Move the device and context handling, `LazyTexture` (becoming `Texture`) and the Scope, `mat4` and `frustum` into `gfx/`.
Add the context-loss test. *Done when:* nothing outside `gfx/` calls WebGL for context, texture or program creation.

**Step 5: split the renderer into passes.** *(visual)*
Create `terrain/heightfield/` and pull `renderer.ts` apart into `passes/flat`, `passes/ground`, `passes/drape` and a thin
`terrain.ts`. Do the same for `sceneryGpu.ts` (`passes/tufts`, `passes/trees`). Add the stats collector and show it in the
3D panel. *Done when:* no file in `terrain/` is over about 250 lines, and the views look identical.

**Step 6: pure scenery data, sculpt and the course loader.**
Move `scenery.ts` into `terrain/scenery/`, `terrain/surfaces/` and `terrain/passes/trees/`. Move `heights/tiles`,
`heights/brush` and `sculptor.ts` into `terrain/sculpt/`. Move camera and sun into `terrain/`. Move the fetch-and-decode half
of bundle loading into `terrain/course/` (the typed `CourseData` including the look). *Done when:* `terrain/` imports only
`core` and `gfx`, and a bundle can be loaded to a renderer without any editor code.

**Step 7: `core/` and `model/`.**
Move `api`, `units`, `decode` and the pure geometry into `core/`. Move the design document, store, holes, layering,
selection, persisted editor state and the theme into `model/`. Peel the OpenLayers and React parts off `design/` into
`views/map2d/design/` and `scene/`. *Done when:* `model/` and `core/` import no DOM, GL or OpenLayers.

**Step 8: `scene/`.**
Gather the scene half of bundle loading, the terrain scene, the height session and the TIF scene. This is the one place that
holds both the renderer and the design store. *Done when:* nothing outside `scene/` imports `terrain/` directly except
`views/map2d`'s layer adapter and `views/view3d`'s canvas.

**Step 9: `views/`.** *(visual)*
Move the OpenLayers map into `views/map2d/`. Split `Terrain3D.tsx` into the component, the controls (pointer and keys) and
the options panel. Move `panel/` and `ui/` to their right homes. *Done when:* `Terrain3D` is under about 120 lines.

**Step 10: commands and editors.**
Invert `commands`: it defines the registry and scopes and imports no editor; each editor registers its commands. Rename
`editors/shared` to `editors/_shared` and break its import of `editors/course`. *Done when:* adding an editor touches only
its own folder and the registry file.

**Step 11: shell, app, and strict mode.**
Tidy `shell/` and `app/`. Write the `README.md` for each layer in the "belongs / does not belong" style. Empty the
allowlist so the architecture test is strict. Update the main README and `docs/editor-technology.md` for the new layout.
*Done when:* the allowlist is empty and every layer has a README.

**Step 12: shadows.** *(visual)*
The first feature built on the new structure, so it lands in `terrain/passes/shadow/` rather than being moved there later.
In order: (a) `gfx` gets depth textures, a framebuffer and `sampler2DShadow` support; (b) pure cascade fitting with tests;
(c) the depth pass for trees; (d) the shadow chunk and the ground, tuft and tree passes sampling it; (e) the terrain
self-shadow ray march in the ground pass; (f) the look's `shadows` fields and a quality setting (off, low, high) in the 3D
panel, with the cost in the stats counter. *Done when:* trees throw shadows onto the ground and each other, hills shade
hills, sculpting updates the shadows live, and `low` holds the frame rate on an older PC.

### After the plan

These become cheap once the steps are done, and are not part of them:

- a **Look editor** (colour pickers and sliders that update the 3D view live, undone through the design store);
- the game loading a bundle through `terrain/course/` and drawing it with `terrain/`;
- the game's own tree models replacing the look's primitive-based ones;
- landmark models (clubhouse and so on) as shadow casters; wind, and tree level-of-detail.

### Order and risk

- Steps 0 and 1 are safe and can go first.
- Step 2 touches every shader but changes no text, which is why it comes first among the engine steps and has the smoke
  check. Step 3 is the one that changes the bundle format and the one most worth reviewing closely: it changes what the game
  will read. Doing it second means every later step builds on data-driven shaders.
- Steps 4 to 6 are mostly moves. The risk is the renderer split in step 5; it keeps the same public surface and gets a
  visual check.
- Steps 7 to 11 are mechanical moves and import rewrites, guarded by the architecture test and the 182 existing tests.
- Step 12 is the only step with a new look, and it is last so it is built into the passes, not retrofitted.
- Doing this before the Hi-res, Greens and Landmarks editors means each new editor is written into the new layout, not
  moved later.

### Out of scope

- Steps 0 to 11 add no features and change nothing visible. Culling, the sand speckle and the sliders keep working as they
  are.
- No WebGPU, no general-purpose engine features (3.1).
- No change to the Python compiler beyond the `Look` model and writing it into `course.json`.
