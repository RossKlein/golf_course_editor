#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uHeight;   // baked heights: r = metres, g = 1 where there is data
uniform sampler2D uDelta;    // offsets so far, in r
uniform ivec2 uGrid;
uniform ivec2 uBox;          // the sample this pass's first pixel is
uniform vec2 uCentre;        // brush centre, in samples
uniform float uRadius;       // in samples
uniform float uHardness;
uniform float uAmount;       // metres, for raise and lower
uniform float uPull;         // 0..1, for smooth, flatten and restore
uniform float uLevel;        // metres, for flatten
uniform int uKind;           // 0 raise, 1 lower, 2 smooth, 3 flatten, 4 restore
uniform int uStep;           // samples between the taps of the smoothing kernel

out vec4 outColor;

float heightAt(ivec2 c) {
  c = clamp(c, ivec2(0), uGrid - 1);
  return texelFetch(uHeight, c, 0).r + texelFetch(uDelta, c, 0).r;
}

void main() {
  ivec2 c = uBox + ivec2(gl_FragCoord.xy);
  float offset = texelFetch(uDelta, c, 0).r;
  vec2 base = texelFetch(uHeight, c, 0).rg;
  float d = distance(vec2(c), uCentre);
  float core = uRadius * uHardness;
  float w = d >= uRadius ? 0.0 : (d <= core ? 1.0 : 1.0 - smoothstep(core, uRadius, d));
  if (w > 0.0 && base.y > 0.5) {
    float height = base.x + offset;
    if (uKind == 0) {
      offset += uAmount * w;
    } else if (uKind == 1) {
      offset -= uAmount * w;
    } else if (uKind == 2) {
      // a 5 x 5 binomial blur of the current heights
      float sum = 0.0;
      for (int j = -2; j <= 2; j++) {
        for (int i = -2; i <= 2; i++) {
          float wi = (i == 0 ? 6.0 : (abs(i) == 1 ? 4.0 : 1.0)) * (j == 0 ? 6.0 : (abs(j) == 1 ? 4.0 : 1.0));
          sum += wi * heightAt(c + ivec2(i, j) * uStep);
        }
      }
      offset = height + (sum / 256.0 - height) * min(1.0, uPull * w) - base.x;
    } else if (uKind == 3) {
      offset = height + (uLevel - height) * min(1.0, uPull * w) - base.x;
    } else {
      offset *= 1.0 - min(1.0, uPull * w);
    }
    offset = clamp(offset, -32.0, 32.0);
  }
  outColor = vec4(offset, 0.0, 0.0, 1.0);
}
