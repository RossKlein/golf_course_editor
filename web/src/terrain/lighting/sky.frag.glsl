#include "head.glsl"
#include "height.glsl"

// Bakes how much sky each height sample can see, from the heights around it: the average over a ring of directions of 1 minus
// the squared sine of the horizon's elevation. skyMath.ts is the same sums for tests, and explains them.

uniform float uReach;   // metres to look out

out vec4 outColor;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 centre = sampleAt(c);
  if (centre.y < 0.5) {
    outColor = vec4(1.0);
    return;
  }
  vec2 p = uOrigin + vec2(c) * uRes;
  float total = 0.0;
  for (int d = 0; d < SKY_DIRS; d++) {
    float angle = (float(d) + 0.5) / float(SKY_DIRS) * 6.28318530718;
    vec2 dir = vec2(cos(angle), sin(angle));
    float sinMax = 0.0;
    for (int s = 1; s <= SKY_STEPS; s++) {
      float f = float(s) / float(SKY_STEPS);
      float t = uReach * f * f; // closer together near the point, where the ground matters most
      vec2 h = heightAt(p + dir * t);
      float rise = h.x - centre.x;
      if (h.y > 0.5 && rise > 0.0) sinMax = max(sinMax, rise / length(vec2(rise, t)));
    }
    total += 1.0 - sinMax * sinMax;
  }
  outColor = vec4(total / float(SKY_DIRS), 0.0, 0.0, 1.0);
}
