import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import MultiPolygon from "ol/geom/MultiPolygon";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style, Text } from "ol/style";
import { CLASS_COLORS, css } from "../bundle/bundleScene";
import { fromMap, toMap, type Pt } from "../core/geometry/coords";
import type { Region } from "../core/api/api";
import { OWNED, visibleRegionIds } from "../model/design/holes";
import { coveringRegions, visibleGeometry } from "../model/design/layering";
import { designStore, type Doc } from "../model/design/store";

export { OWNED }; // fairway, green, tee: the classes that belong to a hole

export const mapRings = (outer: Pt[], inner: Pt[][]) => [outer, ...inner].map((ring) => ring.map((p) => toMap(p)));

export const ringsOf = (f: Feature<Polygon>): { outer: Pt[]; inner: Pt[][] } => {
  const [outer, ...inner] = f.getGeometry()!.getCoordinates() as number[][][];
  return { outer: outer.map((c) => fromMap(c as Pt)), inner: inner.map((r) => r.map((c) => fromMap(c as Pt))) };
};

/**
 * Regions are layered like the build paints them: a later region of another surface covers the ones below. The fill
 * and outline are drawn on the part that shows (`vis`: undefined = all of it, false = none), a faint dotted outline
 * marks what is hidden, and a selected region shows its whole outline so you can see what you are editing.
 */
const shown = (f: FeatureLike) => {
  const vis = f.get("vis") as Geometry | false | undefined;
  return vis === false ? undefined : vis ?? (f.getGeometry() as Geometry);
};
const whole = (f: FeatureLike) => f.getGeometry() as Geometry;
const labelAt = (f: FeatureLike) => (f.get("label") as Point | undefined) ?? (f.getGeometry() as Polygon).getInteriorPoint();

function regionStyle(f: FeatureLike): Style[] {
  const cls = (f.get("cls") as number) ?? 0;
  const hole = f.get("hole") as number | null | undefined;
  const selected = designStore.getState().selected.includes(f.getId() as string);
  const rgb = CLASS_COLORS[cls] ?? [255, 0, 255];
  const orphan = OWNED.includes(cls) && !hole; // an owned surface that no hole has claimed yet
  const covered = f.get("vis") !== undefined;
  const styles = [
    new Style({
      geometry: shown,
      fill: new Fill({ color: css(rgb, selected ? 0.5 : 0.35) }),
      stroke: new Stroke({ color: css(rgb, 1), width: 2, lineDash: orphan ? [8, 5] : undefined }),
    }),
  ];
  if (selected) styles.push(new Style({ geometry: whole, stroke: new Stroke({ color: "#ffffff", width: 3, lineDash: orphan ? [8, 5] : undefined }) }));
  else if (covered) styles.push(new Style({ geometry: whole, stroke: new Stroke({ color: css(rgb, 0.45), width: 1, lineDash: [2, 5] }) }));
  if (hole && f.get("vis") !== false) {
    styles.push(new Style({
      geometry: labelAt,
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
  // what covers each region, remembered until a region or one of its coverers is replaced in the store
  const layered = new Map<string, { region: Region; over: Region[]; vis: MultiPolygon | false | undefined; label: Point | undefined }>();

  const visibleOf = (all: Region[], i: number) => {
    const r = all[i];
    const over = coveringRegions(all, i);
    const hit = layered.get(r.id);
    if (hit && hit.region === r && hit.over.length === over.length && hit.over.every((o, k) => o === over[k])) return hit;
    const g = visibleGeometry(r, over);
    const vis = g === undefined ? undefined : g === null ? (false as const) : new MultiPolygon(g.map((poly) => poly.map((ring) => ring.map((p) => toMap(p)))));
    let label: Point | undefined;
    if (vis) {
      // the widest piece of what shows is where the hole number goes
      const pts = vis.getInteriorPoints().getCoordinates() as number[][];
      const best = pts.reduce((a, b) => (b[2] > a[2] ? b : a), pts[0]);
      label = best ? new Point([best[0], best[1]]) : undefined;
    }
    const entry = { region: r, over, vis, label };
    layered.set(r.id, entry);
    return entry;
  };

  const apply = (doc: Doc) => {
    const keep = only === null ? null : visibleRegionIds(doc, only, designStore.getState().selected);
    const all = doc.order.map((id) => doc.regions[id]);
    for (let i = 0; i < all.length; i++) {
      const r = all[i];
      const id = r.id;
      if (keep && !keep.has(id)) continue;
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
      const { vis, label } = visibleOf(all, i);
      f.set("vis", vis);
      f.set("label", label);
      f.set("z", i); // painter's order is the draw order
    }
    for (const id of layered.keys()) if (!doc.regions[id]) layered.delete(id);
    for (const [id, f] of features) {
      if (!doc.regions[id] || (keep && !keep.has(id))) {
        source.removeFeature(f);
        features.delete(id);
      }
    }
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
