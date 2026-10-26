import { describe, expect, it } from "vitest";
import { basis, reliefAt, reliefScale, reliefTaps, reliefWeights } from "./reliefMath";

const grid = (f: (x: number, z: number) => number | null) => (i: number, j: number) => f(i, j);

describe("the spline's derivatives", () => {
  it("agree with differences of the spline itself", () => {
    for (const x of [-1.7, -1.2, -0.6, -0.1, 0.3, 0.9, 1.4, 1.9]) {
      const h = 1e-5;
      const d1 = (basis(x + h).b - basis(x - h).b) / (2 * h);
      const d2 = (basis(x + h).d1 - basis(x - h).d1) / (2 * h);
      expect(basis(x).d1).toBeCloseTo(d1, 5);
      expect(basis(x).d2).toBeCloseTo(d2, 5);
    }
  });

  it("is a smooth bump with a slope that is odd and a curvature that is even", () => {
    expect(basis(0).b).toBeCloseTo(2 / 3, 12);
    expect(basis(0).d1).toBe(0);
    expect(basis(0.7).d1).toBeCloseTo(-basis(-0.7).d1, 12);
    expect(basis(0.7).d2).toBeCloseTo(basis(-0.7).d2, 12);
    expect(basis(2).b).toBe(0);
  });
});

describe("the width of the spline", () => {
  it("follows the radius, from one sample to the unit up", () => {
    expect(reliefScale(2, 1)).toBe(1);
    expect(reliefScale(4, 1)).toBe(2);
    expect(reliefScale(6, 1)).toBe(3);
    expect(reliefScale(1, 1)).toBe(1);
    expect(reliefTaps(1)).toBe(4);
    expect(reliefTaps(3)).toBe(12);
    expect(reliefTaps(1.3) % 2).toBe(0);
  });

  it("weights add up to what a plane and a bowl need, whatever the width", () => {
    for (const scale of [1, 1.5, 2, 3]) {
      const w = reliefWeights(scale);
      expect(w.n0).toBeCloseTo(1, 1);
      expect(w.n1).toBeGreaterThan(0.7);
      expect(w.n2).toBeGreaterThan(0.7);
    }
  });
});

describe("the relief of the ground", () => {
  it("is the exact slope of a plane, with different spacing east and south", () => {
    const resX = 1, resZ = 2;
    // rises 0.3 m per metre east and falls 0.1 m per metre south
    const plane = grid((i, j) => 5 + 0.3 * i * resX - 0.1 * j * resZ);
    for (const scale of [1, 1.5, 2, 3]) {
      const r = reliefAt(plane, 40, 40, scale, resX, resZ)!;
      expect(r.gx).toBeCloseTo(0.3, 9);
      expect(r.gz).toBeCloseTo(-0.1, 9);
      expect(r.curvature).toBeCloseTo(0, 9);
    }
  });

  it("is the exact curvature of a bowl, and positive in a hollow", () => {
    const bowl = grid((i, j) => 0.5 * 0.2 * (i * i + j * j)); // second derivative 0.2 along each axis
    for (const scale of [1, 2, 3]) {
      const r = reliefAt(bowl, 0, 0, scale, 1, 1)!;
      expect(r.curvature).toBeCloseTo(0.4, 6);
      expect(r.gx).toBeCloseTo(0, 9);
    }
    const crest = grid((i, j) => -0.5 * 0.2 * (i * i + j * j));
    expect(reliefAt(crest, 0, 0, 1, 1, 1)!.curvature).toBeLessThan(0);
  });

  it("is smoother than differences of the grid, which is why it does not look faceted", () => {
    // a rolling field with a little roughness: a hill and noise on the 1 m grid
    const noise = (i: number, j: number) => Math.sin(i * 12.9898 + j * 78.233) * 43758.5453 % 1;
    const field = grid((i, j) => 4 * Math.exp(-((i - 30) ** 2 + (j - 30) ** 2) / 200) + 0.08 * noise(i, j));
    const raw = (i: number, j: number) => field(i + 1, j)! - field(i, j)!; // the slope across each square of the grid: what the bilinear surface has
    const jump = (slope: (i: number, j: number) => number) => {
      let total = 0, n = 0;
      for (let j = 20; j < 40; j++) for (let i = 20; i < 40; i++, n++) total += Math.abs(slope(i + 1, j) - slope(i, j));
      return total / n; // how much the slope changes from one sample to the next
    };
    const smooth = (scale: number) => jump((i, j) => reliefAt(field, i, j, scale, 1, 1)!.gx);
    expect(smooth(1)).toBeLessThan(jump(raw) * 0.6);
    expect(smooth(2)).toBeLessThan(smooth(1));
  });

  it("does not make a spike where data is missing", () => {
    const plane = (hole: boolean) => grid((i, j) => (hole && i === 41 && j === 40 ? null : 2 * i));
    const whole = reliefAt(plane(false), 40, 40, 1, 1, 1)!;
    const holed = reliefAt(plane(true), 40, 40, 1, 1, 1)!;
    expect(Math.abs(holed.gx - whole.gx)).toBeLessThan(0.7); // a missing sample counts as level with the centre: a bounded change on a slope this steep (2 m per metre)
    expect(Math.abs(holed.gz)).toBeLessThan(0.5);
  });

  it("is nothing where the sample itself has no data", () => {
    expect(reliefAt(grid(() => null), 3, 3, 1, 1, 1)).toBeNull();
  });
});
