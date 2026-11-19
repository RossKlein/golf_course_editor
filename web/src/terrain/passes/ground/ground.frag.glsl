#include "head.glsl"
#include "height.glsl"
#include "overlays.glsl"
#include "look.glsl"
#include "lighting.glsl"
#include "shadow.glsl"
#include "noise.glsl"

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
uniform vec4 uEdge;           // where surfaces of different grass heights meet: metres across the step, how far the grass texture pushes the line, how dark the foot of the step is, how many times taller than it is the step is drawn
uniform sampler2D uTile;      // seamless grass, tiled over everything
uniform vec3 uTileAvg;        // its average colour, so tinting does not change the brightness
uniform sampler2D uBumpGrass;   // RG8: the slope of the grass tile's light and dark, east and south, in units of its rms over BUMP_RANGE, from 0 to 1
uniform sampler2D uBumpGrain;   // RG8: the same for grains (noise), for sand and paths
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

// How much of a layer of soil noise a pixel can still see: a layer finer than a pixel is not there
float soilVisible(float scale, float footprint) {
  return 1.0 - smoothstep(0.5 * scale, 1.5 * scale, footprint);
}

// How much of a forest floor is soil at a point, 0 for the ground's own colour to 1 for earth, where coverage is the share of the ground that
// is soil. Two masks, each a threshold of noise, so every edge is crisp: chunks of soil and of grass (layers of noise 30 and 12 cm across), and
// holes (layers 5 and 2 cm across, and the grass texture's own light and dark, so a hole has a blade's edge), which flip the colour wherever they
// are. So soil chunks have grass holes in them and grass chunks have soil holes, like a Swiss cheese. A layer finer than a pixel is dropped and
// the rest scaled back up to the same spread, so the shares do not change as the layers go; far off the holes are their share of the ground and
// the chunks are coverage. tex is the grass texture's green over its average, footprint the metres a pixel covers. soften widens every edge
// by that much of the noise's 0 to 1 range (0 for a forest floor's crisp edges; a lake's bed uses it to crumble in less sharply).
float soilEarth(vec2 p, float tex, float footprint, float coverage, float soften) {
  float chunkWeight0 = 0.6 * soilVisible(float(SOIL_GRAIN_METRES), footprint);
  float chunkWeight1 = 0.4 * soilVisible(float(SOIL_FINE_METRES), footprint);
  float chunkSum = chunkWeight0 * (valueNoise(p / float(SOIL_GRAIN_METRES) + vec2(31.7, 12.9)) - 0.5)
                 + chunkWeight1 * (valueNoise(p / float(SOIL_FINE_METRES) + vec2(57.3, 4.1)) - 0.5);
  float chunk = clamp(0.5 + float(SOIL_CONTRAST) * chunkSum / max(sqrt(chunkWeight0 * chunkWeight0 + chunkWeight1 * chunkWeight1), 0.05), 0.0, 1.0);
  float edgeChunk = 0.25 * footprint / float(SOIL_FINE_METRES) + 0.01 + soften; // about a pixel of the chunk's edge
  float soil = smoothstep(1.0 - coverage - edgeChunk, 1.0 - coverage + edgeChunk, chunk);

  float holeWeight0 = 0.3 * soilVisible(float(SOIL_FINER_METRES), footprint);
  float holeWeight1 = 0.3 * soilVisible(float(SOIL_FINEST_METRES), footprint);
  float holeSum = holeWeight0 * (valueNoise(p / float(SOIL_FINER_METRES) + vec2(83.9, 66.2)) - 0.5)
                + holeWeight1 * (valueNoise(p / float(SOIL_FINEST_METRES) + vec2(17.1, 91.6)) - 0.5)
                + 0.15 * (clamp(0.5 + (tex - 1.0) * 2.0, 0.0, 1.0) - 0.5);
  float hole = clamp(0.5 + float(SOIL_CONTRAST) * holeSum / sqrt(holeWeight0 * holeWeight0 + holeWeight1 * holeWeight1 + 0.0225), 0.0, 1.0);
  float edgeHole = 0.25 * footprint / float(SOIL_FINEST_METRES) + 0.01 + soften;
  float flipped = smoothstep(1.0 - float(SOIL_HOLE_SHARE) - edgeHole, 1.0 - float(SOIL_HOLE_SHARE) + edgeHole, hole);
  flipped = mix(flipped, float(SOIL_HOLE_SHARE), smoothstep(0.5 * float(SOIL_FINER_METRES), 1.5 * float(SOIL_FINER_METRES), footprint));

  float nearEarth = mix(soil, 1.0 - soil, flipped);
  float average = mix(coverage, 1.0 - coverage, float(SOIL_HOLE_SHARE));
  return mix(nearEarth, average, smoothstep(0.5 * float(SOIL_GRAIN_METRES), 1.5 * float(SOIL_GRAIN_METRES), footprint));
}

// one surface's colour at a point: mown surfaces are striped across the line of play, every surface has grass grain.
// soil is (the grass texture's green over its average here, the metres a pixel covers): what soilEarth needs, worked out only for a surface that is flecked.
vec3 surfaceColour(vec4 cell, vec2 p, vec3 grain, vec2 soil) {
  int cls = clamp(int(cell.r + 0.5), 0, SURFACES - 1);
  int hole = clamp(int(cell.g + 0.5) - 1, 0, 23);
  vec3 a = surfaceColor(cls), b = surfaceColor2(cls);
  float stripe = surfaceStripe(cls), amount = surfaceGrain(cls);
  float mottle = surfaceMottle(cls);
  if (mottle > 0.0) { // flecked with earth, as the forest floor is: each speck is the one colour or the other, with a crisp edge, not a blend
    float coverage = 1.0 - exp(-0.4 * mottle);   // the share of the ground that is soil: about half at the default, nearly all at the most
    a = mix(a, surfaceEarth(cls), soilEarth(p, soil.x, soil.y, coverage, 0.0));
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

// How a value changes per metre of ground, from how it changes a pixel across and a pixel down (grassEdge.ts is the same maths)
vec2 worldGradient(vec2 dd, vec2 dpx, vec2 dpy) {
  float det = dpx.x * dpy.y - dpx.y * dpy.x;
  if (abs(det) < 1e-12) return vec2(0.0);
  return vec2(dpy.y * dd.x - dpx.y * dd.y, dpx.x * dd.y - dpy.x * dd.x) / det;
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
// a surface's normal-map detail, as a slope to add to the ground's: from the grass tile's map or the grain map, as steep as the look says
vec2 surfaceDetail(int cls, vec2 grassSlope, vec2 grainSlope) {
  return mix(grassSlope, grainSlope, surfaceBumpMap(cls)) * surfaceBump(cls);
}

// Where two surfaces meet their grass is not the same height, so the ground steps from one to the other (grassEdge.ts). The mesh cannot
// show a centimetre, so the step is only lit: its slope is added to detail, and the shorter grass at its foot is darkened (occlusion).
// The wall of the step is the taller grass's own side, so it lies on the taller surface's side of the line, from the foot at the line
// up to the full height, and is coloured and textured as the taller grass; the shorter side is level up to the foot. dist is metres from
// the line into this pixel's surface a, n the direction across the line towards a, pixel the metres of ground one pixel covers across
// the line (not its longest side: at a shallow angle a pixel is long along the view and narrow across it, and an edge running along
// the view needs no more than a narrow floor). The step is drawn uEdge.w times taller than it is,
// so a few millimetres show. The shade at the foot is cast away from the sun: full where the sun is over the taller grass, and only
// an ambient share of it where the sun is on the shorter side.
void grassStep(float dist, vec2 n, int a, int b, float pixel, inout vec2 detail, out float occlusion) {
  float rise = (surfaceHeight(a) - surfaceHeight(b)) * uEdge.w;
  float width = max(uEdge.x, 1.5 * pixel); // never narrower than a pixel, so it does not shimmer
  if (rise > 0.0) {
    float t = clamp(dist / width, 0.0, 1.0);
    detail += n * (rise * 6.0 * t * (1.0 - t) / width);
  }
  float lower = rise > 0.0 ? -dist : dist; // metres into the shorter grass
  float spread = float(EDGE_SPREAD_BASE) + float(EDGE_SPREAD_PER_METRE) * abs(rise); // float(): a define of 3 is an int
  float sunLength = length(uSunDir.xz);
  float facing = sunLength > 1e-4 ? (rise > 0.0 ? 1.0 : -1.0) * dot(n, uSunDir.xz) / sunLength : 0.0; // 1 when the sun is over the taller grass
  float castShare = float(EDGE_SHADE_AMBIENT) + (1.0 - float(EDGE_SHADE_AMBIENT)) * clamp(facing, 0.0, 1.0);
  float strength = uEdge.z * castShare * smoothstep(0.0, float(EDGE_FULL_STEP), abs(rise)) * (1.0 - smoothstep(0.5 * spread, 2.0 * spread, pixel));
  occlusion = 1.0 - strength * smoothstep(-0.5 * pixel, 0.5 * pixel, lower) * (1.0 - smoothstep(0.0, spread, lower));
}

// water is how much of the point is in a lake (the water surface is cut to it); bed is how much of it shows the lake bed's colour, which is the
// same except at the lake's top edge, where the bed comes in out of the colour of the ground beside it (see below).
vec3 gameGround(vec2 p, out float shade, out vec2 speckle, out vec2 detail, out float occlusion, out float water, out float bed) {
  vec3 grain = texture(uTile, p / uTileMetres).rgb / uTileAvg;
  vec2 soil = vec2(texture(uTile, p / (uTileMetres * 0.7) + 0.11).g / uTileAvg.g, max(fwidth(p.x), fwidth(p.y)));
  vec2 wobble = (texture(uTile, p / (uTileMetres * 3.0) + 0.37).rg - 0.5) * uWobble * uClassInfo.x;
  // the normal maps, read before the branches below, which texture lookups must not be in; the slope of each in units of its rms
  vec2 grassSlope = (texture(uBumpGrass, p / uTileMetres).rg * 2.0 - 1.0) * float(BUMP_RANGE);
  vec2 grainSlope = (texture(uBumpGrain, p / uTileMetres).rg * 2.0 - 1.0) * float(BUMP_RANGE);
  float ragged = clamp((texture(uTile, p / (uTileMetres * 0.5) + 0.23).g / uTileAvg.g - 1.0) * 2.0, -1.0, 1.0); // pushes the line between surfaces about
  occlusion = 1.0;
  vec2 here = (p + wobble) / uClassInfo.x;      // in cells; a cell's centre is at its index plus a half
  ivec2 under = ivec2(floor(here));             // the cell the point is in
  ivec2 block = clamp(under / EDGE_BLOCK, ivec2(0), textureSize(uEdgeMask, 0) - 1);

  // All fragments reach the derivatives below. Only edge fragments pay for the spline.
  bool nearEdge = texelFetch(uEdgeMask, block, 0).r >= 0.5;
  vec4 underCell = classCell(under);
  int underClass = clamp(int(underCell.r + 0.5), 0, SURFACES - 1);
  water = underClass == 6 ? 1.0 : 0.0;
  bed = water;
  int a = underClass, b = underClass;
  float d = 1.0;
  if (nearEdge) {

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
        int tapClass = int(classCell(start + ivec2(i, j)).r + 0.5);
        if (tapClass < SURFACES) weight[tapClass] += w; // a void (255) is no surface: the ground beside it is not tinted by one
        total += w;
      }
    }

    // the heaviest surface a and the runner-up b
    a = 0; b = 0;
    float wa = -1.0, wb = -1.0;
    for (int k = 0; k < SURFACES; k++) {
      if (weight[k] > wa) { wb = wa; b = a; wa = weight[k]; a = k; }
      else if (weight[k] > wb) { wb = weight[k]; b = k; }
    }
    d = (wa - wb) / max(total, 1e-8);
  }
  // the line's direction and how fast d changes across it, in metres of ground, from the screen derivatives
  vec2 dpx = dFdx(p), dpy = dFdy(p);
  vec2 edgeDD = vec2(dFdx(d), dFdy(d));
  vec2 raggedDD = vec2(dFdx(ragged), dFdy(ragged));
  vec2 across = worldGradient(edgeDD, dpx, dpy);
  float steep = length(across);
  d += ragged * uEdge.y * steep; // the grass texture pushes the line about, by up to uEdge.y metres
  // Freeze the local slope when differentiating the ragged edge: no derivative-of-derivative.
  vec2 shiftedDD = edgeDD + raggedDD * uEdge.y * steep;
  float width = (abs(shiftedDD.x) + abs(shiftedDD.y)) * 0.75; // the edge is as narrow as a pixel: a clean line, antialiased, not a blend
  float share = width > 0.0 ? blendShare(d, width) : (d > 0.0 ? 1.0 : 0.5);

  vec3 colour = surfaceColour(vec4(underCell.rg, 0.0, 0.0), p, grain, soil);
  shade = surfaceShade(underClass);
  speckle = surfaceSpeckle(underClass);
  detail = surfaceDetail(underClass, grassSlope, grainSlope);
  if (nearEdge) {
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
    water = mix(b == 6 ? 1.0 : 0.0, a == 6 ? 1.0 : 0.0, share);
    bed = water;
    colour = surfaceColour(ca, p, grain, soil);
    shade = surfaceShade(a);
    speckle = surfaceSpeckle(a);
    detail = surfaceDetail(a, grassSlope, grainSlope);
    if (share < 1.0) {
      float other = 1.0 - share;
      colour = mix(colour, surfaceColour(cb, p, grain, soil), other);
      shade = mix(shade, surfaceShade(b), other);
      speckle = mix(speckle, surfaceSpeckle(b), other);
      detail = mix(detail, surfaceDetail(b, grassSlope, grainSlope), other);
    }
    if (steep > 1e-6 && a != b) {
      vec2 n = across / steep;
      grassStep(d / steep, n, a, b, max(abs(dot(n, dpx)), abs(dot(n, dpy))), detail, occlusion);
    }
    // The lake's top edge. The ground beside the lake carries on to the outline in its own colour, and the bed's colour comes in through the
    // forest floor's soil noise: its coverage is how far into the lake the point is, 0 at the outline to 1 LAKE_EDGE_METRES in. The noise is
    // softened, and a share of the plain ramp is mixed in, so it crumbles in rather than cutting. The noise's own holes and specks are faded out at
    // both ends of the ramp, so it is the ground's colour exactly at the outline and the bed's colour exactly from LAKE_EDGE_METRES in.
    if (a != b && (a == 6 || b == 6)) {
      bool lakeIsA = a == 6;
      float depth = steep > 1e-6 ? (lakeIsA ? d : -d) / steep : (lakeIsA ? 1e3 : -1e3); // metres into the lake, negative on the land
      colour = surfaceColour(lakeIsA ? cb : ca, p, grain, soil);
      float ramp = smoothstep(0.0, float(LAKE_EDGE_METRES), depth);
      float crumble = mix(soilEarth(p, soil.x, soil.y, ramp, float(LAKE_EDGE_SOFTEN)), ramp, float(LAKE_EDGE_SMOOTH));
      bed = mix(crumble * smoothstep(0.0, 0.2, ramp), 1.0, smoothstep(0.8, 1.0, ramp));
    }
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

uniform vec3 uLakeBedTint;
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

  float water = 0.0;
  vec3 albedo = uBare;
  float shade = 1.0;       // how much of the slope shading the surface takes (all of it unless its look says otherwise)
  vec2 detail = vec2(0.0); // the surface's normal-map detail: a slope added to the ground's
  vec2 aerialUv = (p - uAerialRect.xy) / uAerialRect.zw;
  if (uGame > 0.5) {
    vec2 speckle = vec2(0.0);
    float occlusion = 1.0, bed = 0.0;
    // Sequence the out-parameter write before its read (GLSL operand order is not guaranteed).
    albedo = gameGround(p, shade, speckle, detail, occlusion, water, bed);
    albedo *= occlusion;
    albedo = mix(albedo, uLakeBedTint, bed);
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

  // the sun's light on the slope: the ground's, exaggerated, plus the surface's own fine detail (which is not)
  vec3 lit = normalize(vec3(-(g.x * uRelief + detail.x), 1.0, -(g.y * uRelief + detail.y)));
  float facing = clamp(dot(lit, uSunDir), 0.0, 1.0) - uSunDir.y; // 0 on the flat, up facing the sun, down facing away
  float slope = 1.0 + (clamp(1.0 + uShading * 0.6 * facing, 0.3, 1.7) - 1.0) * shade;

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
