#include "head.glsl"
#include "height.glsl"
#include "overlays.glsl"
#include "look.glsl"
#include "lighting.glsl"
#include "shadow.glsl"

uniform float uScale;       // vertical exaggeration of the geometry
uniform vec3 uSunDir;       // towards the sun: x east, y up, z south
uniform float uSpacing;
uniform float uContour;
uniform float uSlope;
uniform float uRelief;      // exaggeration of the relief shading, as for the map
uniform float uShading;     // how strongly the shading shows, 1 for the map's look
uniform vec3 uSpeckle;      // where speckle shows: the ground point looked at (x, z) and how far out, the same as the grass
uniform float uSpeckleGrain; // metres across one grain of speckle
uniform float uWobble;      // how far the grass texture wobbles the edges of surfaces, in class cells
uniform vec3 uBare;         // the ground's colour with no aerial and no game look (the editor's theme)

uniform sampler2D uAerial;
uniform vec4 uAerialRect;   // course metres: x, z of the image's top-left corner, width, height
uniform float uUseAerial;

// the game's look: the surface under each point, from the class map, in the game's flat bright greens
uniform sampler2D uClassMap;  // nearest: r = surface class, g = owning hole
uniform vec3 uClassInfo;      // metres per cell, columns, rows
uniform sampler2D uEdgeMask;   // nearest: 255 for each block of EDGE_BLOCK cells that is near an edge between surfaces
uniform float uSmoothing;     // metres the surface edges are smoothed over, either side of the line
uniform sampler2D uTile;      // seamless grass, tiled over everything
uniform vec3 uTileAvg;        // its average colour, so tinting does not change the brightness
uniform sampler2D uSpeckleTex; // salt and pepper for sand, mipmapped: one byte a grain, 128 plain, 0 dark, 255 pale
uniform float uTileMetres;    // ground one tile covers
uniform vec2 uStripe[24];     // per hole: unit direction across its mowing stripes
uniform float uGame;          // 1 for the game's look

// what the design draws over the ground; premultiplied, covering one square of the course
uniform sampler2D uFill;
uniform sampler2D uLines;
uniform vec4 uDrapeRect;
uniform float uFillAlpha;
uniform float uLineAlpha;

in vec2 vXZ;
out vec4 outColor;

bool inside(vec2 uv) { return uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0; }

vec4 classCell(ivec2 c) {
  c = clamp(c, ivec2(0), ivec2(int(uClassInfo.y), int(uClassInfo.z)) - 1);
  return texelFetch(uClassMap, c, 0) * 255.0;
}

// one surface's colour at a point: mown surfaces are striped across the line of play, every surface has grass grain.
// patchy is slow variation from the grass texture, used to mottle the forest floor.
vec3 surfaceColour(vec4 cell, vec2 p, vec3 grain, float patchy) {
  int cls = clamp(int(cell.r + 0.5), 0, SURFACES - 1);
  int hole = clamp(int(cell.g + 0.5) - 1, 0, 23);
  vec3 a = surfaceColor(cls), b = surfaceColor2(cls);
  float stripe = surfaceStripe(cls), amount = surfaceGrain(cls);
  float mottle = surfaceMottle(cls);
  if (mottle > 0.0) { // mottled with earth, as the forest floor is
    a = mix(a, surfaceEarth(cls), clamp(0.5 + (patchy - 1.0) * mottle, 0.15, 0.85));
    b = a;
  }
  vec3 base = a;
  if (stripe > 0.0) {
    // a surface with no hole yet is still striped, across x
    vec2 across = cell.g > 0.5 ? uStripe[hole] : vec2(1.0, 0.0);
    base = mix(a, b, mod(floor(dot(p, across) / stripe), 2.0));
  }
  return base * mix(vec3(1.0), grain, amount);
}

// the cubic B-spline basis: a bump 4 wide, 2/3 high in the middle (blend.ts is the same maths)
float bspline(float x) {
  float a = abs(x);
  if (a < 1.0) return (4.0 - 6.0 * a * a + 3.0 * a * a * a) / 6.0;
  if (a < 2.0) { float b = 2.0 - a; return b * b * b / 6.0; }
  return 0.0;
}

// How much of the heaviest surface to show, 0.5 to 1, from the weight difference d (0 on the line between two surfaces, 1 far
// from any). A smoothstep across width either side of the line, rescaled so d = 1 is always all of it: a pixel that covers
// many cells (far away) would otherwise leave a little of a surface that is not there in every pure area. blend.ts is the same
float blendShare(float d, float width) {
  float top = smoothstep(-width, width, 1.0);
  return 0.5 + 0.5 * (smoothstep(-width, width, d) - 0.5) / (top - 0.5);
}

// the ground in the game's look. The class map is one surface per cell, so a slanted edge is a staircase of cells and a curved
// one is a staircase with ripples. Each surface's weight is averaged over the cells around the point with a cubic B-spline,
// uSmoothing metres either side, which turns that into a smooth curve (the wider, the bigger and rounder the curves); the two
// heaviest surfaces are then told apart across the line where their weights are equal, as narrowly as a pixel allows: a clean
// edge, not a blend. Far from any edge (the mask says) there is nothing to average and the one cell under the point is the
// answer. shade comes back as how much the relief shading applies here and speckle as how much a dark and a pale grain change
// the colour, each taken from the surface shown like the colour
vec3 gameGround(vec2 p, out float shade, out vec2 speckle) {
  vec3 grain = texture(uTile, p / uTileMetres).rgb / uTileAvg;
  float patchy = texture(uTile, p / (uTileMetres * 0.7) + 0.11).g / uTileAvg.g;
  vec2 wobble = (texture(uTile, p / (uTileMetres * 3.0) + 0.37).rg - 0.5) * uWobble * uClassInfo.x;
  vec2 here = (p + wobble) / uClassInfo.x;      // in cells; a cell's centre is at its index plus a half
  ivec2 under = ivec2(floor(here));             // the cell the point is in
  ivec2 block = clamp(under / EDGE_BLOCK, ivec2(0), textureSize(uEdgeMask, 0) - 1);

  if (texelFetch(uEdgeMask, block, 0).r < 0.5) {
    vec4 cell = classCell(under);
    int k = clamp(int(cell.r + 0.5), 0, SURFACES - 1);
    shade = surfaceShade(k);
    speckle = surfaceSpeckle(k);
    return surfaceColour(vec4(cell.rg, 0.0, 0.0), p, grain, patchy);
  }

  vec2 q = here - 0.5;
  ivec2 c0 = ivec2(floor(q));
  float scale = max(1.0, uSmoothing / (2.0 * uClassInfo.x)); // cells to the unit of the spline
  int taps = min(2 * int(ceil(2.0 * scale)), EDGE_TAPS_MAX);
  ivec2 start = c0 - taps / 2 + 1;

  float weight[SURFACES];
  for (int k = 0; k < SURFACES; k++) weight[k] = 0.0;
  float total = 0.0;
  for (int j = 0; j < EDGE_TAPS_MAX; j++) {
    if (j >= taps) break;
    float wy = bspline((float(start.y + j) - q.y) / scale);
    for (int i = 0; i < EDGE_TAPS_MAX; i++) {
      if (i >= taps) break;
      float w = bspline((float(start.x + i) - q.x) / scale) * wy;
      weight[clamp(int(classCell(start + ivec2(i, j)).r + 0.5), 0, SURFACES - 1)] += w;
      total += w;
    }
  }

  // the heaviest surface a and the runner-up b
  int a = 0, b = 0;
  float wa = -1.0, wb = -1.0;
  for (int k = 0; k < SURFACES; k++) {
    if (weight[k] > wa) { wb = wa; b = a; wa = weight[k]; a = k; }
    else if (weight[k] > wb) { wb = weight[k]; b = k; }
  }
  float d = (wa - wb) / total;
  float width = fwidth(d) * 0.75; // the edge is as narrow as a pixel: a clean line, antialiased, not a blend
  float share = width > 0.0 ? blendShare(d, width) : (d > 0.0 ? 1.0 : 0.5);

  // each surface takes its hole from the nearest of the cells around the point that has it, for the direction of its stripes
  vec4 ca = vec4(float(a), 0.0, 0.0, 0.0), cb = vec4(float(b), 0.0, 0.0, 0.0);
  float da = 1e9, db = 1e9;
  for (int dz = -1; dz <= 1; dz++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 n = under + ivec2(dx, dz);
      vec2 cell = classCell(n).rg;
      int k = clamp(int(cell.x + 0.5), 0, SURFACES - 1);
      float dist = distance(vec2(n) + 0.5, here);
      if (k == a && dist < da) { da = dist; ca.xy = cell; }
      if (k == b && dist < db) { db = dist; cb.xy = cell; }
    }
  }
  vec3 colour = surfaceColour(ca, p, grain, patchy);
  shade = surfaceShade(a);
  speckle = surfaceSpeckle(a);
  if (share < 1.0) {
    float other = 1.0 - share;
    colour = mix(colour, surfaceColour(cb, p, grain, patchy), other);
    shade = mix(shade, surfaceShade(b), other);
    speckle = mix(speckle, surfaceSpeckle(b), other);
  }
  return colour;
}

// How much the ground shades itself at a point, 0 to 1: steps along the ray to the sun and compares its height with the
// ground under it. selfShadow.ts is the same maths for tests; both use SELF_SHADOW_STEPS and SELF_SHADOW_REACH.
float terrainShadow(vec2 p, float groundHeight) {
  if (uSunDir.y <= 0.001) return 1.0;
  float y0 = groundHeight * uScale + 0.15;
  float lit = 1.0;
  for (int i = 1; i <= SELF_SHADOW_STEPS; i++) {
    float f = float(i) / float(SELF_SHADOW_STEPS);
    float t = float(SELF_SHADOW_REACH) * f * f;
    float clearance = y0 + uSunDir.y * t - heightAt(p + uSunDir.xz * t).x * uScale;
    lit = min(lit, clamp(clearance / (0.06 * t + 0.25), 0.0, 1.0));
  }
  return 1.0 - lit;
}

void main() {
  vec2 p = vXZ;
  if (!onGrid(p)) discard;
  float ground = heightAt(p).x;

  // Golf ground is gentle, so true lighting barely shows. Light it the way the map does, with the slope exaggerated (uRelief).
  // The slope is the baked, spline-smoothed relief, so it is smooth and the same at every distance (mipmaps average it far away).
  // Only the sun has a direction, so the slope shades only the sun's share of the light (see applyLight): slope is 1 on the flat,
  // up where the ground faces the sun and down where it faces away. There is no cue for hollows and crests: it came from the
  // curvature of the heights, which is mostly noise, and it ringed every mound with dark at its foot and bright on its rim.
  vec2 g = reliefAt(p, max(0.35, 0.5 * uSpacing));
  vec3 lit = normalize(vec3(-g.x * uRelief, 1.0, -g.y * uRelief));
  float facing = clamp(dot(lit, uSunDir), 0.0, 1.0) - uSunDir.y; // 0 on the flat, up facing the sun, down facing away
  float slope = clamp(1.0 + uShading * 0.6 * facing, 0.3, 1.7);

  vec3 albedo = uBare;
  vec2 aerialUv = (p - uAerialRect.xy) / uAerialRect.zw;
  if (uGame > 0.5) {
    float shade;
    vec2 speckle;
    albedo = gameGround(p, shade, speckle);
    // a surface says how much of the slope shading it takes (every surface takes all of it unless its look says otherwise)
    slope = 1.0 + (slope - 1.0) * shade;
    // salt and pepper, some grains paler and some darker, from a mipmapped texture so it changes smoothly with distance.
    // Averaging washes it out as grains shrink below a pixel, so its contrast is raised by the square root of the grains
    // a pixel covers, which puts back what the averaging took. It fades out towards the grass range.
    float footprint = max(fwidth(p.x), fwidth(p.y));
    float gain = clamp(footprint / uSpeckleGrain, 1.0, 12.0);
    float speck = clamp((texture(uSpeckleTex, p / (uSpeckleGrain * float(SPECKLE_SIZE))).r - 0.5) * 2.0 * gain, -1.0, 1.0);
    float visible = 1.0 - smoothstep(0.7 * uSpeckle.z, uSpeckle.z, distance(p, uSpeckle.xy));
    albedo *= 1.0 + visible * (speck < 0.0 ? speck * speckle.x : speck * speckle.y);
  }
  else if (uUseAerial > 0.5 && inside(aerialUv)) albedo = texture(uAerial, aerialUv).rgb;

  vec2 drapeUv = (p - uDrapeRect.xy) / uDrapeRect.zw;
  bool onDrape = inside(drapeUv);
  if (onDrape) {
    vec4 fill = texture(uFill, drapeUv);
    albedo = albedo * (1.0 - fill.a * uFillAlpha) + fill.rgb * uFillAlpha;
  }

  vec3 col = albedo;
  // the sun's shadows: trees from the shadow map, and (at high quality) the ground's own from the height field
  vec3 world = vec3(p.x, ground * uScale, p.y);
  // the sun's shadows on the ground, terrain and trees, are baked (see terrain/lighting). Without the bake it looks them up in the
  // maps of the view and marches its own
  float shadow;
  if (uSunOn > 0.5) shadow = 1.0 - sunVisibilityAt(p);
  else {
    shadow = shadowMapAt(world, normalize(vec3(-g.x * uScale, 1.0, -g.y * uScale)), true);
    if (uShadowMode.x > 0.5) shadow = 1.0 - (1.0 - shadow) * (1.0 - terrainShadow(p, ground));
  }
  col = applyLight(col, slope, shadow, skyVisibilityAt(p));
  if (uSlope > 0.5) col = mix(col, slopeColour(length(g)) * (0.55 + 0.45 * clamp(slope, 0.0, 1.0)), 0.7);
  if (uContour > 0.0) col *= 1.0 - contourDarkening(ground, uContour);

  if (onDrape) {
    vec4 lines = texture(uLines, drapeUv);
    col = col * (1.0 - lines.a * uLineAlpha) + lines.rgb * uLineAlpha;
  }

  outColor = vec4(col, 1.0);
}
