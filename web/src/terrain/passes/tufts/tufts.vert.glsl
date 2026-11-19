#include "head.glsl"
#include "height.glsl"
#include "look.glsl"
#include "shadow.glsl"
#include "lighting.glsl"
#include "noise.glsl"

// Standing grass: clumps of blades, worked out entirely from the numbers of the instance and the vertex. An instance is one clump, a
// cell of a jittered grid of them; its vertices are blades, BLADE_VERTS each (two quads and a tip, tapering to a point), each with its
// own place in the clump, lean, height and thickness. The clump has a width of its own, so a tall one is not a fat one.

const int TILE = TUFT_TILE;
uniform sampler2D uClassMap;
uniform sampler2D uEdgeMask;   // nearest: 255 for each block of EDGE_BLOCK cells that is near an edge between surfaces
uniform vec3 uClassInfo;
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform ivec2 uTile;       // the first clump of the tile being drawn, in clumps from the patch's corner
uniform vec2 uCentre;      // the middle of the patch of clumps, a whole number of cells so they stay put as the camera moves
uniform float uCell;       // metres between clumps
uniform int uN;            // clumps across the patch
uniform float uRadius;     // metres from the centre where clumps have shrunk to nothing
uniform float uTall;       // the tallest blade of a clump, for a surface with a tuft factor of 1
uniform vec3 uTuftShape;   // metres across a clump, metres thick at the foot of a blade, and blades in a clump seen close up
uniform int uBlades;       // blades drawn in each clump of this tile: fewer, wider ones when the tile is far from the eye
uniform float uScale;      // vertical exaggeration

out float vAlong;          // 0 at the foot of a blade, 1 at its tip
out float vSeed;
out float vShadow;

// the nine vertices of a blade: which row of it (foot, middle, tip) and which side
const int ROW[9] = int[9](0, 0, 1, 0, 1, 1, 1, 1, 2);
const float SIDE[9] = float[9](-1.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, 0.0);
const float ALONG[3] = float[3](0.0, 0.55, 1.0);   // how far up the blade each row is
const float NARROW[3] = float[3](1.0, 0.7, 0.0);   // and how much of the blade's thickness is left there
// eight points round a clump, for finding out how close it is to ground where nothing grows
const vec2 TAPS[8] = vec2[8](vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071), vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071));

// where grass gathers into patches: 1 inside one, 0 between them, over patches TUFT_PATCH_METRES across
float grassPatch(vec2 p) {
  return smoothstep(0.3, 0.7, valueNoise(p / float(TUFT_PATCH_METRES)));
}

int classAt(vec2 p) {
  ivec2 cc = clamp(ivec2(floor(p / uClassInfo.x)), ivec2(0), ivec2(int(uClassInfo.y), int(uClassInfo.z)) - 1);
  return clamp(int(texelFetch(uClassMap, cc, 0).r * 255.0 + 0.5), 0, SURFACES - 1);
}

void hide() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the picture (allow-literal: a position, not a colour)
  vAlong = 0.0;
  vSeed = 0.0;
  vShadow = 0.0;
}

void main() {
  ivec2 cell = uTile + ivec2(gl_InstanceID % TILE, gl_InstanceID / TILE);
  if (cell.x >= uN || cell.y >= uN) { hide(); return; } // the last tiles overhang the patch
  vec2 idx = floor(uCentre / uCell + 0.5) + vec2(cell) - float(uN) * 0.5;
  ivec2 cl = ivec2(idx); // idx is whole numbers
  // a clump may stand up to half a cell into its neighbours', so they bunch and leave gaps and the cells do not show as a grid
  vec2 pos = (idx + 0.5 + (vec2(rnd(cl, 1), rnd(cl, 2)) - 0.5) * 2.0) * uCell;

  int cls = classAt(pos);
  float tuft = surfaceTuft(cls); // 0 where nothing stands
  float dist = distance(pos, uCentre);
  if (tuft <= 0.0 || dist >= uRadius || heightAt(pos).y < 0.5) { hide(); return; }

  // where the surface's grass is thinner, and where it gathers into patches (the clumping): some clumps are left out, and the ones
  // that stay in a patch are taller than the ones round its edge
  float clumping = surfaceTuftClump(cls);
  float gathered = grassPatch(pos);
  if (rnd(cl, 3) >= surfaceTuftDensity(cls) * mix(1.0, 2.0 * gathered, clumping)) { hide(); return; }

  // a clump is whole only where the ground round it is the same grass; at an edge it shrinks, so none overhangs the next surface
  // (every vertex of every blade works this out, so it is skipped where the edge mask says no edge is near, which is nearly everywhere)
  float whole = 1.0;
  ivec2 block = clamp(ivec2(floor(pos / uClassInfo.x)) / EDGE_BLOCK, ivec2(0), textureSize(uEdgeMask, 0) - 1);
  if (texelFetch(uEdgeMask, block, 0).r > 0.5) {
    float reach = 0.5 * uTuftShape.x + float(TUFT_EDGE_MARGIN);
    float inside = 1.0;
    for (int i = 0; i < 8; i++) {
      if (surfaceTuft(classAt(pos + TAPS[i] * reach)) > 0.0) inside += 1.0;
    }
    whole = smoothstep(0.5, 1.0, inside / 9.0);
    if (whole <= 0.0) { hide(); return; }
  }

  float seed = rnd(cl, 4);
  float fade = 1.0 - smoothstep(0.6 * uRadius, uRadius, dist);
  float tall = uTall * tuft * (0.75 + 0.5 * seed) * mix(1.0, 0.55 + 0.45 * gathered, clumping) * fade * whole;
  float radius = 0.5 * uTuftShape.x * whole * (0.4 + 0.6 * fade) * (0.7 + 0.6 * rnd(cl, 5)); // each clump is its own width
  if (tall < 0.002) { hide(); return; }

  // this vertex's blade: where in the clump it stands, which way it leans (outwards, the more the nearer the rim), how tall it is
  int blade = gl_VertexID / BLADE_VERTS;
  int v = gl_VertexID - blade * BLADE_VERTS;
  int row = ROW[v];
  if (blade >= int(ceil(float(uBlades) * (0.5 + 0.5 * rnd(cl, 6))))) { hide(); return; } // and has between half and all of its blades
  int salt = 16 + blade * 8;
  float angle = rnd(cl, salt) * 6.2831853;
  vec2 outward = vec2(cos(angle), sin(angle));
  float rim = sqrt(rnd(cl, salt + 1)); // 0 in the middle of the clump, 1 at its edge
  vec2 root = pos + outward * (rim * radius);
  float height = tall * (0.5 + 0.5 * rnd(cl, salt + 2)) * (1.0 - 0.45 * rim);
  float lean = (0.15 + 0.6 * rnd(cl, salt + 3)) * (0.3 + 0.7 * rim);
  vec3 base = vec3(root.x, heightAt(root).x * uScale, root.y);

  // the blade is a flat strip: turned to face the camera, most of the way, so it is never seen edge-on
  vec3 toEye = uEye - base;
  vec2 side = normalize(vec2(-toEye.z, toEye.x) + 1e-5);
  float yaw = rnd(cl, salt + 4) * 3.14159265;
  vec2 across = vec2(cos(yaw), sin(yaw));
  if (dot(across, side) < 0.0) across = -across;
  across = normalize(mix(across, side, 0.7));

  // fewer blades are drawn far off, so each is wider by as much as there are fewer of them
  float thick = 0.5 * uTuftShape.y * (uTuftShape.z / float(uBlades)) * (0.8 + 0.4 * rnd(cl, salt + 5)) * NARROW[row];
  float up = ALONG[row];
  vec2 bend = outward * (lean * height * up * up);
  vec3 world = base + vec3(bend.x, height * up * (1.0 - 0.3 * lean * up), bend.y) + vec3(across.x, 0.0, across.y) * (thick * SIDE[v]);
  gl_Position = uViewProj * vec4(world, 1.0);
  vAlong = up;
  vSeed = rnd(cl, salt + 6);
  // the ground's shadow at the root: the baked one where there is one, so the grass is shaded as the ground under it is
  vShadow = uSunOn > 0.5 ? 1.0 - sunVisibilityAt(base.xz) : shadowMapAt(base, vec3(0, 1, 0), false);
}
