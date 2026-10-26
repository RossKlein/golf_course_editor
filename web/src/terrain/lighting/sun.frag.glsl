#include "head.glsl"
#include "height.glsl"

// Bakes how much of the sun reaches the ground past the terrain, one texel for each half sample (SUN_TEXELS to a height sample
// along each side, so shadows are crisper than the height grid). sunMath.ts is the same sums for tests, and explains them.

uniform vec3 uSunDir;      // toward the sun: x east, y up, z south
uniform vec2 uSunParams;   // the least width of the soft edge in metres, and the sun's width as a fraction of the distance

out vec4 outColor;

void main() {
  // the texel's centre in height samples, then in metres
  vec2 f = gl_FragCoord.xy / float(SUN_TEXELS) - 0.5;
  vec2 p = uOrigin + f * uRes;
  vec2 ground = heightAt(p);
  if (ground.y < 0.5) {
    outColor = vec4(1.0);
    return;
  }
  if (uSunDir.y <= 0.001) {
    outColor = vec4(0.0);
    return;
  }
  float y0 = ground.x + 0.15; // a little above the ground, so it does not shade itself
  float lit = 1.0;
  for (int i = 1; i <= SUN_STEPS; i++) {
    float s = float(i) / float(SUN_STEPS);
    float t = float(SUN_REACH) * s * s;
    vec2 h = heightAt(p + uSunDir.xz * t);
    if (h.y < 0.5) continue;
    float clearance = y0 + uSunDir.y * t - h.x;
    float width = uSunParams.x + t * uSunParams.y;
    lit = min(lit, clamp(0.5 + clearance / width, 0.0, 1.0));
  }
  outColor = vec4(lit, 0.0, 0.0, 1.0);
}
