#include "head.glsl"
#include "height.glsl"

// How much of the sky one crown hides from this texel of ground; the bake multiplies what is left by one minus it.
// canopyMath.ts is the same sum for tests, and explains it.

in vec2 vWorld;
flat in vec3 vTrunk;
flat in vec3 vCrownM;

out vec4 outColor;

void main() {
  vec2 ground = heightAt(vWorld);
  if (ground.y < 0.5) {
    outColor = vec4(0.0);
    return;
  }
  float radius = vCrownM.x;
  float dist = length(vWorld - vTrunk.xy);
  float rise = ground.x - vTrunk.z;
  float top = vCrownM.z - rise;
  if (top <= 0.0) {
    outColor = vec4(0.0);
    return;
  }
  float bottom = max(0.0, vCrownM.y - rise);
  float reach = max(dist, radius);
  float across = dist > radius ? asin(radius / dist) / 3.14159265358979 : 1.0 - 0.5 * dist / radius;
  float occ = across * (top * top / (top * top + reach * reach) - bottom * bottom / (bottom * bottom + reach * reach));
  outColor = vec4(clamp(occ, 0.0, 1.0));
}
