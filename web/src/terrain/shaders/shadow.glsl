// Looking a point up in the sun's shadow maps. The maps are slices of the view, nearest first, each its own orthographic map
// along the sun; the hardware compares a depth with the map and filters 2x2 texels, and the high quality takes 3 x 3 of those
// across the look's soft edge. A shadow fades out at the end of the last slice. See shadow.ts for what fills these.
uniform highp sampler2DArrayShadow uShadowMap;
uniform mat4 uShadowMat[MAX_SHADOW_SLICES];  // world to each map's texture coordinates, depth 0 to 1
uniform vec4 uShadowSplit;                   // where each slice ends along the view, and how many slices there are (w); 0 is off
uniform vec3 uShadowTexel;                   // metres one texel of each map covers
uniform vec3 uShadowRange;                   // metres each map spans in depth
uniform vec4 uShadowMode;                    // 1 if the ground also shades itself, 1 for soft edges, texels across a map
uniform vec3 uShadowEye;                     // the camera, and the way it looks, to tell which slice a point is in
uniform vec3 uShadowForward;
uniform vec4 uShadowLook;                    // the look: strength, softness in metres, distance (the last slice's end is what is used)
uniform vec3 uShadowTint;                    // what shadow multiplies lit colour by, at full strength

// How much of the sun is blocked at a world point, 0 to 1. normal points away from the surface: the point is moved off it
// by a texel and a little in depth, which keeps a surface from shadowing itself.
float shadowMapAt(vec3 world, vec3 normal, bool soft) {
  int n = int(uShadowSplit.w + 0.5);
  if (n == 0) return 0.0;
  float depth = dot(world - uShadowEye, uShadowForward);
  int c = 0;
  if (n > 1 && depth > uShadowSplit.x) c = 1;
  if (n > 2 && depth > uShadowSplit.y) c = 2;
  float last = n == 1 ? uShadowSplit.x : (n == 2 ? uShadowSplit.y : uShadowSplit.z);
  if (depth > last) return 0.0;
  float texel = uShadowTexel[c];
  vec4 t = uShadowMat[c] * vec4(world + normal * (texel * 1.5), 1.0);
  if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0 || t.z > 1.0) return 0.0;
  float ref = t.z - 0.3 / uShadowRange[c]; // 30 cm of depth bias
  float lit;
  if (soft && uShadowMode.y > 0.5) {
    float spread = max(1.0, uShadowLook.y / texel) / uShadowMode.z; // the look's soft edge, in map coordinates
    lit = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) lit += texture(uShadowMap, vec4(t.xy + vec2(i, j) * spread, float(c), ref));
    lit /= 9.0;
  } else {
    lit = texture(uShadowMap, vec4(t.xy, float(c), ref));
  }
  return (1.0 - lit) * (1.0 - smoothstep(0.85 * last, last, depth));
}

// A colour in shadow: multiplied by the tint, as strongly as the look says. s is how much of the sun is blocked.
vec3 applyShadow(vec3 colour, float s) {
  return colour * mix(vec3(1), uShadowTint, clamp(s, 0.0, 1.0) * uShadowLook.x);
}
