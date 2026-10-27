# Baked lighting

The course never moves and the sun is fixed in its look, so almost everything about how the ground is lit can be worked out
once and looked up, as the Source engine's lightmaps do. This replaces the per-frame shadow maps and the ray march for the
ground, makes ambient light real (sky and occlusion, not a flat multiply), and gives shadows a fixed, high resolution
everywhere instead of three view-fitted maps.

Status: built (steps 1 to 4, and the cleanup in step 5 except the sculpt re-bake, which is unit-tested but was not exercised in the app). Each step was built, checked with tests, and photographed in the running app before the next. What was found along the way is under each step.

## The lighting model

Today a shadow multiplies the colour by a cool tint. That is the same as saying shadowed ground gets only the ambient light,
so the model is made explicit. With `A = 1 - strength * (1 - tint)` (the look's existing `shadows` fields; shadowed ground
is lit as `A`):

    ground light = (1 - A) * sunVisibility  +  A * skyVisibility

- `(1 - A)` is the sun: warm, because the look's tint is cool. `A` is the sky: cool.
- Open, lit ground has both visibilities 1, so the light is exactly 1 and **every existing colour stays as it is**.
- `sunVisibility` (0 to 1) is baked: terrain and trees, with a penumbra that widens with the blocker's distance.
- `skyVisibility` (0 to 1) is baked: how much sky the terrain and the trees leave open. It darkens hollows, bunkers, banks and
  the ground under woods, and its bent normal (the average open direction) steers the sky's light.
- The stylised slope shading (`Shading`, `Relief x`) stays: it multiplies the sun's share, because only the sun has a direction.
  (Built first as a multiplier of the whole light, with a curvature cue for hollows; the cue was removed for being noise, and the
  slope now shades the sun's share only. See frontend-architecture.md.)

No new look fields are needed. The sun's softness already exists (`shadows.softness`).

## What is baked, and where it lives

`terrain/lighting/`, on the GPU when a course loads (the same way as `terrain/relief/`), so there is one implementation, the
bundle does not grow, and a brush stroke re-bakes just its box.

| Texture | Resolution | Holds |
| --- | --- | --- |
| `sky` | the height grid (1 m) | R: sky visibility; GB: bent normal (x, z) |
| `sun` | 0.5 m | R: sun visibility |

## Steps

1. **Sky visibility from the terrain.** For each height sample, march 16 directions across the height field to find how high
   the horizon is, and average. Store the visibility and the bent normal. The ground shader uses it for the sky's share of the
   light, replacing the curvature trick (`hollow`) for hollows. *Check:* tests for the CPU twin (flat ground is 1, a bowl is
   darker in the middle, a plane tilted away from a ridge is darker); a photo of a bunker and a hollow.
   *Found:* Augusta's ground is so gentle that terrain alone is at least 0.99 almost everywhere (mean 0.998), so this changes
   almost nothing yet. It is the base the trees are multiplied into. The bent normal in the plan was not stored: nothing reads it.
2. **Occlusion from trees.** Each tree is a sphere of canopy; the ground under it loses the sky it blocks, by the exact
   formula for a sphere's cosine-weighted solid angle. Added into `sky` as a second pass. *Check:* the CPU twin; a photo of
   the ground under woods. *Found:* this is where the visible gain is: woods and their edges are properly darker, fading into
   clearings. A crown is a cylinder (a sphere under-counts a tall pine badly), with coverage fading from half at the edge to all
   at the trunk so it is continuous.
3. **Sun visibility from the terrain.** A ray march of the height field toward the sun for each 0.5 m texel, with the sun's
   half-degree width giving a penumbra that grows with distance. Replaces the per-pixel march in the ground shader.
   *Check:* the CPU twin against the old one; a photo of a hill's shadow. *Found:* at the look's sun (57 degrees up) Augusta's
   terrain never shades itself, so this shows only with a lower sun (at 12 degrees about 2.4% of the course is in terrain shade).
4. **Sun visibility from trees** (the high-quality, three-map look, baked). The map is cut into tiles, each rendered with its
   own orthographic depth map from the sun at a fixed density (about 12 cm a texel), sampled with a penumbra that widens with
   the distance to the tree's crown. It uses the existing tree depth pass. Because it is baked, quality is the same
   everywhere, not three bands. *Check:* a photo of tree shadows near and far. *Found:* shadows of individual trees are crisp and consistent from near and far,
   where the three view-fitted maps changed density with distance.
5. **Brush updates, cleanup and docs.** A brush stroke re-bakes the sky, the terrain shadow and the tree shadows in its box (the
   tree shadows a tile at a time, the tiles the box touches). The ground and tufts stop using the runtime shadow maps and the ray
   march when the bake is there; the maps stay for trees shading other trees, and as the fallback where a GPU cannot render the
   bake. The panel's Shadows setting says so. *Not exercised in the app:* the safety check blocked sculpting there, as it writes the bundle.

## Deliberately left out

- **Linear-space lighting and tone mapping.** It changes the look of every colour and needs a palette decision, so it is a
  separate step to decide together.
- **One-bounce colour and leaf translucency.** Small gains for their cost.
- **Probes for the ball and players.** The baked textures can be read at a point for them; that waits for the game.
