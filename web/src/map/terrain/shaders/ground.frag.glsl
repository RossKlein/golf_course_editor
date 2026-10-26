#include "head.glsl"
#include "height.glsl"
#include "overlays.glsl"
#include "look.glsl"

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

// the ground in the game's look: the four nearest class cells blended, with the edge wobbled by the grass texture so
// surfaces meet the way mown grass does rather than along a ruler. shade comes back as how much the relief shading applies
// here and speckle as how much a dark and a pale grain change the colour, each blended across the surfaces' edges like the colour
vec3 gameGround(vec2 p, out float shade, out vec2 speckle) {
  vec3 grain = texture(uTile, p / uTileMetres).rgb / uTileAvg;
  float patchy = texture(uTile, p / (uTileMetres * 0.7) + 0.11).g / uTileAvg.g;
  vec2 wobble = (texture(uTile, p / (uTileMetres * 3.0) + 0.37).rg - 0.5) * uWobble * uClassInfo.x;
  vec2 q = (p + wobble) / uClassInfo.x - 0.5;
  ivec2 c0 = ivec2(floor(q));
  vec2 f = fract(q);
  vec3 s00 = surfaceColour(classCell(c0), p, grain, patchy);
  vec3 s10 = surfaceColour(classCell(c0 + ivec2(1, 0)), p, grain, patchy);
  vec3 s01 = surfaceColour(classCell(c0 + ivec2(0, 1)), p, grain, patchy);
  vec3 s11 = surfaceColour(classCell(c0 + ivec2(1, 1)), p, grain, patchy);
  int k00 = clamp(int(classCell(c0).r + 0.5), 0, SURFACES - 1);
  int k10 = clamp(int(classCell(c0 + ivec2(1, 0)).r + 0.5), 0, SURFACES - 1);
  int k01 = clamp(int(classCell(c0 + ivec2(0, 1)).r + 0.5), 0, SURFACES - 1);
  int k11 = clamp(int(classCell(c0 + ivec2(1, 1)).r + 0.5), 0, SURFACES - 1);
  shade = mix(mix(surfaceShade(k00), surfaceShade(k10), f.x), mix(surfaceShade(k01), surfaceShade(k11), f.x), f.y);
  speckle = mix(mix(surfaceSpeckle(k00), surfaceSpeckle(k10), f.x), mix(surfaceSpeckle(k01), surfaceSpeckle(k11), f.x), f.y);
  return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
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
  if (uSlope > 0.5) col = mix(col, slopeColour(length(g)) * (0.55 + 0.45 * clamp(light, 0.0, 1.0)), 0.7);
  if (uContour > 0.0) col *= 1.0 - contourDarkening(ground, uContour);

  if (onDrape) {
    vec4 lines = texture(uLines, drapeUv);
    col = col * (1.0 - lines.a * uLineAlpha) + lines.rgb * uLineAlpha;
  }

  outColor = vec4(col, 1.0);
}
