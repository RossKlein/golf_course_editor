#include "height.glsl"

// Where one vertex of a tree is in the world, and which way its face points there. A tree is spun by a hash of where it
// stands, spread a little wider or narrower, scaled to its height and set on the ground. The tree pass and the shadow
// pass both use it, so a tree casts the shadow of the tree that is drawn.
// position and normal are the model (a tree one unit tall); tree is (x, z, height in metres, kind).
float treeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void placeTree(vec3 position, vec3 normal, vec4 tree, float scale, out vec3 world, out vec3 worldNormal) {
  float turn = treeHash(tree.xy) * 6.2831853;
  mat2 spin = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
  float spread = 0.85 + 0.3 * treeHash(tree.yx);
  float h = tree.z;
  vec2 xz = spin * position.xz * h * spread;
  vec2 turned = spin * normal.xz;
  worldNormal = vec3(turned.x, normal.y, turned.y);
  float ground = heightAt(tree.xy).x * scale;
  world = vec3(tree.x + xz.x, ground + position.y * h, tree.y + xz.y);
}
