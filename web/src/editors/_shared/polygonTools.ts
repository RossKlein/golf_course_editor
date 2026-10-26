import type Feature from "ol/Feature";
import type Polygon from "ol/geom/Polygon";
import Draw from "ol/interaction/Draw";
import type Interaction from "ol/interaction/Interaction";
import Modify from "ol/interaction/Modify";
import Select from "ol/interaction/Select";
import Snap from "ol/interaction/Snap";
import type Layer from "ol/layer/Layer";
import type Map from "ol/Map";
import type VectorSource from "ol/source/Vector";
import { shiftKeyOnly } from "ol/events/condition";
import type { Command } from "../../commands/keymap";
import { closeRing, dedupe, nearestVertex, outlineFromPoints, selfIntersects, snapToRings, withoutRingVertex } from "../../core/geometry/geometry";
import { mapRings, ringsOf } from "../../views/map2d/design/olRegions";
import { designStore } from "../../model/design/store";
import { fromMap, toMap, type Pt } from "../../core/geometry/coords";
import { FreehandInteraction } from "./freehand";

/** A corner the user can right-click to remove, with how far from the pointer it is. */
export type Corner = { distance: number; remove: () => void; blocked: string };

/** What the polygon tools edit: a layer of polygon features that mirrors part of the design, and how to change that part. */
export type PolygonTarget = {
  /** What one polygon is called in messages: "region", "bounds area". */
  noun: string;
  layer: Layer;
  source: VectorSource<Feature<Polygon>>;
  /** Other sources a drawn point should also snap to. */
  snapSources?: VectorSource<Feature<Polygon>>[];
  /** The polygon with this id as the design has it. */
  find: (id: string) => { id: string; outer: Pt[]; inner: Pt[][] } | undefined;
  /** A finished outline: a closed ring in design coordinates. */
  create: (ring: Pt[]) => void;
  update: (label: string, id: string, rings: { outer?: Pt[]; inner?: Pt[][] }) => void;
  remove: (ids: string[]) => void;
  /** Rings a freehand stroke's ends may snap to. */
  snapRings: () => Pt[][];
  /** Corners of other things (routes) that a right-click should also be able to remove. */
  extraCorners?: (p: Pt, near: number[], tol: number) => Corner[];
};

export type PolygonControls = {
  /** An outline is in progress. */
  drawing: () => boolean;
  finish: () => void;
  cancel: () => void;
  /** Remove the last point (polygon) or stroke (freehand). */
  back: () => void;
};

export type ToolOptions = {
  map: Map;
  tool: "select" | "draw" | "freehand";
  target: PolygonTarget;
  snap: boolean;
  /** Freehand simplification in screen pixels, read when an outline is finished. */
  smoothing: () => number;
  say: (text: string) => void;
};

const PX = 10; // how close, in screen pixels, counts as on a corner or an edge

/** Install the interactions of the Select, Polygon or Freehand tool. Returns what to call to remove them again. */
export function installPolygonTools({ map, tool, target, snap, smoothing, say }: ToolOptions): { controls: PolygonControls; dispose: () => void } {
  const interactions: Interaction[] = [];
  const cleanups: (() => void)[] = [];
  const add = (i: Interaction) => {
    map.addInteraction(i);
    interactions.push(i);
  };
  const resolution = () => map.getView().getResolution() ?? 1;

  const addOutline = (ring: Pt[]) => {
    if (ring.length < 4) return say("Not enough points for a polygon.");
    if (selfIntersects(ring)) return say("That outline crosses itself, so it was not added. Draw it again; nothing needs undoing.");
    target.create(closeRing(ring));
  };

  let controls: PolygonControls = { drawing: () => false, finish: () => undefined, cancel: () => undefined, back: () => undefined };

  if (tool === "select") {
    const select = new Select({ layers: [target.layer], hitTolerance: 4, style: null, toggleCondition: shiftKeyOnly });
    select.on("select", () => designStore.getState().select(select.getFeatures().getArray().map((f) => f.getId() as string)));
    add(select);
    cleanups.push(designStore.subscribe((s) => {
      if (!s.selected.length) select.getFeatures().clear(); // after delete, undo, or Escape
    }));

    const modify = new Modify({ source: target.source });
    modify.on("modifyend", (e) => {
      const s = designStore.getState();
      s.begin("Edit vertices");
      e.features.forEach((f) => {
        const id = f.getId() as string;
        const { outer, inner } = ringsOf(f as Feature<Polygon>);
        if (outer.length < 4 || inner.some((h) => h.length < 4)) {
          // removed too many vertices: put the polygon back the way the document has it
          const cur = target.find(id);
          if (cur) (f as Feature<Polygon>).getGeometry()!.setCoordinates(mapRings(cur.outer, cur.inner));
          say("A polygon needs at least three points.");
        } else {
          target.update("Edit vertices", id, { outer: closeRing(outer), inner: inner.map(closeRing) });
        }
      });
      s.end();
    });
    add(modify);

    // A right-click (no drag: a right-drag still pans) removes the corner under the pointer, or, away from every
    // corner, deletes the polygon under it.
    const vp = map.getViewport() as HTMLElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => void (down = e.button === 2 ? { x: e.clientX, y: e.clientY } : null);
    const onMenu = (e: MouseEvent) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
      const px = map.getEventPixel(e);
      const c = map.getCoordinateFromPixel(px) as [number, number];
      const tol = PX * resolution();
      const p = fromMap(c);
      const near = [c[0] - tol, c[1] - tol, c[0] + tol, c[1] + tol];
      const corners: Corner[] = [];
      const topFirst = (a: Feature, b: Feature) => (b.get("z") ?? 0) - (a.get("z") ?? 0);
      for (const f of target.source.getFeaturesInExtent(near).sort(topFirst)) {
        const poly = target.find(f.getId() as string);
        if (!poly) continue;
        [poly.outer, ...poly.inner].forEach((ring, k) => {
          const v = nearestVertex(ring, p, tol);
          if (!v) return;
          const cut = withoutRingVertex(ring, v.index);
          corners.push({
            distance: v.distance,
            blocked: "A shape needs at least three corners.",
            remove: () => {
              if (cut) target.update("Remove point", poly.id, k === 0 ? { outer: cut } : { inner: poly.inner.map((h, i) => (i === k - 1 ? cut : h)) });
            },
          });
        });
      }
      corners.push(...(target.extraCorners?.(p, near, tol) ?? []));
      if (corners.length) {
        // the nearest corner; on a tie the first, which is the topmost polygon
        const best = corners.reduce((a, b) => (b.distance < a.distance ? b : a));
        const before = designStore.getState().doc;
        best.remove();
        say(designStore.getState().doc === before ? best.blocked : "Point removed. Ctrl+Z brings it back.");
        return;
      }
      const hit = map.forEachFeatureAtPixel(px, (f) => f, { layerFilter: (l) => l === target.layer, hitTolerance: 4 });
      const id = hit?.getId() as string | undefined;
      if (!id) return;
      const s = designStore.getState();
      s.select(s.selected.filter((x) => x !== id));
      target.remove([id]);
      say(`${target.noun[0].toUpperCase()}${target.noun.slice(1)} deleted. Ctrl+Z brings it back.`);
    };
    vp.addEventListener("pointerdown", onDown);
    vp.addEventListener("contextmenu", onMenu);
    cleanups.push(() => {
      vp.removeEventListener("pointerdown", onDown);
      vp.removeEventListener("contextmenu", onMenu);
    });
  } else if (tool === "freehand") {
    // a stroke's ends snap to the nearest vertex or edge of anything snappable, within a few pixels
    const snapPoint = (c: [number, number]): [number, number] => (snap ? toMap(snapToRings(fromMap(c), target.snapRings(), PX * resolution())) : c);
    const freehand = new FreehandInteraction({ snap: snapPoint, onChange: () => undefined });
    add(freehand);
    controls = {
      drawing: () => freehand.isDrawing,
      finish: () => {
        const pts = freehand.finish();
        if (pts) addOutline(outlineFromPoints(pts.map((q) => fromMap(q)), smoothing() * resolution()));
      },
      cancel: () => freehand.cancel(),
      back: () => freehand.undoStroke(),
    };
  } else {
    let drawing = false;
    const draw = new Draw({ type: "Polygon", snapTolerance: 12 });
    draw.on("drawstart", () => (drawing = true));
    draw.on("drawabort", () => (drawing = false));
    draw.on("drawend", (e) => {
      drawing = false;
      addOutline(dedupe(ringsOf(e.feature as Feature<Polygon>).outer));
    });
    add(draw);
    controls = { drawing: () => drawing, finish: () => draw.finishDrawing(), cancel: () => draw.abortDrawing(), back: () => draw.removeLastPoint() };
  }

  // select and polygon snap through OpenLayers; freehand snaps its stroke ends itself
  if (snap && tool !== "freehand") {
    add(new Snap({ source: target.source, pixelTolerance: PX }));
    for (const source of target.snapSources ?? []) add(new Snap({ source, pixelTolerance: PX }));
  }

  return {
    controls,
    dispose: () => {
      cleanups.forEach((c) => c());
      interactions.forEach((i) => map.removeInteraction(i));
    },
  };
}

/** The keys shared by every editor's drawing tools: finish, cancel and step back, delete, deselect and leave the tool. */
export function polygonCommands(o: {
  /** Prefix for command ids, and the editor id used in scopes. */
  editor: string;
  controls: () => PolygonControls | null;
  /** Something else (the course editor's route tool) is mid-gesture, so Escape should not leave the tool. */
  otherBusy?: () => boolean;
  tool: () => string;
  setTool: (id: string) => void;
  hasSelection: () => boolean;
  deleteSelected: () => void;
}): Command[] {
  const { editor } = o;
  const scope = (tool: string) => `tool:${editor}/${tool}` as const;
  const busy = () => !!o.controls()?.drawing();
  const cmds: Command[] = [];
  for (const [t, what, unit] of [["draw", "outline", "point"], ["freehand", "outline", "stroke"]] as const) {
    cmds.push(
      { id: `${editor}.${t}.cancel`, label: `Cancel the ${what}`, scope: scope(t), keys: ["Escape"], group: "Drawing", when: busy, run: () => o.controls()?.cancel() },
      { id: `${editor}.${t}.finish`, label: `Finish the ${what}`, scope: scope(t), keys: ["Enter"], group: "Drawing", when: busy, run: () => o.controls()?.finish() },
      { id: `${editor}.${t}.back`, label: `Remove the last ${unit}`, scope: scope(t), keys: ["Backspace"], group: "Drawing", when: busy, run: () => o.controls()?.back() },
    );
  }
  cmds.push(
    { id: `${editor}.delete`, label: "Delete selection", scope: scope("select"), keys: ["Delete", "Backspace"], group: "Edit", when: o.hasSelection, run: o.deleteSelected },
    { id: `${editor}.deselect`, label: "Clear selection", scope: scope("select"), keys: ["Escape"], group: "Edit", when: o.hasSelection, run: () => designStore.getState().select([]) },
    // leaving a drawing tool with Escape, when nothing is being drawn, returns to Select
    { id: `${editor}.tool.exit`, label: "Back to the Select tool", scope: `editor:${editor}`, keys: ["Escape"], group: "Tools", when: () => o.tool() !== "select" && !busy() && !o.otherBusy?.(), run: () => o.setTool("select") },
  );
  return cmds;
}
