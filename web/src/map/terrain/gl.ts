import { FRAGMENT, FRAGMENT_3D, VERTEX, VERTEX_3D } from "./shaders";

export type Program = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

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

const FLAT_UNIFORMS = ["uHeight", "uDelta", "uHasDelta", "uGrid", "uOrigin", "uRes", "uMapOrigin", "uMapPerPixel", "uExaggeration", "uContour", "uSlope", "uSun"];
const MESH_UNIFORMS = [
  "uHeight", "uDelta", "uHasDelta", "uGrid", "uOrigin", "uRes", "uViewProj", "uWindow", "uSpacing", "uQuads", "uScale", "uInner", "uSunDir", "uContour", "uSlope", "uRelief", "uShading", "uSpeckle", "uSpeckleTex",
  "uAerial", "uAerialRect", "uUseAerial", "uFill", "uLines", "uDrapeRect", "uFillAlpha", "uLineAlpha",
  "uClassMap", "uClassInfo", "uTile", "uTileAvg", "uTileMetres", "uStripe", "uGame",
];

let shared: Gl | null = null;
let generation = 0;

export function compileProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string, uniforms: string[], name: string): Program {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`${name} shader: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name} shader: ${gl.getProgramInfoLog(p)}`);
  return { program: p, u: Object.fromEntries(uniforms.map((n) => [n, gl.getUniformLocation(p, n)])) };
}

/** A program that is allowed to fail: the error goes to the console and the caller gets null. */
export function tryProgram(make: () => Program): Program | null {
  try {
    return make();
  } catch (e) {
    console.error(e);
    return null;
  }
}

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
    flat: compileProgram(gl, VERTEX, FRAGMENT, FLAT_UNIFORMS, "terrain"),
    mesh: tryProgram(() => compileProgram(gl, VERTEX_3D, FRAGMENT_3D, MESH_UNIFORMS, "terrain 3D")),
    anisotropy: { ext, max: ext ? (gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) || 1 : 1 },
    floatTargets: !!gl.getExtension("EXT_color_buffer_float"),
    generation: ++generation,
  };
  return shared;
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
