import type { Device } from "../../gfx/device/device";
import type { Program } from "../../gfx/shader/program";
import type { Gl } from "../context";
import type { HeightField } from "../heightfield/heightfield";
import { SKY_REACH } from "../limits";
import { SHADERS } from "../shaders/shaders";
import { Bake } from "./bake";

/**
 * The ground's lighting, baked: what does not change while a course is looked at, worked out once on the GPU when it is first
 * drawn and again for just the box a brush changes. See docs/baked-lighting-plan.md.
 *  - sky: how much of the sky each height sample can see, from the terrain (and, once added, the trees)
 */
export class Lighting {
  private readonly sky: Bake;

  constructor(heights: HeightField) {
    const { grid, resX, resZ } = heights.data;
    this.sky = new Bake({
      name: "sky",
      source: SHADERS.sky,
      cols: grid.cols,
      rows: grid.rows,
      format: "R16F",
      mipmaps: true,
      reach: Math.ceil(SKY_REACH / Math.min(resX, resZ)) + 1,
      unit: 11,
      names: { map: "uSkyMap", on: "uSkyOn" },
      uniforms: (g, p) => {
        heights.bind(g, p);
        g.gl.uniform1f(p.u.uReach, SKY_REACH);
      },
    });
    heights.watch((box) => (box ? this.sky.touch(box) : this.sky.touchAll()));
  }

  /** Bring every bake up to date, before a 3D frame that reads them. It changes the framebuffer, program and viewport, so call it first and set those afterwards. */
  prepare(g: Gl) {
    this.sky.prepare(g);
  }

  /** Bind the bakes for a program that lights the ground with them. */
  bind(d: Device, p: Program) {
    this.sky.bind(d, p);
  }

  dispose() {
    this.sky.dispose();
  }
}
