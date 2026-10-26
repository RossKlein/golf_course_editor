import type { HeightGrid } from "../../decode/decode";
import type { Mat4 } from "../../gfx/math/mat4";
import type { Rect } from "../coords";
import type { Program } from "../../gfx/shader/program";
import type { Device } from "../../gfx/device/device";
import { LazyTexture } from "../../gfx/resource/texture";
import { context, currentContext, type Gl } from "./gl";
import { packHeights } from "./reference";
import { Sculptor } from "./sculptor";
import { SPECKLE_SIZE, speckleTexels } from "../../view3d/scenery";
import { SceneryGpu } from "./sceneryGpu";
import type { Look } from "../../api/api";
import { setLookUniforms } from "./look";
import { sunDirection, sunOfLook, type Sun } from "./sun";
import { DEFAULT_THEME, setThemeUniforms, type TerrainTheme } from "./theme";

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
  /** The mesh as rings, outermost first: each a square of `quads` squares of `spacing` metres with its corner at (x0, z0). */
  meshes: { spacing: number; quads: number; x0: number; z0: number }[];
  /** Vertical exaggeration of the geometry. */
  scale: number;
  /** Exaggeration of the relief shading (as the map's), and how strongly it shows. */
  relief: number;
  shading: number;
  aerial: boolean;
  /** The game's look for the ground (needs `setSurfaces`), and the standing things drawn on it. */
  game: boolean;
  tufts: boolean;
  tuftRange: number;
  tuftDensity: number;
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
  private readonly speckleTexture = new LazyTexture((g) => {
    const { gl } = g;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, SPECKLE_SIZE, SPECKLE_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, speckleTexels());
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); // crisp grains up close
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (g.anisotropy.ext) gl.texParameterf(gl.TEXTURE_2D, g.anisotropy.ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, g.anisotropy.max));
  });
  private readonly classTexture = new LazyTexture((g) => this.uploadClasses(g));
  private readonly tileTexture = new LazyTexture((g) => this.uploadImage(g, this.tileImage, true, true, [255, 255, 255, 255]));
  private classes: { image: ImageData; res: number } | null = null;
  private tileImage: Image | null = null;
  private tileAverage: [number, number, number] = [1, 1, 1];
  private stripes: Float32Array = new Float32Array(48);

  private look!: Look;
  private sun!: Sun;

  /** `data.grid` is the baked terrain, which the GPU adds the sculpting to. `look` is the course's look; `theme` is the editor's. */
  constructor(private readonly data: TerrainGrid, look: Look, private theme: TerrainTheme = DEFAULT_THEME) {
    this.setLook(look);
  }

  /** Use a new look (the course was rebuilt, or its look edited): the sun, sky, surfaces, tufts and trees all follow it. */
  setLook(look: Look) {
    this.look = look;
    this.sun = sunOfLook(look);
    this.scenery.setLook(look);
  }

  setTheme(theme: TerrainTheme) {
    this.theme = theme;
  }

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

  /** The lowest and highest ground, with room for sculpting to have raised or lowered it; used to tell what is out of view. */
  private groundSpan: [number, number] | null = null;
  private groundRange(): [number, number] {
    if (!this.groundSpan) {
      let lo = Infinity, hi = -Infinity;
      const { values, valid } = this.data.grid;
      for (let i = 0; i < values.length; i++) {
        if (!valid[i]) continue;
        if (values[i] < lo) lo = values[i];
        if (values[i] > hi) hi = values[i];
      }
      this.groundSpan = lo <= hi ? [lo - 50, hi + 50] : [-50, 50];
    }
    return this.groundSpan;
  }

  /** Trees to draw, packed four to a tree (x, z, height, kind) and grouped by model kind. */
  setTrees(groups: Float32Array[]) {
    this.scenery.setTrees(groups);
  }

  /** What the last 3D draw sent to the GPU out of what there is: tuft slots and trees. */
  get sceneryStats() {
    return this.scenery.stats;
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

  private uploadClasses(g: Device) {
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

  /** `blank` is the single pixel used when there is no image: transparent for overlays, opaque white for the grass tile. */
  private uploadImage(g: Device, image: Image | null, mipmaps: boolean, repeat = false, blank = [0, 0, 0, 0]) {
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
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(blank));
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
    gl.uniform2f(flat.u.uSun, this.sun.azimuth, this.sun.altitude);
    setThemeUniforms(gl, flat, this.theme);
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
    gl.clearColor(...this.look.sky, 1);
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
    gl.uniform3f(mesh.u.uSunDir, ...sunDirection(this.sun));
    setLookUniforms(gl, mesh, this.look);
    setThemeUniforms(gl, mesh, this.theme);
    gl.uniform1f(mesh.u.uRelief, v.relief);
    gl.uniform1f(mesh.u.uShading, v.shading);
    gl.uniform3f(mesh.u.uSpeckle, v.target[0], v.target[1], v.tuftRange); // speckle shows as far as the grass grows
    gl.uniform1f(mesh.u.uScale, v.scale);
    gl.uniform1f(mesh.u.uContour, v.contour);
    gl.uniform1f(mesh.u.uSlope, v.slope ? 1 : 0);

    const game = v.game && this.classes;
    this.bindClasses(g, mesh);
    this.tileTexture.bind(g, 6);
    gl.uniform1i(mesh.u.uTile, 6);
    this.speckleTexture.bind(g, 7);
    gl.uniform1i(mesh.u.uSpeckleTex, 7);
    gl.uniform3f(mesh.u.uTileAvg, ...this.tileAverage);
    gl.uniform2fv(mesh.u.uStripe, this.stripes);
    gl.uniform1f(mesh.u.uGame, game ? 1 : 0);
    // outermost ring first; where rings overlap the finer one wins, so the coarser ones are pushed back a little in depth
    gl.enable(gl.POLYGON_OFFSET_FILL);
    v.meshes.forEach((m, i) => {
      const finer = v.meshes[i + 1];
      gl.polygonOffset(finer ? 2 : 0, finer ? 2 : 0);
      gl.uniform2f(mesh.u.uWindow, m.x0, m.z0);
      gl.uniform1f(mesh.u.uSpacing, m.spacing);
      gl.uniform1i(mesh.u.uQuads, m.quads);
      const inner = finer ? [finer.x0, finer.z0, finer.x0 + finer.quads * finer.spacing, finer.z0 + finer.quads * finer.spacing] : [0, 0, 0, 0];
      gl.uniform4f(mesh.u.uInner, inner[0], inner[1], inner[2], inner[3]);
      gl.drawArrays(gl.TRIANGLES, 0, m.quads * m.quads * 6);
    });
    gl.disable(gl.POLYGON_OFFSET_FILL);

    if (v.tufts || v.trees) {
      this.scenery.draw(
        g,
        { viewProj: v.viewProj, eye: v.eye, target: v.target, sunDir: sunDirection(this.sun), scale: v.scale, ground: this.groundRange(), tufts: v.tufts && !!this.classes, tuftRange: v.tuftRange, tuftDensity: v.tuftDensity, trees: v.trees },
        (p) => this.bindHeight(g, p),
        (p) => this.bindClasses(g, p),
      );
    }
    return canvas;
  }

  /** Free the textures. The renderer still works afterwards; it uploads again on the next render. */
  dispose() {
    for (const t of [this.height, this.noOffsets, this.aerialTexture, this.fillTexture, this.linesTexture, this.classTexture, this.tileTexture, this.speckleTexture]) t.free();
    this.scenery.free(currentContext());
    this.sculptor?.free();
  }
}
