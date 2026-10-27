#include "head.glsl"
#include "height.glsl"

// Bakes the ground's slope into a texture, one pixel for each height sample: the slope to the east and south of a cubic
// B-spline smoothed over uScale samples to the unit. reliefMath.ts is the same sums for tests (and explains them). The pass
// can cover just part of the texture, as when a brush has changed some heights.

uniform float uScale;   // samples to the unit of the spline

out vec4 outColor;

// the cubic B-spline basis and its slope
vec2 bspline(float x) {
  float a = abs(x);
  float sg = x < 0.0 ? -1.0 : 1.0;
  if (a < 1.0) return vec2((4.0 - 6.0 * a * a + 3.0 * a * a * a) / 6.0, sg * (-12.0 * a + 9.0 * a * a) / 6.0);
  if (a < 2.0) { float b = 2.0 - a; return vec2(b * b * b / 6.0, -sg * b * b / 2.0); }
  return vec2(0.0);
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 centre = sampleAt(c);
  if (centre.y < 0.5) {
    outColor = vec4(0.0);
    return;
  }
  int taps = min(2 * int(ceil(2.0 * uScale)), RELIEF_TAPS_MAX);
  int first = -taps / 2 + 1;
  float s2 = uScale * uScale;

  // what a level and a sloping field come out as, so each is exact whatever the width
  float n0 = 0.0, n1 = 0.0;
  for (int i = 0; i < RELIEF_TAPS_MAX; i++) {
    if (i >= taps) break;
    float k = float(first + i);
    vec2 w = bspline(k / uScale);
    n0 += w.x / uScale;
    n1 -= k * w.y / s2;
  }

  float sx = 0.0, sz = 0.0;
  for (int j = 0; j < RELIEF_TAPS_MAX; j++) {
    if (j >= taps) break;
    vec2 bz = bspline(float(first + j) / uScale);
    float z0 = bz.x / uScale, z1 = bz.y / s2;
    for (int i = 0; i < RELIEF_TAPS_MAX; i++) {
      if (i >= taps) break;
      vec2 bx = bspline(float(first + i) / uScale);
      float x0 = bx.x / uScale, x1 = bx.y / s2;
      vec2 n = sampleAt(clamp(c + ivec2(first + i, first + j), ivec2(0), uGrid - 1));
      float h = (n.y > 0.5 ? n.x : centre.x) - centre.x; // relative to this sample; a missing neighbour is level with it
      sx += h * x1 * z0;
      sz += h * x0 * z1;
    }
  }
  // the slope of the smooth surface at this sample is the sum of h(k) times the spline's slope at -k, and a spline's slope is odd
  outColor = vec4(-sx / (n1 * n0 * uRes.x), -sz / (n1 * n0 * uRes.y), 0.0, 1.0);
}
