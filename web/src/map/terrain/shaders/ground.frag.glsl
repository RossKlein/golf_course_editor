#include "head.glsl"
#include "height.glsl"
#include "overlays.glsl"

uniform vec3 uSunDir;       // towards the sun: x east, y up, z south
uniform float uSpacing;
uniform float uContour;
uniform float uSlope;
uniform float uRelief;      // exaggeration of the relief shading, as for the map
uniform float uShading;     // how strongly the shading shows, 1 for the map's look
uniform vec3 uSpeckle;      // where sand is speckled: the ground point looked at (x, z) and how far out, the same as the grass

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
  int cls = int(cell.r + 0.5);
  int hole = clamp(int(cell.g + 0.5) - 1, 0, 23);
  vec3 fairwayA = vec3(0.50, 0.86, 0.30), fairwayB = vec3(0.66, 0.95, 0.44);
  vec3 rough = vec3(0.40, 0.65, 0.24); // darker than the fairway
  vec3 a = rough, b = rough;
  float stripe = 0.0, amount = 1.0;
  if (cls == 1) { a = fairwayA; b = fairwayB; stripe = 2.4; amount = 0.55; }
  else if (cls == 2) { a = vec3(0.60, 0.92, 0.38); b = a; amount = 0.3; } // plain: no stripes on a green
  else if (cls == 3) { a = vec3(0.52, 0.82, 0.30); b = vec3(0.60, 0.88, 0.36); stripe = 0.9; amount = 0.35; }
  else if (cls == 4) { a = vec3(0.64, 0.94, 0.42); b = a; amount = 0.35; } // plain: no stripes on a tee
  else if (cls == 5) { a = vec3(0.965, 0.93, 0.81); b = a; amount = 0.4; } // sand, half way to white
  else if (cls == 6) { a = vec3(0.27, 0.60, 0.86); b = a; amount = 0.15; }
  else if (cls == 7) { a = vec3(0.72, 0.66, 0.52); b = a; amount = 0.4; }
  else if (cls == 8) { // forest floor: the rough's green mottled with brown earth
    a = mix(rough, vec3(0.42, 0.31, 0.20), clamp(0.5 + (patchy - 1.0) * 1.6, 0.15, 0.85));
    b = a;
    amount = 0.8;
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
// surfaces meet the way mown grass does rather than along a ruler. sand comes back as how much of the point is bunker,
// 0 to 1, so the lighting can be eased off there
vec3 gameGround(vec2 p, out float sand) {
  vec3 grain = texture(uTile, p / uTileMetres).rgb / uTileAvg;
  float patchy = texture(uTile, p / (uTileMetres * 0.7) + 0.11).g / uTileAvg.g;
  vec2 wobble = (texture(uTile, p / (uTileMetres * 3.0) + 0.37).rg - 0.5) * 0.9 * uClassInfo.x;
  vec2 q = (p + wobble) / uClassInfo.x - 0.5;
  ivec2 c0 = ivec2(floor(q));
  vec2 f = fract(q);
  vec3 s00 = surfaceColour(classCell(c0), p, grain, patchy);
  vec3 s10 = surfaceColour(classCell(c0 + ivec2(1, 0)), p, grain, patchy);
  vec3 s01 = surfaceColour(classCell(c0 + ivec2(0, 1)), p, grain, patchy);
  vec3 s11 = surfaceColour(classCell(c0 + ivec2(1, 1)), p, grain, patchy);
  float k00 = abs(classCell(c0).r - 5.0) < 0.5 ? 1.0 : 0.0;
  float k10 = abs(classCell(c0 + ivec2(1, 0)).r - 5.0) < 0.5 ? 1.0 : 0.0;
  float k01 = abs(classCell(c0 + ivec2(0, 1)).r - 5.0) < 0.5 ? 1.0 : 0.0;
  float k11 = abs(classCell(c0 + ivec2(1, 1)).r - 5.0) < 0.5 ? 1.0 : 0.0;
  sand = mix(mix(k00, k10, f.x), mix(k01, k11, f.x), f.y);
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

  vec3 albedo = vec3(0.42, 0.55, 0.30);
  vec2 aerialUv = (p - uAerialRect.xy) / uAerialRect.zw;
  if (uGame > 0.5) {
    float sand;
    albedo = gameGround(p, sand);
    // a bunker's dip would otherwise darken it as a hollow; sand keeps its colour, with a trace of shape at the lip
    light = mix(light, 1.0 + (light - 1.0) * 0.12, sand);
    // salt and pepper, some grains paler and some darker, from a mipmapped texture so it changes smoothly with distance.
    // Averaging washes it out as grains shrink below a pixel, so its contrast is raised by the square root of the grains
    // a pixel covers, which puts back what the averaging took. It fades out towards the grass range.
    float footprint = max(fwidth(p.x), fwidth(p.y));
    float gain = clamp(footprint / SPECKLE_GRAIN, 1.0, 12.0);
    float speck = clamp((texture(uSpeckleTex, p / (SPECKLE_GRAIN * float(SPECKLE_SIZE))).r - 0.5) * 2.0 * gain, -1.0, 1.0);
    float visible = 1.0 - smoothstep(0.7 * uSpeckle.z, uSpeckle.z, distance(p, uSpeckle.xy));
    albedo *= 1.0 + sand * visible * (speck < 0.0 ? speck * 0.1 : speck * 0.07);
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
