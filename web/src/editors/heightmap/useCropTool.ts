import type Map from "ol/Map";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Fill, RegularShape, Stroke, Style } from "ol/style";
import { useEffect, useRef } from "react";
import { fromMap, toMap, type Pt } from "../../core/geometry/coords";
import { cropStore, setCrop } from "./cropStore";
import { boxFromPoints, CURSORS, dragHandle, hitHandle, tidy, wholeMap, type CropRect, type Handle, type MapSize } from "./cropRect";

const FAR = 1e5; // the dimmed ground reaches further than anyone can pan
const PICK_PX = 10; // how close, in screen pixels, counts as on an edge or corner

const DIM = new Style({ fill: new Fill({ color: "rgba(0, 0, 0, 0.55)" }) });
const FRAME = [
  new Style({ stroke: new Stroke({ color: "rgba(0, 0, 0, 0.7)", width: 4 }) }),
  new Style({ stroke: new Stroke({ color: "#ffd24a", width: 2 }) }),
];
const HANDLE = new Style({ image: new RegularShape({ points: 4, radius: 7, angle: Math.PI / 4, fill: new Fill({ color: "#ffd24a" }), stroke: new Stroke({ color: "#000", width: 1.5 }) }) });

const ring = (pts: Pt[]) => pts.map(toMap);

function shapes(r: CropRect) {
  // the dimmed ground is everything but the rectangle: a big ring with the rectangle cut out of it, wound the other way
  const big: Pt[] = [[-FAR, -FAR], [FAR, -FAR], [FAR, FAR], [-FAR, FAR], [-FAR, -FAR]];
  const hole: Pt[] = [[r.x0, r.z0], [r.x0, r.z1], [r.x1, r.z1], [r.x1, r.z0], [r.x0, r.z0]];
  const midX = (r.x0 + r.x1) / 2, midZ = (r.z0 + r.z1) / 2;
  const handles: Pt[] = [[r.x0, r.z0], [midX, r.z0], [r.x1, r.z0], [r.x1, midZ], [r.x1, r.z1], [midX, r.z1], [r.x0, r.z1], [r.x0, midZ]];
  return { dim: [ring(big), ring(hole)], frame: [ring([[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1], [r.x0, r.z0]])], handles: handles.map(toMap) };
}

/**
 * The Crop tool on the 2D map: the part to keep is bright and the rest dimmed, with a handle on each edge and corner to drag, the inside
 * to move it, and a drag anywhere outside it to draw a new one. The rectangle lives in `cropStore`, so the panel's numbers and this agree.
 */
export function useCropTool({ map, active, size }: { map: Map | null; active: boolean; size: MapSize | null }) {
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const w = size?.w, h = size?.h;

  useEffect(() => {
    if (!map || !active || w === undefined || h === undefined) return;
    const m: MapSize = { w, h };
    const keep = cropStore.getState().rect;
    setCrop(keep ? tidy(keep, m) : wholeMap(m));

    const first = shapes(cropStore.getState().rect!);
    const dim = new Feature(new Polygon(first.dim));
    const frame = new Feature(new Polygon(first.frame));
    dim.setStyle(DIM);
    frame.setStyle(FRAME);
    const handleFeatures = first.handles.map((c) => {
      const f = new Feature(new Point(c));
      f.setStyle(HANDLE);
      return f;
    });
    const source = new VectorSource({ features: [dim, frame, ...handleFeatures] });
    const layer = new VectorLayer({ source, zIndex: 1000, updateWhileInteracting: true, updateWhileAnimating: true });
    map.addLayer(layer);

    const draw = (r: CropRect) => {
      const s = shapes(r);
      (dim.getGeometry() as Polygon).setCoordinates(s.dim);
      (frame.getGeometry() as Polygon).setCoordinates(s.frame);
      handleFeatures.forEach((f, i) => (f.getGeometry() as Point).setCoordinates(s.handles[i]));
    };
    const unsub = cropStore.subscribe((s) => s.rect && draw(s.rect));

    const viewport = map.getViewport() as HTMLElement;
    const before = viewport.style.cursor;
    const at = (e: PointerEvent): Pt => fromMap(map.getEventCoordinate(e) as Pt);
    const tol = () => PICK_PX * (map.getView().getResolution() ?? 1);
    let drag: { handle: Handle | "new"; from: Pt; start: CropRect } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || map.get("spacePan")) return;
      const p = at(e);
      const rect = cropStore.getState().rect!;
      drag = { handle: hitHandle(rect, p, tol()) ?? "new", from: p, start: rect };
      viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      const p = at(e);
      if (!drag) {
        const hit = hitHandle(cropStore.getState().rect!, p, tol());
        viewport.style.cursor = hit ? CURSORS[hit] : "crosshair";
        return;
      }
      if (drag.handle === "new") {
        const box = boxFromPoints(drag.from, p, m);
        if (box) setCrop(box);
      } else {
        setCrop(dragHandle(drag.start, drag.handle, drag.from, p, m));
      }
    };
    const onUp = () => void (drag = null);
    viewport.style.cursor = "crosshair";
    viewport.addEventListener("pointerdown", onDown);
    viewport.addEventListener("pointermove", onMove);
    viewport.addEventListener("pointerup", onUp);
    viewport.addEventListener("pointercancel", onUp);
    return () => {
      viewport.removeEventListener("pointerdown", onDown);
      viewport.removeEventListener("pointermove", onMove);
      viewport.removeEventListener("pointerup", onUp);
      viewport.removeEventListener("pointercancel", onUp);
      viewport.style.cursor = before;
      unsub();
      map.removeLayer(layer);
    };
  }, [map, active, w, h]);
}
