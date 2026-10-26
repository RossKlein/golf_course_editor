import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style, Text } from "ol/style";
import { CLASS_COLORS, css } from "../bundle/bundleScene";
import { fromMap, toMap, type Pt } from "../map/coords";
import { OWNED, visibleRegionIds } from "./holes";
import { designStore, type Doc } from "./store";

export { OWNED }; // fairway, green, tee: the classes that belong to a hole

export const mapRings = (outer: Pt[], inner: Pt[][]) => [outer, ...inner].map((ring) => ring.map((p) => toMap(p)));

export const ringsOf = (f: Feature<Polygon>): { outer: Pt[]; inner: Pt[][] } => {
  const [outer, ...inner] = f.getGeometry()!.getCoordinates() as number[][][];
  return { outer: outer.map((c) => fromMap(c as Pt)), inner: inner.map((r) => r.map((c) => fromMap(c as Pt))) };
};

function regionStyle(f: FeatureLike): Style[] {
  const cls = (f.get("cls") as number) ?? 0;
  const hole = f.get("hole") as number | null | undefined;
  const selected = designStore.getState().selected.includes(f.getId() as string);
  const rgb = CLASS_COLORS[cls] ?? [255, 0, 255];
  const orphan = OWNED.includes(cls) && !hole; // an owned surface that no hole has claimed yet
  const styles = [
    new Style({
      fill: new Fill({ color: css(rgb, selected ? 0.5 : 0.35) }),
      stroke: new Stroke({ color: selected ? "#ffffff" : css(rgb, 1), width: selected ? 3 : 2, lineDash: orphan ? [8, 5] : undefined }),
    }),
  ];
  const geom = f.getGeometry() as Polygon | undefined;
  if (hole && geom) {
    styles.push(new Style({
      geometry: geom.getInteriorPoint(),
      text: new Text({ text: String(hole), font: "bold 14px system-ui", fill: new Fill({ color: "#fff" }), stroke: new Stroke({ color: "#000", width: 3 }) }),
    }));
  }
  return styles;
}

/** The design's regions as an OpenLayers layer. The store is the source of truth; this only mirrors it. */
export function createRegionLayer() {
  const source = new VectorSource<Feature<Polygon>>();
  const layer = new VectorLayer({ source, style: regionStyle, zIndex: 50, renderOrder: (a, b) => (a.get("z") ?? 0) - (b.get("z") ?? 0) });
  const features = new Map<string, Feature<Polygon>>();
  // While other holes are hidden their features are taken out of the source, so selecting, editing and snapping
  // (which all read the source) leave them alone too.
  let only: number | null = null;

  const apply = (doc: Doc) => {
    const shown = only === null ? null : visibleRegionIds(doc, only, designStore.getState().selected);
    for (const id of doc.order) {
      if (shown && !shown.has(id)) continue;
      const r = doc.regions[id];
      const coords = mapRings(r.outer as Pt[], r.inner as Pt[][]);
      let f = features.get(id);
      if (!f) {
        f = new Feature(new Polygon(coords));
        f.setId(id);
        features.set(id, f);
        source.addFeature(f);
      } else if (JSON.stringify(f.getGeometry()!.getCoordinates()) !== JSON.stringify(coords)) {
        f.getGeometry()!.setCoordinates(coords); // interactions edit in place; this only fires for undo/redo and loads
      }
      f.set("cls", r.class);
      f.set("hole", r.hole);
    }
    for (const [id, f] of features) {
      if (!doc.regions[id] || (shown && !shown.has(id))) {
        source.removeFeature(f);
        features.delete(id);
      }
    }
    // painter's order is the draw order
    source.getFeatures().forEach((f) => f.set("z", doc.order.indexOf(f.getId() as string)));
    layer.changed();
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
      if (only !== null) apply(s.doc); // the selection is always shown, even outside the hole
      layer.changed();
    }
  });
  return {
    layer,
    source,
    /** Show only this hole's surfaces (and what is near them), or everything when null. */
    showOnly(hole: number | null) {
      only = hole;
      apply(designStore.getState().doc);
    },
    dispose: unsub,
  };
}
