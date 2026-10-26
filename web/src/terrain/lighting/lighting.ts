import type { Look } from "../../core/api/api";
import type { Sun } from "../sun";
import { sunDirection } from "../sun";
import type { Device } from "../../gfx/device/device";
import { compileProgram, type Program } from "../../gfx/shader/program";
import type { Gl } from "../context";
import type { HeightField } from "../heightfield/heightfield";
import { SKY_REACH, SUN_REACH, SUN_TEXELS } from "../limits";
import { SUN_WIDTH } from "./sunMath";
import type { TreesPass } from "../passes/trees/trees";
import { SHADERS } from "../shaders/shaders";
import { Bake } from "./bake";

/**
 * The ground's lighting, baked: what does not change while a course is looked at, worked out once on the GPU when it is first
 * drawn and again for just the box a brush changes. See docs/baked-lighting-plan.md.
 *  - sun: how much of the sun reaches each half sample of ground past the terrain, with a penumbra as wide as the real sun makes
 *  - sky: how much of the sky each height sample can see: from the terrain (a pass over every sample), then from the trees
 *    (a quad for each, hiding the share of the sky its crown covers, multiplied in)
 */
export class Lighting {
  private readonly sky: Bake;
  private readonly sun: Bake;
  private canopy: { generation: number; p: Program } | null = null;

  /** `look` gives the course's current look, which decides what the trees are. */
  constructor(heights: HeightField, trees: TreesPass, look: () => Look, sun: () => Sun) {
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
      after: (g, box) => {
        const { gl } = g;
        if (!this.canopy || this.canopy.generation !== g.generation) {
          this.canopy = { generation: g.generation, p: compileProgram(gl, SHADERS.canopy.vertex, SHADERS.canopy.fragment, "canopy") };
        }
        const p = this.canopy.p;
        gl.useProgram(p.program);
        heights.bind(g, p);
        gl.uniform4f(p.u.uBox, box.x0, box.z0, box.x1 - box.x0 + 1, box.z1 - box.z0 + 1);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR); // what is left of the sky times one minus what this crown hides
        trees.drawCanopies(g, look(), p);
        gl.disable(gl.BLEND);
      },
    });
    this.sun = new Bake({
      name: "sun",
      source: SHADERS.sun,
      cols: grid.cols * SUN_TEXELS,
      rows: grid.rows * SUN_TEXELS,
      format: "R8",
      mipmaps: true,
      reach: Math.ceil(SUN_REACH / (Math.min(resX, resZ) / SUN_TEXELS)) + 1,
      unit: 12,
      names: { map: "uSunMap", on: "uSunOn" },
      uniforms: (g, p) => {
        heights.bind(g, p);
        g.gl.uniform3f(p.u.uSunDir, ...sunDirection(sun()));
        g.gl.uniform2f(p.u.uSunParams, look().shadows?.softness ?? 0.3, SUN_WIDTH); // a look from an older server has no shadows
      },
    });
    heights.watch((box) => {
      if (!box) return this.touchAll();
      this.sky.touch(box);
      this.sun.touch({ x0: box.x0 * SUN_TEXELS, z0: box.z0 * SUN_TEXELS, x1: (box.x1 + 1) * SUN_TEXELS - 1, z1: (box.z1 + 1) * SUN_TEXELS - 1 });
    });
  }

  /** The trees or the look changed: everything the trees decide has to be baked again. */
  touchAll() {
    this.sky.touchAll();
    this.sun.touchAll();
  }

  /** Bring every bake up to date, before a 3D frame that reads them. It changes the framebuffer, program and viewport, so call it first and set those afterwards. */
  prepare(g: Gl) {
    this.sky.prepare(g);
    this.sun.prepare(g);
  }

  /** Bind the bakes for a program that lights the ground with them; `enabled` false lights it as if open, lit ground. */
  bind(d: Device, p: Program, enabled = true) {
    this.sky.bind(d, p, enabled);
    this.sun.bind(d, p, enabled);
  }

  dispose() {
    this.sky.dispose();
    this.sun.dispose();
  }
}
