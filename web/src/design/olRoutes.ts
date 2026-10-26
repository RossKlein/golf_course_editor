import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import { css, holeColor } from "../scene/bundleScene";
import { toMap, type Pt } from "../core/geometry/coords";
import { designStore, type Doc } from "../model/design/store";

export type RouteView = { hole: number; hideOthers: boolean };

/** Tee to green, one line per hole that has a route. The active hole's is drawn heavier. */
export function createRouteLayer() {
  const source = new VectorSource<Feature<LineString>>();
  let view: RouteView = { hole: 1, hideOthers: false };

  const style = (f: { get(k: string): unknown; getGeometry(): unknown }): Style[] => {
    const n = f.get("number") as number;
    const active = n === view.hole;
    const coords = (f.getGeometry() as LineString).getCoordinates();
    const color = css(holeColor(n));
    const label = new Text({ text: String(n), font: "bold 13px system-ui", fill: new Fill({ color: "#fff" }), stroke: new Stroke({ color: "#000", width: 3 }), offsetY: -14 });
    return [
      new Style({ stroke: new Stroke({ color: "rgba(0,0,0,0.75)", width: active ? 6 : 4 }) }),
      new Style({ stroke: new Stroke({ color, width: active ? 3 : 2 }) }),
      new Style({ geometry: new Point(coords[0]), image: new CircleStyle({ radius: active ? 6 : 4, fill: new Fill({ color: "#fff" }), stroke: new Stroke({ color: "#000", width: 2 }) }), text: label }),
      new Style({ geometry: new Point(coords[coords.length - 1]), image: new CircleStyle({ radius: active ? 5 : 3, fill: new Fill({ color }), stroke: new Stroke({ color: "#000", width: 2 }) }) }),
    ];
  };
  const layer = new VectorLayer({ source, style, zIndex: 60 });

  const apply = (doc: Doc) => {
    const wanted = new Map<string, Pt[]>();
    for (const h of doc.layout.holes) {
      if (h.route.length < 2) continue;
      if (view.hideOthers && h.number !== view.hole) continue;
      wanted.set(`hole-${h.number}`, h.route as Pt[]);
    }
    for (const f of source.getFeatures()) if (!wanted.has(f.getId() as string)) source.removeFeature(f);
    for (const [id, route] of wanted) {
      const coords = route.map((p) => toMap(p));
      const f = source.getFeatureById(id);
      if (!f) {
        const nf = new Feature(new LineString(coords));
        nf.setId(id);
        nf.set("number", Number(id.slice(5)));
        source.addFeature(nf);
      } else if (JSON.stringify(f.getGeometry()!.getCoordinates()) !== JSON.stringify(coords)) {
        f.getGeometry()!.setCoordinates(coords); // an interaction edits in place; this is for undo, redo and loads
      }
    }
    layer.changed();
  };

  apply(designStore.getState().doc);
  let last = designStore.getState().doc;
  const unsub = designStore.subscribe((s) => {
    if (s.doc !== last) {
      last = s.doc;
      apply(s.doc);
    }
  });
  return {
    layer,
    source,
    setView(v: RouteView) {
      view = v;
      apply(designStore.getState().doc);
    },
    dispose: unsub,
  };
}
