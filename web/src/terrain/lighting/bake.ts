import type { Device } from "../../gfx/device/device";
import { compileProgram, type Program } from "../../gfx/shader/program";
import { context, currentContext, type Gl } from "../context";

/** A box of texels, corners included. */
export type Box = { x0: number; z0: number; x1: number; z1: number };

const FORMATS = {
  R16F: (gl: WebGL2RenderingContext) => ({ internal: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT }),
  RGBA16F: (gl: WebGL2RenderingContext) => ({ internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }),
  R8: (gl: WebGL2RenderingContext) => ({ internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE }),
};

export type BakeSpec = {
  name: string;
  /** The program's finished source: a full-screen vertex shader and a fragment shader that writes one texel a pixel. */
  source: { vertex: string; fragment: string };
  /** Texels across and down. */
  cols: number;
  rows: number;
  format: keyof typeof FORMATS;
  /** Whether to keep a chain of mipmaps, so a distant lookup averages instead of sparkling. */
  mipmaps: boolean;
  /** How many texels away a changed height still changes the result. */
  reach: number;
  /** The texture unit it is bound to. */
  unit: number;
  /** The uniform names a program reads it by: the sampler, and a flag that is 1 when it holds a bake. */
  names: { map: string; on: string };
  /** Sets the uniforms the bake pass needs (the program is in use). */
  uniforms: (g: Gl, p: Program) => void;
  /** Draws more into the same texels, in the same framebuffer and viewport, after the pass (blending is off and may be switched on). */
  after?: (g: Gl, box: Box) => void;
};

type Target = { generation: number; texture: WebGLTexture; framebuffer: WebGLFramebuffer };

/**
 * A texture filled by a full-screen pass, one pixel to a texel, when first needed and again for any box that has changed (and
 * the texels its change reaches). It is what the lighting bakes (sky, sun) are made of; see lighting.ts. Where the GPU cannot
 * render into it, `supported` is false and the shaders do without (their flag is 0).
 */
export class Bake {
  private target: Target | null = null;
  private program: { generation: number; p: Program } | null = null;
  private all = true;
  private dirty: Box | null = null;
  private failed = false;

  constructor(private readonly spec: BakeSpec) {}

  supported(): boolean {
    if (this.failed) return false;
    try {
      return context().floatTargets;
    } catch {
      return false;
    }
  }

  /** The texels in this box changed, so those it reaches are out of date. */
  touch(box: Box) {
    if (this.all) return;
    const { reach, cols, rows } = this.spec;
    const grown = { x0: Math.max(0, box.x0 - reach), z0: Math.max(0, box.z0 - reach), x1: Math.min(cols - 1, box.x1 + reach), z1: Math.min(rows - 1, box.z1 + reach) };
    const d = this.dirty;
    this.dirty = d ? { x0: Math.min(d.x0, grown.x0), z0: Math.min(d.z0, grown.z0), x1: Math.max(d.x1, grown.x1), z1: Math.max(d.z1, grown.z1) } : grown;
  }

  touchAll() {
    this.all = true;
  }

  private ensureTarget(g: Gl): Target | null {
    if (this.target && this.target.generation === g.generation) return this.target;
    const { gl } = g;
    const { cols, rows, format, mipmaps } = this.spec;
    const f = FORMATS[format](gl);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, cols, rows, 0, f.format, f.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      this.failed = true;
      console.warn(`this GPU cannot render the ${this.spec.name} bake into a texture, so it is left out`);
      return null;
    }
    this.target = { generation: g.generation, texture, framebuffer };
    this.all = true; // a new texture is empty
    return this.target;
  }

  /** Bring the texture up to date, before anything that reads it is drawn: it changes the framebuffer, program and viewport. */
  prepare(g: Gl) {
    if (!this.supported()) return;
    const target = this.ensureTarget(g);
    if (!target) return;
    if (!this.all && !this.dirty) return;
    const { cols, rows } = this.spec;
    const box = this.all || !this.dirty ? { x0: 0, z0: 0, x1: cols - 1, z1: rows - 1 } : this.dirty;
    this.all = false;
    this.dirty = null;
    const { gl } = g;
    if (!this.program || this.program.generation !== g.generation) {
      this.program = { generation: g.generation, p: compileProgram(gl, this.spec.source.vertex, this.spec.source.fragment, this.spec.name) };
    }
    const p = this.program.p;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(box.x0, box.z0, box.x1 - box.x0 + 1, box.z1 - box.z0 + 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(p.program);
    this.spec.uniforms(g, p);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.spec.after?.(g, box);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (this.spec.mipmaps) {
      gl.activeTexture(gl.TEXTURE0 + this.spec.unit);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
  }

  /** Bind it for a program that reads it. Without a baked texture the program is told to do without. */
  bind(d: Device, p: Program) {
    const { gl } = d;
    const target = this.target && this.target.generation === d.generation && !this.failed ? this.target : null;
    gl.uniform1f(p.u[this.spec.names.on], target ? 1 : 0);
    if (!target) return;
    gl.activeTexture(gl.TEXTURE0 + this.spec.unit);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.uniform1i(p.u[this.spec.names.map], this.spec.unit);
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
