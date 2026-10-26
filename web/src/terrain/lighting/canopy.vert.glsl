#include "head.glsl"
#include "height.glsl"

// One quad for each tree, covering the ground its crown hides sky from, drawn into the sky bake (see lighting.ts).

layout(location = 0) in vec4 aTree;   // x, z, height in metres, kind
uniform vec3 uCrown;                  // half-width, bottom and top of this kind's crown, as fractions of the tree's height
uniform vec4 uBox;                    // the texels the pass covers: first column, first row, columns, rows

out vec2 vWorld;
flat out vec3 vTrunk;                 // where the trunk stands: x, z and the ground's height there
flat out vec3 vCrownM;                // half-width, bottom and top of the crown, in metres

void main() {
  vec3 crown = uCrown * aTree.z;
  vTrunk = vec3(aTree.xy, heightAt(aTree.xy).x);
  vCrownM = crown;
  // a crown hides a share of the sky that falls off with the cube of the distance: twice its height out is all that matters
  float reach = 2.0 * (crown.z + crown.x);
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vWorld = aTree.xy + corner * reach;
  vec2 texel = (vWorld - uOrigin) / uRes; // a sample's centre is at its index, a pixel's at its index plus a half
  gl_Position = vec4(((texel + 0.5 - uBox.xy) / uBox.zw) * 2.0 - 1.0, 0.0, 1.0);
}
