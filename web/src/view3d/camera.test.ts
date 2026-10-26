import { describe, expect, it } from "vitest";
import { cameraFor, eyeOf, FOV, matricesOf, meshWindow, MAX_DISTANCE, nudge, orbit, pan, visibleHeightOf, zoom, type Camera } from "./camera";
import { lookAt, multiply, perspective, transform } from "./mat4";

const flat = () => 0;
const cam = (over: Partial<Camera> = {}): Camera => ({ x: 100, z: 200, yaw: 0, pitch: Math.PI / 4, distance: 100, ...over });
const deg = (d: number) => (d * Math.PI) / 180;

describe("matrices", () => {
  it("a point in front of the camera lands in the middle of the picture", () => {
    const m = multiply(perspective(FOV, 2, 1, 1000), lookAt([0, 10, 0], [0, 0, -50]));
    const [x, y, z, w] = transform(m, [0, 0, -50]);
    expect(x / w).toBeCloseTo(0, 5);
    expect(y / w).toBeCloseTo(0, 5);
    expect(z / w).toBeGreaterThan(-1);
    expect(z / w).toBeLessThan(1);
  });

  it("east is to the right and up is up when looking north", () => {
    const { viewProj } = matricesOf(cam({ yaw: 0 }), 1, flat);
    const centre = transform(viewProj, [100, 0, 200]);
    const east = transform(viewProj, [110, 0, 200]);
    const above = transform(viewProj, [100, 10, 200]);
    expect(east[0] / east[3]).toBeGreaterThan(centre[0] / centre[3]);
    expect(above[1] / above[3]).toBeGreaterThan(centre[1] / centre[3]);
  });

  it("looking east, south is to the right", () => {
    const { viewProj } = matricesOf(cam({ yaw: deg(90) }), 1, flat);
    const centre = transform(viewProj, [100, 0, 200]);
    const south = transform(viewProj, [100, 0, 210]);
    expect(south[0] / south[3]).toBeGreaterThan(centre[0] / centre[3]);
  });

  it("the target is in the middle of the picture", () => {
    const { viewProj } = matricesOf(cam({ yaw: deg(37) }), 1.6, (x) => x * 0.1);
    const [x, y, , w] = transform(viewProj, [100, 10, 200]);
    expect(x / w).toBeCloseTo(0, 4);
    expect(y / w).toBeCloseTo(0, 4);
  });
});

describe("eye", () => {
  it("sits behind and above the target, on the side it is looking from", () => {
    const [x, y, z] = eyeOf(cam({ yaw: 0, pitch: deg(45), distance: 100 }), flat);
    expect(x).toBeCloseTo(100);
    expect(z).toBeGreaterThan(200); // looking north, so the eye is south of the target
    expect(y).toBeCloseTo(70.71, 1);
  });

  it("never goes below the ground", () => {
    const hill = (x: number) => (x > 150 ? 500 : 0);
    const [, y] = eyeOf(cam({ x: 100, z: 0, yaw: deg(270), pitch: deg(5), distance: 100 }), hill); // looking west from the hill
    expect(y).toBeGreaterThanOrEqual(502);
  });
});

describe("moving the camera", () => {
  it("dragging right swings the view the other way, and dragging down lowers the camera", () => {
    expect(orbit(cam(), 50, 0).yaw).toBeLessThan(0);
    expect(orbit(cam(), 0, 50).pitch).toBeGreaterThan(cam().pitch);
  });

  it("stops short of the horizon and of straight down", () => {
    expect(orbit(cam(), 0, -1e6).pitch).toBeGreaterThan(0);
    expect(orbit(cam(), 0, 1e6).pitch).toBeLessThan(Math.PI / 2);
  });

  it("dragging the ground right moves the target left, relative to the view", () => {
    expect(pan(cam({ yaw: 0 }), 100, 0, 800).x).toBeLessThan(100);
    // facing east, the camera's right is south, so the target moves north
    expect(pan(cam({ yaw: deg(90) }), 100, 0, 800).z).toBeLessThan(200);
  });

  it("dragging the ground down moves the target forward", () => {
    expect(pan(cam({ yaw: 0 }), 0, 100, 800).z).toBeLessThan(200); // forward is north
  });

  it("covers more ground per pixel when further away", () => {
    const near = pan(cam({ distance: 50 }), 100, 0, 800);
    const far = pan(cam({ distance: 500 }), 100, 0, 800);
    expect(100 - far.x).toBeGreaterThan(10 * (100 - near.x) * 0.99);
  });

  it("nudges forward and sideways with the view", () => {
    const n = nudge(cam({ yaw: 0 }), 0, 1);
    expect(n.z).toBeLessThan(200);
    expect(n.x).toBeCloseTo(100);
    expect(nudge(cam({ yaw: 0 }), 1, 0).x).toBeGreaterThan(100);
  });

  it("zooms within limits", () => {
    expect(zoom(cam({ distance: 100 }), 2).distance).toBe(50);
    expect(zoom(cam({ distance: 5 }), 100).distance).toBeGreaterThan(0);
    expect(zoom(cam({ distance: MAX_DISTANCE }), 0.01).distance).toBe(MAX_DISTANCE);
  });
});

describe("matching the 2D view", () => {
  it("opens at a distance that shows about the same ground, and converts back", () => {
    const c = cameraFor(500, 600, 300);
    expect(visibleHeightOf(c)).toBeCloseTo(300, 6);
    expect([c.x, c.z]).toEqual([500, 600]);
  });

  it("keeps the angle of a previous view", () => {
    const c = cameraFor(0, 0, 100, cam({ yaw: 1, pitch: 0.7 }));
    expect([c.yaw, c.pitch]).toEqual([1, 0.7]);
  });
});

describe("mesh window", () => {
  it("uses finer squares when close and coarser when far", () => {
    expect(meshWindow(cam({ distance: 20 })).spacing).toBeLessThan(meshWindow(cam({ distance: 2000 })).spacing);
  });

  it("always covers the target with room to spare, snapped so it does not crawl", () => {
    for (const distance of [10, 80, 400, 3000]) {
      for (const x of [0, 17.3, 1234.5, 2999]) {
        const w = meshWindow(cam({ distance, x, z: 321 }));
        const size = w.quads * w.spacing;
        expect(w.x0).toBeLessThanOrEqual(x - size * 0.4);
        expect(w.x0 + size).toBeGreaterThanOrEqual(x + size * 0.4);
        expect(Math.abs((w.x0 / (w.spacing * 32)) % 1)).toBe(0);
      }
    }
  });

  it("holds still while the target moves a little", () => {
    expect(meshWindow(cam({ x: 100 })).x0).toBe(meshWindow(cam({ x: 105 })).x0);
  });
});
