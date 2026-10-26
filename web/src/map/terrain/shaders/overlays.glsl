vec3 slopeColour(float s) { // s is rise over run
  vec3 c0 = vec3(0.20, 0.45, 0.95); // under 1%
  vec3 c1 = vec3(0.20, 0.80, 0.40); // 2%
  vec3 c2 = vec3(0.95, 0.90, 0.20); // 4%
  vec3 c3 = vec3(0.95, 0.55, 0.15); // 8%
  vec3 c4 = vec3(0.90, 0.15, 0.15); // 15% and over
  vec3 c = mix(c0, c1, clamp((s - 0.01) / 0.01, 0.0, 1.0));
  c = mix(c, c2, clamp((s - 0.02) / 0.02, 0.0, 1.0));
  c = mix(c, c3, clamp((s - 0.04) / 0.04, 0.0, 1.0));
  return mix(c, c4, clamp((s - 0.08) / 0.07, 0.0, 1.0));
}

// how much to darken for a contour line at this height: 0 between lines, up to 0.7 on a major (every fifth) one
float contourDarkening(float height, float interval) {
  float v = height / interval;
  float w = fwidth(v);
  float d = abs(fract(v + 0.5) - 0.5);
  float line = (1.0 - smoothstep(0.0, max(1.2 * w, 1e-5), d)) * (1.0 - smoothstep(0.25, 0.5, w)); // fades out when too dense to read
  float major = mod(floor(v + 0.5), 5.0) < 0.5 ? 1.0 : 0.0;
  return line * mix(0.35, 0.7, major);
}
