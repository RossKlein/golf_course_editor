#include "head.glsl"
#include "height.glsl"

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec4 aTree;   // per tree: x, z, height in metres, kind

uniform mat4 uViewProj;
uniform vec3 uSunDir;
uniform float uScale;
uniform vec3 uTreeLight;  // ambient, direct, and the brightness at the foot of a tree

out vec3 vColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  float turn = hash(aTree.xy) * 6.2831853;
  mat2 spin = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
  float spread = 0.85 + 0.3 * hash(aTree.yx);
  float h = aTree.z;
  vec2 xz = spin * aPosition.xz * h * spread;
  vec2 turned = spin * aNormal.xz;
  vec3 n = vec3(turned.x, aNormal.y, turned.y);
  float ground = heightAt(aTree.xy).x * uScale;
  vec3 world = vec3(aTree.x + xz.x, ground + aPosition.y * h, aTree.y + xz.y);
  float lit = uTreeLight.x + uTreeLight.y * max(dot(normalize(n), uSunDir), 0.0);
  vColor = aColor * lit * (uTreeLight.z + (1.0 - uTreeLight.z) * aPosition.y);
  gl_Position = uViewProj * vec4(world, 1.0);
}
