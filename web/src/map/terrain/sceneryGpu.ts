import { boxVisible, frustumOf, type Frustum } from "../../view3d/frustum";
import type { Look } from "../../api/api";
import { chunkTrees, treeMesh, type Mesh, type TreeChunk } from "../../view3d/scenery";
import { compileProgram, tryProgram, type Program } from "../../gfx/shader/program";
import { currentContext, type Gl } from "./gl";
import { TUFT_TILE } from "./limits";
import { setLookUniforms } from "./look";
import { SHADERS } from "./shaders";

// The standing things on the ground, drawn on top of the terrain: tufts of grass in the rough and low-poly trees.
// Neither has any data on the CPU beyond the trees' positions. A tuft's place, size and whether it exists at all are worked
// out in the vertex shader from its number, the class map and the heights, so there is nothing to build or update.

/** The tufts' defaults: how far from the camera's target they grow, and the spacing that gives "density 1". */
export const TUFT_RANGE = 200;
const TUFT_CELL = 0.5;
/** Most tufts across the patch, a bound on the work however far or dense the sliders go (only the tiles in view are drawn). */
const MAX_ACROSS = 3072;

/** The grid of tufts for a range (metres) and a density (1 is the default, 2 is twice as many to the square metre). */
export function tuftGrid(range: number, density: number): { cell: number; across: number } {
  const cell = Math.max(TUFT_CELL / Math.sqrt(Math.max(density, 0.01)), (2 * range) / MAX_ACROSS);
  return { cell, across: Math.ceil((2 * range) / cell) };
}

/**
 * The tiles of the tuft patch worth drawing: those within `range` of the patch's centre and in view. Each is the first
 * tuft of the tile, in tufts from the patch's corner. `y0`..`y1` bound the ground's height, tufts' height included.
 */
export function tuftTiles(target: readonly [number, number], range: number, density: number, f: Frustum, y0: number, y1: number): [number, number][] {
  const { cell, across } = tuftGrid(range, density);
  const cx = Math.round(target[0] / cell), cz = Math.round(target[1] / cell);
  const cornerX = cx - across / 2, cornerZ = cz - across / 2; // in tufts, as in the shader
  const out: [number, number][] = [];
  const margin = 1; // metres: a tuft sits up to a cell from its grid point and is as wide as it is tall
  for (let ty = 0; ty < across; ty += TUFT_TILE) {
    for (let tx = 0; tx < across; tx += TUFT_TILE) {
      const x0 = (cornerX + tx) * cell - margin, x1 = (cornerX + tx + TUFT_TILE + 1) * cell + margin;
      const z0 = (cornerZ + ty) * cell - margin, z1 = (cornerZ + ty + TUFT_TILE + 1) * cell + margin;
      const near = Math.hypot(Math.max(x0 - cx * cell, 0, cx * cell - x1), Math.max(z0 - cz * cell, 0, cz * cell - z1));
      if (near > range) continue;
      if (boxVisible(f, x0, y0, z0, x1, y1, z1)) out.push([tx, ty]);
    }
  }
  return out;
}

type Model = { vao: WebGLVertexArrayObject; vertices: number; instances: WebGLBuffer; count: number; radius: number };

export type SceneryParams = {
  viewProj: Float32Array;
  eye: [number, number, number];
  target: [number, number];
  sunDir: [number, number, number];
  scale: number;
  /** The lowest and highest ground in the course, in metres before the vertical exaggeration, which bounds what could be in view. */
  ground: [number, number];
  tufts: boolean;
  /** How far from the target tufts grow, in metres, and how many (1 is the default density). */
  tuftRange: number;
  tuftDensity: number;
  trees: boolean;
};

/** The grass tufts and trees, with the GPU objects they need, made when first drawn and again if the context is replaced. */
export class SceneryGpu {
  private made: {
    generation: number;
    tufts: Program | null;
    trees: Program | null;
    models: Model[];
    quad: WebGLVertexArrayObject;
  } | null = null;
  private look: Look | null = null;
  private groups: Float32Array[] = [];
  private chunks: TreeChunk[][] = [];
  private dirty = true;
  /** What the last draw sent, out of what there is: for checking that culling works. */
  stats = { tuftTiles: 0, tuftTilesAll: 0, treeChunks: 0, treeChunksAll: 0, tufts: 0, tuftsAll: 0, trees: 0, treesAll: 0 };

  /** The course's look: the tree models, the light they take, the tufts and what grows where. The tree models are rebuilt. */
  setLook(look: Look) {
    this.free(currentContext());
    this.look = look;
  }

  /** The trees, packed four to a tree (x, z, height, kind) and grouped by the look's model kinds. */
  setTrees(groups: Float32Array[]) {
    const chunked = groups.map((g) => chunkTrees(g));
    this.groups = chunked.map((c) => c.sorted);
    this.chunks = chunked.map((c) => c.chunks);
    this.dirty = true;
  }

  get treeCount() {
    return this.groups.reduce((n, g) => n + g.length / 4, 0);
  }

  private make(g: Gl) {
    const { gl } = g;
    const buffer = (data: Float32Array) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    };
    const models: Model[] = [];
    for (const kind of this.look!.trees.kinds) {
      const mesh: Mesh = treeMesh(kind);
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      for (const [loc, data] of [[0, mesh.positions], [1, mesh.normals], [2, mesh.colors]] as const) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer(data));
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      }
      const instances = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, instances);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(3, 1);
      let radius = 0; // how far from its trunk a tree one unit tall reaches
      for (let i = 0; i < mesh.positions.length; i += 3) radius = Math.max(radius, Math.hypot(mesh.positions[i], mesh.positions[i + 2]));
      models.push({ vao, vertices: mesh.positions.length / 3, instances, count: 0, radius });
    }
    gl.bindVertexArray(null);
    const quad = gl.createVertexArray()!; // the tufts need no attributes at all
    this.made = {
      generation: g.generation,
      quad,
      models,
      tufts: tryProgram(() => compileProgram(gl, SHADERS.tufts.vertex, SHADERS.tufts.fragment, "grass tufts")),
      trees: tryProgram(() => compileProgram(gl, SHADERS.trees.vertex, SHADERS.trees.fragment, "trees")),
    };
    this.dirty = true;
  }

  /**
   * Draw both onto what the terrain pass just drew. `bindHeight` binds the heights for a program; `bindClasses` binds the
   * class map and says where.
   */
  draw(g: Gl, p: SceneryParams, bindHeight: (p: Program) => void, bindClasses: (p: Program) => void) {
    const { gl } = g;
    if (!this.look) return;
    const look = this.look;
    if (!this.made || this.made.generation !== g.generation) this.make(g);
    const m = this.made!;
    if (this.dirty) {
      this.dirty = false;
      m.models.forEach((model, k) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, model.instances);
        const trees = this.groups[k] ?? new Float32Array(0);
        gl.bufferData(gl.ARRAY_BUFFER, trees, gl.DYNAMIC_DRAW);
        model.count = trees.length / 4;
      });
    }

    const frustum = frustumOf(p.viewProj);
    const y0 = p.ground[0] * p.scale - 1, y1 = p.ground[1] * p.scale + 1;
    this.stats = { tuftTiles: 0, tuftTilesAll: 0, treeChunks: 0, treeChunksAll: 0, tufts: 0, tuftsAll: 0, trees: 0, treesAll: this.treeCount };

    if (p.trees && m.trees) {
      const t = m.trees;
      gl.useProgram(t.program);
      bindHeight(t);
      gl.uniformMatrix4fv(t.u.uViewProj, false, p.viewProj);
      gl.uniform3f(t.u.uSunDir, ...p.sunDir);
      gl.uniform1f(t.u.uScale, p.scale);
      setLookUniforms(gl, t, look);
      this.stats.treeChunks = this.stats.treeChunksAll = this.stats.trees = 0;
      this.stats.treesAll = this.treeCount;
      m.models.forEach((model, k) => {
        if (!model.count) return;
        gl.bindVertexArray(model.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, model.instances);
        for (const c of this.chunks[k] ?? []) {
          this.stats.treeChunksAll++;
          // a tree reaches `radius` times its height from its trunk, up to 15% more when it is spread
          const r = model.radius * c.tallest * 1.15;
          if (!boxVisible(frustum, c.x0 - r, y0, c.z0 - r, c.x1 + r, y1 + c.tallest, c.z1 + r)) continue;
          this.stats.treeChunks++;
          this.stats.trees += c.count;
          gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, c.first * 16); // the run of this chunk's trees
          gl.drawArraysInstanced(gl.TRIANGLES, 0, model.vertices, c.count);
        }
      });
    }

    if (p.tufts && m.tufts) {
      const t = m.tufts;
      gl.useProgram(t.program);
      bindHeight(t);
      bindClasses(t);
      gl.uniformMatrix4fv(t.u.uViewProj, false, p.viewProj);
      gl.uniform3f(t.u.uEye, ...p.eye);
      const { cell, across } = tuftGrid(p.tuftRange, p.tuftDensity);
      gl.uniform2f(t.u.uCentre, Math.round(p.target[0] / cell) * cell, Math.round(p.target[1] / cell) * cell);
      gl.uniform1f(t.u.uCell, cell);
      gl.uniform1i(t.u.uN, across);
      gl.uniform1f(t.u.uRadius, p.tuftRange);
      gl.uniform1f(t.u.uScale, p.scale);
      setLookUniforms(gl, t, look);
      gl.bindVertexArray(m.quad);
      const tiles = tuftTiles(p.target, p.tuftRange, p.tuftDensity, frustum, y0, y1 + 1);
      this.stats.tuftTiles = tiles.length;
      this.stats.tuftTilesAll = Math.ceil(across / TUFT_TILE) ** 2;
      this.stats.tufts = tiles.length * TUFT_TILE * TUFT_TILE; // sent to the GPU; those off the rough are dropped there
      this.stats.tuftsAll = across * across;
      for (const [tx, ty] of tiles) {
        gl.uniform2i(t.u.uTile, tx, ty);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, TUFT_TILE * TUFT_TILE);
      }
    }
    gl.bindVertexArray(null);
  }

  free(g: Gl | null) {
    if (g && this.made?.generation === g.generation) {
      for (const model of this.made.models) {
        g.gl.deleteVertexArray(model.vao);
        g.gl.deleteBuffer(model.instances);
      }
      g.gl.deleteVertexArray(this.made.quad);
    }
    this.made = null;
  }
}
