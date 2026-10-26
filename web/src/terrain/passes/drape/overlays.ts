import type { Device } from "../../../gfx/device/device";
import { uploadImage, type Image } from "../../../gfx/resource/image";
import { LazyTexture } from "../../../gfx/resource/texture";
import type { Program } from "../../../gfx/shader/program";
import type { Rect } from "../../../core/geometry/coords";

/** How strongly to show each overlay this frame. */
export type OverlayShow = { aerial: boolean; fill: number; lines: number };

/**
 * What is laid over the ground in 3D: the aerial imagery, and the design's surfaces and outlines painted to two canvases
 * (see the drape in view3d). Textures upload when first used and again when their source is replaced.
 */
export class Overlays {
  private aerialImage: Image | null = null;
  private aerialRect: Rect | null = null;
  private fillImage: Image | null = null;
  private linesImage: Image | null = null;
  private drapeRect: Rect | null = null;
  private readonly aerialTexture = new LazyTexture((d) => uploadImage(d, this.aerialImage, { mipmaps: true }));
  private readonly fillTexture = new LazyTexture((d) => uploadImage(d, this.fillImage, { mipmaps: true }));
  private readonly linesTexture = new LazyTexture((d) => uploadImage(d, this.linesImage, { mipmaps: true }));

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

  /** Bind the aerial (unit 1), the fill (2) and the outlines (3) and say where and how strongly they show. */
  bind(d: Device, p: Program, show: OverlayShow) {
    const { gl } = d;
    this.aerialTexture.bind(d, 1);
    gl.uniform1i(p.u.uAerial, 1);
    const a = this.aerialRect;
    gl.uniform4f(p.u.uAerialRect, a?.x ?? 0, a?.z ?? 0, a?.w ?? 1, a?.h ?? 1);
    gl.uniform1f(p.u.uUseAerial, show.aerial && this.aerialImage ? 1 : 0);

    this.fillTexture.bind(d, 2);
    gl.uniform1i(p.u.uFill, 2);
    this.linesTexture.bind(d, 3);
    gl.uniform1i(p.u.uLines, 3);
    const r = this.drapeRect;
    gl.uniform4f(p.u.uDrapeRect, r?.x ?? 0, r?.z ?? 0, r?.w ?? 1, r?.h ?? 1);
    gl.uniform1f(p.u.uFillAlpha, this.fillImage ? show.fill : 0);
    gl.uniform1f(p.u.uLineAlpha, this.linesImage ? show.lines : 0);
  }

  dispose() {
    for (const t of [this.aerialTexture, this.fillTexture, this.linesTexture]) t.free();
  }
}
