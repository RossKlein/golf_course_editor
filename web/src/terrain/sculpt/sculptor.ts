import type { HeightGrid } from "../../core/decode/decode";
import type { BrushKind } from "./brush";
import { readTile, tileRect, tilesInBox, writeTile } from "./tiles";
import { compileProgram, type Program } from "../../gfx/shader/program";
import type { Device } from "../../gfx/device/device";
import { LazyTexture } from "../../gfx/resource/texture";
import { context, currentContext, type Gl } from "../context";
import type { TerrainGrid } from "../heightfield/heightfield";
import { SHADERS } from "../shaders/shaders";

/** The largest square a single stamp can cover, in samples. */
const SCRATCH = 512;
const KINDS: Record<BrushKind, number> = { raise: 0, lower: 1, smooth: 2, flatten: 3, restore: 4 };

/** One dab of a brush. Positions are course metres. `amount` is metres for raise and lower; `pull` is 0..1 for the rest. */
export type Stamp = { kind: BrushKind; x: number; z: number; radius: number; hardness: number; amount: number; pull: number; level: number };

/** What a stroke changed, tile by tile: for undo, redo and saving. */
export type TileChange = { keys: number[]; before: Float32Array[]; after: Float32Array[] };

/**
 * The sculpted terrain: an offset from the baked height at every sample, kept on the GPU where brushes change it and
 * the shaders read it, and mirrored here in `offsets` as of the last commit. A stroke is many stamps and one `commit`,
 * which reads back only the tiles it touched; that pair of snapshots is what undo, redo and saving work with.
 */
export class Sculptor {
  /** The offsets as of the last commit, a metre per unit. This is what is saved. */
  readonly offsets: Float32Array;
  private readonly touched = new Set<number>();
  private readonly texture = new LazyTexture((g) => this.upload(g));
  private scratch: { generation: number; texture: WebGLTexture; framebuffer: WebGLFramebuffer } | null = null;
  private reader: { generation: number; framebuffer: WebGLFramebuffer } | null = null;
  private program: { generation: number; p: Program } | null = null;

  /**
   * `effective` is the CPU copy of baked height + offsets (for readouts and the camera), which this keeps in step.
   * `bindBase` binds the baked height texture to a unit.
   */
  constructor(
    private readonly data: TerrainGrid,
    private readonly effective: HeightGrid,
    private readonly bindBase: (g: Device, unit: number) => void,
  ) {
    this.offsets = new Float32Array(data.grid.cols * data.grid.rows);
  }

  /** Whether this GPU can render into float textures, which brushes need. */
  supported(): boolean {
    try {
      return context().floatTargets;
    } catch {
      return false;
    }
  }

  private get grid() {
    return { cols: this.data.grid.cols, rows: this.data.grid.rows };
  }

  /** The offsets' texture, bound for the terrain shaders. */
  bindOffsets(g: Device, unit: number) {
    this.texture.bind(g, unit);
  }

  private upload(g: Device) {
    const { gl } = g;
    const { cols, rows } = this.grid;
    const rgba = new Float32Array(cols * rows * 4);
    for (let i = 0; i < this.offsets.length; i++) rgba[i * 4] = this.offsets[i];
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, cols, rows, 0, gl.RGBA, gl.FLOAT, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  private refreshEffective(key: number) {
    const { cols } = this.grid;
    const r = tileRect(this.grid, key);
    for (let j = 0; j < r.h; j++) {
      for (let i = 0; i < r.w; i++) {
        const at = (r.y + j) * cols + r.x + i;
        this.effective.values[at] = this.data.grid.values[at] + this.offsets[at];
      }
    }
  }

  /** Replace every offset, as when a project opens. */
  load(offsets: Float32Array) {
    this.offsets.set(offsets);
    this.touched.clear();
    const g = this.grid;
    for (let key = 0; key < Math.ceil(g.cols / 64) * Math.ceil(g.rows / 64); key++) this.refreshEffective(key);
    this.texture.invalidate();
  }

  private ensureScratch(g: Gl) {
    if (this.scratch && this.scratch.generation === g.generation) return this.scratch;
    const { gl } = g;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, SCRATCH, SCRATCH, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("this GPU cannot render to float textures, so the terrain cannot be sculpted");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.scratch = { generation: g.generation, texture, framebuffer };
    return this.scratch;
  }

  private ensureProgram(g: Gl): Program {
    if (!this.program || this.program.generation !== g.generation) {
      this.program = { generation: g.generation, p: compileProgram(g.gl, SHADERS.brush.vertex, SHADERS.brush.fragment, "brush") };
    }
    return this.program.p;
  }

  /** Apply one dab of a brush on the GPU. Nothing is read back until `commit`. */
  stamp(s: Stamp) {
    const g = context();
    const { gl } = g;
    const { cols, rows } = this.grid;
    const { origin, resX, resZ } = this.data;
    const cx = (s.x - origin.x) / resX, cz = (s.z - origin.z) / resZ;
    const r = Math.min(s.radius / resX, (SCRATCH - 4) / 2);
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(cols - 1, Math.ceil(cx + r + 1));
    const z0 = Math.max(0, Math.floor(cz - r - 1)), z1 = Math.min(rows - 1, Math.ceil(cz + r + 1));
    const w = x1 - x0 + 1, h = z1 - z0 + 1;
    if (w <= 0 || h <= 0) return;

    const scratch = this.ensureScratch(g);
    const p = this.ensureProgram(g);
    this.bindBase(g, 0);
    this.texture.bind(g, 1);

    gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(p.program);
    gl.uniform1i(p.u.uHeight, 0);
    gl.uniform1i(p.u.uDelta, 1);
    gl.uniform2i(p.u.uGrid, cols, rows);
    gl.uniform2i(p.u.uBox, x0, z0);
    gl.uniform2f(p.u.uCentre, cx, cz);
    gl.uniform1f(p.u.uRadius, r);
    gl.uniform1f(p.u.uHardness, s.hardness);
    gl.uniform1f(p.u.uAmount, s.amount);
    gl.uniform1f(p.u.uPull, s.pull);
    gl.uniform1f(p.u.uLevel, s.level);
    gl.uniform1i(p.u.uKind, KINDS[s.kind]);
    gl.uniform1i(p.u.uStep, Math.max(1, Math.floor(r * 0.06)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // put the result into the offsets' texture (a different texture from the one just read, so no feedback)
    gl.activeTexture(gl.TEXTURE1);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, x0, z0, 0, 0, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (const key of tilesInBox(this.grid, x0, z0, x1, z1)) this.touched.add(key);
  }

  /** Read back the tiles the stroke touched. Returns what changed, or null when nothing did. */
  commit(): TileChange | null {
    const keys = [...this.touched].sort((a, b) => a - b);
    this.touched.clear();
    if (!keys.length) return null;
    const g = context();
    const { gl } = g;
    const texture = this.texture.current(g);
    if (!texture) return null;
    if (!this.reader || this.reader.generation !== g.generation) this.reader = { generation: g.generation, framebuffer: gl.createFramebuffer()! };
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.reader.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const change: TileChange = { keys: [], before: [], after: [] };
    for (const key of keys) {
      const r = tileRect(this.grid, key);
      const rgba = new Float32Array(r.w * r.h * 4);
      gl.readPixels(r.x, r.y, r.w, r.h, gl.RGBA, gl.FLOAT, rgba);
      const after = new Float32Array(r.w * r.h);
      for (let i = 0; i < after.length; i++) after[i] = rgba[i * 4];
      const before = readTile(this.offsets, this.grid, key);
      if (before.every((v, i) => v === after[i])) continue;
      change.keys.push(key);
      change.before.push(before);
      change.after.push(after);
      writeTile(this.offsets, this.grid, key, after);
      this.refreshEffective(key);
    }
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return change.keys.length ? change : null;
  }

  /** Put tiles back to the given values, on the GPU as well: undo and redo. */
  apply(keys: number[], tiles: Float32Array[]) {
    const g = context();
    const { gl } = g;
    this.texture.bind(g, 1);
    keys.forEach((key, n) => {
      writeTile(this.offsets, this.grid, key, tiles[n]);
      this.refreshEffective(key);
      const r = tileRect(this.grid, key);
      const rgba = new Float32Array(r.w * r.h * 4);
      for (let i = 0; i < tiles[n].length; i++) rgba[i * 4] = tiles[n][i];
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RGBA, gl.FLOAT, rgba);
    });
  }

  free() {
    this.texture.free();
    const g = currentContext();
    if (g && this.scratch?.generation === g.generation) {
      g.gl.deleteTexture(this.scratch.texture);
      g.gl.deleteFramebuffer(this.scratch.framebuffer);
    }
    this.scratch = null;
  }
}
