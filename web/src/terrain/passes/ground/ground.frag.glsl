#include "head.glsl"
#include "height.glsl"
#include "overlays.glsl"
#include "look.glsl"
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
uniform float uEdge;        // metres across the soft blend between two surfaces: 0 is one pixel
uniform vec3 uBare;         // the ground's colour with no aerial and no game look (the editor's theme)

uniform sampler2D uAerial;
uniform vec4 uAerialRect;   // course metres: x, z of the image's top-left corner, width, height
uniform float uUseAerial;

// the game's look: the surface under each point, from the class map, in the game's flat bright greens
uniform sampler2D uClassMap;  // nearest: r = surface class, g = owning hole
uniform vec3 uClassInfo;      // metres per cell, columns, rows
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

// cubic B-spline weights of the four cells around a point, t being its place between the middle two (blend.ts is the same maths)
vec4 bspline(float t) {
  float t2 = t * t, t3 = t2 * t;
  return vec4(1.0 - 3.0 * t + 3.0 * t2 - t3, 4.0 - 6.0 * t2 + 3.0 * t3, 1.0 + 3.0 * t + 3.0 * t2 - 3.0 * t3, t3) / 6.0;
}

// The weight difference across a straight edge changes by 1.5 a cell, so a blend of the given metres spans this much of it on
// either side of the line (blend.ts has the same)
float edgeWidth(float metres, float cellMetres) {
  return 0.75 * metres / cellMetres;
}

// How much of the heaviest surface to show, 0.5 to 1, from the weight difference d (0 on the line between two surfaces, 1 far
// from any). The blend is a smoothstep across width either side of the line, rescaled so d = 1 is always all of it: a wide blend
// would otherwise leave a little of a surface that is not there in every pure area. blend.ts is the same
float blendShare(float d, float width) {
  float top = smoothstep(-width, width, 1.0);
  return 0.5 + 0.5 * (smoothstep(-width, width, d) - 0.5) / (top - 0.5);
}

// the ground in the game's look. The class map is one surface per cell, so a slanted edge is a staircase of cells. Each
// surface's weight is spread over the sixteen nearest cells with a B-spline, which turns the staircase into a smooth curve,
// and the two heaviest surfaces are blended across the line where their weights are equal, as narrowly as a pixel (and the
// look's edge) allows. The edge is wobbled by the grass texture so surfaces meet the way mown grass does rather than along
// a ruler. shade comes back as how much the relief shading applies here and speckle as how much a dark and a pale grain
// change the colour, each blended between the two surfaces like the colour
vec3 gameGround(vec2 p, out float shade, out vec2 speckle) {
  vec3 grain = texture(uTile, p / uTileMetres).rgb / uTileAvg;
  float patchy = texture(uTile, p / (uTileMetres * 0.7) + 0.11).g / uTileAvg.g;
  vec2 wobble = (texture(uTile, p / (uTileMetres * 3.0) + 0.37).rg - 0.5) * uWobble * uClassInfo.x;
  vec2 q = (p + wobble) / uClassInfo.x - 0.5;
  ivec2 c0 = ivec2(floor(q));
  vec2 f = fract(q);
  vec4 wx = bspline(f.x), wy = bspline(f.y);

  float weight[SURFACES];
  for (int k = 0; k < SURFACES; k++) weight[k] = 0.0;
  vec2 cell[16];          // each nearby cell's surface and hole
  float cellWeight[16];
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      int n = j * 4 + i;
      cell[n] = classCell(c0 + ivec2(i - 1, j - 1)).rg;
      cellWeight[n] = wx[i] * wy[j];
      weight[clamp(int(cell[n].x + 0.5), 0, SURFACES - 1)] += cellWeight[n];
    }
  }

  // the heaviest surface a and the runner-up b
  int a = 0, b = 0;
  float wa = -1.0, wb = -1.0;
  for (int k = 0; k < SURFACES; k++) {
    if (weight[k] > wa) { wb = wa; b = a; wa = weight[k]; a = k; }
    else if (weight[k] > wb) { wb = weight[k]; b = k; }
  }
  float d = wa - wb;
  float width = max(fwidth(d) * 0.75, edgeWidth(uEdge, uClassInfo.x)); // in units of the weight difference
  float share = width > 0.0 ? blendShare(d, width) : (d > 0.0 ? 1.0 : 0.5);

  // each surface takes its hole from the nearest cell of that surface, for the direction of its stripes
  vec4 ca = vec4(float(a), 0.0, 0.0, 0.0), cb = vec4(float(b), 0.0, 0.0, 0.0);
  float ba = -1.0, bb = -1.0;
  for (int n = 0; n < 16; n++) {
    int k = clamp(int(cell[n].x + 0.5), 0, SURFACES - 1);
    if (k == a && cellWeight[n] > ba) { ba = cellWeight[n]; ca.xy = cell[n]; }
    if (k == b && cellWeight[n] > bb) { bb = cellWeight[n]; cb.xy = cell[n]; }
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

  // Golf ground is gentle, so true lighting barely shows. Light it the way the map does, with the relief exaggerated,
  // and add the cue the eye uses for subtle contours: hollows a little darker, crests a little lighter. Both multiply
  // the aerial, whose own light is left alone on flat ground. Wider steps on a coarser mesh stop distant ground sparkling.
  float s = max(0.35, 0.5 * uSpacing);
  vec2 g = gradientAt(p, s);
  vec3 lit = normalize(vec3(-g.x * uRelief, 1.0, -g.y * uRelief));
  float facing = clamp(dot(lit, uSunDir), 0.0, 1.0) - uSunDir.y; // 0 on the flat, up facing the sun, down facing away
  float hollow = clamp(-curvatureAt(p, max(1.0, 0.75 * uSpacing)) * 2.0 * uRelief, -0.3, 0.3);
  float light = clamp(1.0 + uShading * (0.6 * facing + hollow), 0.3, 1.7);

  vec3 albedo = uBare;
  vec2 aerialUv = (p - uAerialRect.xy) / uAerialRect.zw;
  if (uGame > 0.5) {
    float shade;
    vec2 speckle;
    albedo = gameGround(p, shade, speckle);
    // a bunker's dip would otherwise darken it as a hollow: a surface says how much of the relief shading it takes
    light = 1.0 + (light - 1.0) * shade;
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

  vec3 col = albedo * light;
  // the sun's shadows: trees from the shadow map, and (at high quality) the ground's own from the height field
  vec3 world = vec3(p.x, ground * uScale, p.y);
  float shadow = shadowMapAt(world, normalize(vec3(-g.x * uScale, 1.0, -g.y * uScale)), true);
  if (uShadowMode.x > 0.5) shadow = 1.0 - (1.0 - shadow) * (1.0 - terrainShadow(p, ground));
  col = applyShadow(col, shadow);
  if (uSlope > 0.5) col = mix(col, slopeColour(length(g)) * (0.55 + 0.45 * clamp(light, 0.0, 1.0)), 0.7);
  if (uContour > 0.0) col *= 1.0 - contourDarkening(ground, uContour);

  if (onDrape) {
    vec4 lines = texture(uLines, drapeUv);
    col = col * (1.0 - lines.a * uLineAlpha) + lines.rgb * uLineAlpha;
  }

  outColor = vec4(col, 1.0);
}
