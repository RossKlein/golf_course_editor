import { currentDevice, type Device } from "../device/device";

/** A texture that is uploaded when first needed, and again if the context was replaced or the source changed. */
export class LazyTexture {
  private texture: WebGLTexture | null = null;
  private generation = -1;
  private dirty = true;

  /** `upload` is called with the texture bound to the unit it is being bound to, and fills it. */
  constructor(private readonly upload: (d: Device) => void) {}

  invalidate() {
    this.dirty = true;
  }

  /** The texture, bound to `unit`, uploading first if it needs it. */
  bind(d: Device, unit: number) {
    const { gl } = d;
    gl.activeTexture(gl.TEXTURE0 + unit);
    if (!this.texture || this.generation !== d.generation) {
      this.texture = gl.createTexture();
      this.generation = d.generation;
      this.dirty = true;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.dirty) {
      this.dirty = false;
      this.upload(d);
    }
  }

  /** The texture as it is now, for drawing into or reading back; null if it was never made in this context. */
  current(d: Device): WebGLTexture | null {
    return this.texture && this.generation === d.generation ? this.texture : null;
  }

  free() {
    const d = currentDevice();
    if (this.texture && d && this.generation === d.generation) d.gl.deleteTexture(this.texture);
    this.texture = null;
    this.generation = -1;
  }
}
