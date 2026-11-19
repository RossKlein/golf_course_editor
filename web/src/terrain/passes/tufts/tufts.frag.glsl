#include "head.glsl"
#include "shadow.glsl"

uniform vec3 uTuftRoot;
uniform vec3 uTuftTip;

in float vAlong;
in float vSeed;
in float vShadow;
out vec4 outColor;

void main() {
  // a blade is the geometry, so there is nothing to cut out: its colour runs from the root to the tip, and each blade is a little lighter or darker
  outColor = vec4(applyShadow(mix(uTuftRoot, uTuftTip, vAlong) * (0.85 + 0.3 * vSeed), vShadow), 1.0);
}
