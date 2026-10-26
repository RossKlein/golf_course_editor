// The course's look, as the renderer loads it from the bundle: one row of four vec4s for each surface class (see
// packSurfaces in look.ts). Nothing about a surface's colour or what grows on it is written in a shader.
uniform vec4 uSurface[SURFACES * 4];

vec3 surfaceColor(int cls)   { return uSurface[cls * 4].rgb; }
float surfaceStripe(int cls) { return uSurface[cls * 4].a; }      // metres across a mowing stripe, 0 for none
vec3 surfaceColor2(int cls)  { return uSurface[cls * 4 + 1].rgb; } // the other stripe's colour
float surfaceGrain(int cls)  { return uSurface[cls * 4 + 1].a; }  // how much grass texture shows
vec3 surfaceEarth(int cls)   { return uSurface[cls * 4 + 2].rgb; }
float surfaceMottle(int cls) { return uSurface[cls * 4 + 2].a; }  // how strongly the earth shows, 0 for none
float surfaceShade(int cls)  { return uSurface[cls * 4 + 3].x; }  // how much the relief shading applies
vec2 surfaceSpeckle(int cls) { return uSurface[cls * 4 + 3].yz; } // how much a dark grain darkens, a pale one lightens
float surfaceTuft(int cls)   { return uSurface[cls * 4 + 3].w; }  // standing grass height factor, 0 for none
