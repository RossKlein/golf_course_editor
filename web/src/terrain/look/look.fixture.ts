import type { Look, Surface } from "../../core/api/api";
import { solarPosition } from "../sun";

// A look for tests (the real default is the server's, in course_maker/look_defaults.py): nine surfaces, three tree models and
// a sun at 11 am on the US east coast in midsummer.

const ROUGH: [number, number, number] = [0.4, 0.65, 0.24];
const TRUNK: [number, number, number] = [0.42, 0.29, 0.18];

const surface = (s: Partial<Surface> & Pick<Surface, "color" | "grain">): Surface => ({
  color2: null, earth: null, stripe: 0, shade: 1, speckleDark: 0, specklePale: 0, mottle: 0, tuft: 0, bump: 0, bumpMap: "grass", ...s,
});

export const testSun = solarPosition(33.5, 23.44, -36);

export const testLook: Look = {
  sky: [0.62, 0.76, 0.9],
  sun: { latitude: 33.5, declination: 23.44, hourAngle: -36 },
  surfaces: {
    rough: surface({ color: ROUGH, grain: 1, tuft: 1 }), // rough
    fairway: surface({ color: [0.5, 0.86, 0.3], color2: [0.66, 0.95, 0.44], stripe: 2.4, grain: 0.55, bump: 0.35 }), // fairway
    green: surface({ color: [0.6, 0.92, 0.38], grain: 0.3 }), // green
    collar: surface({ color: [0.52, 0.82, 0.3], color2: [0.6, 0.88, 0.36], stripe: 0.9, grain: 0.35 }), // collar
    tee: surface({ color: [0.64, 0.94, 0.42], grain: 0.35 }), // tee
    bunker: surface({ color: [0.965, 0.93, 0.81], grain: 0.4, speckleDark: 0.1, specklePale: 0.07, bump: 0.25, bumpMap: "grain" }), // bunker
    water: surface({ color: [0.27, 0.6, 0.86], grain: 0.15 }), // water
    path: surface({ color: [0.72, 0.66, 0.52], grain: 0.4 }), // path
    woods: surface({ color: ROUGH, earth: [0.42, 0.31, 0.2], mottle: 1.6, grain: 0.8, tuft: 0.7 }), // woods
  },
  relief: { smoothing: 2 },
  shadows: { strength: 0.8, tint: [0.5, 0.58, 0.78], softness: 0.6, distance: 200 },
  grass: { tile: "grass.png", tileMetres: 3, wobble: 0, speckleGrain: 0.03, smoothing: 2 },
  tufts: { height: 0.4, width: 1.1, root: [0.16, 0.31, 0.1], tip: [0.46, 0.66, 0.24] },
  trees: {
    ambient: 0.5,
    direct: 0.65,
    base: 0.78,
    kinds: [
      {
        name: "pine",
        height: [14, 24],
        parts: [
          { shape: "frustum", y0: 0, r0: 0.028, y1: 0.4, r1: 0.02, sides: 6, color: TRUNK, shade: 0.12 },
          { shape: "frustum", y0: 0.3, r0: 0.17, y1: 0.62, r1: 0, sides: 7, color: [0.16, 0.42, 0.2], shade: 0.12 },
          { shape: "frustum", y0: 0.5, r0: 0.14, y1: 0.82, r1: 0, sides: 7, color: [0.19, 0.48, 0.23], shade: 0.12 },
          { shape: "frustum", y0: 0.7, r0: 0.1, y1: 1, r1: 0, sides: 7, color: [0.22, 0.54, 0.26], shade: 0.12 },
        ],
      },
      {
        name: "broadleaf",
        height: [9, 15],
        parts: [
          { shape: "frustum", y0: 0, r0: 0.04, y1: 0.42, r1: 0.03, sides: 6, color: TRUNK, shade: 0.12 },
          { shape: "blob", cx: 0, cy: 0.68, cz: 0, rx: 0.3, ry: 0.3, rz: 0.3, color: [0.3, 0.6, 0.2], sides: 7, rings: 3 },
          { shape: "blob", cx: 0.1, cy: 0.84, cz: 0.05, rx: 0.19, ry: 0.17, rz: 0.19, color: [0.4, 0.7, 0.25], sides: 7, rings: 3 },
        ],
      },
      {
        name: "fir",
        height: [14, 24],
        parts: [
          { shape: "frustum", y0: 0, r0: 0.03, y1: 0.2, r1: 0.025, sides: 6, color: TRUNK, shade: 0.12 },
          { shape: "frustum", y0: 0.12, r0: 0.26, y1: 0.5, r1: 0, sides: 8, color: [0.1, 0.35, 0.2], shade: 0.12 },
          { shape: "frustum", y0: 0.34, r0: 0.2, y1: 0.74, r1: 0, sides: 8, color: [0.13, 0.41, 0.23], shade: 0.12 },
          { shape: "frustum", y0: 0.56, r0: 0.14, y1: 1, r1: 0, sides: 8, color: [0.16, 0.47, 0.26], shade: 0.12 },
        ],
      },
    ],
  },
};
