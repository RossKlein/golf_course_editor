import type { HeightGrid } from "../../core/decode/decode";
import type { Device } from "../../gfx/device/device";
import { LazyTexture } from "../../gfx/resource/texture";
import type { Program } from "../../gfx/shader/program";
import { Sculptor } from "../sculpt/sculptor";

export type TerrainGrid = {
  grid: HeightGrid;
  /** Course metres of sample (0, 0). */
  origin: { x: number; z: number };
  resX: number;
  resZ: number;
};

/** Interleave heights and validity the way the shader's texture expects: (height, 1 or 0) per sample. */
export function packHeights(values: Float32Array, valid: Uint8Array): Float32Array {
  const out = new Float32Array(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    out[i * 2] = valid[i] ? values[i] : 0;
    out[i * 2 + 1] = valid[i] ? 1 : 0;
  }
  return out;
}

/**
 * The ground's heights on the GPU: the baked grid, plus the sculptor's offsets once sculpting is enabled. Every pass that
 * needs the ground binds it with `bind` and gets the shaders' one sampling routine (shaders/height.glsl).
 */
export class HeightField {
  private readonly base = new LazyTexture((d) => {
    const { gl } = d;
    const { grid } = this.data;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, grid.cols, grid.rows, 0, gl.RG, gl.FLOAT, packHeights(grid.values, grid.valid));
    // read with texelFetch, so filtering is moot; set to the only mode a float texture always supports
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  });
  /** Stands in for the offsets when nothing is sculpted. */
  private readonly noOffsets = new LazyTexture((d) => {
    const { gl } = d;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  });
  private sculptor: Sculptor | null = null;
  private span: [number, number] | null = null;

  /** `data.grid` is the baked terrain, which the GPU adds the sculpting to. */
  constructor(readonly data: TerrainGrid) {}

  /** Make the terrain editable. `effective` is the CPU copy of base + sculpting that the sculptor keeps up to date. */
  enableSculpt(effective: HeightGrid): Sculptor {
    this.sculptor ??= new Sculptor(this.data, effective, (d, unit) => this.base.bind(d, unit));
    return this.sculptor;
  }

  /** Bind the heights (unit 0) and the sculpting offsets (unit 4) and the numbers that describe them. */
  bind(d: Device, p: Program) {
    const { gl } = d;
    const { grid, origin, resX, resZ } = this.data;
    this.base.bind(d, 0);
    gl.uniform1i(p.u.uHeight, 0);
    if (this.sculptor) this.sculptor.bindOffsets(d, 4);
    else this.noOffsets.bind(d, 4);
    gl.uniform1i(p.u.uDelta, 4);
    gl.uniform1f(p.u.uHasDelta, this.sculptor ? 1 : 0);
    gl.uniform2i(p.u.uGrid, grid.cols, grid.rows);
    gl.uniform2f(p.u.uOrigin, origin.x, origin.z);
    gl.uniform2f(p.u.uRes, resX, resZ);
  }

  /** The lowest and highest ground, with room for sculpting to have raised or lowered it; used to tell what is out of view. */
  groundRange(): [number, number] {
    if (!this.span) {
      let lo = Infinity, hi = -Infinity;
      const { values, valid } = this.data.grid;
      for (let i = 0; i < values.length; i++) {
        if (!valid[i]) continue;
        if (values[i] < lo) lo = values[i];
        if (values[i] > hi) hi = values[i];
      }
      this.span = lo <= hi ? [lo - 50, hi + 50] : [-50, 50];
    }
    return this.span;
  }

  /** Free the textures. The field still works afterwards; it uploads again on the next bind. */
  dispose() {
    this.base.free();
    this.noOffsets.free();
    this.sculptor?.free();
  }
}
