import type { HeightGrid } from "../../decode/decode";
import type { Mat4 } from "../../view3d/mat4";
import type { Rect } from "../coords";
import { context, currentContext, LazyTexture, type Gl, type Program } from "./gl";
import { packHeights } from "./reference";
import { Sculptor } from "./sculptor";
import { SceneryGpu } from "./sceneryGpu";
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
  /** The mesh: a square of `quads` squares of `spacing` metres, with its corner at (x0, z0). */
  mesh: { spacing: number; quads: number; x0: number; z0: number };
  /** Vertical exaggeration of the geometry. */
  scale: number;
  /** Exaggeration of the relief shading (as the map's), and how strongly it shows. */
  relief: number;
  shading: number;
  aerial: boolean;
  /** The game's look for the ground (needs `setSurfaces`), and the standing things drawn on it. */
  game: boolean;
  tufts: boolean;
  trees: boolean;
  /** The camera, for the things that face it, and the ground point it looks at. */
  eye: [number, number, number];
  target: [number, number];
  /** How strongly the design's surfaces and outlines show, 0 to 1. */
  fill: number;
  lines: number;
  contour: number;
  slope: boolean;
};

const SKY: [number, number, number] = [0.62, 0.76, 0.9];

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

type Image = HTMLImageElement | HTMLCanvasElement;

/**
 * A height grid on the GPU and what it takes to draw it, flat for the map or as a 3D mesh. Many renderers share one
 * context; each owns its textures, which are uploaded when first used and again after `dispose` or a lost context, so a
 * renderer is never left unusable. Heights are the baked grid plus, once sculpting is enabled, the sculptor's offsets.
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
  /** Stands in for the offsets when nothing is sculpted. */
  private readonly noOffsets = new LazyTexture((g) => {
    const { gl } = g;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  });
  private readonly aerialTexture = new LazyTexture((g) => this.uploadImage(g, this.aerialImage, true));
  private readonly fillTexture = new LazyTexture((g) => this.uploadImage(g, this.fillImage, true));
  private readonly linesTexture = new LazyTexture((g) => this.uploadImage(g, this.linesImage, true));
  private aerialImage: Image | null = null;
  private aerialRect: Rect | null = null;
  private fillImage: Image | null = null;
  private linesImage: Image | null = null;
  private drapeRect: Rect | null = null;
  private sculptor: Sculptor | null = null;
  private readonly scenery = new SceneryGpu();
  private readonly classTexture = new LazyTexture((g) => this.uploadClasses(g));
  private readonly tileTexture = new LazyTexture((g) => this.uploadImage(g, this.tileImage, true, true));
  private classes: { image: ImageData; res: number } | null = null;
  private tileImage: Image | null = null;
  private tileAverage: [number, number, number] = [1, 1, 1];
  private stripes: Float32Array = new Float32Array(48);

  /** `data.grid` is the baked terrain, which the GPU adds the sculpting to. */
  constructor(private readonly data: TerrainGrid) {}

  /** Make the terrain editable. `effective` is the CPU copy of base + sculpting that the sculptor keeps up to date. */
  enableSculpt(effective: HeightGrid): Sculptor {
    this.sculptor ??= new Sculptor(this.data, effective, (g, unit) => this.height.bind(g, unit));
    return this.sculptor;
  }

  /**
   * The surfaces for the game's look: the class map (R = class, G = hole), the metres a cell covers, and the direction
   * across the mowing stripes of each hole (see stripeDirections).
   */
  setSurfaces(image: ImageData | null, res: number, stripes: Float32Array) {
    this.classes = image ? { image, res } : null;
    this.stripes = stripes;
    this.classTexture.invalidate();
  }

  /** The seamless grass the ground is textured with; its average colour is worked out here so tinting keeps the brightness. */
  setGrassTile(image: Image | null) {
    this.tileImage = image;
    this.tileAverage = [1, 1, 1];
    if (image) {
      const c = document.createElement("canvas");
      c.width = c.height = 16;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(image, 0, 0, 16, 16);
      const px = ctx.getImageData(0, 0, 16, 16).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += px[i + k];
      this.tileAverage = sum.map((s) => s / 255 / (px.length / 4)) as [number, number, number];
    }
    this.tileTexture.invalidate();
  }

  /** Trees to draw, packed four to a tree (x, z, height, kind) and grouped by model kind. */
  setTrees(groups: Float32Array[]) {
    this.scenery.setTrees(groups);
  }

  get treeCount() {
    return this.scenery.treeCount;
  }

  /** Whether the game's look has what it needs. */
  get hasSurfaces() {
    return !!this.classes;
  }

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

  private uploadClasses(g: Gl) {
    const { gl } = g;
    const image = this.classes?.image;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Bind the class map (unit 5) for a program that has uClassMap and uClassInfo. */
  private bindClasses(g: Gl, p: Program) {
    const { gl } = g;
    this.classTexture.bind(g, 5);
    gl.uniform1i(p.u.uClassMap, 5);
    const c = this.classes;
    gl.uniform3f(p.u.uClassInfo, c?.res ?? 1, c?.image.width ?? 1, c?.image.height ?? 1);
  }

  private uploadImage(g: Gl, image: Image | null, mipmaps: boolean, repeat = false) {
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mipmaps && source) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (g.anisotropy.ext) gl.texParameterf(gl.TEXTURE_2D, g.anisotropy.ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, g.anisotropy.max));
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
  }

  /** Bind the heights (unit 0) and the sculpting offsets (unit 4) and the numbers that describe them. */
  private bindHeight(g: Gl, p: Program) {
    const { gl } = g;
    const { grid, origin, resX, resZ } = this.data;
    this.height.bind(g, 0);
    gl.uniform1i(p.u.uHeight, 0);
    if (this.sculptor) this.sculptor.bindOffsets(g, 4);
    else this.noOffsets.bind(g, 4);
    gl.uniform1i(p.u.uDelta, 4);
    gl.uniform1f(p.u.uHasDelta, this.sculptor ? 1 : 0);
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
    g.gl.bindFramebuffer(g.gl.FRAMEBUFFER, null);
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
    const { gl, canvas } = g;
    const mesh = g.mesh;
    if (!mesh) throw new Error("the 3D terrain program did not build; the console has the shader error");
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
    gl.uniform3f(mesh.u.uSunDir, ...sunDirection());
    gl.uniform1f(mesh.u.uRelief, v.relief);
    gl.uniform1f(mesh.u.uShading, v.shading);
    gl.uniform2f(mesh.u.uWindow, v.mesh.x0, v.mesh.z0);
    gl.uniform1f(mesh.u.uSpacing, v.mesh.spacing);
    gl.uniform1i(mesh.u.uQuads, v.mesh.quads);
    gl.uniform1f(mesh.u.uScale, v.scale);
    gl.uniform1f(mesh.u.uContour, v.contour);
    gl.uniform1f(mesh.u.uSlope, v.slope ? 1 : 0);

    const game = v.game && this.classes;
    this.bindClasses(g, mesh);
    this.tileTexture.bind(g, 6);
    gl.uniform1i(mesh.u.uTile, 6);
    gl.uniform3f(mesh.u.uTileAvg, ...this.tileAverage);
    gl.uniform1f(mesh.u.uTileMetres, 3);
    gl.uniform2fv(mesh.u.uStripe, this.stripes);
    gl.uniform1f(mesh.u.uGame, game ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, v.mesh.quads * v.mesh.quads * 6);

    if (v.tufts || v.trees) {
      this.scenery.draw(
        g,
        { viewProj: v.viewProj, eye: v.eye, target: v.target, sunDir: sunDirection(), scale: v.scale, tufts: v.tufts && !!this.classes, trees: v.trees },
        (p) => this.bindHeight(g, p),
        (p) => this.bindClasses(g, p),
      );
    }
    return canvas;
  }

  /** Free the textures. The renderer still works afterwards; it uploads again on the next render. */
  dispose() {
    for (const t of [this.height, this.noOffsets, this.aerialTexture, this.fillTexture, this.linesTexture, this.classTexture, this.tileTexture]) t.free();
    this.scenery.free(currentContext());
    this.sculptor?.free();
  }
}
