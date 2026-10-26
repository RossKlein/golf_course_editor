#include "head.glsl"
#include "tree.glsl"

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 3) in vec4 aTree;   // per tree: x, z, height in metres, kind

uniform mat4 uLightViewProj;
uniform float uScale;

void main() {
  vec3 world, normal;
  placeTree(aPosition, aNormal, aTree, uScale, world, normal);
  gl_Position = uLightViewProj * vec4(world, 1.0);
}
