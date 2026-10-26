// The terrain shader. One full-screen triangle; every pixel looks up the height under it and shades it. Heights are
// sampled exactly as the game does (bilinear between grid points) and normals come from central differences of that
// surface, so the relief on screen is the relief the ball will see. The reference maths for the lighting lives in
// reference.ts, which the tests pin to the old CPU hillshade.

export const VERTEX = `#version 300 es
void main() {
  // a triangle that covers the viewport, with no vertex buffer
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uHeight;   // RG32F: r = height in metres, g = 1 where there is data
uniform ivec2 uGrid;         // samples across, down
uniform vec2 uOrigin;        // course metres of sample (0, 0)
uniform vec2 uRes;           // metres between samples, x and z
uniform vec2 uMapOrigin;     // map coordinates (x, -z) of the bottom-left pixel
uniform vec2 uMapPerPixel;   // map units per pixel
uniform float uExaggeration;
uniform float uContour;      // metres between contour lines, 0 for none
uniform float uSlope;        // 1 to colour by slope

out vec4 outColor;

const float PI = 3.14159265358979;
const float SUN_AZIMUTH = 5.49778714378214;  // 315 degrees: from the north-west
const float SUN_ALTITUDE = 0.785398163397448; // 45 degrees up

// height (x) and whether there is data (y) at a point in course metres, bilinear between the four nearest samples
vec2 heightAt(vec2 p) {
  vec2 f = clamp((p - uOrigin) / uRes, vec2(0.0), vec2(uGrid - 1));
  ivec2 c = min(ivec2(floor(f)), uGrid - 2);
  vec2 t = f - vec2(c);
  vec2 a = texelFetch(uHeight, c, 0).rg;
  vec2 b = texelFetch(uHeight, c + ivec2(1, 0), 0).rg;
  vec2 d = texelFetch(uHeight, c + ivec2(0, 1), 0).rg;
  vec2 e = texelFetch(uHeight, c + ivec2(1, 1), 0).rg;
  float ok = min(min(a.y, b.y), min(d.y, e.y));
  float h = mix(mix(a.x, b.x, t.x), mix(d.x, e.x, t.x), t.y);
  return vec2(h, ok);
}

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

void main() {
  vec2 map = uMapOrigin + gl_FragCoord.xy * uMapPerPixel;
  vec2 p = vec2(map.x, -map.y); // course metres: x east, z south

  // outside the grid (half a sample of margin, as the grid's samples are cells' centres) there is nothing to show
  vec2 f = (p - uOrigin) / uRes;
  vec2 here = heightAt(p);
  if (f.x < -0.5 || f.y < -0.5 || f.x > float(uGrid.x) - 0.5 || f.y > float(uGrid.y) - 0.5 || here.y < 0.5) {
    outColor = vec4(0.0);
    return;
  }

  // slope from central differences, a quarter of a metre either side like the game's normal(), or half a pixel when
  // zoomed out so that one pixel does not alias a whole patch of ground
  float s = max(0.25, 0.5 * max(uMapPerPixel.x, uMapPerPixel.y));
  vec2 ex = heightAt(p + vec2(s, 0.0)), wx = heightAt(p - vec2(s, 0.0));
  vec2 ez = heightAt(p + vec2(0.0, s)), wz = heightAt(p - vec2(0.0, s));
  float dx = ((ex.y > 0.5 ? ex.x : here.x) - (wx.y > 0.5 ? wx.x : here.x)) / (2.0 * s); // rise per metre east
  float dz = ((ez.y > 0.5 ? ez.x : here.x) - (wz.y > 0.5 ? wz.x : here.x)) / (2.0 * s); // rise per metre south

  float steep = length(vec2(dx, dz)) * uExaggeration;
  float slope = PI / 2.0 - atan(steep);
  float aspect = atan(-dx, dz);
  float shade = clamp(sin(SUN_ALTITUDE) * sin(slope) + cos(SUN_ALTITUDE) * cos(slope) * cos(SUN_AZIMUTH - aspect), 0.0, 1.0);
  vec3 col = vec3(shade);

  if (uSlope > 0.5) col = mix(col, slopeColour(length(vec2(dx, dz))) * (0.55 + 0.45 * shade), 0.7);

  if (uContour > 0.0) {
    float v = here.x / uContour;
    float w = fwidth(v);
    float d = abs(fract(v + 0.5) - 0.5);
    float line = (1.0 - smoothstep(0.0, max(1.2 * w, 1e-5), d)) * (1.0 - smoothstep(0.25, 0.5, w)); // fades out when too dense to read
    float major = mod(floor(v + 0.5), 5.0) < 0.5 ? 1.0 : 0.0;
    col *= 1.0 - line * mix(0.35, 0.7, major);
  }

  outColor = vec4(col, 1.0);
}`;
