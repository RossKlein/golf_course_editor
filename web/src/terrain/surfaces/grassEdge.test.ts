import { describe, expect, it } from "vitest";
import { edgeStep, worldGradient, type EdgeInput } from "./grassEdge";

// the sun is over the taller grass (a, towards +x), as in a noon shade at the foot of a wall facing it, and the step is true height
const base: EdgeInput = { dist: 0, normal: [1, 0], heightA: 0.06, heightB: 0.015, width: 0.08, shadow: 0.4, gain: 1, sun: [1, 0], pixel: 0.005 };
const at = (dist: number, over: Partial<EdgeInput> = {}) => edgeStep({ ...base, ...over, dist });

describe("the gradient of a value across the ground", () => {
  it("is the change per pixel when a pixel is a metre", () => {
    expect(worldGradient([0.3, -0.2], [1, 0], [0, 1])).toEqual([0.3, -0.2]);
  });

  it("is steeper when a pixel covers less ground", () => {
    const [gx, gz] = worldGradient([0.3, -0.2], [0.1, 0], [0, 0.1]);
    expect(gx).toBeCloseTo(3);
    expect(gz).toBeCloseTo(-2);
  });

  it("finds the direction of a change whatever way the pixels lie on the ground", () => {
    // the value is 2x + 5z; the pixel across covers (0.5, 0.5) metres and the pixel down (-0.5, 0.5)
    const [gx, gz] = worldGradient([2 * 0.5 + 5 * 0.5, 2 * -0.5 + 5 * 0.5], [0.5, 0.5], [-0.5, 0.5]);
    expect(gx).toBeCloseTo(2);
    expect(gz).toBeCloseTo(5);
  });

  it("is nothing where the pixel covers no ground", () => {
    expect(worldGradient([1, 1], [1, 0], [2, 0])).toEqual([0, 0]);
  });
});

describe("the step between two heights of grass", () => {
  it("is level on the shorter side up to the line, and the taller grass's height past the wall", () => {
    expect(at(-1).height).toBeCloseTo(0.015);
    expect(at(-0.001).height).toBeCloseTo(0.015);
    expect(at(0).height).toBeCloseTo(0.015); // the foot of the wall is at the line
    expect(at(0.04).height).toBeCloseTo(0.0375); // half way up the wall
    expect(at(0.08).height).toBeCloseTo(0.06);
    expect(at(1).height).toBeCloseTo(0.06);
  });

  it("puts the whole wall on the taller side, so it is textured as the taller grass", () => {
    expect(at(-0.01).slope).toEqual([0, 0]); // the shorter side has no wall
    expect(at(-0.5).slope).toEqual([0, 0]);
    expect(at(0.04).slope[0]).toBeGreaterThan(0);
    expect(at(0.08).slope).toEqual([0, 0]); // and the top of it is level again
    expect(at(1).slope).toEqual([0, 0]);
  });

  it("has a slope only across the line, towards the taller grass", () => {
    expect(at(0.04).slope[0]).toBeGreaterThan(0);
    expect(at(0.04).slope[1]).toBe(0);
  });

  it("puts the wall on b's side, sloping the other way, when the heavier surface is the shorter", () => {
    const flipped = { heightA: 0.015, heightB: 0.06 };
    expect(at(0.04, flipped).slope).toEqual([0, 0]); // a's own side is the shorter
    expect(at(-0.04, flipped).slope[0]).toBeLessThan(0); // the wall is across the line, up towards b
    expect(at(-0.04, flipped).height).toBeCloseTo(0.0375);
  });

  it("is steepest half way up, 1.5 times its average slope", () => {
    const rise = 0.06 - 0.015;
    expect(at(0.04).slope[0]).toBeCloseTo((1.5 * rise) / 0.08, 6);
  });

  it("adds up to the whole step: the slopes across the wall integrate to the difference in height", () => {
    let sum = 0;
    const dx = 0.0005;
    for (let x = -0.2; x < 0.3; x += dx) sum += at(x).slope[0] * dx;
    expect(sum).toBeCloseTo(0.045, 4);
  });

  it("points along the normal, whatever it is", () => {
    const s = at(0.04, { normal: [0.6, 0.8] }).slope;
    expect(s[1] / s[0]).toBeCloseTo(0.8 / 0.6);
  });

  it("is nothing where the heights are the same", () => {
    const flat = at(0.02, { heightA: 0.02, heightB: 0.02 });
    expect(flat.slope).toEqual([0, 0]);
    expect(flat.occlusion).toBe(1);
  });

  it("is never narrower than a pixel and a half, so it does not shimmer, and so fades as pixels grow", () => {
    const near = at(0.04, { pixel: 0.005 }).slope[0];
    const far = at(0.75, { pixel: 1 }).slope[0]; // the wall is 1.5 m wide when a pixel is a metre
    expect(far).toBeLessThan(near / 10);
    expect(far).toBeGreaterThan(0);
  });

  it("is wider when the look says so, and gentler", () => {
    expect(at(0.1, { width: 0.2 }).slope[0]).toBeLessThan(at(0.04, { width: 0.08 }).slope[0]);
  });
});

describe("the shade at the foot of a step", () => {
  it("darkens the shorter grass at the line, and never the taller", () => {
    expect(at(-0.02).occlusion).toBeLessThan(1);
    for (const x of [0.02, 0.05, 0.5]) expect(at(x).occlusion).toBe(1);
  });

  it("darkens the other side when the heavier surface is the shorter", () => {
    const flipped = { heightA: 0.015, heightB: 0.06 };
    expect(at(0.02, flipped).occlusion).toBeLessThan(1);
    expect(at(-0.05, flipped).occlusion).toBe(1);
  });

  it("is darkest at the foot, at the line, and fades out into the shorter grass", () => {
    const d = [0.002, 0.03, 0.08, 0.16, 0.3, 0.6].map((x) => at(-x).occlusion); // metres into the shorter grass
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]);
    expect(d[0]).toBeLessThan(0.7);
    expect(d[d.length - 1]).toBe(1);
  });

  it("comes on over a pixel at the line, so the edge is not jagged", () => {
    const px = { pixel: 0.01 };
    expect(at(0.004, px).occlusion).toBeGreaterThan(at(-0.004, px).occlusion); // inside the pixel it is half way
    expect(at(0.004, px).occlusion).toBeLessThan(1);
  });

  it("is as strong as the look says, and none for none", () => {
    expect(at(-0.01, { shadow: 0 }).occlusion).toBe(1);
    expect(at(-0.01, { shadow: 1 }).occlusion).toBeLessThan(at(-0.01, { shadow: 0.4 }).occlusion);
  });

  it("is less for a smaller step and reaches further for a taller one", () => {
    const small = at(-0.01, { heightA: 0.016, heightB: 0.015 }).occlusion;
    const tall = at(-0.01).occlusion;
    expect(small).toBeGreaterThan(tall);
    expect(at(-0.15, { heightA: 0.2 }).occlusion).toBeLessThan(at(-0.15).occlusion);
  });

  it("fades away when a pixel is much wider than the shade, so it is not a dark line far off", () => {
    expect(at(-0.01, { pixel: 5 }).occlusion).toBeCloseTo(1, 6);
  });

  it("is cast away from the sun: darkest with the sun over the taller grass, the ambient share with it along the line or on the shorter side", () => {
    const foot = (sun: [number, number]) => at(-0.01, { sun }).occlusion; // b's side is the shorter, and the taller is towards +x
    expect(foot([1, 0])).toBeLessThan(foot([1, 1])); // the sun straight over the taller grass, then a slant
    expect(foot([1, 1])).toBeLessThan(foot([0, 1])); // then along the line
    expect(foot([0, 1])).toBeCloseTo(foot([0, -1]), 10);
    expect(foot([-1, 0])).toBeCloseTo(foot([0, 1]), 10); // on the shorter side is no darker than along the line
  });

  it("keeps an ambient share of the shade whichever way the sun is, and uses the length of the sun's direction for nothing", () => {
    const ambient = at(-0.01, { sun: [-1, 0], shadow: 1 }).occlusion;
    expect(ambient).toBeLessThan(1);
    expect(ambient).toBeGreaterThan(at(-0.01, { sun: [1, 0], shadow: 1 }).occlusion);
    expect(at(-0.01, { sun: [5, 0] }).occlusion).toBeCloseTo(at(-0.01, { sun: [0.1, 0] }).occlusion, 10);
  });

  it("is the ambient share when the sun is overhead and has no direction along the ground", () => {
    expect(at(-0.01, { sun: [0, 0] }).occlusion).toBeCloseTo(at(-0.01, { sun: [-1, 0] }).occlusion, 10);
  });

  it("follows the taller grass when it is b, so a flipped step is shaded from the same sun the same way", () => {
    const flipped = { heightA: 0.015, heightB: 0.06, normal: [-1, 0] as [number, number] }; // a is now the shorter, with b over towards +x
    expect(at(0.01, { ...flipped, sun: [1, 0] }).occlusion).toBeCloseTo(at(-0.01, { sun: [1, 0] }).occlusion, 10);
  });
});

describe("the step drawn taller than it is", () => {
  it("has a wall gain times as steep, and the true height", () => {
    const one = at(0.04), two = at(0.04, { gain: 2 });
    expect(two.slope[0]).toBeCloseTo(2 * one.slope[0], 10);
    expect(two.height).toBeCloseTo(one.height, 10);
  });

  it("makes a few millimetres show: a gain of 2 on a 6 mm step is as steep as a 12 mm one", () => {
    const small = { heightA: 0.01, heightB: 0.004 };
    expect(at(0.04, { ...small, gain: 2 }).slope[0]).toBeCloseTo(at(0.04, { heightA: 0.016, heightB: 0.004 }).slope[0], 10);
  });

  it("darkens the foot of a small step more, and reaches further for it", () => {
    const small = { heightA: 0.01, heightB: 0.004 };
    expect(at(-0.01, { ...small, gain: 3 }).occlusion).toBeLessThan(at(-0.01, small).occlusion);
    expect(at(-0.05, { ...small, gain: 3 }).occlusion).toBeLessThan(at(-0.05, small).occlusion); // 5 cm out: inside a tripled step's shade, past a true one's
  });

  it("changes nothing where the heights are the same, however much the gain", () => {
    const flat = at(0.02, { heightA: 0.02, heightB: 0.02, gain: 10 });
    expect(flat.slope).toEqual([0, 0]);
    expect(flat.occlusion).toBe(1);
  });
});
