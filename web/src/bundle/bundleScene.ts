import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style, Text } from "ol/style";
import type { StyleLike } from "ol/style/Style";
import { api, fileUrl, tifRgbUrl, type Course, type Report } from "../api/api";
import { buildHillshade, decodeHeights, loadBytes, loadImage, loadPixels, memoLast, pixelCanvas, sampleGrid } from "../decode/decode";
import { toMap } from "../map/coords";
import { rasterLayer } from "../map/layers";
import type { ReadoutLine, Scene, SceneLayer } from "../map/scene";
import type { Formatter } from "../units/units";

// docs/golf-course-format.md: class map R = surface, G = owning hole; bounds = one in-bounds bit per hole.
export const CLASS_NAMES = ["rough", "fairway", "green", "collar", "tee", "bunker", "water", "path", "woods"];
export const CLASS_COLORS: [number, number, number][] = [
  [106, 143, 58], [143, 209, 79], [31, 170, 89], [127, 199, 122], [224, 184, 74],
  [241, 227, 160], [59, 130, 196], [154, 154, 154], [47, 90, 42],
];
const UNKNOWN: [number, number, number] = [255, 0, 255];
const TREE_RECORD = 12;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
export const holeColor = (n: number) => hslToRgb((n * 47) % 360, 0.7, 0.55);
export const css = ([r, g, b]: [number, number, number], a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`;

export type BundleData = { path: string; course: Course; report: Report };

type Pixels = { class: ImageData; bounds: ImageData };

/** A bundle on the map, read from its files the way the game will read them. */
export async function loadBundleScene(path: string): Promise<{ scene: Scene; data: BundleData }> {
  let course = await api.course(path);
  const [heightPx, classPx, boundsPx, treeBytes, report, aerial] = await Promise.all([
    loadPixels(fileUrl(path, course.height.file)),
    loadPixels(fileUrl(path, course.class.file)),
    loadPixels(fileUrl(path, course.bounds.file)),
    loadBytes(fileUrl(path, course.trees.file)),
    api.validate(path),
    api.aerial(path),
  ]);
  const px: Pixels = { class: classPx, bounds: boundsPx };
  const data: BundleData = { path, course, report };
  const { cols, rows } = course.height;
  const extent = { x: 0, z: 0, w: cols - 1, h: rows - 1 };
  const grid = decodeHeights(heightPx, course.hMin, course.hMax);

  const layers: SceneLayer[] = [];
  const raster = (id: string, label: string, opts: Parameters<typeof rasterLayer>[0], init: { visible: boolean; opacity: number }, extra?: Partial<SceneLayer>) => {
    const { layer, redraw } = rasterLayer(opts);
    layer.setVisible(init.visible);
    layer.setOpacity(init.opacity);
    const entry: SceneLayer = { id, label, ...init, adjustable: true, olLayer: layer, ...extra };
    layers.push(entry);
    return { redraw, entry };
  };

  if (aerial) {
    const img = await loadImage(tifRgbUrl(aerial.stack));
    raster("aerial", "Aerial", {
      image: () => img, smooth: true,
      rect: { x: aerial.x0, z: aerial.z0, w: aerial.width * aerial.res, h: aerial.height * aerial.res },
    }, { visible: true, opacity: 1 });
  }

  const shade = memoLast((exaggeration: number) => buildHillshade(grid, course.height.res, course.height.res, exaggeration));
  let exaggeration = 3;
  const hillshade = raster("hillshade", "Hillshade", {
    image: () => shade(exaggeration), smooth: true, multiply: !!aerial,
    // samples sit on grid points, so each pixel is centred on its sample
    rect: { x: -0.5, z: -0.5, w: cols, h: rows },
  }, { visible: true, opacity: aerial ? 0.55 : 1 });
  hillshade.entry.onParams = (p) => {
    if (p.exaggeration !== exaggeration) {
      exaggeration = p.exaggeration;
      hillshade.redraw();
    }
  };

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
      extent, layers, readout, refresh,
    },
  };
}
