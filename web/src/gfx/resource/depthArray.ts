import type { Device } from "../device/device";

/**
 * A stack of square depth maps with a framebuffer to draw into each, and a hardware comparison when read: sampling it with a
 * reference depth gives how much of the 2x2 neighbourhood is nearer than the reference (a shadow lookup). Made when first
 * needed, remade if the size or the number of layers changes or the context was replaced.
 */
export class DepthArray {
  private made: { generation: number; texture: WebGLTexture; framebuffer: WebGLFramebuffer; size: number; layers: number } | null = null;

  /** Make sure the array exists with this size and number of layers. Returns its actual size (it never exceeds what the GPU allows). */
  ensure(d: Device, size: number, layers: number): number {
    const { gl } = d;
    const limit = Math.min(size, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const m = this.made;
    if (m && m.generation === d.generation && m.size === limit && m.layers === layers) return limit;
    this.free(d);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.DEPTH_COMPONENT24, limit, limit, layers, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, texture, 0, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error("this GPU cannot render into depth textures, so there are no shadows");
    }
    this.made = { generation: d.generation, texture, framebuffer, size: limit, layers };
    return limit;
  }

  /** Draw into one layer: it is cleared to the far depth and the viewport is the whole layer. `ensure` must have been called. */
  bindForWrite(d: Device, layer: number) {
    const { gl } = d;
    const m = this.made!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, m.framebuffer);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, m.texture, 0, layer);
    gl.viewport(0, 0, m.size, m.size);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }

  /** Bind the array to a texture unit for sampling. */
  bindForRead(d: Device, unit: number) {
    const { gl } = d;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.made!.texture);
  }

  free(d: Device | null) {
    const m = this.made;
    if (m && d && m.generation === d.generation) {
      d.gl.deleteFramebuffer(m.framebuffer);
      d.gl.deleteTexture(m.texture);
    }
    this.made = null;
  }
}
