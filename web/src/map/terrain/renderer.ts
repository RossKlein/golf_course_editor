import type { HeightGrid } from "../../decode/decode";
import type { Mat4, Vec3 } from "../../view3d/mat4";
import type { Rect } from "../coords";
import { packHeights } from "./reference";
import { FRAGMENT, FRAGMENT_3D, VERTEX, VERTEX_3D } from "./shaders";
import { SUN, sunDirection } from "./sun";

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

/** How to draw the 3D view. */
export type View3d = {
  viewProj: Mat4;
  eye: Vec3;
  /** The mesh: a square of `quads` squares of `spacing` metres, with its corner at (x0, z0). */
  mesh: { spacing: number; quads: number; x0: number; z0: number };
  /** Vertical exaggeration of the geometry. */
  scale: number;
  aerial: boolean;
  /** How strongly the design's surfaces and outlines show, 0 to 1. */
  fill: number;
  lines: number;
  contour: number;
  slope: boolean;
};

type Program = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

type Gl = {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  flat: Program;
  mesh: Program;
  anisotropy: { ext: { TEXTURE_MAX_ANISOTROPY_EXT: number } | null; max: number };
  /** Changes when the context is replaced, so textures made for an old one are known to be gone. */
  generation: number;
};

const FLAT_UNIFORMS = ["uHeight", "uGrid", "uOrigin", "uRes", "uMapOrigin", "uMapPerPixel", "uExaggeration", "uContour", "uSlope", "uSun"];
const MESH_UNIFORMS = [
  "uHeight", "uGrid", "uOrigin", "uRes", "uViewProj", "uWindow", "uSpacing", "uQuads", "uScale", "uEye", "uSunDir", "uContour", "uSlope", "uSky",
  "uAerial", "uAerialRect", "uUseAerial", "uFill", "uLines", "uDrapeRect", "uFillAlpha", "uLineAlpha",
];
const SKY: Vec3 = [0.62, 0.76, 0.9];

let shared: Gl | null = null;
let generation = 0;

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string, uniforms: string[], name: string): Program {
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

/** The one WebGL2 context all terrain views draw with, made on first use and again if the browser takes it away. */
function context(): Gl {
  if (shared && !shared.gl.isContextLost()) return shared;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false });
  if (!gl) throw new Error("WebGL2 is not available");
  const ext = gl.getExtension("EXT_texture_filter_anisotropic");
  shared = {
    canvas,
    gl,
    flat: program(gl, VERTEX, FRAGMENT, FLAT_UNIFORMS, "terrain"),
    mesh: program(gl, VERTEX_3D, FRAGMENT_3D, MESH_UNIFORMS, "terrain 3D"),
    anisotropy: { ext, max: ext ? gl.getParameter(ext.TEXTURE_MAX_ANISOTROPY_EXT) : 1 },
    generation: ++generation,
  };
  return shared;
}

/** Whether terrain can be drawn on the GPU here. Callers fall back to the CPU hillshade when it cannot. */
export function terrainSupported(grid?: HeightGrid): boolean {
  try {
    const { gl } = context();
    return !grid || Math.max(grid.cols, grid.rows) <= gl.getParameter(gl.MAX_TEXTURE_SIZE);
  } catch (e) {
    console.error("GPU terrain is unavailable, using the CPU hillshade:", e);
    return false;
  }
}

/** A texture that is uploaded when first needed, and again if the context was replaced or the source changed. */
class LazyTexture {
  private texture: WebGLTexture | null = null;
  private generation = -1;
  private dirty = true;

  constructor(private readonly upload: (g: Gl) => void) {}

  invalidate() {
    this.dirty = true;
  }

  bind(g: Gl, unit: number): boolean {
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
    return true;
  }

  free() {
    if (this.texture && shared && !shared.gl.isContextLost() && this.generation === shared.generation) shared.gl.deleteTexture(this.texture);
    this.texture = null;
    this.generation = -1;
  }
}

type Image = HTMLImageElement | HTMLCanvasElement;

/**
 * A height grid on the GPU and what it takes to draw it, flat for the map or as a 3D mesh. Many renderers share one
 * context; each owns its textures, which are uploaded when first used and again after `dispose` or a lost context, so a
 * renderer is never left unusable.
 */
export class TerrainRenderer {
  private readonly height = new LazyTexture((g) => {
    const { gl } = g;
    const { grid } = this.data;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, grid.cols, grid.rows, 0, gl.RG, gl.FLOAT, packHeights(grid.values, grid.valid));
    // read with texelFetch, so filtering is moot; set to the only mode a float texture always supports
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  });
  private readonly aerialTexture = new LazyTexture((g) => this.uploadImage(g, this.aerialImage, true));
  private readonly fillTexture = new LazyTexture((g) => this.uploadImage(g, this.fillImage, false));
  private readonly linesTexture = new LazyTexture((g) => this.uploadImage(g, this.linesImage, false));
  private aerialImage: Image | null = null;
  private aerialRect: Rect | null = null;
  private fillImage: Image | null = null;
  private linesImage: Image | null = null;
  private drapeRect: Rect | null = null;

  constructor(private readonly data: TerrainGrid) {}

  /** The imagery draped over the 3D view, covering `rect` (course metres, top-left corner and size). */
  setAerial(image: Image | null, rect: Rect | null) {
    this.aerialImage = image;
    this.aerialRect = rect;
    this.aerialTexture.invalidate();
  }

  /**
   * What the design draws over the ground in 3D: surfaces and outlines, as two canvases covering `rect`. Pass the same
   * canvases again after painting them to upload the change.
   */
  setDrape(fill: Image | null, lines: Image | null, rect: Rect | null) {
    this.fillImage = fill;
    this.linesImage = lines;
    this.drapeRect = rect;
    this.fillTexture.invalidate();
    this.linesTexture.invalidate();
  }

  private uploadImage(g: Gl, image: Image | null, mipmaps: boolean) {
    const { gl } = g;
    const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    let source: Image | null = image;
    if (image && Math.max(image.width, image.height) > limit) {
      const k = limit / Math.max(image.width, image.height); // too big for this GPU: shrink to fit
      const c = document.createElement("canvas");
      c.width = Math.floor(image.width * k);
      c.height = Math.floor(image.height * k);
      c.getContext("2d")!.drawImage(image, 0, 0, c.width, c.height);
      source = c;
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mipmaps && source) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (g.anisotropy.ext) gl.texParameterf(gl.TEXTURE_2D, g.anisotropy.ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, g.anisotropy.max));
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
  }

  private bindHeight(g: Gl, p: Program) {
    const { gl } = g;
    const { grid, origin, resX, resZ } = this.data;
    this.height.bind(g, 0);
    gl.uniform1i(p.u.uHeight, 0);
    gl.uniform2i(p.u.uGrid, grid.cols, grid.rows);
    gl.uniform2f(p.u.uOrigin, origin.x, origin.z);
    gl.uniform2f(p.u.uRes, resX, resZ);
  }

  private resize(g: Gl, size: number[]) {
    const w = Math.max(1, Math.round(size[0])), h = Math.max(1, Math.round(size[1]));
    if (g.canvas.width !== w || g.canvas.height !== h) {
      g.canvas.width = w;
      g.canvas.height = h;
    }
    g.gl.viewport(0, 0, w, h);
    return { w, h };
  }

  /**
   * Draw the part of the course in `extent` (map coordinates: minX, minY, maxX, maxY) into a canvas `size` pixels
   * across. The returned canvas is the shared one, so use it before the next render.
   */
  render(extent: number[], size: number[], style: TerrainStyle): HTMLCanvasElement {
    const g = context();
    const { gl, canvas, flat } = g;
    const { w, h } = this.resize(g, size);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(flat.program);
    this.bindHeight(g, flat);
    gl.uniform2f(flat.u.uMapOrigin, extent[0], extent[1]);
    gl.uniform2f(flat.u.uMapPerPixel, (extent[2] - extent[0]) / w, (extent[3] - extent[1]) / h);
    gl.uniform1f(flat.u.uExaggeration, style.exaggeration);
    gl.uniform1f(flat.u.uContour, style.contour);
    gl.uniform1f(flat.u.uSlope, style.slope ? 1 : 0);
    gl.uniform2f(flat.u.uSun, SUN.azimuth, SUN.altitude);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return canvas;
  }

  /** Draw the terrain as a 3D mesh into the shared canvas, `size` pixels across. Use the canvas before the next render. */
  render3d(size: number[], v: View3d): HTMLCanvasElement {
    const g = context();
    const { gl, canvas, mesh } = g;
    this.resize(g, size);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(SKY[0], SKY[1], SKY[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(mesh.program);
    this.bindHeight(g, mesh);

    this.aerialTexture.bind(g, 1);
    gl.uniform1i(mesh.u.uAerial, 1);
    const a = this.aerialRect;
    gl.uniform4f(mesh.u.uAerialRect, a?.x ?? 0, a?.z ?? 0, a?.w ?? 1, a?.h ?? 1);
    gl.uniform1f(mesh.u.uUseAerial, v.aerial && this.aerialImage ? 1 : 0);

    this.fillTexture.bind(g, 2);
    gl.uniform1i(mesh.u.uFill, 2);
    this.linesTexture.bind(g, 3);
    gl.uniform1i(mesh.u.uLines, 3);
    const d = this.drapeRect;
    gl.uniform4f(mesh.u.uDrapeRect, d?.x ?? 0, d?.z ?? 0, d?.w ?? 1, d?.h ?? 1);
    gl.uniform1f(mesh.u.uFillAlpha, this.fillImage ? v.fill : 0);
    gl.uniform1f(mesh.u.uLineAlpha, this.linesImage ? v.lines : 0);

    gl.uniformMatrix4fv(mesh.u.uViewProj, false, v.viewProj);
    gl.uniform3f(mesh.u.uEye, ...v.eye);
    gl.uniform3f(mesh.u.uSunDir, ...sunDirection());
    gl.uniform3f(mesh.u.uSky, ...SKY);
    gl.uniform2f(mesh.u.uWindow, v.mesh.x0, v.mesh.z0);
    gl.uniform1f(mesh.u.uSpacing, v.mesh.spacing);
    gl.uniform1i(mesh.u.uQuads, v.mesh.quads);
    gl.uniform1f(mesh.u.uScale, v.scale);
    gl.uniform1f(mesh.u.uContour, v.contour);
    gl.uniform1f(mesh.u.uSlope, v.slope ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, v.mesh.quads * v.mesh.quads * 6);
    return canvas;
  }

  /** Free the textures. The renderer still works afterwards; it uploads again on the next render. */
  dispose() {
    for (const t of [this.height, this.aerialTexture, this.fillTexture, this.linesTexture]) t.free();
  }
}
