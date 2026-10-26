#include "head.glsl"
#include "height.glsl"
#include "look.glsl"

const int TILE = TUFT_TILE;
uniform sampler2D uClassMap;
uniform vec3 uClassInfo;
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform ivec2 uTile;      // the first tuft of the tile being drawn, in tufts from the patch's corner
uniform vec2 uCentre;     // the middle of the patch of tufts, a whole number of cells so tufts stay put as the camera moves
uniform float uCell;      // metres between tufts
uniform int uN;           // tufts across the patch
uniform float uRadius;    // metres from the centre where tufts have shrunk to nothing
uniform float uTall;      // typical tuft height, for a surface with a tuft factor of 1
uniform float uTuftWidth; // width as a multiple of the height
uniform float uScale;     // vertical exaggeration

out vec2 vUv;
out float vSeed;

const vec2 CORNER[6] = vec2[6](vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0));

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void hide() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the picture (allow-literal: a position, not a colour)
  vUv = vec2(0.0);
  vSeed = 0.0;
}

void main() {
  ivec2 cell = uTile + ivec2(gl_InstanceID % TILE, gl_InstanceID / TILE);
  if (cell.x >= uN || cell.y >= uN) { hide(); return; } // the last tiles overhang the patch
  vec2 idx = floor(uCentre / uCell + 0.5) + vec2(cell) - float(uN) * 0.5;
  vec2 pos = (idx + vec2(hash(idx), hash(idx + 17.3))) * uCell;

  ivec2 cc = ivec2(floor(pos / uClassInfo.x));
  cc = clamp(cc, ivec2(0), ivec2(int(uClassInfo.y), int(uClassInfo.z)) - 1);
  float cls = texelFetch(uClassMap, cc, 0).r * 255.0;
  vec2 ground = heightAt(pos);
  float dist = distance(pos, uCentre);
  float tuft = surfaceTuft(clamp(int(cls + 0.5), 0, SURFACES - 1)); // 0 where nothing stands
  bool grows = tuft > 0.0 && ground.y > 0.5 && dist < uRadius;
  if (!grows) { hide(); return; }

  float seed = hash(idx + 3.1);
  float fade = 1.0 - smoothstep(0.6 * uRadius, uRadius, dist);
  float h = uTall * (0.6 + 0.8 * seed) * fade * tuft;
  vec3 base = vec3(pos.x, ground.x * uScale, pos.y);
  vec3 toEye = uEye - base;
  vec2 side = normalize(vec2(-toEye.z, toEye.x)); // across the line of sight, so the tuft always faces the camera
  vec2 corner = CORNER[gl_VertexID];
  vec3 world = base + vec3(side.x, 0.0, side.y) * (corner.x - 0.5) * h * uTuftWidth + vec3(0.0, corner.y * h, 0.0);
  gl_Position = uViewProj * vec4(world, 1.0);
  vUv = corner;
  vSeed = seed;
}
