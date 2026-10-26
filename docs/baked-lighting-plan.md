# Baked lighting

The course never moves and the sun is fixed in its look, so almost everything about how the ground is lit can be worked out
once and looked up, as the Source engine's lightmaps do. This replaces the per-frame shadow maps and the ray march for the
ground, makes ambient light real (sky and occlusion, not a flat multiply), and gives shadows a fixed, high resolution
everywhere instead of three view-fitted maps.

Status: planned. Each step below is built, checked with tests, and photographed in the running app before the next.

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
2. **Occlusion from trees.** Each tree is a sphere of canopy; the ground under it loses the sky it blocks, by the exact
   formula for a sphere's cosine-weighted solid angle. Added into `sky` as a second pass. *Check:* the CPU twin; a photo of
   the ground under woods.
3. **Sun visibility from the terrain.** A ray march of the height field toward the sun for each 0.5 m texel, with the sun's
   half-degree width giving a penumbra that grows with distance. Replaces the per-pixel march in the ground shader.
   *Check:* the CPU twin against the old one; a photo of a hill's shadow.
4. **Sun visibility from trees** (the high-quality, three-map look, baked). The map is cut into tiles, each rendered with its
   own orthographic depth map from the sun at a fixed density (about 12 cm a texel), sampled with a penumbra that widens with
   the distance to the tree's crown. It uses the existing tree depth pass. Because it is baked, quality is the same
   everywhere, not three bands. *Check:* a photo of tree shadows near and far.
5. **Brush updates, cleanup and docs.** A brush stroke re-bakes the sky and terrain shadow in its box as it goes (they only
   depend on the heights), and the tree shadows when it ends. The ground and tufts stop using the runtime shadow pass and the
   ray march; it stays only for trees shading other trees. The panel's Shadows setting becomes that. Docs and tests updated.

## Deliberately left out

- **Linear-space lighting and tone mapping.** It changes the look of every colour and needs a palette decision, so it is a
  separate step to decide together.
- **One-bounce colour and leaf translucency.** Small gains for their cost.
- **Probes for the ball and players.** The baked textures can be read at a point for them; that waits for the game.
