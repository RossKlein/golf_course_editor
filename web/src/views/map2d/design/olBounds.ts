import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style, Text } from "ol/style";
import { css, holeColor } from "../../../scene/bundleScene";
import type { Pt } from "../../../core/geometry/coords";
import { mapRings } from "./olRegions";
import { designStore, type Doc } from "../../../model/design/store";

export type BoundsView = { hole: number; showOthers: boolean };

const activeStyle = (f: FeatureLike) => {
  const n = f.get("hole") as number;
  const selected = designStore.getState().selected.includes(f.getId() as string);
  const rgb = holeColor(n);
  return new Style({
    fill: new Fill({ color: css(rgb, selected ? 0.3 : 0.16) }),
    stroke: new Stroke({ color: selected ? "#ffffff" : css(rgb, 1), width: selected ? 3 : 2.5 }),
  });
};

const otherStyle = (f: FeatureLike) => {
  const n = f.get("hole") as number;
  const rgb = holeColor(n);
  return [
    new Style({ fill: new Fill({ color: css(rgb, 0.05) }), stroke: new Stroke({ color: css(rgb, 0.75), width: 1.5, lineDash: [6, 5] }) }),
    new Style({
      geometry: (ff) => (ff.getGeometry() as Polygon).getInteriorPoint(),
      text: new Text({ text: String(n), font: "bold 12px system-ui", fill: new Fill({ color: css(rgb, 1) }), stroke: new Stroke({ color: "#000", width: 3 }) }),
    }),
  ];
};

/**
 * Bounds areas as two layers. The active hole's areas are in `source` and are what the tools edit; the other holes'
 * areas, when asked for, are in `contextSource` on a separate layer that nothing interacts with.
 */
export function createBoundsLayer() {
  const source = new VectorSource<Feature<Polygon>>();
  const contextSource = new VectorSource<Feature<Polygon>>();
  const layer = new VectorLayer({ source, style: activeStyle, zIndex: 70 });
  const context = new VectorLayer({ source: contextSource, style: otherStyle, zIndex: 65 });
  let view: BoundsView = { hole: 1, showOthers: false };

  const sync = (target: VectorSource<Feature<Polygon>>, doc: Doc, want: (hole: number) => boolean) => {
    const wanted = Object.values(doc.bounds).filter((a) => want(a.hole));
    const ids = new Set(wanted.map((a) => a.id));
    for (const f of target.getFeatures()) if (!ids.has(f.getId() as string)) target.removeFeature(f);
    for (const a of wanted) {
      const coords = mapRings(a.outer as Pt[], a.inner as Pt[][]);
      let f = target.getFeatureById(a.id);
      if (!f) {
        f = new Feature(new Polygon(coords));
        f.setId(a.id);
        target.addFeature(f);
      } else if (JSON.stringify(f.getGeometry()!.getCoordinates()) !== JSON.stringify(coords)) {
        f.getGeometry()!.setCoordinates(coords); // interactions edit in place; this is for undo, redo and loads
      }
      f.set("hole", a.hole);
    }
  };
  const apply = (doc: Doc) => {
    sync(source, doc, (h) => h === view.hole);
    sync(contextSource, doc, (h) => view.showOthers && h !== view.hole);
    layer.changed();
    context.changed();
  };

  apply(designStore.getState().doc);
  let lastDoc = designStore.getState().doc;
  let lastSel = designStore.getState().selected;
  const unsub = designStore.subscribe((s) => {
    if (s.doc !== lastDoc) {
      lastDoc = s.doc;
      apply(s.doc);
    }
    if (s.selected !== lastSel) {
      lastSel = s.selected;
      layer.changed();
    }
  });
  return {
    layer,
    context,
    source,
    setView(v: BoundsView) {
      view = v;
      apply(designStore.getState().doc);
    },
    dispose: unsub,
  };
}
