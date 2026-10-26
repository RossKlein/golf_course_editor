uniform sampler2D uHeight;   // RG32F: r = baked height in metres, g = 1 where there is data
uniform sampler2D uDelta;    // RGBA32F: r = sculpted offset from the baked height, in metres
uniform float uHasDelta;     // 1 when uDelta holds sculpting
uniform ivec2 uGrid;         // samples across, down
uniform vec2 uOrigin;        // course metres of sample (0, 0)
uniform vec2 uRes;           // metres between samples, x and z

// height (x) and whether there is data (y) of one grid sample: the baked height plus whatever was sculpted
vec2 sampleAt(ivec2 c) {
  vec2 s = texelFetch(uHeight, c, 0).rg;
  return vec2(s.x + (uHasDelta > 0.5 ? texelFetch(uDelta, c, 0).r : 0.0), s.y);
}

// height (x) and whether there is data (y) at a point in course metres, bilinear between the four nearest samples
vec2 heightAt(vec2 p) {
  vec2 f = clamp((p - uOrigin) / uRes, vec2(0.0), vec2(uGrid - 1));
  ivec2 c = min(ivec2(floor(f)), uGrid - 2);
  vec2 t = f - vec2(c);
  vec2 a = sampleAt(c);
  vec2 b = sampleAt(c + ivec2(1, 0));
  vec2 d = sampleAt(c + ivec2(0, 1));
  vec2 e = sampleAt(c + ivec2(1, 1));
  float ok = min(min(a.y, b.y), min(d.y, e.y));
  float h = mix(mix(a.x, b.x, t.x), mix(d.x, e.x, t.x), t.y);
  return vec2(h, ok);
}

// whether a point is on the grid (half a sample of margin, as the samples are cells' centres) and has data
bool onGrid(vec2 p) {
  vec2 f = (p - uOrigin) / uRes;
  return f.x >= -0.5 && f.y >= -0.5 && f.x <= float(uGrid.x) - 0.5 && f.y <= float(uGrid.y) - 0.5 && heightAt(p).y > 0.5;
}

// how much the ground curves: positive in a hollow, negative on a crest, per metre; 0 beside missing data
float curvatureAt(vec2 p, float s) {
  vec2 c = heightAt(p), e = heightAt(p + vec2(s, 0.0)), w = heightAt(p - vec2(s, 0.0)), n = heightAt(p - vec2(0.0, s)), t = heightAt(p + vec2(0.0, s));
  if (min(min(c.y, e.y), min(min(w.y, n.y), t.y)) < 0.5) return 0.0;
  return (e.x + w.x + n.x + t.x - 4.0 * c.x) / (s * s);
}

// rise over run to the east and to the south, from central differences s metres either side
vec2 gradientAt(vec2 p, float s) {
  float here = heightAt(p).x;
  vec2 ex = heightAt(p + vec2(s, 0.0)), wx = heightAt(p - vec2(s, 0.0));
  vec2 ez = heightAt(p + vec2(0.0, s)), wz = heightAt(p - vec2(0.0, s));
  return vec2(((ex.y > 0.5 ? ex.x : here) - (wx.y > 0.5 ? wx.x : here)) / (2.0 * s),
              ((ez.y > 0.5 ? ez.x : here) - (wz.y > 0.5 ? wz.x : here)) / (2.0 * s));
}
