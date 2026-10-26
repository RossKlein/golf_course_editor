import type { HeightGrid } from "../../decode/decode";
import { FRAGMENT, VERTEX } from "./shaders";
import { packHeights } from "./reference";

export type TerrainStyle = {
  /** Relief exaggeration for the lighting. */
  exaggeration: number;
  /** Metres between contour lines; 0 for none. */
  contour: number;
  /** Colour the ground by slope. */
  slope: boolean;
};

export type TerrainGrid = {
  grid: HeightGrid;
  /** Course metres of sample (0, 0). */
  origin: { x: number; z: number };
  resX: number;
  resZ: number;
};

type Gl = {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
  /** Changes when the context is replaced, so textures made for an old one are known to be gone. */
  generation: number;
};

const UNIFORMS = ["uHeight", "uGrid", "uOrigin", "uRes", "uMapOrigin", "uMapPerPixel", "uExaggeration", "uContour", "uSlope"];

let shared: Gl | null = null;
let generation = 0;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`terrain shader: ${gl.getShaderInfoLog(shader)}`);
  return shader;
}

/** The one WebGL2 context all terrain layers draw with, made on first use and again if the browser takes it away. */
function context(): Gl {
  if (shared && !shared.gl.isContextLost()) return shared;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) throw new Error("WebGL2 is not available");
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`terrain shader: ${gl.getProgramInfoLog(program)}`);
  shared = { canvas, gl, program, uniforms: Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(program, n)])), generation: ++generation };
  return shared;
}

/** Whether terrain can be drawn on the GPU here. Callers fall back to the CPU hillshade when it cannot. */
export function terrainSupported(grid?: HeightGrid): boolean {
  try {
    const { gl } = context();
    return !grid || Math.max(grid.cols, grid.rows) <= gl.getParameter(gl.MAX_TEXTURE_SIZE);
  } catch {
    return false;
  }
}

/**
 * A height grid on the GPU and what it takes to draw it: the lighting, contour and slope shader run per screen pixel.
 * Many renderers share one context; each owns its height texture, which is uploaded on first use and again after
 * `dispose` or a lost context, so a renderer is never left unusable.
 */
export class TerrainRenderer {
  private texture: WebGLTexture | null = null;
  private textureGeneration = -1;

  constructor(private readonly data: TerrainGrid) {}

  private upload(g: Gl) {
    const { gl } = g;
    if (this.texture && this.textureGeneration === g.generation) return;
    const { grid } = this.data;
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, grid.cols, grid.rows, 0, gl.RG, gl.FLOAT, packHeights(grid.values, grid.valid));
    // read with texelFetch, so filtering is moot; set to the only mode a float texture always supports
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.textureGeneration = g.generation;
  }

  /**
   * Draw the part of the course in `extent` (map coordinates: minX, minY, maxX, maxY) into a canvas `size` pixels
   * across. The returned canvas is the shared one, so use it before the next render.
   */
  render(extent: number[], size: number[], style: TerrainStyle): HTMLCanvasElement {
    const g = context();
    const { gl, canvas, uniforms: u } = g;
    const w = Math.max(1, Math.round(size[0])), h = Math.max(1, Math.round(size[1]));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.upload(g);
    const { grid, origin, resX, resZ } = this.data;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(g.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(u.uHeight, 0);
    gl.uniform2i(u.uGrid, grid.cols, grid.rows);
    gl.uniform2f(u.uOrigin, origin.x, origin.z);
    gl.uniform2f(u.uRes, resX, resZ);
    gl.uniform2f(u.uMapOrigin, extent[0], extent[1]);
    gl.uniform2f(u.uMapPerPixel, (extent[2] - extent[0]) / w, (extent[3] - extent[1]) / h);
    gl.uniform1f(u.uExaggeration, style.exaggeration);
    gl.uniform1f(u.uContour, style.contour);
    gl.uniform1f(u.uSlope, style.slope ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return canvas;
  }

  /** Free the height texture. The renderer still works afterwards; it uploads again on the next render. */
  dispose() {
    if (this.texture && shared && !shared.gl.isContextLost() && this.textureGeneration === shared.generation) shared.gl.deleteTexture(this.texture);
    this.texture = null;
    this.textureGeneration = -1;
  }
}
