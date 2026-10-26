import { compileProgram, tryProgram, type Program } from "../../gfx/shader/program";
import { SHADERS } from "./shaders";

export type Gl = {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  flat: Program;
  /** The 3D programs, which can fail to build without taking the flat map with them. */
  mesh: Program | null;
  anisotropy: { ext: { TEXTURE_MAX_ANISOTROPY_EXT: number; MAX_TEXTURE_MAX_ANISOTROPY_EXT: number } | null; max: number };
  /** Rendering to float textures, which sculpting needs. */
  floatTargets: boolean;
  /** Changes when the context is replaced, so textures made for an old one are known to be gone. */
  generation: number;
};

let shared: Gl | null = null;
let generation = 0;

/** The one WebGL2 context all terrain views draw with, made on first use and again if the browser takes it away. */
export function context(): Gl {
  if (shared && !shared.gl.isContextLost()) return shared;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false });
  if (!gl) throw new Error("WebGL2 is not available");
  const ext = gl.getExtension("EXT_texture_filter_anisotropic");
  shared = {
    canvas,
    gl,
    flat: compileProgram(gl, SHADERS.flat.vertex, SHADERS.flat.fragment, "terrain"),
    mesh: tryProgram(() => compileProgram(gl, SHADERS.ground.vertex, SHADERS.ground.fragment, "terrain 3D")),
    anisotropy: { ext, max: ext ? (gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) || 1 : 1 },
    floatTargets: !!gl.getExtension("EXT_color_buffer_float"),
    generation: ++generation,
  };
  return shared;
}

/**
 * Compile every shader program on the shared context and return the errors, none when they all build. Programs are normally
 * built the first time a view needs them, so this is how a change to any shader is checked without visiting every view
 * (the page offers it as checkShaders() in the console).
 */
export function checkShaders(): string[] {
  const { gl } = context();
  const errors: string[] = [];
  for (const [name, source] of Object.entries(SHADERS)) {
    try {
      gl.deleteProgram(compileProgram(gl, source.vertex, source.fragment, name).program);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return errors;
}

/** The context if there is one, without making it. */
export const currentContext = () => (shared && !shared.gl.isContextLost() ? shared : null);

/** A texture that is uploaded when first needed, and again if the context was replaced or the source changed. */
export class LazyTexture {
  private texture: WebGLTexture | null = null;
  private generation = -1;
  private dirty = true;

  constructor(private readonly upload: (g: Gl) => void) {}

  invalidate() {
    this.dirty = true;
  }

  /** The texture, bound to `unit`, uploading first if it needs it. */
  bind(g: Gl, unit: number) {
    const { gl } = g;
    gl.activeTexture(gl.TEXTURE0 + unit);
    if (!this.texture || this.generation !== g.generation) {
      this.texture = gl.createTexture();
      this.generation = g.generation;
      this.dirty = true;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.dirty) {
      this.dirty = false;
      this.upload(g);
    }
  }

  /** The texture as it is now, for drawing into or reading back; null if it was never made in this context. */
  current(g: Gl): WebGLTexture | null {
    return this.texture && this.generation === g.generation ? this.texture : null;
  }

  free() {
    const g = currentContext();
    if (this.texture && g && this.generation === g.generation) g.gl.deleteTexture(this.texture);
    this.texture = null;
    this.generation = -1;
  }
}
