import { boxVisible, frustumOf, type Frustum } from "../../view3d/frustum";
import { chunkTrees, treeMesh, TREE_KINDS, type Mesh, type TreeChunk } from "../../view3d/scenery";
import { compileProgram, tryProgram, type Gl, type Program } from "./gl";
import { HEAD, HEIGHT } from "./shaders";

// The standing things on the ground, drawn on top of the terrain: tufts of grass in the rough and low-poly trees.
// Neither has any data on the CPU beyond the trees' positions. A tuft's place, size and whether it exists at all are worked
// out in the vertex shader from its number, the class map and the heights, so there is nothing to build or update.

const HEIGHT_UNIFORMS = ["uHeight", "uDelta", "uHasDelta", "uGrid", "uOrigin", "uRes"];

/** Tufts are drawn in square tiles of this many across, so a tile that is out of view is never sent to the GPU. */
export const TUFT_TILE = 32;

const TUFT_VERTEX =
  HEAD +
  HEIGHT +
  `
const int TILE = ${TUFT_TILE};
uniform sampler2D uClassMap;
uniform vec3 uClassInfo;
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform ivec2 uTile;      // the first tuft of the tile being drawn, in tufts from the patch's corner
uniform vec2 uCentre;     // the middle of the patch of tufts, a whole number of cells so tufts stay put as the camera moves
uniform float uCell;      // metres between tufts
uniform int uN;           // tufts across the patch
uniform float uRadius;    // metres from the centre where tufts have shrunk to nothing
uniform float uTall;      // typical tuft height
uniform float uScale;     // vertical exaggeration

out vec2 vUv;
out float vSeed;

const vec2 CORNER[6] = vec2[6](vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0));

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void hide() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the picture
  vUv = vec2(0.0);
  vSeed = 0.0;
}

void main() {
  ivec2 cell = uTile + ivec2(gl_InstanceID % TILE, gl_InstanceID / TILE);
  if (cell.x >= uN || cell.y >= uN) { hide(); return; } // the last tiles overhang the patch
  vec2 idx = floor(uCentre / uCell + 0.5) + vec2(cell) - float(uN) * 0.5;
  vec2 pos = (idx + vec2(hash(idx), hash(idx + 17.3))) * uCell;

  ivec2 cc = ivec2(floor(pos / uClassInfo.x));
  cc = clamp(cc, ivec2(0), ivec2(int(uClassInfo.y), int(uClassInfo.z)) - 1);
  float cls = texelFetch(uClassMap, cc, 0).r * 255.0;
  vec2 ground = heightAt(pos);
  float dist = distance(pos, uCentre);
  bool grows = (cls < 0.5 || (cls > 7.5 && cls < 8.5)) && ground.y > 0.5 && dist < uRadius;
  if (!grows) { hide(); return; }

  float seed = hash(idx + 3.1);
  float fade = 1.0 - smoothstep(0.6 * uRadius, uRadius, dist);
  float h = uTall * (0.6 + 0.8 * seed) * fade * (cls > 7.5 ? 0.7 : 1.0);
  vec3 base = vec3(pos.x, ground.x * uScale, pos.y);
  vec3 toEye = uEye - base;
  vec2 side = normalize(vec2(-toEye.z, toEye.x)); // across the line of sight, so the tuft always faces the camera
  vec2 corner = CORNER[gl_VertexID];
  vec3 world = base + vec3(side.x, 0.0, side.y) * (corner.x - 0.5) * h * 1.1 + vec3(0.0, corner.y * h, 0.0);
  gl_Position = uViewProj * vec4(world, 1.0);
  vUv = corner;
  vSeed = seed;
}`;

const TUFT_FRAGMENT =
  HEAD +
  `
in vec2 vUv;
in float vSeed;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // four blades, each a narrow triangle that leans a little and has its own height
  float shade = -1.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float centre = 0.2 + 0.2 * fi + (hash(vec2(fi, vSeed * 9.0)) - 0.5) * 0.14;
    float lean = (hash(vec2(fi + 7.0, vSeed * 9.0)) - 0.5) * 0.5;
    float top = 0.55 + 0.45 * hash(vec2(fi + 3.0, vSeed * 5.0));
    float x = vUv.x - (centre + lean * vUv.y * vUv.y);
    if (vUv.y < top && abs(x) < 0.085 * (1.0 - vUv.y / top)) shade = vUv.y / top;
  }
  if (shade < 0.0) discard;
  vec3 root = vec3(0.16, 0.31, 0.10);
  vec3 tip = vec3(0.46, 0.66, 0.24);
  outColor = vec4(mix(root, tip, shade) * (0.85 + 0.3 * vSeed), 1.0);
}`;

const TREE_VERTEX =
  HEAD +
  HEIGHT +
  `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec4 aTree;   // per tree: x, z, height in metres, kind

uniform mat4 uViewProj;
uniform vec3 uSunDir;
uniform float uScale;

out vec3 vColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  float turn = hash(aTree.xy) * 6.2831853;
  mat2 spin = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
  float spread = 0.85 + 0.3 * hash(aTree.yx);
  float h = aTree.z;
  vec2 xz = spin * aPosition.xz * h * spread;
  vec2 turned = spin * aNormal.xz;
  vec3 n = vec3(turned.x, aNormal.y, turned.y);
  float ground = heightAt(aTree.xy).x * uScale;
  vec3 world = vec3(aTree.x + xz.x, ground + aPosition.y * h, aTree.y + xz.y);
  float lit = 0.5 + 0.65 * max(dot(normalize(n), uSunDir), 0.0);
  vColor = aColor * lit * (0.78 + 0.22 * aPosition.y);
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

const TREE_FRAGMENT =
  HEAD +
  `
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }`;

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
  private groups: Float32Array[] = Array.from({ length: TREE_KINDS }, () => new Float32Array(0));
  private chunks: TreeChunk[][] = Array.from({ length: TREE_KINDS }, () => []);
  private dirty = true;
  /** What the last draw sent, out of what there is: for checking that culling works. */
  stats = { tuftTiles: 0, tuftTilesAll: 0, treeChunks: 0, treeChunksAll: 0, tufts: 0, tuftsAll: 0, trees: 0, treesAll: 0 };

  /** The trees, packed four to a tree (x, z, height, kind) and grouped by model kind. */
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
    for (let kind = 0; kind < TREE_KINDS; kind++) {
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
      tufts: tryProgram(() => compileProgram(gl, TUFT_VERTEX, TUFT_FRAGMENT, [...HEIGHT_UNIFORMS, "uClassMap", "uClassInfo", "uViewProj", "uEye", "uTile", "uCentre", "uCell", "uN", "uRadius", "uTall", "uScale"], "grass tufts")),
      trees: tryProgram(() => compileProgram(gl, TREE_VERTEX, TREE_FRAGMENT, [...HEIGHT_UNIFORMS, "uViewProj", "uSunDir", "uScale"], "trees")),
    };
    this.dirty = true;
  }

  /**
   * Draw both onto what the terrain pass just drew. `bindHeight` binds the heights for a program; `bindClasses` binds the
   * class map and says where.
   */
  draw(g: Gl, p: SceneryParams, bindHeight: (p: Program) => void, bindClasses: (p: Program) => void) {
    const { gl } = g;
    if (!this.made || this.made.generation !== g.generation) this.make(g);
    const m = this.made!;
    if (this.dirty) {
      this.dirty = false;
      m.models.forEach((model, k) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, model.instances);
        gl.bufferData(gl.ARRAY_BUFFER, this.groups[k], gl.DYNAMIC_DRAW);
        model.count = this.groups[k].length / 4;
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
      this.stats.treeChunks = this.stats.treeChunksAll = this.stats.trees = 0;
      this.stats.treesAll = this.treeCount;
      m.models.forEach((model, k) => {
        if (!model.count) return;
        gl.bindVertexArray(model.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, model.instances);
        for (const c of this.chunks[k]) {
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
      gl.uniform1f(t.u.uTall, 0.4);
      gl.uniform1f(t.u.uScale, p.scale);
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
