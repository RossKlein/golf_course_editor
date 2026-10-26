import type { Look } from "../../../core/api/api";
import type { Mat4 } from "../../../gfx/math/mat4";
import { boxVisible } from "../../../gfx/math/frustum";
import { compileProgram, tryProgram, type Program } from "../../../gfx/shader/program";
import type { Gl } from "../../context";
import { setLookUniforms } from "../../look/look";
import { chunkTrees, type TreeChunk } from "../../scenery/trees";
import { treeMesh, type Mesh } from "../../scenery/treeMesh";
import { SHADERS } from "../../shaders/shaders";
import type { Crown } from "../../lighting/canopyMath";
import { crownOfMesh } from "../../lighting/crown";
import { sunDirection } from "../../sun";
import type { Cull, World } from "../../world";

// Low-poly trees, instanced from the look's models. The CPU holds only their positions, sorted into chunks of ground so a
// chunk that is out of view is never drawn. The same trees are drawn again, depth only, into the sun's shadow maps.

type Model = {
  vao: WebGLVertexArrayObject;
  vertices: number;
  instances: WebGLBuffer;
  count: number;
  radius: number;
  /** The instances alone, for drawing a quad for each tree. */
  canopyVao: WebGLVertexArrayObject;
  /** The crown of a tree one unit tall. */
  crown: Crown;
};

export type TreesView = {
  viewProj: Float32Array;
  /** Vertical exaggeration of the geometry. */
  scale: number;
};

/** What the last draw sent, out of what there is. */
export type TreeStats = { chunks: number; chunksAll: number; trees: number; treesAll: number };

export class TreesPass {
  private made: { generation: number; look: Look; program: Program | null; depth: Program | null; models: Model[] } | null = null;
  private groups: Float32Array[] = [];
  private chunks: TreeChunk[][] = [];
  private dirty = true;
  stats: TreeStats = { chunks: 0, chunksAll: 0, trees: 0, treesAll: 0 };

  /** The trees, packed four to a tree (x, z, height, kind) and grouped by the look's model kinds. */
  setTrees(groups: Float32Array[]) {
    const chunked = groups.map((g) => chunkTrees(g));
    this.groups = chunked.map((c) => c.sorted);
    this.chunks = chunked.map((c) => c.chunks);
    this.dirty = true;
  }

  get count() {
    return this.groups.reduce((n, g) => n + g.length / 4, 0);
  }

  /** The height of the tallest tree, in metres. */
  tallest(): number {
    let t = 0;
    for (const chunks of this.chunks) for (const c of chunks) t = Math.max(t, c.tallest);
    return t;
  }

  private make(g: Gl, look: Look) {
    const { gl } = g;
    this.free(g);
    const buffer = (data: Float32Array) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    };
    const models: Model[] = [];
    for (const kind of look.trees.kinds) {
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
      const canopyVao = gl.createVertexArray()!;
      gl.bindVertexArray(canopyVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instances);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 1);
      models.push({ vao, vertices: mesh.positions.length / 3, instances, count: 0, radius, canopyVao, crown: crownOfMesh(mesh.positions) });
    }
    gl.bindVertexArray(null);
    this.made = {
      generation: g.generation,
      look,
      models,
      program: tryProgram(() => compileProgram(gl, SHADERS.trees.vertex, SHADERS.trees.fragment, "trees")),
      depth: tryProgram(() => compileProgram(gl, SHADERS.shadowDepth.vertex, SHADERS.shadowDepth.fragment, "tree shadows")),
    };
    this.dirty = true;
  }

  /** Build what is missing (the models are rebuilt when the look changes) and upload the trees if they changed. */
  private ready(g: Gl, look: Look) {
    const { gl } = g;
    if (!this.made || this.made.generation !== g.generation || this.made.look !== look) this.make(g, look);
    const made = this.made!;
    if (this.dirty) {
      this.dirty = false;
      made.models.forEach((model, k) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, model.instances);
        const trees = this.groups[k] ?? new Float32Array(0);
        gl.bufferData(gl.ARRAY_BUFFER, trees, gl.DYNAMIC_DRAW);
        model.count = trees.length / 4;
      });
    }
    return made;
  }

  /** Draw each chunk of each model that `cull` says is in view, and count what was sent. */
  private drawChunks(g: Gl, models: Model[], cull: Cull, stats: TreeStats) {
    const { gl } = g;
    models.forEach((model, k) => {
      if (!model.count) return;
      gl.bindVertexArray(model.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, model.instances);
      for (const c of this.chunks[k] ?? []) {
        stats.chunksAll++;
        // a tree reaches `radius` times its height from its trunk, up to 15% more when it is spread
        const r = model.radius * c.tallest * 1.15;
        if (!boxVisible(cull.frustum, c.x0 - r, cull.y0, c.z0 - r, c.x1 + r, cull.y1 + c.tallest, c.z1 + r)) continue;
        stats.chunks++;
        stats.trees += c.count;
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, c.first * 16); // the run of this chunk's trees
        gl.drawArraysInstanced(gl.TRIANGLES, 0, model.vertices, c.count);
      }
    });
    gl.bindVertexArray(null);
  }

  /** Draw onto what the ground pass just drew. */
  draw(g: Gl, world: World, v: TreesView, cull: Cull) {
    const { gl } = g;
    const { program: t, models } = this.ready(g, world.look);
    this.stats = { chunks: 0, chunksAll: 0, trees: 0, treesAll: this.count };
    if (!t) return;
    gl.useProgram(t.program);
    world.height.bind(g, t);
    gl.uniformMatrix4fv(t.u.uViewProj, false, v.viewProj);
    gl.uniform3f(t.u.uSunDir, ...sunDirection(world.sun));
    gl.uniform1f(t.u.uScale, v.scale);
    setLookUniforms(gl, t, world.look);
    world.shadow.bind(g, t);
    this.drawChunks(g, models, cull, this.stats);
  }

  /**
   * Draw the trees depth only, from the sun, into whichever shadow map is bound. `cull` is the map's own view volume. Returns
   * what was sent.
   */
  drawDepth(g: Gl, world: World, lightViewProj: Mat4, scale: number, cull: Cull): TreeStats {
    const { gl } = g;
    const stats: TreeStats = { chunks: 0, chunksAll: 0, trees: 0, treesAll: this.count };
    const { depth, models } = this.ready(g, world.look);
    if (!depth || !this.count) return stats;
    gl.useProgram(depth.program);
    world.height.bind(g, depth);
    gl.uniformMatrix4fv(depth.u.uLightViewProj, false, lightViewProj);
    gl.uniform1f(depth.u.uScale, scale);
    this.drawChunks(g, models, cull, stats);
    return stats;
  }

  /**
   * Draw one quad for every tree, with `p` (a program that reads the trees as its first attribute, and the crown of the kind as
   * uCrown), for what a tree does to the ground around it rather than for how it looks. Nothing is culled.
   */
  drawCanopies(g: Gl, look: Look, p: Program) {
    const { gl } = g;
    const { models } = this.ready(g, look);
    for (const m of models) {
      if (!m.count) continue;
      gl.bindVertexArray(m.canopyVao);
      gl.uniform3f(p.u.uCrown, m.crown.radius, m.crown.bottom, m.crown.top);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, m.count);
    }
    gl.bindVertexArray(null);
  }

  free(g: Gl | null) {
    if (g && this.made?.generation === g.generation) {
      for (const model of this.made.models) {
        g.gl.deleteVertexArray(model.canopyVao);
        g.gl.deleteVertexArray(model.vao);
        g.gl.deleteBuffer(model.instances);
      }
    }
    this.made = null;
  }
}
