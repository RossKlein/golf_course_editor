import ImageLayer from "ol/layer/Image";
import ImageCanvas from "ol/source/ImageCanvas";
import type RenderEvent from "ol/render/Event";
import type { Rect } from "../core/geometry/coords";
import { projection } from "./projection";

const dims = (img: CanvasImageSource) => {
  const a = img as { naturalWidth?: number; width: number; naturalHeight?: number; height: number };
  return { w: a.naturalWidth || a.width, h: a.naturalHeight || a.height };
};

/**
 * A raster (image, canvas or bitmap) placed at `rect` in course metres. The source image is drawn straight into
 * OpenLayers' frame canvas, cropped to what is visible, so there is no PNG encode and no async image decode, and
 * `smooth: false` gives nearest-neighbour for class maps. `multiply` shades whatever is drawn beneath it.
 */
export function rasterLayer(opts: { image: () => CanvasImageSource | null; rect: Rect; smooth: boolean; multiply?: boolean }) {
  const source = new ImageCanvas({
    projection,
    ratio: 1,
    canvasFunction: (extent, _resolution, _pixelRatio, size) => {
      const canvas = document.createElement("canvas");
      canvas.width = size[0];
      canvas.height = size[1];
      const img = opts.image();
      if (!img) return canvas;
      const { w: iw, h: ih } = dims(img);
      const { rect } = opts;
      const top = -rect.z; // map y of the image's top edge; its bottom is top - rect.h
      const vx0 = Math.max(extent[0], rect.x), vx1 = Math.min(extent[2], rect.x + rect.w);
      const vy0 = Math.max(extent[1], top - rect.h), vy1 = Math.min(extent[3], top);
      if (vx1 <= vx0 || vy1 <= vy0) return canvas;
      const k = size[0] / (extent[2] - extent[0]); // canvas pixels per metre
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = opts.smooth;
      ctx.drawImage(
        img,
        ((vx0 - rect.x) / rect.w) * iw, ((top - vy1) / rect.h) * ih, ((vx1 - vx0) / rect.w) * iw, ((vy1 - vy0) / rect.h) * ih,
        (vx0 - extent[0]) * k, (extent[3] - vy1) * k, (vx1 - vx0) * k, (vy1 - vy0) * k,
      );
      return canvas;
    },
  });
  const layer = new ImageLayer({ source });
  if (opts.multiply) multiplyBlend(layer);
  return { layer, redraw: () => source.changed() };
}

/** Make a layer shade whatever is drawn beneath it, instead of covering it. */
export function multiplyBlend(layer: ImageLayer<ImageCanvas>) {
  const ctxOf = (e: unknown) => (e as RenderEvent).context as CanvasRenderingContext2D;
  layer.on("prerender", (e) => {
    const ctx = ctxOf(e);
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
  });
  layer.on("postrender", (e) => ctxOf(e).restore());
}

/**
 * A layer drawn by a function of the view: it is given the map extent and the size in pixels and returns a canvas of
 * that size, so what it shows is always sharp at any zoom. `redraw` asks for a fresh render.
 */
export function viewLayer(opts: { draw: (extent: number[], size: number[]) => CanvasImageSource | null; multiply?: boolean }) {
  const source = new ImageCanvas({
    projection,
    ratio: 1,
    canvasFunction: (extent, _resolution, _pixelRatio, size) => {
      const canvas = document.createElement("canvas");
      canvas.width = size[0];
      canvas.height = size[1];
      const image = opts.draw(extent, size);
      if (image) canvas.getContext("2d")!.drawImage(image, 0, 0);
      return canvas;
    },
  });
  const layer = new ImageLayer({ source });
  if (opts.multiply) multiplyBlend(layer);
  return { layer, redraw: () => source.changed() };
}
