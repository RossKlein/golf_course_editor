import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import VectorSource from "ol/source/Vector";
import { fromMap, toMap, type Pt } from "./geom";
import type { Doc, Region } from "./store";
import { store } from "./store";

const mapCoords = (r: Region): number[][][] => [r.outer, ...r.inner].map((ring) => ring.map(toMap));

/** One-way mirror of the store into an OpenLayers source. Interactions edit features in place; their end events are
 *  turned into store actions elsewhere, and the next sync then finds the features already equal. */
export function bindStore(source: VectorSource): () => void {
  const features = new Map<string, Feature<Polygon>>();
  const apply = (doc: Doc) => {
    for (const id of doc.order) {
      const r = doc.regions[id];
      const coords = mapCoords(r);
      let f = features.get(id);
      if (!f) {
        f = new Feature(new Polygon(coords));
        f.setId(id);
        features.set(id, f);
        source.addFeature(f);
      } else if (JSON.stringify(f.getGeometry()!.getCoordinates()) !== JSON.stringify(coords)) {
        f.getGeometry()!.setCoordinates(coords);
      }
      f.set("cls", r.cls);
      f.set("hole", r.hole);
    }
    for (const [id, f] of features) {
      if (!doc.regions[id]) {
        source.removeFeature(f);
        features.delete(id);
      }
    }
  };
  apply(store.getState().doc);
  let last = store.getState().doc;
  return store.subscribe((s) => {
    if (s.doc !== last) {
      last = s.doc;
      apply(s.doc);
    }
  });
}

export const ringsOf = (f: Feature<Polygon>): { outer: Pt[]; inner: Pt[][] } => {
  const [outer, ...inner] = f.getGeometry()!.getCoordinates() as number[][][];
  return { outer: outer.map((c) => fromMap(c as Pt)), inner: inner.map((r) => r.map((c) => fromMap(c as Pt))) };
};
