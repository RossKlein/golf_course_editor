import { boxVisible, type Frustum } from "../../../gfx/math/frustum";
import { compileProgram, tryProgram, type Program } from "../../../gfx/shader/program";
import type { Gl } from "../../context";
import { TUFT_TILE } from "../../limits";
import { setLookUniforms } from "../../look/look";
import { SHADERS } from "../../shaders/shaders";
import type { Cull, World } from "../../world";

// Tufts of grass in the rough, drawn as billboards on top of the ground. They have no data on the CPU at all: a tuft's place,
// size and whether it exists are worked out in the vertex shader from its number, the class map and the heights, so there
// is nothing to build or update. The patch is drawn in tiles, and a tile that is out of view is never sent.

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

export type TuftView = {
  viewProj: Float32Array;
  eye: [number, number, number];
  /** The ground point at the middle of the patch. */
  target: [number, number];
  /** Vertical exaggeration of the geometry. */
  scale: number;
  /** How far from the target tufts grow, in metres, and how many (1 is the default density). */
  range: number;
  density: number;
  /** Shade the grass from the baked lighting where there is one (false when shadows are off). */
  baked: boolean;
};

/** What the last draw sent, out of what there is: tuft slots, as tiles in view out of all of them. */
export type TuftStats = { tiles: number; tilesAll: number; tufts: number; tuftsAll: number };

export class TuftsPass {
  private made: { generation: number; program: Program | null; quad: WebGLVertexArrayObject } | null = null;
  stats: TuftStats = { tiles: 0, tilesAll: 0, tufts: 0, tuftsAll: 0 };

  private make(g: Gl) {
    const { gl } = g;
    this.made = {
      generation: g.generation,
      quad: gl.createVertexArray()!, // the tufts need no attributes at all
      program: tryProgram(() => compileProgram(gl, SHADERS.tufts.vertex, SHADERS.tufts.fragment, "grass tufts")),
    };
  }

  /** Draw onto what the ground pass just drew. */
  draw(g: Gl, world: World, v: TuftView, cull: Cull) {
    const { gl } = g;
    if (!this.made || this.made.generation !== g.generation) this.make(g);
    const { program: t, quad } = this.made!;
    this.stats = { tiles: 0, tilesAll: 0, tufts: 0, tuftsAll: 0 };
    if (!t) return;

    gl.useProgram(t.program);
    world.height.bind(g, t);
    world.surfaces.bindClasses(g, t);
    gl.uniformMatrix4fv(t.u.uViewProj, false, v.viewProj);
    gl.uniform3f(t.u.uEye, ...v.eye);
    const { cell, across } = tuftGrid(v.range, v.density);
    gl.uniform2f(t.u.uCentre, Math.round(v.target[0] / cell) * cell, Math.round(v.target[1] / cell) * cell);
    gl.uniform1f(t.u.uCell, cell);
    gl.uniform1i(t.u.uN, across);
    gl.uniform1f(t.u.uRadius, v.range);
    gl.uniform1f(t.u.uScale, v.scale);
    setLookUniforms(gl, t, world.look);
    world.shadow.bind(g, t);
    world.lighting.bind(g, t, v.baked);
    gl.bindVertexArray(quad);
    const tiles = tuftTiles(v.target, v.range, v.density, cull.frustum, cull.y0, cull.y1 + 1);
    this.stats = {
      tiles: tiles.length,
      tilesAll: Math.ceil(across / TUFT_TILE) ** 2,
      tufts: tiles.length * TUFT_TILE * TUFT_TILE, // sent to the GPU; those off the rough are dropped there
      tuftsAll: across * across,
    };
    for (const [tx, ty] of tiles) {
      gl.uniform2i(t.u.uTile, tx, ty);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, TUFT_TILE * TUFT_TILE);
    }
    gl.bindVertexArray(null);
  }

  free(g: Gl | null) {
    if (g && this.made?.generation === g.generation) g.gl.deleteVertexArray(this.made.quad);
    this.made = null;
  }
}
