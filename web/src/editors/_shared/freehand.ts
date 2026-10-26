import Feature from "ol/Feature";
import type Map from "ol/Map";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import PointerInteraction from "ol/interaction/Pointer";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";

type Coord = [number, number];

/** Pointer samples closer together than this many screen pixels are dropped while drawing. */
const MIN_SPACING_PX = 1;

/**
 * Freehand drawing in as many strokes as you like. Press and drag to draw, lift to pause, press and drag again to
 * continue (the gap is joined by a straight line); a click without a drag adds a single point. The outline is not
 * created until you finish it. Only the primary button draws, so middle and right drag (and space+drag) still pan.
 *
 * `snap` is applied to where each stroke starts and ends, so a new border can meet an existing one exactly, but not
 * to points in the middle of a stroke, which would make a hand-drawn line jump between neighbours.
 */
export class FreehandInteraction extends PointerInteraction {
  private strokes: Coord[][] = [];
  private current: Coord[] | null = null;
  private cursor: Coord | null = null;
  private readonly source = new VectorSource();
  private readonly sketch = new VectorLayer({ source: this.source, style: sketchStyle, zIndex: 200, updateWhileInteracting: true });

  constructor(private readonly options: { snap: (c: Coord) => Coord; onChange: () => void }) {
    super();
  }

  override setMap(map: Map | null) {
    super.setMap(map);
    this.sketch.setMap(map); // an unmanaged overlay: it is removed when the interaction is
    if (!map) this.reset();
  }

  /** Something has been drawn and not yet finished or cancelled. */
  get isDrawing() {
    return this.strokes.length > 0 || this.current !== null;
  }

  /** Every point so far, strokes in order, in map coordinates. */
  get points(): Coord[] {
    return [...this.strokes.flat(), ...(this.current ?? [])];
  }

  /** The finished outline's points, clearing the sketch. Null when there is nothing to finish. */
  finish(): Coord[] | null {
    if (!this.isDrawing) return null;
    const pts = this.points;
    this.reset();
    return pts;
  }

  cancel() {
    this.reset();
  }

  /** Forget the most recent stroke, so a slip does not cost the whole outline. */
  undoStroke() {
    this.current = null;
    this.strokes.pop();
    this.render();
    this.options.onChange();
  }

  private reset() {
    this.strokes = [];
    this.current = null;
    this.render();
    this.options.onChange();
  }

  private primary(e: MapBrowserEvent<PointerEvent>) {
    const map = this.getMap();
    return e.originalEvent.button === 0 && !(map && map.get("spacePan"));
  }

  override handleDownEvent(e: MapBrowserEvent<PointerEvent>): boolean {
    if (!this.primary(e)) return false; // not ours: let the map pan
    this.current = [this.options.snap(e.coordinate as Coord)];
    this.render();
    this.options.onChange();
    return true;
  }

  override handleDragEvent(e: MapBrowserEvent<PointerEvent>) {
    const cur = this.current;
    if (!cur) return;
    const res = this.getMap()?.getView().getResolution() ?? 1;
    const last = cur[cur.length - 1];
    if (Math.hypot(e.coordinate[0] - last[0], e.coordinate[1] - last[1]) >= MIN_SPACING_PX * res) {
      cur.push(e.coordinate as Coord);
      this.cursor = e.coordinate as Coord;
      this.render();
    }
  }

  override handleUpEvent(e: MapBrowserEvent<PointerEvent>): boolean {
    const cur = this.current;
    if (!cur) return false;
    if (cur.length > 1) {
      const end = this.options.snap(e.coordinate as Coord);
      if (end[0] !== cur[cur.length - 1][0] || end[1] !== cur[cur.length - 1][1]) cur.push(end);
    }
    this.strokes.push(cur);
    this.current = null;
    this.render();
    this.options.onChange();
    return false;
  }

  override handleMoveEvent(e: MapBrowserEvent<PointerEvent>) {
    this.cursor = e.coordinate as Coord;
    if (this.isDrawing) this.render();
  }

  private render() {
    this.source.clear();
    const pts = this.points;
    if (!pts.length) return;
    this.source.addFeature(new Feature({ geometry: new Point(pts[0]), kind: "start" }));
    if (pts.length > 1) this.source.addFeature(new Feature({ geometry: new LineString(pts), kind: "line" }));
    const last = pts[pts.length - 1];
    if (!this.current && this.cursor) this.source.addFeature(new Feature({ geometry: new LineString([last, this.cursor]), kind: "next" }));
    if (pts.length > 2) this.source.addFeature(new Feature({ geometry: new LineString([last, pts[0]]), kind: "close" }));
  }
}

function sketchStyle(f: { get(k: string): unknown }) {
  switch (f.get("kind")) {
    case "line":
      return [
        new Style({ stroke: new Stroke({ color: "#000", width: 4 }) }),
        new Style({ stroke: new Stroke({ color: "#fff", width: 2 }) }),
      ];
    case "next":
      return new Style({ stroke: new Stroke({ color: "rgba(255,255,255,0.6)", width: 1.5, lineDash: [4, 4] }) });
    case "close":
      return new Style({ stroke: new Stroke({ color: "rgba(255,255,255,0.8)", width: 1.5, lineDash: [8, 6] }) });
    default:
      return new Style({ image: new CircleStyle({ radius: 5, fill: new Fill({ color: "#fff" }), stroke: new Stroke({ color: "#000", width: 2 }) }) });
  }
}
