import { describe, expect, it } from "vitest";
import { invert, lookAt, multiply, ortho, perspective, project, transform } from "./mat4";

const close = (a: ArrayLike<number>, b: ArrayLike<number>, digits = 4) => {
  for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], digits);
};
const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

describe("matrices", () => {
  const view = lookAt([3, 40, -20], [100, 5, 60]);
  const cam = multiply(perspective(0.8, 1.6, 0.5, 900), view);

  it("inverts a camera, so a matrix times its inverse is the identity", () => {
    const inv = invert(cam)!;
    close(multiply(cam, inv), identity, 3);
    close(multiply(inv, cam), identity, 3);
  });

  it("has no inverse for a flat matrix", () => {
    expect(invert(new Float32Array(16))).toBeNull();
  });

  it("unprojects the corners of the view to where the camera sees them", () => {
    const inv = invert(cam)!;
    const far = project(inv, [0, 0, 1]); // the middle of the far plane
    const back = project(cam, far);
    close(back, [0, 0, 1], 3);
  });

  it("maps an orthographic box onto the clip cube", () => {
    const m = ortho(-10, 30, -5, 5, 1, 101);
    close(project(m, [-10, -5, -1]), [-1, -1, -1]);
    close(project(m, [30, 5, -101]), [1, 1, 1]);
    close(project(m, [10, 0, -51]), [0, 0, 0]);
  });

  it("projects with the divide by w", () => {
    const p = transform(cam, [100, 5, 60]);
    close(project(cam, [100, 5, 60]), [p[0] / p[3], p[1] / p[3], p[2] / p[3]]);
  });
});
