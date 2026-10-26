uniform vec3 uSlopeColor[5]; // the slope palette, for under 1%, 2%, 4%, 8% and 15% and over (the editor's theme)
uniform vec2 uContourStyle;  // how much a contour line darkens: an ordinary one, and every fifth

vec3 slopeColour(float s) { // s is rise over run
  vec3 c = mix(uSlopeColor[0], uSlopeColor[1], clamp((s - 0.01) / 0.01, 0.0, 1.0));
  c = mix(c, uSlopeColor[2], clamp((s - 0.02) / 0.02, 0.0, 1.0));
  c = mix(c, uSlopeColor[3], clamp((s - 0.04) / 0.04, 0.0, 1.0));
  return mix(c, uSlopeColor[4], clamp((s - 0.08) / 0.07, 0.0, 1.0));
}

// how much to darken for a contour line at this height: 0 between lines, the style's strength on a line
float contourDarkening(float height, float interval) {
  float v = height / interval;
  float w = fwidth(v);
  float d = abs(fract(v + 0.5) - 0.5);
  float line = (1.0 - smoothstep(0.0, max(1.2 * w, 1e-5), d)) * (1.0 - smoothstep(0.25, 0.5, w)); // fades out when too dense to read
  float major = mod(floor(v + 0.5), 5.0) < 0.5 ? 1.0 : 0.0;
  return line * mix(uContourStyle.x, uContourStyle.y, major);
}
