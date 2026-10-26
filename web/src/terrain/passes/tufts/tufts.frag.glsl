#include "head.glsl"

uniform vec3 uTuftRoot;
uniform vec3 uTuftTip;

in vec2 vUv;
in float vSeed;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // four blades, each a narrow triangle that leans a little and has its own height
  float shade = -1.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float centre = 0.2 + 0.2 * fi + (hash(vec2(fi, vSeed * 9.0)) - 0.5) * 0.14;
    float lean = (hash(vec2(fi + 7.0, vSeed * 9.0)) - 0.5) * 0.5;
    float top = 0.55 + 0.45 * hash(vec2(fi + 3.0, vSeed * 5.0));
    float x = vUv.x - (centre + lean * vUv.y * vUv.y);
    if (vUv.y < top && abs(x) < 0.085 * (1.0 - vUv.y / top)) shade = vUv.y / top;
  }
  if (shade < 0.0) discard;
  outColor = vec4(mix(uTuftRoot, uTuftTip, shade) * (0.85 + 0.3 * vSeed), 1.0);
}
