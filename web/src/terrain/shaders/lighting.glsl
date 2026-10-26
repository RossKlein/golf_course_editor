// What the lighting bakes (terrain/lighting/) say about a point of the ground. Each is one pixel to a height sample, read with
// ordinary filtering; where one is not there the point is lit as open ground.
uniform sampler2D uSkyMap;   // R16F: how much of the sky the ground can see, 0 to 1
uniform float uSkyOn;        // 1 when uSkyMap holds the bake
uniform sampler2D uSunMap;   // R8, two texels to a height sample each way: how much of the sun reaches the ground, 0 to 1
uniform float uSunOn;        // 1 when uSunMap holds the bake

// How much sky the ground at a point can see: 1 on open ground, less in a hollow, under a bank, beside a hill
float skyVisibilityAt(vec2 p) {
  if (uSkyOn < 0.5) return 1.0;
  vec2 f = (p - uOrigin) / uRes + 0.5; // a sample's centre is its pixel's centre
  return texture(uSkyMap, f / vec2(uGrid)).r;
}

// How much of the sun reaches the ground at a point, past the terrain: 1 in the open, 0 in shadow, soft at the edge
float sunVisibilityAt(vec2 p) {
  if (uSunOn < 0.5) return 1.0;
  vec2 f = (p - uOrigin) / uRes + 0.5; // the texture covers the same samples, with twice the texels
  return texture(uSunMap, f / vec2(uGrid)).r;
}
