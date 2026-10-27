# `src/terrain`

## Purpose

The golf renderer, built on `gfx/`. It draws a course from a height grid, the class map and the course's look, flat for the 2D map or as a 3D landscape. It will be the game's renderer too, so it imports no React, no OpenLayers and nothing about the design document or the editors.

## Shape

`terrain.ts` (`TerrainRenderer`) assembles the pieces and is the one thing the rest of the app talks to. Each pass reads a shared `World` (see `world.ts`).

| Folder | Role |
| --- | --- |
| `heightfield/` | the baked heights on the GPU, plus the sculpt offsets; the one place heights are bound |
| `lighting/` | the ground's baked lighting: how much sky (terrain, then trees' crowns) and how much sun (terrain, then trees' shadows tile by tile) reaches each point, as textures the ground and grass look up; `bake.ts` is the shared full-screen-pass texture, and each bake has a CPU twin (`skyMath`, `canopyMath`, `sunMath`, `tileLight`) with the tests |
| `relief/` | the ground's slope, spline-smoothed and baked into a texture for lighting: `reliefMath.ts` is the maths (and its tests), `relief.frag.glsl` the GPU bake, `relief.ts` the texture, re-baked for just the box a brush changed |
| `surfaces/` | the class map, mowing stripe directions, the grass tile, the sand speckle, `blend.ts`, the maths of how surfaces meet (the ground shader does the same sums), and `edgeMask.ts`, which finds where there is no edge to smooth |
| `passes/flat/` | the map's hillshade, contours, slope colours (and a CPU fallback) |
| `passes/ground/` | the 3D ground: rings of mesh out to the horizon, lit and coloured per pixel |
| `passes/tufts/`, `passes/trees/` | standing grass and trees, instanced, culled to the view |
| `passes/shadow/` | the sun's shadow maps: slices of the view each with a map, trees drawn into them from the sun, and the ground's own shadow by a ray march (`selfShadow.ts` is its CPU twin) |
| `passes/drape/` | the aerial and the design's painted overlays |
| `sculpt/` | the GPU brush, the offset tiles, the delta format (editor only) |
| `scenery/` | where trees are, and tree models built from the look |
| `camera/` | the orbit camera, the windows of ground that mesh and drape cover, and picking the ground under a screen point (`pick.ts`) |
| `look/` | the course's look as uniforms; `course/` loads a course's files; `theme.ts` is the editor's own colours |
| `shaders/` | the shared GLSL chunks and each program's finished source |

## Rules

- **Data, not literals.** A colour, a size in metres or a rule about a surface is the course's look, loaded from the bundle (`look/look.ts`, `shaders/look.glsl`). A test fails on a colour literal in a `.glsl` file. Engine limits (quality and safety caps) are named in `limits.ts`; editor aids (slope palette, contour strength) are the theme.
- **Culling next to what it culls.** What a pass decides before drawing (which tuft tiles, which tree chunks) is a pure function in the pass's folder, with a test.
- **Pure first.** Camera maths, brush maths, tile selection and tree scatter run without a GPU and are unit-tested.
- A pass owns its programs and buffers and nothing else.
