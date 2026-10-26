import { describe, expect, it } from "vitest";
import { boxVisible, frustumOf } from "./frustum";
import { lookAt, multiply, perspective } from "./mat4";

// a camera at the origin looking north (-z), 45 degrees tall, square, seeing from 1 m to 1 km
const view = lookAt([0, 0, 0], [0, 0, -1]);
const f = frustumOf(multiply(perspective((45 * Math.PI) / 180, 1, 1, 1000), view));
const box = (x: number, y: number, z: number, r = 1) => boxVisible(f, x - r, y - r, z - r, x + r, y + r, z + r);

describe("view frustum", () => {
  it("sees what is ahead", () => {
    expect(box(0, 0, -50)).toBe(true);
    expect(box(10, 5, -100)).toBe(true);
  });

  it("does not see what is behind the camera", () => {
    expect(box(0, 0, 50)).toBe(false);
    expect(box(0, 0, 5)).toBe(false);
  });

  it("does not see what is far to either side, above or below", () => {
    expect(box(100, 0, -50)).toBe(false);
    expect(box(-100, 0, -50)).toBe(false);
    expect(box(0, 100, -50)).toBe(false);
    expect(box(0, -100, -50)).toBe(false);
  });

  it("does not see what is beyond the far plane", () => {
    expect(box(0, 0, -2000)).toBe(false);
  });

  it("keeps a box that is only partly in view", () => {
    expect(boxVisible(f, -100, -1, -60, 100, 1, -40)).toBe(true); // a wide strip crossing the view
    expect(boxVisible(f, -1, -1, -3, 1, 1, 3)).toBe(true); // one that straddles the camera
  });

  it("follows the camera round", () => {
    const east = frustumOf(multiply(perspective((45 * Math.PI) / 180, 1, 1, 1000), lookAt([0, 0, 0], [1, 0, 0])));
    expect(boxVisible(east, 49, -1, -1, 51, 1, 1)).toBe(true);
    expect(boxVisible(east, -51, -1, -1, -49, 1, 1)).toBe(false);
  });
});
