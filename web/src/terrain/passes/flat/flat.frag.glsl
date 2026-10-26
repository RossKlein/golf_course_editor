#include "head.glsl"
#include "height.glsl"
#include "overlays.glsl"

uniform vec2 uMapOrigin;     // map coordinates (x, -z) of the bottom-left pixel
uniform vec2 uMapPerPixel;   // map units per pixel
uniform float uExaggeration;
uniform float uContour;      // metres between contour lines, 0 for none
uniform float uSlope;        // 1 to colour by slope
uniform vec2 uSun;           // compass bearing and height of the sun, radians

out vec4 outColor;

const float PI = 3.14159265358979;

void main() {
  vec2 map = uMapOrigin + gl_FragCoord.xy * uMapPerPixel;
  vec2 p = vec2(map.x, -map.y); // course metres: x east, z south

  if (!onGrid(p)) {
    outColor = vec4(0.0);
    return;
  }

  // a quarter of a metre either side like the game's normal(), or half a pixel when zoomed out so that one pixel does
  // not alias a whole patch of ground
  float s = max(0.25, 0.5 * max(uMapPerPixel.x, uMapPerPixel.y));
  vec2 g = gradientAt(p, s);

  float steep = length(g) * uExaggeration;
  float slope = PI / 2.0 - atan(steep);
  float aspect = atan(-g.x, g.y);
  float shade = clamp(sin(uSun.y) * sin(slope) + cos(uSun.y) * cos(slope) * cos(uSun.x - aspect), 0.0, 1.0);
  vec3 col = vec3(shade);

  if (uSlope > 0.5) col = mix(col, slopeColour(length(g)) * (0.55 + 0.45 * shade), 0.7);
  if (uContour > 0.0) col *= 1.0 - contourDarkening(heightAt(p).x, uContour);

  outColor = vec4(col, 1.0);
}
