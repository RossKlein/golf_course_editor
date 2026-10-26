import type { Device } from "../device/device";

/** A picture to upload: a loaded image, or a canvas painted in code. */
export type Image = HTMLImageElement | HTMLCanvasElement;

export type ImageOptions = {
  mipmaps: boolean;
  repeat?: boolean;
  /** The single pixel used when there is no image: transparent for overlays, opaque white for a grass tile. */
  blank?: number[];
};

/**
 * Fill the bound texture from an image, premultiplied. An image larger than the GPU allows is shrunk to fit. With mipmaps
 * it filters trilinearly and anisotropically, without them linearly.
 */
export function uploadImage(d: Device, image: Image | null, { mipmaps, repeat = false, blank = [0, 0, 0, 0] }: ImageOptions) {
  const { gl } = d;
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
    if (d.anisotropy.ext) gl.texParameterf(gl.TEXTURE_2D, d.anisotropy.ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, d.anisotropy.max));
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
}
