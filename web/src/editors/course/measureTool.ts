import Feature from "ol/Feature";
import type Map from "ol/Map";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import PointerInteraction from "ol/interaction/Pointer";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { unByKey } from "ol/Observable";
import type { EventsKey } from "ol/events";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import type { Pt } from "../../core/geometry/coords";
import { measurePoints, measureReadout, pathLength, segments } from "./measure";

type Coord = Pt;

const LINE = "#b8e26a";

/**
 * Click points to measure horizontal distance. Nothing is written into the design: the line lives only while this
 * interaction is on the map. A click is not a drag, so dragging still pans. Double-click finishes; Enter does too.
 */
export class MeasureInteraction extends PointerInteraction {
  private points: Coord[] = [];
  private cursor: Coord | null = null;
  private finished = false;
  private lastClick = 0;
  private clickKey: EventsKey | null = null;
  private readonly source = new VectorSource();
  private readonly layer: VectorLayer<VectorSource>;

  constructor(private readonly options: { snap: (c: Coord) => Coord; format: (metres: number) => string; onReadout: (text: string) => void; say: (text: string) => void }) {
    super();
    this.layer = new VectorLayer({
      source: this.source,
      zIndex: 80,
      updateWhileInteracting: true,
      style: (f) => this.styleOf(f as Feature),
    });
  }

  /** At least one point has been clicked. */
  get hasPoints() {
    return this.points.length > 0;
  }

  /** A measurement is in progress, so Enter should finish it rather than leave the tool. */
  get isDrawing() {
    return this.points.length > 0 && !this.finished;
  }

  override setMap(map: Map | null) {
    if (this.clickKey) unByKey(this.clickKey);
    this.clickKey = null;
    super.setMap(map);
    this.layer.setMap(map);
    if (!map) {
      this.points = [];
      this.cursor = null;
      this.finished = false;
      this.options.onReadout("");
      return;
    }
    // A click, not a drag: panning never drops a point. The down event is left alone so the map can pan.
    this.clickKey = map.on("click", (e) => {
      if (map.get("spacePan")) return;
      this.place(e.coordinate as Coord);
    });
  }

  /** Units changed: the same line, with labels written again. */
  redraw() {
    this.render();
  }

  finish() {
    if (this.points.length < 2) {
      this.options.say("Click a second point to measure.");
      return;
    }
    this.finished = true;
    this.render();
  }

  cancel() {
    this.points = [];
    this.finished = false;
    this.render();
  }

  back() {
    if (!this.points.length) return;
    this.finished = false;
    this.points.pop();
    this.render();
  }

  override handleMoveEvent(e: MapBrowserEvent<PointerEvent>) {
    if (!this.points.length || this.finished) {
      this.cursor = e.coordinate as Coord;
      return;
    }
    this.cursor = this.options.snap(e.coordinate as Coord);
    this.render();
  }

  private place(coord: Coord) {
    const snapped = this.options.snap(coord);
    this.cursor = snapped;
    const now = performance.now();
    if (this.finished) {
      this.points = [snapped];
      this.finished = false;
      this.lastClick = now;
      this.render();
      return;
    }
    const last = this.points[this.points.length - 1];
    const tol = (this.getMap()?.getView().getResolution() ?? 1) * 4;
    const same = !!last && Math.hypot(snapped[0] - last[0], snapped[1] - last[1]) <= tol;
    if (!same) this.points.push(snapped);
    else if (now - this.lastClick < 400 && this.points.length >= 2) this.finished = true;
    this.lastClick = now;
    this.render();
  }

  private render() {
    this.source.clear();
    const open = !this.finished;
    const shown = measurePoints(this.points, this.cursor, open);
    if (this.points.length > 1) {
      const line = new Feature(new LineString(this.points));
      line.set("kind", "line");
      this.source.addFeature(line);
    }
    if (open && this.points.length && shown.length > this.points.length) {
      const next = new Feature(new LineString([this.points[this.points.length - 1], shown[shown.length - 1]]));
      next.set("kind", "next");
      this.source.addFeature(next);
    }
    for (const p of this.points) {
      const v = new Feature(new Point(p));
      v.set("kind", "vertex");
      this.source.addFeature(v);
    }
    const format = this.options.format;
    for (const s of segments(shown)) {
      const label = new Feature(new Point(s.mid));
      label.set("kind", "label");
      label.set("text", format(s.metres));
      this.source.addFeature(label);
    }
    if (shown.length > 2) {
      const total = new Feature(new Point(shown[shown.length - 1]));
      total.set("kind", "label");
      total.set("below", true);
      total.set("text", `${format(pathLength(shown))} total`);
      this.source.addFeature(total);
    }
    this.options.onReadout(measureReadout(this.points, this.cursor, open, format));
  }

  private styleOf(f: Feature): Style | Style[] {
    switch (f.get("kind")) {
      case "line":
        return [
          new Style({ stroke: new Stroke({ color: "rgba(0,0,0,0.85)", width: 5 }) }),
          new Style({ stroke: new Stroke({ color: LINE, width: 2 }) }),
        ];
      case "next":
        return new Style({ stroke: new Stroke({ color: LINE, width: 1.5, lineDash: [6, 5] }) });
      case "label":
        return new Style({
          text: new Text({
            text: String(f.get("text")),
            font: "600 13px system-ui, sans-serif",
            fill: new Fill({ color: "#fff" }),
            stroke: new Stroke({ color: "#111", width: 4 }),
            offsetY: f.get("below") ? 16 : -14,
          }),
        });
      default:
        return new Style({ image: new CircleStyle({ radius: 4, fill: new Fill({ color: "#fff" }), stroke: new Stroke({ color: "#111", width: 2 }) }) });
    }
  }
}
