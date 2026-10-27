import type { Device } from "../../gfx/device/device";
import { uploadImage, type Image } from "../../gfx/resource/image";
import { LazyTexture } from "../../gfx/resource/texture";
import type { Program } from "../../gfx/shader/program";
import { EDGE_BLOCK, EDGE_REACH } from "../limits";
import { grainHeights, luminanceHeights, slopeMap } from "./bump";
import { edgeMask } from "./edgeMask";
import { SPECKLE_SIZE, speckleTexels } from "./speckle";

/** A normal map: the slope of a surface's fine detail, two bytes a pixel (see bump.ts). */
type BumpMap = { data: Uint8Array; width: number; height: number };

/** The biggest the grass tile's normal map is made, in pixels across: more is detail a screen cannot show. */
const BUMP_SIZE = 1024;
/** Pixels across the grain normal map, and the seed that makes it the same every time. */
const GRAIN_SIZE = 256;
const GRAIN_SEED = 3;

/** Fill the bound texture from a normal map (a level one pixel map when there is none), repeating, with mipmaps so it fades to level with distance. */
function uploadBump(d: Device, map: BumpMap | null) {
  const { gl } = d;
  const m = map ?? { data: new Uint8Array([128, 128]), width: 1, height: 1 };
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, m.width, m.height, 0, gl.RG, gl.UNSIGNED_BYTE, m.data);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  if (d.anisotropy.ext) gl.texParameterf(gl.TEXTURE_2D, d.anisotropy.ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, d.anisotropy.max));
}

/**
 * What the game's look needs to know about the ground: the class map (R = surface, G = owning hole), the direction of each
 * hole's mowing stripes, the grass texture the surfaces are tiled with, the speckle texture for sand, and two normal
 * maps for the surfaces' fine detail: one made from the grass texture's own light and dark, one of grains.
 */
export class Surfaces {
  private classes: { image: ImageData; res: number } | null = null;
  private stripes: Float32Array = new Float32Array(48);
  private tileImage: Image | null = null;
  private tileAverage: [number, number, number] = [1, 1, 1];
  private grassBump: BumpMap | null = null;
  private grainBump: BumpMap | null = null;
  private readonly classTexture = new LazyTexture((d) => this.uploadClasses(d));
  /** Which blocks of the class map are near an edge between surfaces, so the shader smooths only there. */
  private readonly edgeTexture = new LazyTexture((d) => this.uploadEdges(d));
  private readonly tileTexture = new LazyTexture((d) => uploadImage(d, this.tileImage, { mipmaps: true, repeat: true, blank: [255, 255, 255, 255] }));
  private readonly grassBumpTexture = new LazyTexture((d) => uploadBump(d, this.grassBump));
  private readonly grainBumpTexture = new LazyTexture((d) => uploadBump(d, (this.grainBump ??= { data: slopeMap(grainHeights(GRAIN_SIZE, GRAIN_SEED), GRAIN_SIZE, GRAIN_SIZE), width: GRAIN_SIZE, height: GRAIN_SIZE })));
  private readonly speckleTexture = new LazyTexture((d) => {
    const { gl } = d;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, SPECKLE_SIZE, SPECKLE_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, speckleTexels());
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); // crisp grains up close
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (d.anisotropy.ext) gl.texParameterf(gl.TEXTURE_2D, d.anisotropy.ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, d.anisotropy.max));
  });

  /**
   * The class map, the metres a cell covers, and the direction across the mowing stripes of each hole (see
   * stripeDirections).
   */
  set(image: ImageData | null, res: number, stripes: Float32Array) {
    this.classes = image ? { image, res } : null;
    this.stripes = stripes;
    this.classTexture.invalidate();
    this.edgeTexture.invalidate();
  }

  /** The seamless grass the ground is textured with; its average colour is worked out here so tinting keeps the brightness. */
  setGrassTile(image: Image | null) {
    this.tileImage = image;
    this.tileAverage = [1, 1, 1];
    this.grassBump = image ? grassNormals(image) : null;
    this.grassBumpTexture.invalidate();
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

  /** Whether the game's look has what it needs. */
  get has() {
    return !!this.classes;
  }

  private uploadClasses(d: Device) {
    const { gl } = d;
    const image = this.classes?.image;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private uploadEdges(d: Device) {
    const { gl } = d;
    const image = this.classes?.image;
    const mask = image ? edgeMask(image.data, image.width, image.height, EDGE_BLOCK, EDGE_REACH) : { data: new Uint8Array(1), cols: 1, rows: 1 };
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mask.cols, mask.rows, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Bind the class map (unit 5) for a program that has uClassMap and uClassInfo. */
  bindClasses(d: Device, p: Program) {
    const { gl } = d;
    this.classTexture.bind(d, 5);
    gl.uniform1i(p.u.uClassMap, 5);
    this.edgeTexture.bind(d, 9);
    gl.uniform1i(p.u.uEdgeMask, 9);
    const c = this.classes;
    gl.uniform3f(p.u.uClassInfo, c?.res ?? 1, c?.image.width ?? 1, c?.image.height ?? 1);
  }

  /** Bind the grass tile (unit 6), the speckle texture (unit 7), and the stripe directions, for the ground program. */
  bindGround(d: Device, p: Program) {
    const { gl } = d;
    this.tileTexture.bind(d, 6);
    gl.uniform1i(p.u.uTile, 6);
    this.speckleTexture.bind(d, 7);
    gl.uniform1i(p.u.uSpeckleTex, 7);
    this.grassBumpTexture.bind(d, 14);
    gl.uniform1i(p.u.uBumpGrass, 14);
    this.grainBumpTexture.bind(d, 15);
    gl.uniform1i(p.u.uBumpGrain, 15);
    gl.uniform3f(p.u.uTileAvg, ...this.tileAverage);
    gl.uniform2fv(p.u.uStripe, this.stripes);
  }

  dispose() {
    for (const t of [this.classTexture, this.edgeTexture, this.tileTexture, this.speckleTexture, this.grassBumpTexture, this.grainBumpTexture]) t.free();
  }
}

/** The normal map of the grass tile: its light and dark read as height, so blades and clumps catch the sun. */
function grassNormals(image: Image): BumpMap {
  const k = Math.min(1, BUMP_SIZE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * k)), height = Math.max(1, Math.round(image.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0, width, height);
  return { data: slopeMap(luminanceHeights(ctx.getImageData(0, 0, width, height).data, width, height), width, height), width, height };
}
