uniform sampler2D uHeight;   // RG32F: r = baked height in metres, g = 1 where there is data
uniform sampler2D uDelta;    // RGBA32F: r = sculpted offset from the baked height, in metres
uniform float uHasDelta;     // 1 when uDelta holds sculpting
uniform ivec2 uGrid;         // samples across, down
uniform vec2 uOrigin;        // course metres of sample (0, 0)
uniform vec2 uRes;           // metres between samples, x and z
uniform sampler2D uReliefMap; // RG16F, one pixel a sample: slope east and south of the spline-smoothed heights (see relief/)
uniform float uReliefOn;      // 1 when uReliefMap holds the baked relief

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

// rise over run to the east and to the south, from central differences s metres either side
vec2 gradientAt(vec2 p, float s) {
  float here = heightAt(p).x;
  vec2 ex = heightAt(p + vec2(s, 0.0)), wx = heightAt(p - vec2(s, 0.0));
  vec2 ez = heightAt(p + vec2(0.0, s)), wz = heightAt(p - vec2(0.0, s));
  return vec2(((ex.y > 0.5 ? ex.x : here) - (wx.y > 0.5 ? wx.x : here)) / (2.0 * s),
              ((ez.y > 0.5 ? ez.x : here) - (wz.y > 0.5 ? wz.x : here)) / (2.0 * s));
}

// The ground's slope to the east and south at a point, for lighting. The baked relief is smooth and the same at every
// distance, and its mipmaps average it as the ground gets far away. Without it (a GPU that cannot bake it) the slope comes
// from differences of heights s metres either side, which is faceted but works.
vec2 reliefAt(vec2 p, float s) {
  vec2 slope = vec2(0.0);
  if (uReliefOn > 0.5) {
    vec2 f = (p - uOrigin) / uRes + 0.5; // a sample's centre is its pixel's centre
    slope = texture(uReliefMap, f / vec2(uGrid)).xy;
  } else {
    slope = gradientAt(p, s);
  }
  return slope;
}
