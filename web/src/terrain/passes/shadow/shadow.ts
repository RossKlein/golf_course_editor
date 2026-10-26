import { frustumOf } from "../../../gfx/math/frustum";
import type { Vec3 } from "../../../gfx/math/mat4";
import { DepthArray } from "../../../gfx/resource/depthArray";
import type { Device } from "../../../gfx/device/device";
import type { Program } from "../../../gfx/shader/program";
import type { Gl } from "../../context";
import { MAX_SHADOW_SLICES, SHADOW_MAP, SHADOW_REACH, SHADOW_SLICES } from "../../limits";
import { sunDirection } from "../../sun";
import type { Cull, ShadowState, World } from "../../world";
import type { TreesPass } from "../trees/trees";
import { fitCascades, type Fit } from "./cascades";

/** How good the viewer wants shadows: off, one slice of trees (low), or three slices with soft edges and the ground's own shadow (high). */
export type ShadowQuality = "off" | "low" | "high";
export const SHADOW_QUALITIES: readonly ShadowQuality[] = ["off", "low", "high"];

export type ShadowView = {
  viewProj: Float32Array;
  eye: [number, number, number];
  /** Vertical exaggeration of the geometry. */
  scale: number;
  quality: ShadowQuality;
};

/** What the last frame's shadows cost: slices drawn and trees sent into them. */
export type ShadowStats = { slices: number; trees: number };

const UNIT = 8; // the texture unit the maps are bound to

/**
 * The sun's shadow maps. Each 3D frame it fits slices of the view with a map each (see cascades.ts), draws the trees depth
 * only into them from the sun, and hands the passes that receive shadows a state to bind. The ground shades itself without a
 * map (see ground.frag.glsl), so only casters stand in the maps: today the trees, later landmarks.
 */
export class ShadowPass {
  private readonly maps = new DepthArray();
  private readonly stand = new DepthArray(); // a 1 x 1 map to bind when there are no shadows, so the shader always has one
  private failed = false;
  stats: ShadowStats = { slices: 0, trees: 0 };

  private off(): ShadowState {
    const stand = this.stand;
    return {
      bind: (d: Device, p: Program) => {
        const { gl } = d;
        stand.ensure(d, 1, 1);
        stand.bindForRead(d, UNIT);
        gl.uniform1i(p.u.uShadowMap, UNIT);
        gl.uniform4f(p.u.uShadowSplit, 1, 1, 1, 0);
        gl.uniform4f(p.u.uShadowMode, 0, 0, 1, 0);
      },
    };
  }

  private state(fit: Fit, size: number, eye: Vec3, quality: ShadowQuality): ShadowState {
    const maps = this.maps;
    const cs = fit.cascades;
    const mats = new Float32Array(16 * MAX_SHADOW_SLICES);
    cs.forEach((c, i) => mats.set(c.texMat, i * 16));
    const at = (k: "far" | "texel" | "range", i: number) => cs[Math.min(i, cs.length - 1)][k];
    return {
      bind: (d: Device, p: Program) => {
        const { gl } = d;
        maps.bindForRead(d, UNIT);
        gl.uniform1i(p.u.uShadowMap, UNIT);
        gl.uniformMatrix4fv(p.u.uShadowMat, false, mats);
        gl.uniform4f(p.u.uShadowSplit, at("far", 0), at("far", 1), at("far", 2), cs.length);
        gl.uniform3f(p.u.uShadowTexel, at("texel", 0), at("texel", 1), at("texel", 2));
        gl.uniform3f(p.u.uShadowRange, at("range", 0), at("range", 1), at("range", 2));
        gl.uniform4f(p.u.uShadowMode, quality === "high" ? 1 : 0, quality === "high" ? 1 : 0, size, 0);
        gl.uniform3f(p.u.uShadowEye, ...eye);
        gl.uniform3f(p.u.uShadowForward, ...fit.forward);
      },
    };
  }

  /**
   * Draw this frame's maps and return what to bind to read them. The canvas size and viewport are not touched here beyond
   * the maps' own, so the caller sets up the main view after this.
   */
  render(g: Gl, world: World, trees: TreesPass | null, v: ShadowView, cull: Cull): ShadowState {
    this.stats = { slices: 0, trees: 0 };
    const look = world.look.shadows;
    const sun = sunDirection(world.sun);
    if (v.quality === "off" || this.failed || look.strength <= 0 || sun[1] <= 0.02) return this.off();
    const count = SHADOW_SLICES[v.quality];
    let size: number;
    try {
      size = this.maps.ensure(g, SHADOW_MAP, count);
    } catch (e) {
      console.error(e);
      this.failed = true;
      return this.off();
    }
    const fit = fitCascades({ viewProj: v.viewProj, eye: v.eye, sunDir: sun, distance: look.distance, count, size, reach: SHADOW_REACH });
    if (!fit) return this.off();

    const { gl } = g;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.colorMask(false, false, false, false);
    fit.cascades.forEach((c, i) => {
      this.maps.bindForWrite(g, i);
      const mapCull: Cull = { frustum: frustumOf(c.viewProj), y0: cull.y0, y1: cull.y1 };
      if (trees) this.stats.trees += trees.drawDepth(g, world, c.viewProj, v.scale, mapCull).trees;
      this.stats.slices++;
    });
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.state(fit, size, v.eye, v.quality);
  }

  free(g: Device | null) {
    this.maps.free(g);
    this.stand.free(g);
    this.failed = false;
  }
}
