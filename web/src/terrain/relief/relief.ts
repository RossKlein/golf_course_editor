import type { Device } from "../../gfx/device/device";
import { compileProgram, type Program } from "../../gfx/shader/program";
import { context, currentContext, type Gl } from "../context";
import type { TerrainGrid } from "../heightfield/heightfield";
import { SHADERS } from "../shaders/shaders";
import { RELIEF_TAPS_MAX } from "../limits";
import { reliefScale } from "./reliefMath";

const UNIT = 10; // the texture unit the relief is bound to

/** A box of height samples, corners included. */
type Box = { x0: number; z0: number; x1: number; z1: number };

type Target = { generation: number; texture: WebGLTexture; framebuffer: WebGLFramebuffer };

/**
 * The ground's relief baked into a texture, one pixel for each height sample: slope to the east and south, and curvature,
 * of the heights smoothed with a cubic B-spline (see reliefMath.ts). Lighting reads it with ordinary filtering, so shading is
 * smooth, the same at every distance, and costs one lookup instead of a couple of dozen. It is baked when first needed, again
 * in full when the smoothing changes, and for just the samples a brush has changed (and those the spline reaches from them).
 * The texture is 16-bit float, which every WebGL2 GPU can filter; where it cannot be rendered into, `supported` is false and
 * the shaders work the relief out the old way.
 */
export class Relief {
  private target: Target | null = null;
  private program: { generation: number; p: Program } | null = null;
  private radius = 2;
  private all = true;
  private dirty: Box | null = null;
  private failed = false;

  constructor(private readonly data: TerrainGrid) {}

  /** The smoothing, in metres the spline reaches either side. A change bakes it all again. */
  setSmoothing(metres: number) {
    if (metres === this.radius) return;
    this.radius = metres;
    this.all = true;
  }

  private get scale() {
    return reliefScale(this.radius, Math.max(this.data.resX, this.data.resZ));
  }

  /** Whether this GPU can render the relief; if not, nothing here does anything and the shaders do without. */
  supported(): boolean {
    if (this.failed) return false;
    try {
      return context().floatTargets;
    } catch {
      return false;
    }
  }

  /** Heights in this box of samples changed: its relief, and that of the samples the spline reaches from it, is out of date. */
  touch(box: Box) {
    if (this.all) return;
    const reach = Math.min(RELIEF_TAPS_MAX, 2 * Math.ceil(2 * this.scale)) / 2 + 1;
    const { cols, rows } = this.data.grid;
    const grown = { x0: Math.max(0, box.x0 - reach), z0: Math.max(0, box.z0 - reach), x1: Math.min(cols - 1, box.x1 + reach), z1: Math.min(rows - 1, box.z1 + reach) };
    const d = this.dirty;
    this.dirty = d ? { x0: Math.min(d.x0, grown.x0), z0: Math.min(d.z0, grown.z0), x1: Math.max(d.x1, grown.x1), z1: Math.max(d.z1, grown.z1) } : grown;
  }

  /** Every height changed. */
  touchAll() {
    this.all = true;
  }

  private ensureProgram(g: Gl): Program {
    if (!this.program || this.program.generation !== g.generation) {
      this.program = { generation: g.generation, p: compileProgram(g.gl, SHADERS.relief.vertex, SHADERS.relief.fragment, "relief") };
    }
    return this.program.p;
  }

  private ensureTarget(g: Gl): Target | null {
    if (this.target && this.target.generation === g.generation) return this.target;
    const { gl } = g;
    const { cols, rows } = this.data.grid;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, cols, rows, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (g.anisotropy.ext) gl.texParameterf(gl.TEXTURE_2D, g.anisotropy.ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, g.anisotropy.max));
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      this.failed = true;
      console.warn("this GPU cannot render the ground's relief into a texture, so lighting works the slope out per pixel instead");
      return null;
    }
    this.target = { generation: g.generation, texture, framebuffer };
    this.all = true; // a new texture is empty
    return this.target;
  }

  /**
   * Bring the texture up to date, before anything that reads it is drawn: it changes the framebuffer, program and viewport,
   * so the caller sets those afterwards. `bindHeights` binds the heights and what describes them to the program.
   */
  prepare(g: Gl, bindHeights: (g: Device, p: Program) => void) {
    if (!this.supported()) return;
    const target = this.ensureTarget(g);
    if (!target) return;
    if (!this.all && !this.dirty) return;
    const { cols, rows } = this.data.grid;
    const box = this.all || !this.dirty ? { x0: 0, z0: 0, x1: cols - 1, z1: rows - 1 } : this.dirty;
    this.all = false;
    this.dirty = null;
    const { gl } = g;
    const p = this.ensureProgram(g);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(box.x0, box.z0, box.x1 - box.x0 + 1, box.z1 - box.z0 + 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(p.program);
    bindHeights(g, p);
    gl.uniform1f(p.u.uScale, this.scale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0 + UNIT);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  /** Bind the relief for a program that reads it (uReliefMap, uReliefOn). Without a baked texture the program is told to do without. */
  bind(d: Device, p: Program) {
    const { gl } = d;
    const target = this.target && this.target.generation === d.generation && !this.failed ? this.target : null;
    gl.uniform1f(p.u.uReliefOn, target ? 1 : 0);
    if (!target) return;
    gl.activeTexture(gl.TEXTURE0 + UNIT);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.uniform1i(p.u.uReliefMap, UNIT);
  }

  dispose() {
    const g = currentContext();
    if (g && this.target?.generation === g.generation) {
      g.gl.deleteTexture(this.target.texture);
      g.gl.deleteFramebuffer(this.target.framebuffer);
    }
    this.target = null;
    this.all = true;
    this.dirty = null;
  }
}
