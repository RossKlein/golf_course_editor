#include "head.glsl"
// DepthArray has one mip level. Explicit zero gradients preserve filtered depth comparisons
// after per-fragment exits without relying on implicit derivatives in divergent control flow.
#include "height.glsl"

// Resolves one tile's tree shadow map into the sun bake: for each texel of ground it looks the point up in the map (see
// tileLight.ts for how the map is fitted) and writes how much of the sun the trees let through. The bake multiplies this into
// what the terrain pass wrote there, so a point shaded by either is shaded.

uniform highp sampler2DArrayShadow uTileMap;
uniform mat4 uLight;     // world to the map's clip space
uniform vec2 uMap;       // the map's size in texels, and the metres of depth it spans

out vec4 outColor;

void main() {
  vec2 f = gl_FragCoord.xy / float(SUN_TEXELS) - 0.5;
  vec2 p = uOrigin + f * uRes;
  vec2 ground = heightAt(p);
  if (ground.y < 0.5) {
    outColor = vec4(1.0);
    return;
  }
  vec4 clip = uLight * vec4(p.x, ground.x + 0.1, p.y, 1.0);
  vec3 t = clip.xyz / clip.w * 0.5 + 0.5;
  if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0 || t.z > 1.0) {
    outColor = vec4(1.0); // outside the map: nothing in it to shade this point
    return;
  }
  float ref = t.z - 0.3 / uMap.y; // 30 cm of depth bias, so the ground does not shade itself
  float texel = 1.0 / uMap.x;
  float lit = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) lit += textureGrad(uTileMap, vec4(t.xy + vec2(float(i), float(j)) * texel, 0.0, ref), vec2(0.0), vec2(0.0));
  }
  outColor = vec4(lit / 9.0);
}
