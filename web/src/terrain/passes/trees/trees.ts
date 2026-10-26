import type { Look } from "../../../core/api/api";
import { boxVisible } from "../../../gfx/math/frustum";
import { compileProgram, tryProgram, type Program } from "../../../gfx/shader/program";
import type { Gl } from "../../context";
import { setLookUniforms } from "../../look/look";
import { chunkTrees, type TreeChunk } from "../../scenery/trees";
import { treeMesh, type Mesh } from "../../scenery/treeMesh";
import { SHADERS } from "../../shaders/shaders";
import { sunDirection } from "../../sun";
import type { Cull, World } from "../../world";

// Low-poly trees, instanced from the look's models. The CPU holds only their positions, sorted into chunks of ground so a
// chunk that is out of view is never drawn.

type Model = { vao: WebGLVertexArrayObject; vertices: number; instances: WebGLBuffer; count: number; radius: number };

export type TreesView = {
  viewProj: Float32Array;
  /** Vertical exaggeration of the geometry. */
  scale: number;
};

/** What the last draw sent, out of what there is. */
export type TreeStats = { chunks: number; chunksAll: number; trees: number; treesAll: number };

export class TreesPass {
  private made: { generation: number; look: Look; program: Program | null; models: Model[] } | null = null;
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
      models.push({ vao, vertices: mesh.positions.length / 3, instances, count: 0, radius });
    }
    gl.bindVertexArray(null);
    this.made = {
      generation: g.generation,
      look,
      models,
      program: tryProgram(() => compileProgram(gl, SHADERS.trees.vertex, SHADERS.trees.fragment, "trees")),
    };
    this.dirty = true;
  }

  /** Draw onto what the ground pass just drew. The models are rebuilt when the look changes. */
  draw(g: Gl, world: World, v: TreesView, cull: Cull) {
    const { gl } = g;
    if (!this.made || this.made.generation !== g.generation || this.made.look !== world.look) this.make(g, world.look);
    const { program: t, models } = this.made!;
    if (this.dirty) {
      this.dirty = false;
      models.forEach((model, k) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, model.instances);
        const trees = this.groups[k] ?? new Float32Array(0);
        gl.bufferData(gl.ARRAY_BUFFER, trees, gl.DYNAMIC_DRAW);
        model.count = trees.length / 4;
      });
    }
    this.stats = { chunks: 0, chunksAll: 0, trees: 0, treesAll: this.count };
    if (!t) return;

    gl.useProgram(t.program);
    world.height.bind(g, t);
    gl.uniformMatrix4fv(t.u.uViewProj, false, v.viewProj);
    gl.uniform3f(t.u.uSunDir, ...sunDirection(world.sun));
    gl.uniform1f(t.u.uScale, v.scale);
    setLookUniforms(gl, t, world.look);
    models.forEach((model, k) => {
      if (!model.count) return;
      gl.bindVertexArray(model.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, model.instances);
      for (const c of this.chunks[k] ?? []) {
        this.stats.chunksAll++;
        // a tree reaches `radius` times its height from its trunk, up to 15% more when it is spread
        const r = model.radius * c.tallest * 1.15;
        if (!boxVisible(cull.frustum, c.x0 - r, cull.y0, c.z0 - r, c.x1 + r, cull.y1 + c.tallest, c.z1 + r)) continue;
        this.stats.chunks++;
        this.stats.trees += c.count;
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, c.first * 16); // the run of this chunk's trees
        gl.drawArraysInstanced(gl.TRIANGLES, 0, model.vertices, c.count);
      }
    });
    gl.bindVertexArray(null);
  }

  free(g: Gl | null) {
    if (g && this.made?.generation === g.generation) {
      for (const model of this.made.models) {
        g.gl.deleteVertexArray(model.vao);
        g.gl.deleteBuffer(model.instances);
      }
    }
    this.made = null;
  }
}
