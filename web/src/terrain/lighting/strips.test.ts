import { describe, expect, it } from "vitest";
import { framesFor, takeStrip } from "./strips";

const box = (z0: number, z1: number) => ({ x0: 5, z0, x1: 99, z1 });

describe("baking a box a strip at a time", () => {
  it("takes the whole box when it is no taller than a strip and does not cross a boundary", () => {
    expect(takeStrip(box(10, 200), 512)).toEqual({ now: box(10, 200), rest: null });
  });

  it("cuts at a multiple of the strip, so a strip never straddles two tile rows", () => {
    const { now, rest } = takeStrip(box(100, 2000), 512);
    expect(now).toEqual(box(100, 511));
    expect(rest).toEqual(box(512, 2000));
  });

  it("keeps the columns", () => {
    const { now, rest } = takeStrip({ x0: 7, z0: 0, x1: 70, z1: 1500 }, 512);
    expect([now.x0, now.x1, rest!.x0, rest!.x1]).toEqual([7, 70, 7, 70]);
  });

  it("covers every row exactly once, in order, however the box starts", () => {
    for (const [z0, z1] of [[0, 3849], [37, 3849], [511, 512], [512, 1023], [0, 0], [1000, 1100]]) {
      let at: ReturnType<typeof box> | null = box(z0, z1);
      const seen: number[] = [];
      while (at) {
        const { now, rest } = takeStrip(at, 512);
        for (let z = now.z0; z <= now.z1; z++) seen.push(z);
        expect(Math.floor(now.z0 / 512)).toBe(Math.floor(now.z1 / 512)); // one tile row
        at = rest;
      }
      expect(seen).toEqual(Array.from({ length: z1 - z0 + 1 }, (_, i) => z0 + i));
    }
  });

  it("counts the frames: a course 3,850 texels tall is eight strips of 512", () => {
    expect(framesFor(box(0, 3849), 512)).toBe(8);
    expect(framesFor(box(0, 500), 512)).toBe(1);
    expect(framesFor(box(500, 520), 512)).toBe(2); // it crosses a boundary
  });
});
