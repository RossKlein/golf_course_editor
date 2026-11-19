import { previewWater } from "../core/api/api";
import { parseWaterMesh } from "../terrain/water/data";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import MultiPoint from "ol/geom/MultiPoint";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style, Text } from "ol/style";
import type { StyleLike } from "ol/style/Style";
import { api, fileUrl, heightBaseUrl, tifRgbUrl, type Course, type Report } from "../core/api/api";
import { HeightSession } from "./heightSession";
import { splitByKind, treesFromBin } from "../terrain/scenery/trees";
import { stripeDirections } from "../terrain/surfaces/stripes";
import { loadCourseFiles } from "../terrain/course/course";
import { buildHillshade } from "../terrain/passes/flat/cpuHillshade";
import { sunOfLook } from "../terrain/sun";
import { decodeHeights, loadBytes, loadImage, loadPixels, memoLast, pixelCanvas, sampleGrid } from "../core/decode/decode";
import { toMap } from "../core/geometry/coords";
import { CLASS_COLORS, css, holeColor, VOID_CLASS } from "../model/theme/colours";
import { markVoid } from "./voidGround";
import { rasterLayer } from "./layers";
import { TerrainRenderer, terrainSupported } from "../terrain/terrain";
import { terrainLayer } from "./terrainLayer";
import type { ReadoutLine, RefreshInfo, Scene, SceneLayer, TerrainSource } from "./scene";
import { touches } from "./buildFiles";
import { paint, paletteOf } from "./palette";
import type { Formatter } from "../core/units/units";

// docs/golf-course-format.md: class map R = surface, G = owning hole; bounds = one in-bounds bit per hole.
export const CLASS_NAMES = ["rough", "fairway", "green", "collar", "tee", "bunker", "water", "path", "woods"];
/** The surfaces a region can be, with the number each has in class.png: the nine classes, then void (no ground). */
export const CLASS_OPTIONS: { cls: number; name: string }[] = [...CLASS_NAMES.map((name, cls) => ({ cls, name })), { cls: VOID_CLASS, name: "void (no ground)" }];
export const classNameOf = (cls: number) => (cls === VOID_CLASS ? "void (no ground)" : CLASS_NAMES[cls] ?? `class ${cls}?`);
const UNKNOWN: [number, number, number] = [255, 0, 255];
export { CLASS_COLORS, css, holeColor };
const TREE_RECORD = 12;

const sameBytes = (a: ArrayBuffer, b: ArrayBuffer) => {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};

export type BundleData = { path: string; course: Course; report: Report };

type Pixels = { class: ImageData; bounds: ImageData };

/** A bundle on the map, read from its files the way the game will read them. */
export async function loadBundleScene(path: string): Promise<{ scene: Scene; data: BundleData }> {
  let course = await api.course(path);
  // sculpting is an offset from the baked heights, so the base is what the GPU holds and the offsets go on top
  const [files, heightBase, report, aerial] = await Promise.all([
    loadCourseFiles(course, (file) => fileUrl(path, file), heightBaseUrl(path)),
    api.heightBase(path),
    api.validate(path),
    api.aerial(path),
  ]);
  let holeRoutes = JSON.stringify(course.holes.map((h) => h.route)); // what the stripes were made from, to tell when they must be again
  const { height: heightPx, classes: classPx, bounds: boundsPx } = files;
  let treeBytes = files.trees; // trees.bin as the last build wrote it (see refresh)
  const px: Pixels = { class: classPx, bounds: boundsPx };
  const data: BundleData = { path, course, report };
  const { cols, rows } = course.height;
  const extent = { x: 0, z: 0, w: cols - 1, h: rows - 1 };
  const baseGrid = decodeHeights(heightPx, heightBase.hMin, heightBase.hMax);
  // where the class map has no ground the height grid has no data, so the terrain is left with a hole in it (the same array is the sculpted copy's)
  markVoid(classPx, course.class.res, course.height.res, baseGrid);
  const grid = { ...baseGrid, values: baseGrid.values.slice() }; // base + sculpting, for readouts

  const layers: SceneLayer[] = [];
  const raster = (id: string, label: string, opts: Parameters<typeof rasterLayer>[0], init: { visible: boolean; opacity: number }, extra?: Partial<SceneLayer>) => {
    const { layer, redraw } = rasterLayer(opts);
    layer.setVisible(init.visible);
    layer.setOpacity(init.opacity);
    const entry: SceneLayer = { id, label, ...init, adjustable: true, olLayer: layer, ...extra };
    layers.push(entry);
    return { redraw, entry };
  };

  let aerialSource: TerrainSource["aerial"] = null;
  if (aerial) {
    const img = await loadImage(tifRgbUrl(aerial.stack));
    const rect = { x: aerial.x0, z: aerial.z0, w: aerial.width * aerial.res, h: aerial.height * aerial.res };
    raster("aerial", "Aerial", { image: () => img, smooth: true, rect }, { visible: true, opacity: 1 });
    aerialSource = { image: img, rect };
  }

  const res = course.height.res;
  let view = { exaggeration: 3, contour: 0, slope: false };
  let terrainSource: TerrainSource | undefined;
  let setScenery = (_treesChanged = true, _surfacesChanged = true) => {}; // gives the 3D view the class map, stripes and trees; again after each build, each only if it changed
  if (terrainSupported(grid)) {
    // shaded, contoured relief drawn by the GPU for what is on screen; samples sit on grid points
    const renderer = new TerrainRenderer({ grid: baseGrid, origin: { x: 0, z: 0 }, resX: res, resZ: res }, course.look);
    renderer.setAerial(aerialSource?.image ?? null, aerialSource?.rect ?? null);
    let redrawMap = () => {};
    const watchers = new Set<() => void>();
    const redraw = () => {
      redrawMap();
      watchers.forEach((w) => w());
    };
    terrainSource = {
      renderer,
      ground: (x, z) => sampleGrid(grid, x / res, z / res),
      aerial: aerialSource,
      redraw,
      watch: (listener) => (watchers.add(listener), () => void watchers.delete(listener)),
    };
    const sculptor = renderer.enableSculpt(grid);
    if (sculptor.supported()) {
      // the class map is read when a basin is begun, not now: it is the one the last build made (px.class, and the course's class res)
      terrainSource.sculpt = new HeightSession(path, sculptor, grid, redraw, () => ({
        classes: { data: px.class.data, width: px.class.width, height: px.class.height, res: course.class.res },
        grid: { cols, rows, res, origin: { x: 0, z: 0 } },
      }));
      await terrainSource.sculpt.load();
    }
    const terrain = terrainLayer({ renderer, style: () => view, multiply: !!aerial });
    redrawMap = terrain.redraw;
    // the game's look needs the grass texture, the surfaces and the trees
    loadImage("/game/grass.png").then((img) => renderer.setGrassTile(img)).catch(() => renderer.setGrassTile(null));
    // the look on screen: the one the editor last applied, not the file's, which a late build must not put back (see lookApplier.ts)
    let live = course.look;
    const placeTrees = () => renderer.setTrees(splitByKind(treesFromBin(treeBytes), live.trees.kinds.length));
    setScenery = (treesChanged = true, surfacesChanged = true) => {
      renderer.setLook(live);
      if (surfacesChanged) renderer.setSurfaces(px.class, course.class.res, stripeDirections(course.holes.map((h) => h.route as [number, number][])));
      if (treesChanged) placeTrees();
    };
    terrainSource.previewTrees = (bytes) => {
      renderer.setTrees(splitByKind(treesFromBin(bytes), live.trees.kinds.length));
      loadTrees(bytes);
      redraw();
    };
    terrainSource.look = () => live;
    terrainSource.applyLook = (look) => {
      live = look;
      const change = renderer.setLook(look);
      if (change.treeLayout) placeTrees(); // the kinds or their heights changed: group (or scatter) the trees again
      redraw();
      return change;
    };
    let waterKey = "";
    terrainSource.previewWater = async (look) => {
      const key = JSON.stringify([look.water, look.grass, course.waterMesh]);
      if (key === waterKey) return;
      const water = parseWaterMesh(await previewWater(path, look));
      renderer.setWater(water);
      waterKey = key;
      redraw();
    };
    await terrainSource.previewWater(live);
    setScenery();
    terrain.layer.setOpacity(aerial ? 0.55 : 1);
    layers.push({ id: "hillshade", label: "Hillshade", visible: true, opacity: aerial ? 0.55 : 1, adjustable: true, olLayer: terrain.layer, dispose: terrain.dispose,
      onParams: (p) => {
        if (p.exaggeration === view.exaggeration && p.contour === view.contour && p.slope === view.slope) return;
        view = { exaggeration: p.exaggeration, contour: p.contour, slope: p.slope };
        terrain.redraw();
      } });
  } else {
    const shade = memoLast((exaggeration: number) => buildHillshade(grid, res, res, exaggeration, sunOfLook(course.look)));
    const hillshade = raster("hillshade", "Hillshade", {
      image: () => shade(view.exaggeration), smooth: true, multiply: !!aerial,
      rect: { x: -0.5, z: -0.5, w: cols, h: rows },
    }, { visible: true, opacity: aerial ? 0.55 : 1 });
    hillshade.entry.onParams = (p) => {
      if (p.exaggeration !== view.exaggeration) {
        view = { ...view, exaggeration: p.exaggeration };
        hillshade.redraw();
      }
    };
  }

  const classRect = () => ({ x: 0, z: 0, w: px.class.width * course.class.res, h: px.class.height * course.class.res });
  // Ten million cells: a lookup in a table for each, with no array made per pixel, and only when the layer is first drawn and after the
  // class map changes (both layers start hidden, so most of the time this is never run).
  const classPalette = paletteOf((k) => CLASS_COLORS[k] ?? UNKNOWN);
  const ownerPalette = paletteOf((n) => (n ? holeColor(n) : null));
  const classCanvas = () => pixelCanvas(px.class.width, px.class.height, (d) => paint(d, px.class.data, 0, classPalette));
  const ownerCanvas = () => pixelCanvas(px.class.width, px.class.height, (d) => paint(d, px.class.data, 1, ownerPalette));
  let classImg: HTMLCanvasElement | null = null;
  let ownerImg: HTMLCanvasElement | null = null;
  const classLayer = raster("class", "Surface class", { image: () => (classImg ??= classCanvas()), smooth: false, rect: classRect() }, { visible: false, opacity: 0.6 });
  const ownerLayer = raster("owner", "Hole ownership", { image: () => (ownerImg ??= ownerCanvas()), smooth: false, rect: classRect() }, { visible: false, opacity: 0.8 });

  const boundsMask = (c: number, r: number) => {
    const i = (r * px.bounds.width + c) * 4;
    return px.bounds.data[i] | (px.bounds.data[i + 1] << 8) | (px.bounds.data[i + 2] << 16);
  };
  const outOfBounds = memoLast(({ hole, version }: { hole: number; version: number }) => {
    void version;
    return pixelCanvas(px.bounds.width, px.bounds.height, (d) => {
      for (let r = 0; r < px.bounds.height; r++)
        for (let c = 0; c < px.bounds.width; c++)
          if (!((boundsMask(c, r) >> (hole - 1)) & 1)) d.set([220, 40, 40, 255], (r * px.bounds.width + c) * 4);
    });
  });
  let hole = 1, version = 0;
  const boundsRect = () => ({ x: 0, z: 0, w: px.bounds.width * course.bounds.res, h: px.bounds.height * course.bounds.res });
  const boundsLayer = raster("bounds", "Out of bounds (selected hole)", {
    image: () => (course.holes.length ? outOfBounds({ hole, version }) : null), smooth: false, rect: boundsRect(),
  }, { visible: false, opacity: 0.55 });
  boundsLayer.entry.onParams = (p) => {
    if (p.hole !== hole) {
      hole = p.hole;
      boundsLayer.redraw();
    }
  };

  // vector overlays
  const patchSource = new VectorSource();
  const routeSource = new VectorSource();
  const landmarkSource = new VectorSource();
  const fillVectors = () => {
    patchSource.clear();
    routeSource.clear();
    landmarkSource.clear();
    for (const p of course.patches) {
      patchSource.addFeature(new Feature(new Polygon([[[p.x0, p.z0], [p.x0 + p.cellsX, p.z0], [p.x0 + p.cellsX, p.z0 + p.cellsZ], [p.x0, p.z0 + p.cellsZ], [p.x0, p.z0]].map((q) => toMap(q as [number, number]))])));
    }
    for (const h of course.holes) {
      const f = new Feature(new LineString(h.route.map((q) => toMap(q as [number, number]))));
      f.set("hole", h.number);
      routeSource.addFeature(f);
    }
    for (const m of course.landmarks) {
      const f = new Feature(new Point(toMap([m.x, m.z])));
      f.set("name", m.name);
      landmarkSource.addFeature(f);
    }
  };
  fillVectors();
  const vector = (id: string, label: string, source: VectorSource, style: StyleLike) => {
    const layer = new VectorLayer({ source, style });
    layers.push({ id, label, visible: true, opacity: 1, adjustable: false, olLayer: layer });
    return layer;
  };
  vector("patches", `Patches`, patchSource, new Style({ stroke: new Stroke({ color: "#ffd24a", width: 1.5 }) }));
  const trees = new VectorSource();
  const treeLayer = new WebGLVectorLayer({ source: trees, style: { "circle-radius": 2.5, "circle-fill-color": "#1e5e2a" } });
  layers.push({ id: "trees", label: "Trees", visible: true, opacity: 1, adjustable: false, olLayer: treeLayer });
  // all the trees are ONE feature with a MultiPoint, not a feature each: ten thousand features cost more to make than the whole preview of a slider
  let treeTotal = 0;
  const loadTrees = (bytes: ArrayBuffer) => {
    trees.clear();
    treeTotal = Math.floor(bytes.byteLength / TREE_RECORD);
    if (!treeTotal) return;
    const dv = new DataView(bytes);
    const flat: number[] = new Array(treeTotal * 2);
    for (let i = 0; i < treeTotal; i++) {
      flat[i * 2] = dv.getFloat32(i * TREE_RECORD, true);
      flat[i * 2 + 1] = -dv.getFloat32(i * TREE_RECORD + 4, true);
    }
    trees.addFeature(new Feature(new MultiPoint(flat, "XY")));
  };
  loadTrees(treeBytes);
  vector("routes", "Hole routes", routeSource, (f) => {
    const n = f.get("hole") as number;
    const c = css(holeColor(n));
    const coords = (f.getGeometry() as LineString).getCoordinates();
    return [
      new Style({ stroke: new Stroke({ color: c, width: 2 }) }),
      new Style({ geometry: new Point(coords[coords.length - 1]), text: new Text({ text: String(n), offsetX: 9, offsetY: -9, font: "13px system-ui", fill: new Fill({ color: "#fff" }), stroke: new Stroke({ color: "#000", width: 3 }) }) }),
    ];
  });
  vector("landmarks", "Landmarks", landmarkSource, (f) => new Style({
    text: new Text({ text: `◆ ${f.get("name")}`, font: "12px system-ui", fill: new Fill({ color: "#ff6ad5" }), stroke: new Stroke({ color: "#000", width: 3 }), textAlign: "left" }),
  }));

  const countLabels = () => {
    const set = (id: string, label: string) => { const l = layers.find((x) => x.id === id); if (l) l.label = label; };
    set("patches", `Patches (${course.patches.length})`);
    set("trees", `Trees (${treeTotal})`);
    set("routes", `Hole routes (${course.holes.length})`);
    set("landmarks", `Landmarks (${course.landmarks.length})`);
  };
  countLabels();

  const readout = (x: number, z: number, f: Formatter): ReadoutLine[] => {
    const lines: ReadoutLine[] = [{ text: `x ${f.distance(x)}   z ${f.distance(z)}` }];
    if (x < 0 || z < 0 || x > extent.w || z > extent.h) return [...lines, { text: "outside the course grid" }];
    const height = sampleGrid(grid, x / course.height.res, z / course.height.res);
    lines.push({ text: `height ${height === null ? "?" : f.height(height)}` });
    const c = Math.min(px.class.width - 1, Math.floor(x / course.class.res));
    const r = Math.min(px.class.height - 1, Math.floor(z / course.class.res));
    const klass = px.class.data[(r * px.class.width + c) * 4];
    const owner = px.class.data[(r * px.class.width + c) * 4 + 1];
    lines.push({ text: `${classNameOf(klass)}${owner ? `, hole ${owner}` : ""}`, color: css(CLASS_COLORS[klass] ?? UNKNOWN) });
    const mask = boundsMask(Math.min(px.bounds.width - 1, Math.floor(x / course.bounds.res)), Math.min(px.bounds.height - 1, Math.floor(z / course.bounds.res)));
    const inBounds = course.holes.filter((h) => (mask >> (h.number - 1)) & 1).map((h) => h.number);
    lines.push({ text: `in bounds for: ${inBounds.length ? inBounds.join(", ") : "no hole"}` });
    const patch = course.patches.findIndex((p) => x >= p.x0 && x <= p.x0 + p.cellsX && z >= p.z0 && z <= p.z0 + p.cellsZ);
    lines.push({ text: patch >= 0 ? `0.25 m patch ${patch}` : "1 m macro grid" });
    return lines;
  };

  /**
   * Re-read what a build changed. The height grid and aerial are not touched by builds yet. `build` says which files changed, and
   * only those are fetched, decoded and shown again: a tree edit leaves the class and bounds maps alone, and reloading them was
   * most of the editor's stutter. Without it, everything is read again.
   */
  const refresh = async (build: RefreshInfo = { changed: "all" }) => {
    const { changed } = build;
    const classChanged = touches(changed, course.class.file), boundsChanged = touches(changed, course.bounds.file);
    const treesFile = touches(changed, course.trees.file), courseChanged = touches(changed, "course.json");
    const stamp = `?t=${Date.now()}`;
    const [nextCourse, nextClass, nextBounds, nextReport, nextTrees] = await Promise.all([
      courseChanged ? api.course(path) : course,
      classChanged ? loadPixels(`${fileUrl(path, course.class.file)}${stamp}`) : px.class,
      boundsChanged ? loadPixels(`${fileUrl(path, course.bounds.file)}${stamp}`) : px.bounds,
      build.report ?? (changed === "all" ? api.validate(path) : data.report),
      treesFile ? loadBytes(`${fileUrl(path, course.trees.file)}${stamp}`) : treeBytes,
    ]);
    const treesChanged = treesFile && !sameBytes(treeBytes, nextTrees); // placing trees re-bakes the lighting: only when they changed
    const routes = JSON.stringify(nextCourse.holes.map((h) => h.route));
    const surfacesChanged = classChanged || routes !== holeRoutes; // the class map or the stripes' directions
    holeRoutes = routes;
    treeBytes = nextTrees;
    course = nextCourse;
    data.course = nextCourse;
    data.report = nextReport;
    px.class = nextClass;
    px.bounds = nextBounds;
    if (classChanged && markVoid(nextClass, course.class.res, course.height.res, baseGrid)) {
      terrainSource?.renderer.refreshGround(); // a void came or went: the terrain's holes are where the new class map says
      terrainSource?.redraw();
    }
    setScenery(treesChanged, surfacesChanged);
    if (courseChanged || classChanged) await terrainSource?.previewWater?.(terrainSource.look?.() ?? course.look);
    if (classChanged) {
      classImg = ownerImg = null; // made again, when a layer next draws them
      classLayer.redraw();
      ownerLayer.redraw();
    }
    if (boundsChanged || courseChanged) {
      version += 1;
      boundsLayer.redraw();
    }
    if (courseChanged) {
      fillVectors();
      if (treesChanged) loadTrees(treeBytes);
      countLabels();
    } else if (treesChanged) {
      loadTrees(treeBytes);
      countLabels();
    }
  };

  return {
    data,
    scene: {
      key: `bundle:${path}`,
      kind: "bundle",
      title: course.name,
      subtitle: (f) => `${path} · ${f.distance(extent.w, 0)} x ${f.distance(extent.h, 0)}, ${course.holes.length} holes`,
      extent, layers, readout, refresh, terrain: terrainSource,
    },
  };
}
