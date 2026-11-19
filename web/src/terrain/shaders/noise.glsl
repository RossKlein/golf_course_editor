// Random numbers and noise by place, shared by the standing grass and the ground. A hash that is an integer one (PCG), not the usual sin
// one: that leaves a faint lattice that shows from afar as a grid. rnd is a number in [0, 1) for a lattice point c and a salt that tells one
// use of it from another, so no two uses ever share a value.
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(ivec2 c, int salt) {
  return float(pcg(uint(c.x) + pcg(uint(c.y) + pcg(uint(salt)))) >> 8u) / 16777216.0;
}

// smooth noise with one value a unit square, 0 to 1
float valueNoise(vec2 p) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rnd(i, 100), rnd(i + ivec2(1, 0), 100), u.x), mix(rnd(i + ivec2(0, 1), 100), rnd(i + ivec2(1, 1), 100), u.x), u.y);
}
