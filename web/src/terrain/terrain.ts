import type { Look } from "../core/api/api";
import type { HeightGrid } from "../core/decode/decode";
import { resizeCanvas } from "../gfx/device/device";
import type { Image } from "../gfx/resource/image";
import { frustumOf } from "../gfx/math/frustum";
import type { Rect } from "../core/geometry/coords";
import { context, currentContext } from "./context";
import { HeightField, type TerrainGrid } from "./heightfield/heightfield";
import { Overlays } from "./passes/drape/overlays";
import { drawFlat, type TerrainStyle } from "./passes/flat/flat";
import { drawGround, type GroundView } from "./passes/ground/ground";
import { ShadowPass, type ShadowQuality } from "./passes/shadow/shadow";
import { TreesPass } from "./passes/trees/trees";
import { TuftsPass } from "./passes/tufts/tufts";
import type { Sculptor } from "./sculpt/sculptor";
import { sunOfLook } from "./sun";
import { Surfaces } from "./surfaces/surfaces";
import { DEFAULT_THEME, type TerrainTheme } from "./theme";
import type { Cull, World } from "./world";

export type { TerrainGrid };

/** How to draw the 3D view: the ground, and the standing things drawn on it. */
export type View3d = GroundView & {
  tufts: boolean;
  tuftDensity: number;
  trees: boolean;
  /** The camera, for the things that face it and for fitting the shadow maps to what it sees. */
  eye: [number, number, number];
  /** How good the sun's shadows are: off, low, or high. */
  shadows: ShadowQuality;
};

/** Whether terrain can be drawn on the GPU here. Callers fall back to the CPU hillshade when it cannot. */
export function terrainSupported(grid?: HeightGrid): boolean {
  try {
    const { gl } = context();
    return !grid || Math.max(grid.cols, grid.rows) <= gl.getParameter(gl.MAX_TEXTURE_SIZE);
  } catch (e) {
    console.error("GPU terrain is unavailable, using the CPU hillshade:", e);
    return false;
  }
}

/**
 * A height grid on the GPU and what it takes to draw it, flat for the map or as a 3D landscape. Many renderers share one
 * context; each owns its textures, which are uploaded when first used and again after `dispose` or a lost context, so a
 * renderer is never left unusable. This assembles the pieces (the height field, the surfaces, the overlays and the passes
 * that draw them) and is the one thing the rest of the app talks to.
 */
export class TerrainRenderer {
  private readonly world: World;
  private readonly tufts = new TuftsPass();
  private readonly trees = new TreesPass();
  private readonly shadows = new ShadowPass();

  /** `data.grid` is the baked terrain, which the GPU adds the sculpting to. `look` is the course's look; `theme` is the editor's. */
  constructor(data: TerrainGrid, look: Look, theme: TerrainTheme = DEFAULT_THEME) {
    this.world = { height: new HeightField(data), surfaces: new Surfaces(), overlays: new Overlays(), look, sun: sunOfLook(look), theme, shadow: { bind: () => {} } };
    this.setLook(look);
  }

  /** Use a new look (the course was rebuilt, or its look edited): the sun, sky, surfaces, tufts and trees all follow it. */
  setLook(look: Look) {
    this.world.look = look;
    this.world.sun = sunOfLook(look);
    if (look.relief) this.world.height.relief.setSmoothing(look.relief.smoothing); // missing when the server that sent the look is older than this page
  }

  setTheme(theme: TerrainTheme) {
    this.world.theme = theme;
  }

  /** Make the terrain editable. `effective` is the CPU copy of base + sculpting that the sculptor keeps up to date. */
  enableSculpt(effective: HeightGrid): Sculptor {
    return this.world.height.enableSculpt(effective);
  }

  /**
   * The surfaces for the game's look: the class map (R = class, G = hole), the metres a cell covers, and the direction
   * across the mowing stripes of each hole (see stripeDirections).
   */
  setSurfaces(image: ImageData | null, res: number, stripes: Float32Array) {
    this.world.surfaces.set(image, res, stripes);
  }

  /** The seamless grass the ground is textured with. */
  setGrassTile(image: Image | null) {
    this.world.surfaces.setGrassTile(image);
  }

  /** Trees to draw, packed four to a tree (x, z, height, kind) and grouped by the look's model kinds. */
  setTrees(groups: Float32Array[]) {
    this.trees.setTrees(groups);
  }

  /** The imagery draped over the 3D view, covering `rect` (course metres, top-left corner and size). */
  setAerial(image: Image | null, rect: Rect | null) {
    this.world.overlays.setAerial(image, rect);
  }

  /**
   * What the design draws over the ground in 3D: surfaces and outlines, as two canvases covering `rect`. Pass the same
   * canvases again after painting them to upload the change.
   */
  setDrape(fill: Image | null, lines: Image | null, rect: Rect | null) {
    this.world.overlays.setDrape(fill, lines, rect);
  }

  /** Whether the game's look has what it needs. */
  get hasSurfaces() {
    return this.world.surfaces.has;
  }

  get treeCount() {
    return this.trees.count;
  }

  /** What the last 3D draw sent to the GPU out of what there is: tuft slots and trees. */
  get sceneryStats() {
    const t = this.tufts.stats, r = this.trees.stats;
    const s = this.shadows.stats;
    return { tufts: t.tufts, tuftsAll: t.tuftsAll, tuftTiles: t.tiles, tuftTilesAll: t.tilesAll, trees: r.trees, treesAll: r.treesAll, treeChunks: r.chunks, treeChunksAll: r.chunksAll, shadowSlices: s.slices, shadowTrees: s.trees };
  }

  /**
   * Draw the part of the course in `extent` (map coordinates: minX, minY, maxX, maxY) into a canvas `size` pixels
   * across. The returned canvas is the shared one, so use it before the next render.
   */
  render(extent: number[], size: number[], style: TerrainStyle): HTMLCanvasElement {
    return drawFlat(context(), this.world, extent, size, style);
  }

  /** Draw the terrain as a 3D landscape into the shared canvas, `size` pixels across. Use the canvas before the next render. */
  render3d(size: number[], v: View3d): HTMLCanvasElement {
    const g = context();
    const { gl, canvas } = g;
    this.world.height.prepare(g); // the baked relief, first: it uses its own framebuffer and viewport
    const [low, high] = this.world.height.groundRange();
    const cull: Cull = { frustum: frustumOf(v.viewProj), y0: low * v.scale - 1, y1: high * v.scale + 1 };
    // the sun's shadow maps first, into their own framebuffer; the passes below read them
    this.world.shadow = this.shadows.render(g, this.world, v.trees ? this.trees : null, { viewProj: v.viewProj, eye: v.eye, scale: v.scale, quality: v.shadows }, cull);

    resizeCanvas(g, size);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(...this.world.look.sky, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawGround(g, this.world, v);

    if (v.trees) this.trees.draw(g, this.world, { viewProj: v.viewProj, scale: v.scale }, cull);
    else this.trees.stats = { chunks: 0, chunksAll: 0, trees: 0, treesAll: this.trees.count };
    if (v.tufts && this.world.surfaces.has) this.tufts.draw(g, this.world, { viewProj: v.viewProj, eye: v.eye, target: v.target, scale: v.scale, range: v.tuftRange, density: v.tuftDensity }, cull);
    else this.tufts.stats = { tiles: 0, tilesAll: 0, tufts: 0, tuftsAll: 0 };
    return canvas;
  }

  /** Free the textures. The renderer still works afterwards; it uploads again on the next render. */
  dispose() {
    const g = currentContext();
    this.world.height.dispose();
    this.world.surfaces.dispose();
    this.world.overlays.dispose();
    this.tufts.free(g);
    this.trees.free(g);
    this.shadows.free(g);
  }
}
