/** What every GPU object is made against: the one WebGL2 context, and what this GPU can do. */
export type Device = {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  anisotropy: { ext: { TEXTURE_MAX_ANISOTROPY_EXT: number; MAX_TEXTURE_MAX_ANISOTROPY_EXT: number } | null; max: number };
  /** Rendering to float textures, which sculpting needs. */
  floatTargets: boolean;
  /** Changes when the context is replaced, so GPU objects made for an old one are known to be gone. */
  generation: number;
};

let shared: Device | null = null;
let generation = 0;

/** The one WebGL2 context everything draws with, made on first use and again if the browser takes it away. */
export function device(): Device {
  if (shared && !shared.gl.isContextLost()) return shared;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false });
  if (!gl) throw new Error("WebGL2 is not available");
  const ext = gl.getExtension("EXT_texture_filter_anisotropic");
  shared = {
    canvas,
    gl,
    anisotropy: { ext, max: ext ? (gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) || 1 : 1 },
    floatTargets: !!gl.getExtension("EXT_color_buffer_float"),
    generation: ++generation,
  };
  return shared;
}

/** The device if there is one, without making it. */
export const currentDevice = (): Device | null => (shared && !shared.gl.isContextLost() ? shared : null);
