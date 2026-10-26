#include "head.glsl"
#include "height.glsl"

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
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the picture (allow-literal: a position, not a colour)
    return;
  }
  gl_Position = uViewProj * vec4(p.x, heightAt(p).x * uScale, p.y, 1.0);
}
