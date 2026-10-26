#include "head.glsl"
#include "tree.glsl"
#include "shadow.glsl"

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec4 aTree;   // per tree: x, z, height in metres, kind

uniform mat4 uViewProj;
uniform vec3 uSunDir;
uniform float uScale;
uniform vec3 uTreeLight;  // ambient, direct, and the brightness at the foot of a tree

out vec3 vColor;

void main() {
  vec3 world, n;
  placeTree(aPosition, aNormal, aTree, uScale, world, n);
  n = normalize(n);
  float lit = uTreeLight.x + uTreeLight.y * max(dot(n, uSunDir), 0.0);
  // a face turned from the sun is dark already; shadow darkens the ones turned towards it that something stands in front of
  float shadow = shadowMapAt(world, n, false) * step(0.0, dot(n, uSunDir));
  vColor = applyShadow(aColor * lit * (uTreeLight.z + (1.0 - uTreeLight.z) * aPosition.y), shadow);
  gl_Position = uViewProj * vec4(world, 1.0);
}
