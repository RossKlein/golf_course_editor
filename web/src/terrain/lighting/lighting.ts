import type { Device } from "../../gfx/device/device";
import { frustumOf } from "../../gfx/math/frustum";
import { DepthArray } from "../../gfx/resource/depthArray";
import { compileProgram, type Program } from "../../gfx/shader/program";
import type { Gl } from "../context";
import type { HeightField } from "../heightfield/heightfield";
import { SHADOW_REACH, SKY_REACH, SUN_REACH, SUN_TEXELS, SUN_TILE, SUN_TILE_MAP } from "../limits";
import type { TreeChange } from "../scenery/treeDiff";
import type { TreesPass } from "../passes/trees/trees";
import { SHADERS } from "../shaders/shaders";
import { sunDirection } from "../sun";
import type { World } from "../world";
import { Bake, type Box } from "./bake";
import { SUN_WIDTH } from "./sunMath";
import { tileLight } from "./tileLight";

const TILE_UNIT = 13; // the texture unit a tile's shadow map is read from while it is resolved

/**
 * The ground's lighting, baked: what does not change while a course is looked at, worked out once on the GPU when it is first
 * drawn and again for just the box a brush changes. See docs/baked-lighting-plan.md.
 *  - sun: how much of the sun reaches each half sample of ground. A pass over the terrain marches a ray toward the sun, with a
 *    penumbra as wide as the real sun makes; then the trees' shadows are multiplied in, a tile of the map at a time, each tile
 *    with its own shadow map of fixed density (see tileLight.ts), so tree shadows are as crisp far away as near
 *  - sky: how much of the sky each height sample can see: from the terrain (a pass over every sample), then from the trees
 *    (a quad for each, hiding the share of the sky its crown covers, multiplied in)
 */
export class Lighting {
  private readonly sky: Bake;
  private readonly sun: Bake;
  private readonly depth = new DepthArray();
  private canopy: { generation: number; p: Program } | null = null;
  private treeShade: { generation: number; p: Program } | null = null;
  private depthFailed = false;

  /** `world` gives what the bakes depend on that is not the heights: the look and the sun. */
  constructor(private readonly heights: HeightField, private readonly trees: TreesPass, private readonly world: () => World) {
    const { grid, resX, resZ } = heights.data;
    this.sky = new Bake({
      name: "sky",
      source: SHADERS.sky,
      cols: grid.cols,
      rows: grid.rows,
      format: "R16F",
      mipmaps: true,
      reach: Math.ceil(SKY_REACH / Math.min(resX, resZ)) + 1,
      strip: SUN_TILE / SUN_TEXELS, // the same ground as a strip of the sun bake
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
        trees.drawCanopies(g, world().look, p);
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
      strip: SUN_TILE, // a row of the tiles the trees' shadows are baked in
      unit: 12,
      names: { map: "uSunMap", on: "uSunOn" },
      uniforms: (g, p) => {
        heights.bind(g, p);
        g.gl.uniform3f(p.u.uSunDir, ...sunDirection(world().sun));
        g.gl.uniform2f(p.u.uSunParams, world().look.shadows?.softness ?? 0.3, SUN_WIDTH); // a look from an older server has no shadows
      },
      after: (g, box, restore) => this.treeShadows(g, box, restore),
    });
    heights.watch((box) => {
      if (!box) return this.touchAll();
      this.sky.touch(box);
      this.sun.touch({ x0: box.x0 * SUN_TEXELS, z0: box.z0 * SUN_TEXELS, x1: (box.x1 + 1) * SUN_TEXELS - 1, z1: (box.z1 + 1) * SUN_TEXELS - 1 });
    });
  }

  /**
   * Multiply the trees' shadows into the sun bake over `box` (texels of the sun bake), a tile at a time: a depth map of the
   * trees from the sun fitted to the tile, then each texel of the tile in the box looked up in it.
   */
  private treeShadows(g: Gl, box: Box, restore: () => void) {
    const { trees, heights } = this;
    const world = this.world();
    const casterTop = trees.tallest();
    if (!trees.count || !casterTop || this.depthFailed) return;
    const sun = sunDirection(world.sun);
    const { gl } = g;
    let size: number;
    try {
      size = this.depth.ensure(g, SUN_TILE_MAP, 1);
    } catch (e) {
      console.warn(e);
      this.depthFailed = true;
      return;
    }
    if (!this.treeShade || this.treeShade.generation !== g.generation) {
      this.treeShade = { generation: g.generation, p: compileProgram(gl, SHADERS.treeShade.vertex, SHADERS.treeShade.fragment, "tree shadows baked") };
    }
    const p = this.treeShade.p;
    const [yLo, yHi] = heights.groundRange();
    const { origin, resX, resZ } = heights.data;
    const T = SUN_TILE;
    for (let tz = Math.floor(box.z0 / T); tz <= Math.floor(box.z1 / T); tz++) {
      for (let tx = Math.floor(box.x0 / T); tx <= Math.floor(box.x1 / T); tx++) {
        const t0 = { x: tx * T, z: tz * T };
        // the tile in metres, with a little over, and the part of the box that is in it in texels
        const rect = {
          x0: origin.x + (t0.x / SUN_TEXELS - 0.5 - 1) * resX,
          x1: origin.x + ((t0.x + T) / SUN_TEXELS - 0.5 + 1) * resX,
          z0: origin.z + (t0.z / SUN_TEXELS - 0.5 - 1) * resZ,
          z1: origin.z + ((t0.z + T) / SUN_TEXELS - 0.5 + 1) * resZ,
        };
        const light = tileLight(rect, yLo, yHi, casterTop, sun, SHADOW_REACH);
        if (!light) return; // the sun is too low to light anything
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.colorMask(false, false, false, false);
        this.depth.bindForWrite(g, 0);
        trees.drawDepth(g, world, light.viewProj, 1, { frustum: frustumOf(light.viewProj), y0: yLo, y1: yHi });
        gl.colorMask(true, true, true, true);
        gl.disable(gl.DEPTH_TEST);

        restore();
        const x0 = Math.max(box.x0, t0.x), x1 = Math.min(box.x1, t0.x + T - 1);
        const z0 = Math.max(box.z0, t0.z), z1 = Math.min(box.z1, t0.z + T - 1);
        gl.viewport(x0, z0, x1 - x0 + 1, z1 - z0 + 1);
        gl.useProgram(p.program);
        heights.bind(g, p);
        this.depth.bindForRead(g, TILE_UNIT);
        gl.uniform1i(p.u.uTileMap, TILE_UNIT);
        gl.uniformMatrix4fv(p.u.uLight, false, light.viewProj);
        gl.uniform2f(p.u.uMap, size, light.range);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ZERO, gl.SRC_COLOR); // what the terrain left lit, times what the trees leave
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disable(gl.BLEND);
      }
    }
  }

  /** The trees or the look changed: everything the trees decide has to be baked again. */
  touchAll() {
    this.sky.touchAll();
    this.sun.touchAll();
  }

  /**
   * Some trees were added, removed or changed. Only the ground they can reach is baked again: a crown hides the sky from the ground
   * around it, and a tree's shadow runs as far as the sun's angle makes it. A change to a large share of the forest, or one that reaches
   * over half the course, is baked whole.
   */
  touchTrees(change: TreeChange) {
    if (!change.box) return;
    const { grid, origin, resX, resZ } = this.heights.data;
    const [sx, sy, sz] = sunDirection(this.world().sun);
    const shadow = sy > 0.02 ? Math.min(SHADOW_REACH, (change.tallest * Math.hypot(sx, sz)) / sy) : SHADOW_REACH;
    const reach = Math.max(SKY_REACH, shadow) + 4; // metres
    const x0 = Math.max(0, Math.floor((change.box.x0 - reach - origin.x) / resX)), x1 = Math.min(grid.cols - 1, Math.ceil((change.box.x1 + reach - origin.x) / resX));
    const z0 = Math.max(0, Math.floor((change.box.z0 - reach - origin.z) / resZ)), z1 = Math.min(grid.rows - 1, Math.ceil((change.box.z1 + reach - origin.z) / resZ));
    const covers = ((x1 - x0 + 1) * (z1 - z0 + 1)) / (grid.cols * grid.rows);
    if (change.changed > 0.4 * change.total || covers > 0.5) return this.touchAll();
    this.sky.touchExact({ x0, z0, x1, z1 });
    this.sun.touchExact({ x0: x0 * SUN_TEXELS, z0: z0 * SUN_TEXELS, x1: (x1 + 1) * SUN_TEXELS - 1, z1: (z1 + 1) * SUN_TEXELS - 1 });
  }

  /** Whether a bake is part done: more of it comes with each frame that is drawn. */
  get pending(): boolean {
    return this.sky.pending || this.sun.pending;
  }

  /** Only the sun's lighting is out of date (the sun moved or its shadows' edge changed); the sky's is not. */
  touchSun() {
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
    this.depth.free(null);
  }
}
