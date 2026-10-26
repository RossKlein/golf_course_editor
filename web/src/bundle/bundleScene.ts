import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style, Text } from "ol/style";
import type { StyleLike } from "ol/style/Style";
import { api, fileUrl, heightBaseUrl, tifRgbUrl, type Course, type Report } from "../api/api";
import { HeightSession } from "../heights/session";
import { scatterWoods, splitByKind, treesFromBin } from "../terrain/scenery/trees";
import { stripeDirections } from "../terrain/surfaces/stripes";
import { loadCourseFiles } from "../terrain/course/course";
import { sunOfLook } from "../terrain/sun";
import { buildHillshade, decodeHeights, loadImage, loadPixels, memoLast, pixelCanvas, sampleGrid } from "../decode/decode";
import { toMap } from "../map/coords";
import { CLASS_COLORS, css, holeColor } from "./colours";
import { rasterLayer } from "../map/layers";
import { TerrainRenderer, terrainSupported } from "../terrain/terrain";
import { terrainLayer } from "../map/terrainLayer";
import type { ReadoutLine, Scene, SceneLayer, TerrainSource } from "../map/scene";
import type { Formatter } from "../units/units";

// docs/golf-course-format.md: class map R = surface, G = owning hole; bounds = one in-bounds bit per hole.
export const CLASS_NAMES = ["rough", "fairway", "green", "collar", "tee", "bunker", "water", "path", "woods"];
const UNKNOWN: [number, number, number] = [255, 0, 255];
export { CLASS_COLORS, css, holeColor };
const TREE_RECORD = 12;

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
  const { height: heightPx, classes: classPx, bounds: boundsPx, trees: treeBytes } = files;
  const px: Pixels = { class: classPx, bounds: boundsPx };
  const data: BundleData = { path, course, report };
  const { cols, rows } = course.height;
  const extent = { x: 0, z: 0, w: cols - 1, h: rows - 1 };
  const baseGrid = decodeHeights(heightPx, heightBase.hMin, heightBase.hMax);
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
  let setScenery = () => {}; // gives the 3D view the class map, stripes and trees; again after each build
  if (terrainSupported(grid)) {
    // shaded, contoured relief drawn by the GPU for what is on screen; samples sit on grid points
    const renderer = new TerrainRenderer({ grid: baseGrid, origin: { x: 0, z: 0 }, resX: res, resZ: res }, course.look);
    renderer.setAerial(aerialSource?.image ?? null, aerialSource?.rect ?? null);
    let redraw = () => {};
    terrainSource = { renderer, ground: (x, z) => sampleGrid(grid, x / res, z / res), aerial: aerialSource, redraw: () => redraw() };
    const sculptor = renderer.enableSculpt(grid);
    if (sculptor.supported()) {
      terrainSource.sculpt = new HeightSession(path, sculptor, grid, () => redraw());
      await terrainSource.sculpt.load();
    }
    const terrain = terrainLayer({ renderer, style: () => view, multiply: !!aerial });
    redraw = terrain.redraw;
    // the game's look needs the grass texture, the surfaces and the trees
    loadImage("/game/grass.png").then((img) => renderer.setGrassTile(img)).catch(() => renderer.setGrassTile(null));
    terrainSource.treeInfo = { preview: false };
    setScenery = () => {
      renderer.setLook(course.look); // a rebuilt bundle may have a changed look
      renderer.setSurfaces(px.class, course.class.res, stripeDirections(course.holes.map((h) => h.route as [number, number][])));
      const real = treesFromBin(treeBytes);
      const trees = real.length ? real : scatterWoods(px.class, course.class.res, course.look.trees.kinds);
      terrainSource!.treeInfo!.preview = !real.length;
      renderer.setTrees(splitByKind(trees, course.look.trees.kinds.length));
    };
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
  const classCanvas = () => pixelCanvas(px.class.width, px.class.height, (d) => {
    for (let i = 0; i < px.class.width * px.class.height; i++) d.set([...(CLASS_COLORS[px.class.data[i * 4]] ?? UNKNOWN), 255], i * 4);
  });
  const ownerCanvas = () => pixelCanvas(px.class.width, px.class.height, (d) => {
    for (let i = 0; i < px.class.width * px.class.height; i++) {
      const n = px.class.data[i * 4 + 1];
      if (n) d.set([...holeColor(n), 255], i * 4);
    }
  });
  let classImg = classCanvas();
  let ownerImg = ownerCanvas();
  const classLayer = raster("class", "Surface class", { image: () => classImg, smooth: false, rect: classRect() }, { visible: false, opacity: 0.6 });
  const ownerLayer = raster("owner", "Hole ownership", { image: () => ownerImg, smooth: false, rect: classRect() }, { visible: false, opacity: 0.8 });

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
  const loadTrees = (bytes: ArrayBuffer) => {
    trees.clear();
    const dv = new DataView(bytes);
    const list: Feature[] = [];
    for (let o = 0; o + TREE_RECORD <= dv.byteLength; o += TREE_RECORD) list.push(new Feature(new Point([dv.getFloat32(o, true), -dv.getFloat32(o + 4, true)])));
    trees.addFeatures(list);
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
    set("trees", `Trees (${trees.getFeatures().length})`);
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
    lines.push({ text: `${CLASS_NAMES[klass] ?? `class ${klass}?`}${owner ? `, hole ${owner}` : ""}`, color: css(CLASS_COLORS[klass] ?? UNKNOWN) });
    const mask = boundsMask(Math.min(px.bounds.width - 1, Math.floor(x / course.bounds.res)), Math.min(px.bounds.height - 1, Math.floor(z / course.bounds.res)));
    const inBounds = course.holes.filter((h) => (mask >> (h.number - 1)) & 1).map((h) => h.number);
    lines.push({ text: `in bounds for: ${inBounds.length ? inBounds.join(", ") : "no hole"}` });
    const patch = course.patches.findIndex((p) => x >= p.x0 && x <= p.x0 + p.cellsX && z >= p.z0 && z <= p.z0 + p.cellsZ);
    lines.push({ text: patch >= 0 ? `0.25 m patch ${patch}` : "1 m macro grid" });
    return lines;
  };

  /** Re-read what a build changed. The height grid and aerial are not touched by builds yet. */
  const refresh = async () => {
    const [nextCourse, nextClass, nextBounds, nextReport] = await Promise.all([
      api.course(path),
      loadPixels(`${fileUrl(path, course.class.file)}?t=${Date.now()}`),
      loadPixels(`${fileUrl(path, course.bounds.file)}?t=${Date.now()}`),
      api.validate(path),
    ]);
    course = nextCourse;
    data.course = nextCourse;
    data.report = nextReport;
    px.class = nextClass;
    setScenery();
    px.bounds = nextBounds;
    classImg = classCanvas();
    ownerImg = ownerCanvas();
    version += 1;
    fillVectors();
    countLabels();
    classLayer.redraw();
    ownerLayer.redraw();
    boundsLayer.redraw();
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
