import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import type Map from "ol/Map";
import { Stroke, Style } from "ol/style";
import { fromMap, toMap, type Pt } from "../../core/geometry/coords";
import { pathStep, smoothLine } from "../../core/geometry/pathShape";
import { snapToRings } from "../../core/geometry/geometry";
import { addPath } from "../../model/design/path";
import { CLASS_COLORS } from "../../model/theme/colours";
import { FreehandInteraction } from "../_shared/freehand";
import type { PolygonControls } from "../_shared/polygonTools";

const PX = 10; // how close, in screen pixels, a stroke's end snaps to an outline
const PATH = 7;

type Options = {
  map: Map;
  snap: boolean;
  /** Rings a stroke's ends may snap to. */
  snapRings: () => Pt[][];
  /** The width, in metres, read as the path is drawn and when it is finished. */
  width: () => number;
  /** The Simplify setting, in screen pixels: how much hand wobble is smoothed away. */
  smoothing: () => number;
  say: (text: string) => void;
};

/** Hand wobble below this many screen pixels is always smoothed away: a path is meant to be smooth. */
export const MIN_PATH_SMOOTHING_PX = 1;

/**
 * The Course editor's Path tool: draw the line a path follows (click points, drag freehand, or both) and Enter turns it into a Path surface
 * of the chosen width. While it is drawn the final width and curve are shown under the line, so what you see is what you get.
 */
export function installPathTool({ map, snap, snapRings, width, smoothing, say }: Options): { controls: PolygonControls; redraw: () => void; dispose: () => void } {
  const resolution = () => map.getView().getResolution() ?? 1;
  const tolerance = () => Math.max(smoothing(), MIN_PATH_SMOOTHING_PX) * resolution();

  const source = new VectorSource<Feature<LineString>>();
  const [r, g, b] = CLASS_COLORS[PATH];
  const layer = new VectorLayer({
    source,
    zIndex: 190, // under the stroke the freehand interaction draws
    updateWhileInteracting: true,
    style: (_f, res) => new Style({ stroke: new Stroke({ color: `rgba(${r}, ${g}, ${b}, 0.6)`, width: Math.max(2, width() / res), lineCap: "round", lineJoin: "round" }) }),
  });
  map.addLayer(layer);

  let freehand: FreehandInteraction;
  const redraw = () => {
    source.clear();
    const pts = freehand.points.map((q) => fromMap(q));
    if (pts.length < 2) return;
    const line = smoothLine(pts, tolerance(), pathStep(width()));
    source.addFeature(new Feature(new LineString(line.map(toMap))));
  };

  const snapPoint = (c: [number, number]): [number, number] => (snap ? toMap(snapToRings(fromMap(c), snapRings(), PX * resolution())) : c);
  freehand = new FreehandInteraction({ snap: snapPoint, onChange: redraw, onDraw: redraw, open: true });
  map.addInteraction(freehand);

  const controls: PolygonControls = {
    drawing: () => freehand.isDrawing,
    finish: () => {
      const pts = freehand.finish();
      if (!pts) return;
      const ids = addPath("Draw path", pts.map((q) => fromMap(q)), width(), tolerance());
      say(ids.length ? "Path added. Ctrl+Z undoes it." : "A path needs at least two points: click or drag along where it goes.");
    },
    cancel: () => freehand.cancel(),
    back: () => freehand.undoStroke(),
  };

  return {
    controls,
    redraw,
    dispose: () => {
      map.removeInteraction(freehand);
      map.removeLayer(layer);
    },
  };
}
