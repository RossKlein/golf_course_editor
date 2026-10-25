import Feature from "ol/Feature";
import Map from "ol/Map";
import View from "ol/View";
import Point from "ol/geom/Point";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import type Interaction from "ol/interaction/Interaction";
import Snap from "ol/interaction/Snap";
import ImageLayer from "ol/layer/Image";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import Projection from "ol/proj/Projection";
import Static from "ol/source/ImageStatic";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style } from "ol/style";
import type { FeatureLike } from "ol/Feature";
import { buildHillshade, decodeHeights, loadPixels } from "./decode";
import { cleanFreehand, dedupe, selfIntersects } from "./geom";
import { ringsOf, bindStore } from "./sync";
import { addRegion, store, updateRegion } from "./store";
import type Polygon from "ol/geom/Polygon";

export const W = 1405; // course extent in metres (Augusta bundle): x east
export const H = 1760; // z south

// A projection in plain metres with no geographic meaning. Map y is -z.
export const projection = new Projection({ code: "course", units: "m", extent: [-50, -(H + 50), W + 50, 50] });

export const CLASS_COLORS = ["#6a8f3a", "#8fd14f", "#1faa59", "#7fc77a", "#e0b84a", "#f1e3a0", "#3b82c4", "#9a9a9a", "#2f5a2a"];

const regionStyle = (f: FeatureLike) => {
  const color = CLASS_COLORS[(f.get("cls") as number) ?? 0];
  return new Style({ fill: new Fill({ color: color + "66" }), stroke: new Stroke({ color, width: 2 }) });
};

export type Mode = "none" | "draw" | "freehand" | "modify" | "trace";

export async function createMap(target: HTMLElement) {
  const regionSource = new VectorSource<Feature<Polygon>>();
  bindStore(regionSource as unknown as VectorSource);
  const treeSource = new VectorSource();

  const aerialMeta = await (await fetch("/api/bundle/aerial?path=bundles%2Faugusta")).json();
  const aerial = new ImageLayer({
    source: new Static({
      url: `/api/tif/rgb.jpg?path=${encodeURIComponent(aerialMeta.stack)}`,
      projection,
      imageExtent: [aerialMeta.x0, -(aerialMeta.z0 + aerialMeta.height * aerialMeta.res), aerialMeta.x0 + aerialMeta.width * aerialMeta.res, -aerialMeta.z0],
    }),
  });

  // hillshade from the bundle's own height.png, decoded exactly as the main app does
  const course = await (await fetch("/files/bundles/augusta/course.json")).json();
  const heightPx = await loadPixels("/files/bundles/augusta/height.png");
  const grid = decodeHeights(heightPx, course.hMin, course.hMax);
  const shade = buildHillshade(grid, 1, 1, 3);
  const hillshade = new ImageLayer({
    opacity: 0.5,
    source: new Static({
      url: shade.toDataURL(),
      projection,
      imageExtent: [-0.5, -(grid.rows - 0.5), grid.cols - 0.5, 0.5], // samples sit on grid points, so pixels are centred on them
    }),
  });

  const classView = new ImageLayer({ opacity: 0.8, visible: false });
  // nearest-neighbour: the raster is a class map, not a picture
  const setClassView = (url: string) =>
    classView.setSource(new Static({ url, projection, imageExtent: [0, -H, W, 0], interpolate: false }));

  const regions = new VectorLayer({ source: regionSource, style: regionStyle });
  const trees = new WebGLVectorLayer({
    source: treeSource,
    style: { "circle-radius": 2.5, "circle-fill-color": "#1e5e2a" },
  });

  const view = new View({ projection, center: [W / 2, -H / 2], resolution: 2, minResolution: 0.01, maxResolution: 8 });
  const map = new Map({ target, layers: [aerial, hillshade, classView, regions, trees], view, controls: [] });

  // ---- interactions: one active drawing/editing tool at a time, Snap always last ----
  let mode: Mode = "none";
  let active: Interaction[] = [];
  const state = { cls: 2, snap: true };

  const finishDraw = (f: Feature<Polygon>, freehand: boolean) => {
    const { outer, inner } = ringsOf(f);
    const ring = dedupe(freehand ? cleanFreehand(outer, 0.6, 1) : outer);
    if (selfIntersects(ring)) return { ok: false as const, ring };
    return { ok: true as const, rawCount: outer.length, id: addRegion(freehand ? "Draw freehand" : "Draw polygon", { cls: state.cls, outer: ring, inner }) };
  };

  const setMode = (next: Mode) => {
    active.forEach((i) => map.removeInteraction(i));
    active = [];
    mode = next;
    const add = (i: Interaction) => {
      map.addInteraction(i);
      active.push(i);
    };
    if (next === "draw" || next === "freehand" || next === "trace") {
      const draw = new Draw({
        type: "Polygon",
        freehand: next === "freehand",
        trace: next === "trace",
        traceSource: next === "trace" ? (regionSource as unknown as VectorSource) : undefined,
      });
      draw.on("drawend", (e) => {
        const result = finishDraw(e.feature as Feature<Polygon>, next === "freehand");
        (window as unknown as { spike: { lastDraw?: unknown } }).spike.lastDraw = result;
      });
      add(draw);
    } else if (next === "modify") {
      const modify = new Modify({ source: regionSource });
      modify.on("modifyend", (e) => {
        store.getState().begin("Modify");
        e.features.forEach((f) => {
          const { outer, inner } = ringsOf(f as Feature<Polygon>);
          updateRegion("Modify", f.getId() as string, { outer, inner });
        });
        store.getState().end();
      });
      add(modify);
    }
    if (state.snap && next !== "none") {
      add(new Snap({ source: regionSource as unknown as VectorSource, pixelTolerance: 10, vertex: true, edge: true }));
    }
  };

  return { map, view, layers: { aerial, hillshade, classView, regions, trees }, regionSource, treeSource, setMode, getMode: () => mode, state, setClassView };
}

export type SpikeMap = Awaited<ReturnType<typeof createMap>>;
export { Point };
