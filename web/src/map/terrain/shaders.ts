// The terrain shaders. Heights are sampled exactly as the game does (bilinear between grid points) and normals come from
// central differences of that surface, so the relief on screen is the relief the ball will see. Two programs share the
// height lookup, the slope palette and the contour lines:
//  - a flat top-down shade for the map (one full-screen triangle, every pixel looks up the ground under it), and
//  - a 3D mesh whose vertices are lifted by the same lookup, textured with the aerial and the design.
// The reference maths for the 2D lighting lives in reference.ts, pinned by tests to the old CPU hillshade.

export const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** The height grid and its bilinear lookup. */
export const HEIGHT = `
uniform sampler2D uHeight;   // RG32F: r = baked height in metres, g = 1 where there is data
uniform sampler2D uDelta;    // RGBA32F: r = sculpted offset from the baked height, in metres
uniform float uHasDelta;     // 1 when uDelta holds sculpting
uniform ivec2 uGrid;         // samples across, down
uniform vec2 uOrigin;        // course metres of sample (0, 0)
uniform vec2 uRes;           // metres between samples, x and z

// height (x) and whether there is data (y) of one grid sample: the baked height plus whatever was sculpted
vec2 sampleAt(ivec2 c) {
  vec2 s = texelFetch(uHeight, c, 0).rg;
  return vec2(s.x + (uHasDelta > 0.5 ? texelFetch(uDelta, c, 0).r : 0.0), s.y);
}

// height (x) and whether there is data (y) at a point in course metres, bilinear between the four nearest samples
vec2 heightAt(vec2 p) {
  vec2 f = clamp((p - uOrigin) / uRes, vec2(0.0), vec2(uGrid - 1));
  ivec2 c = min(ivec2(floor(f)), uGrid - 2);
  vec2 t = f - vec2(c);
  vec2 a = sampleAt(c);
  vec2 b = sampleAt(c + ivec2(1, 0));
  vec2 d = sampleAt(c + ivec2(0, 1));
  vec2 e = sampleAt(c + ivec2(1, 1));
  float ok = min(min(a.y, b.y), min(d.y, e.y));
  float h = mix(mix(a.x, b.x, t.x), mix(d.x, e.x, t.x), t.y);
  return vec2(h, ok);
}

// whether a point is on the grid (half a sample of margin, as the samples are cells' centres) and has data
bool onGrid(vec2 p) {
  vec2 f = (p - uOrigin) / uRes;
  return f.x >= -0.5 && f.y >= -0.5 && f.x <= float(uGrid.x) - 0.5 && f.y <= float(uGrid.y) - 0.5 && heightAt(p).y > 0.5;
}

// how much the ground curves: positive in a hollow, negative on a crest, per metre; 0 beside missing data
float curvatureAt(vec2 p, float s) {
  vec2 c = heightAt(p), e = heightAt(p + vec2(s, 0.0)), w = heightAt(p - vec2(s, 0.0)), n = heightAt(p - vec2(0.0, s)), t = heightAt(p + vec2(0.0, s));
  if (min(min(c.y, e.y), min(min(w.y, n.y), t.y)) < 0.5) return 0.0;
  return (e.x + w.x + n.x + t.x - 4.0 * c.x) / (s * s);
}

// rise over run to the east and to the south, from central differences s metres either side
vec2 gradientAt(vec2 p, float s) {
  float here = heightAt(p).x;
  vec2 ex = heightAt(p + vec2(s, 0.0)), wx = heightAt(p - vec2(s, 0.0));
  vec2 ez = heightAt(p + vec2(0.0, s)), wz = heightAt(p - vec2(0.0, s));
  return vec2(((ex.y > 0.5 ? ex.x : here) - (wx.y > 0.5 ? wx.x : here)) / (2.0 * s),
              ((ez.y > 0.5 ? ez.x : here) - (wz.y > 0.5 ? wz.x : here)) / (2.0 * s));
}
`;

/** Slope colours and contour lines. */
const OVERLAYS = `
vec3 slopeColour(float s) { // s is rise over run
  vec3 c0 = vec3(0.20, 0.45, 0.95); // under 1%
  vec3 c1 = vec3(0.20, 0.80, 0.40); // 2%
  vec3 c2 = vec3(0.95, 0.90, 0.20); // 4%
  vec3 c3 = vec3(0.95, 0.55, 0.15); // 8%
  vec3 c4 = vec3(0.90, 0.15, 0.15); // 15% and over
  vec3 c = mix(c0, c1, clamp((s - 0.01) / 0.01, 0.0, 1.0));
  c = mix(c, c2, clamp((s - 0.02) / 0.02, 0.0, 1.0));
  c = mix(c, c3, clamp((s - 0.04) / 0.04, 0.0, 1.0));
  return mix(c, c4, clamp((s - 0.08) / 0.07, 0.0, 1.0));
}

// how much to darken for a contour line at this height: 0 between lines, up to 0.7 on a major (every fifth) one
float contourDarkening(float height, float interval) {
  float v = height / interval;
  float w = fwidth(v);
  float d = abs(fract(v + 0.5) - 0.5);
  float line = (1.0 - smoothstep(0.0, max(1.2 * w, 1e-5), d)) * (1.0 - smoothstep(0.25, 0.5, w)); // fades out when too dense to read
  float major = mod(floor(v + 0.5), 5.0) < 0.5 ? 1.0 : 0.0;
  return line * mix(0.35, 0.7, major);
}
`;

// ---- 2D: the map ---------------------------------------------------------------------------------------------------

export const VERTEX = `#version 300 es
void main() {
  // a triangle that covers the viewport, with no vertex buffer
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAGMENT =
  HEAD +
  HEIGHT +
  OVERLAYS +
  `
uniform vec2 uMapOrigin;     // map coordinates (x, -z) of the bottom-left pixel
uniform vec2 uMapPerPixel;   // map units per pixel
uniform float uExaggeration;
uniform float uContour;      // metres between contour lines, 0 for none
uniform float uSlope;        // 1 to colour by slope
uniform vec2 uSun;           // compass bearing and height of the sun, radians

out vec4 outColor;

const float PI = 3.14159265358979;

void main() {
  vec2 map = uMapOrigin + gl_FragCoord.xy * uMapPerPixel;
  vec2 p = vec2(map.x, -map.y); // course metres: x east, z south

  if (!onGrid(p)) {
    outColor = vec4(0.0);
    return;
  }

  // a quarter of a metre either side like the game's normal(), or half a pixel when zoomed out so that one pixel does
  // not alias a whole patch of ground
  float s = max(0.25, 0.5 * max(uMapPerPixel.x, uMapPerPixel.y));
  vec2 g = gradientAt(p, s);

  float steep = length(g) * uExaggeration;
  float slope = PI / 2.0 - atan(steep);
  float aspect = atan(-g.x, g.y);
  float shade = clamp(sin(uSun.y) * sin(slope) + cos(uSun.y) * cos(slope) * cos(uSun.x - aspect), 0.0, 1.0);
  vec3 col = vec3(shade);

  if (uSlope > 0.5) col = mix(col, slopeColour(length(g)) * (0.55 + 0.45 * shade), 0.7);
  if (uContour > 0.0) col *= 1.0 - contourDarkening(heightAt(p).x, uContour);

  outColor = vec4(col, 1.0);
}`;

// ---- 3D: the mesh --------------------------------------------------------------------------------------------------

export const VERTEX_3D =
  HEAD +
  HEIGHT +
  `
uniform mat4 uViewProj;
uniform vec2 uWindow;     // course metres of the mesh's corner
uniform float uSpacing;   // metres between mesh vertices
uniform int uQuads;       // squares along each side
uniform float uScale;     // vertical exaggeration
uniform vec4 uInner;      // the next finer mesh's area (x0, z0, x1, z1); quads wholly inside it are left to that mesh

out vec2 vXZ;

const ivec2 CORNERS[6] = ivec2[6](ivec2(0, 0), ivec2(1, 0), ivec2(0, 1), ivec2(1, 0), ivec2(1, 1), ivec2(0, 1));

void main() {
  int quad = gl_VertexID / 6;
  ivec2 corner = CORNERS[gl_VertexID - quad * 6];
  vec2 first = uWindow + vec2(float(quad % uQuads), float(quad / uQuads)) * uSpacing;
  vec2 p = first + vec2(corner) * uSpacing;
  vXZ = p;
  if (uInner.z > uInner.x && first.x >= uInner.x && first.y >= uInner.y && first.x + uSpacing <= uInner.z && first.y + uSpacing <= uInner.w) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the picture
    return;
  }
  gl_Position = uViewProj * vec4(p.x, heightAt(p).x * uScale, p.y, 1.0);
}`;

export const FRAGMENT_3D =
  HEAD +
  HEIGHT +
  OVERLAYS +
  `
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
// surfaces meet the way mown grass does rather than along a ruler
// a hash of a grain of ground, 0 to 1, without the precision trouble that sin has far from the origin
float grainHash(vec2 cell) {
  vec3 q = fract(vec3(mod(cell, 1024.0).xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// sand comes back as how much of the point is bunker, 0 to 1, so the lighting can be eased off there
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
    // salt and pepper: grains 3 cm across, some paler, some darker. Where a pixel covers more than a grain the grains grow
    // in doubling steps to stay a pixel or so, so far sand is still speckled. They fade out towards the grass range.
    float footprint = max(fwidth(p.x), fwidth(p.y));
    float grainSize = 0.03 * exp2(max(0.0, ceil(log2(max(footprint, 1e-4) / 0.03))));
    float visible = 1.0 - smoothstep(0.7 * uSpeckle.z, uSpeckle.z, distance(p, uSpeckle.xy));
    float n = grainHash(floor(p / grainSize));
    float speck = n < 0.14 ? -0.2 : (n > 0.86 ? 0.14 : (n - 0.5) * 0.12);
    albedo *= 1.0 + sand * visible * speck;
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
}`;
