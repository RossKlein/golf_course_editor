import type Map from "ol/Map";
import type Feature from "ol/Feature";
import type LineString from "ol/geom/LineString";
import type Polygon from "ol/geom/Polygon";
import Draw from "ol/interaction/Draw";
import type Interaction from "ol/interaction/Interaction";
import Modify from "ol/interaction/Modify";
import Select from "ol/interaction/Select";
import Snap from "ol/interaction/Snap";
import { shiftKeyOnly } from "ol/events/condition";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorState } from "../../api/api";
import type { Command } from "../../commands/keymap";
import { closeRing, dedupe, outlineFromPoints, selfIntersects, snapToRings } from "../../design/geometry";
import { holeView, suggestHoles, unassignedCount } from "../../design/holes";
import { createRegionLayer, mapRings, OWNED, ringsOf } from "../../design/olRegions";
import { createRouteLayer } from "../../design/olRoutes";
import { addHole, addRegion, assignHoles, designStore, removeRegions, reorderRegions, setRoute, updateRegion, useDesign } from "../../design/store";
import { fromMap, toMap, type Pt } from "../../map/coords";
import type { Scene } from "../../map/scene";
import { flyToRect } from "../../map/view";
import { FreehandInteraction } from "./freehand";

/** Surface classes in the palette, with the key that picks each. Keys are fixed to class names, not positions. */
export const CLASS_KEYS: { cls: number; key: string; label: string }[] = [
  { cls: 2, key: "g", label: "Green" },
  { cls: 1, key: "f", label: "Fairway" },
  { cls: 4, key: "t", label: "Tee" },
  { cls: 3, key: "c", label: "Collar" },
  { cls: 5, key: "b", label: "Bunker" },
  { cls: 6, key: "w", label: "Water" },
  { cls: 7, key: "p", label: "Path" },
  { cls: 8, key: "o", label: "Woods" },
  { cls: 0, key: "r", label: "Rough" },
];

export const TOOLS = [
  { id: "select", label: "Select", key: "v", hint: "Click a region to select it; drag a vertex to move it, an edge to add one, Alt+click a vertex to remove it" },
  { id: "draw", label: "Polygon", key: "d", hint: "Click to add points; click the first point or press Enter to finish" },
  { id: "freehand", label: "Freehand", key: "Shift+D", hint: "Drag to draw, lift and keep going as often as you like. Enter finishes the outline, Backspace removes the last stroke, Esc cancels. Middle-drag pans." },
  { id: "route", label: "Route", key: "Shift+R", hint: "Click along the active hole from tee to green, replacing its route. Enter or double-click finishes, Backspace removes the last point, Esc cancels" },
] as const;
export type ToolId = (typeof TOOLS)[number]["id"];

const className = (cls: number) => CLASS_KEYS.find((c) => c.cls === cls)?.label ?? `class ${cls}`;

type Props = {
  map: Map | null;
  scene: Scene | null;
  /** The Course editor is the open editor. */
  active: boolean;
  editor: EditorState;
  patch: (p: Partial<EditorState>) => void;
};

/**
 * The Course editor: owns the region layer on the map, the interactions for the active tool, and the keyboard
 * commands. The store is the document; everything here turns map gestures into store actions.
 */
export function useCourseEditor({ map, scene, active, editor, patch }: Props) {
  const layerRef = useRef<ReturnType<typeof createRegionLayer> | null>(null);
  const routesRef = useRef<ReturnType<typeof createRouteLayer> | null>(null);
  const holeCount = useDesign((s) => s.doc.layout.holes.length);
  const [layerReady, setLayerReady] = useState(false);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawRef = useRef<Draw | null>(null);
  const freehandRef = useRef<FreehandInteraction | null>(null);
  const finishFreehandRef = useRef<(pts: [number, number][]) => void>(() => undefined);
  const drawing = useRef(false);
  const latest = useRef({ editor, patch });
  latest.current = { editor, patch };
  const isBundle = scene?.kind === "bundle";
  const tool = editor.tool as ToolId;

  const say = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 5000);
  }, []);

  // the region layer lives on the map for as long as a bundle is shown
  useEffect(() => {
    if (!map || !isBundle) return;
    const r = createRegionLayer();
    const routes = createRouteLayer();
    layerRef.current = r;
    routesRef.current = routes;
    map.addLayer(r.layer);
    map.addLayer(routes.layer);
    setLayerReady(true);
    return () => {
      map.removeLayer(r.layer);
      map.removeLayer(routes.layer);
      r.dispose();
      routes.dispose();
      layerRef.current = null;
      routesRef.current = null;
      setLayerReady(false);
    };
  }, [map, isBundle]);

  useEffect(() => {
    layerRef.current?.layer.setVisible(active);
    routesRef.current?.layer.setVisible(active);
  }, [active, layerReady]);

  // one hole at a time: the toggle takes other holes out of the layers, and so out of reach of the tools too
  useEffect(() => {
    layerRef.current?.showOnly(editor.hideOthers ? editor.hole : null);
    routesRef.current?.setView({ hole: editor.hole, hideOthers: editor.hideOthers });
  }, [editor.hole, editor.hideOthers, layerReady]);

  // removing holes can leave the active one past the end
  useEffect(() => {
    if (active && editor.hole > Math.max(1, holeCount)) latest.current.patch({ hole: Math.max(1, holeCount) });
  }, [active, holeCount, editor.hole]);

  // interactions for the active tool
  useEffect(() => {
    const r = layerRef.current;
    if (!map || !r || !active || !isBundle) return;
    const interactions: Interaction[] = [];
    const add = (i: Interaction) => {
      map.addInteraction(i);
      interactions.push(i);
    };

    /** Add a finished outline (design coordinates) as a region of the active surface and hole. */
    const addOutline = (ring: Pt[]) => {
      const { editor } = latest.current;
      if (ring.length < 4) return say("Not enough points for a polygon.");
      if (selfIntersects(ring)) return say("That outline crosses itself, so it was not added. Draw it again; nothing needs undoing.");
      const cls = editor.activeClass;
      const id = addRegion(`Draw ${className(cls).toLowerCase()}`, { class: cls, hole: OWNED.includes(cls) ? editor.hole : null, outer: closeRing(ring), inner: [] });
      designStore.getState().select([id]);
    };
    /** The drawn line becomes the active hole's route (creating the hole if it is new). */
    const finishRoute = (f: Feature<LineString>) => {
      const pts = (f.getGeometry()!.getCoordinates() as [number, number][]).map((c) => fromMap(c));
      const route = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
      if (route.length < 2) return say("A route needs at least two points.");
      const hole = latest.current.editor.hole;
      setRoute(hole, route);
      say(`Route set for hole ${hole}.`);
    };
    const finishPolygon = (f: Feature<Polygon>) => addOutline(dedupe(ringsOf(f).outer));
    /** Strokes become one outline, simplified to `smoothing` screen pixels at the current zoom. */
    const finishFreehand = (points: [number, number][]) => {
      const res = map.getView().getResolution() ?? 1;
      addOutline(outlineFromPoints(points.map((p) => fromMap(p)), latest.current.editor.smoothing * res));
    };
    finishFreehandRef.current = finishFreehand;
    // freehand snaps only where a stroke starts and ends, to the nearest vertex or edge of any region
    const snapPoint = (c: [number, number]): [number, number] => {
      if (!latest.current.editor.snap) return c;
      const doc = designStore.getState().doc;
      const rings = doc.order.flatMap((id) => [doc.regions[id].outer as Pt[], ...(doc.regions[id].inner as Pt[][])]);
      return toMap(snapToRings(fromMap(c), rings, 10 * (map.getView().getResolution() ?? 1)));
    };

    if (tool === "select") {
      const select = new Select({ layers: [r.layer], hitTolerance: 4, style: null, toggleCondition: shiftKeyOnly });
      select.on("select", () => designStore.getState().select(select.getFeatures().getArray().map((f) => f.getId() as string)));
      add(select);
      const unsub = designStore.subscribe((s) => {
        if (!s.selected.length) select.getFeatures().clear(); // after delete, undo, or Escape
      });
      interactions.push({ unsub } as never);
      const modify = new Modify({ source: r.source });
      modify.on("modifyend", (e) => {
        const s = designStore.getState();
        s.begin("Edit vertices");
        e.features.forEach((f) => {
          const id = f.getId() as string;
          const { outer, inner } = ringsOf(f as Feature<Polygon>);
          if (outer.length < 4 || inner.some((h) => h.length < 4)) {
            // removed too many vertices: put the polygon back the way the document has it
            const cur = s.doc.regions[id];
            (f as Feature<Polygon>).getGeometry()!.setCoordinates(mapRings(cur.outer as never, cur.inner as never));
            say("A polygon needs at least three points.");
          } else {
            updateRegion("Edit vertices", id, { outer: closeRing(outer), inner: inner.map(closeRing) });
          }
        });
        s.end();
      });
      add(modify);
      const routes = routesRef.current;
      if (routes) {
        const editRoute = new Modify({ source: routes.source });
        editRoute.on("modifyend", (e) => {
          e.features.forEach((f) => {
            const hole = f.get("number") as number;
            const geom = (f as Feature<LineString>).getGeometry()!;
            const coords = (geom.getCoordinates() as [number, number][]).map((c) => fromMap(c));
            if (coords.length < 2) {
              const cur = designStore.getState().doc.layout.holes.find((h) => h.number === hole);
              if (cur) geom.setCoordinates(cur.route.map((p) => toMap(p as Pt)));
              say("A route needs at least two points.");
            } else {
              setRoute(hole, coords);
            }
          });
        });
        add(editRoute);
      }
    } else if (tool === "route") {
      const draw = new Draw({ type: "LineString" });
      draw.on("drawstart", () => (drawing.current = true));
      draw.on("drawabort", () => (drawing.current = false));
      draw.on("drawend", (e) => {
        drawing.current = false;
        finishRoute(e.feature as Feature<LineString>);
      });
      drawRef.current = draw;
      add(draw);
    } else if (tool === "freehand") {
      const freehand = new FreehandInteraction({ snap: snapPoint, onChange: () => undefined });
      freehandRef.current = freehand;
      add(freehand);
    } else {
      const draw = new Draw({ type: "Polygon", snapTolerance: 12 });
      draw.on("drawstart", () => (drawing.current = true));
      draw.on("drawabort", () => (drawing.current = false));
      draw.on("drawend", (e) => {
        drawing.current = false;
        finishPolygon(e.feature as Feature<Polygon>);
      });
      drawRef.current = draw;
      add(draw);
    }
    // select and polygon snap through OpenLayers; freehand snaps stroke ends itself (snapPoint)
    if (editor.snap && tool !== "freehand") add(new Snap({ source: r.source, pixelTolerance: 10 }));

    return () => {
      for (const i of interactions) {
        const u = (i as unknown as { unsub?: () => void }).unsub;
        if (u) u();
        else map.removeInteraction(i);
      }
      drawRef.current = null;
      freehandRef.current = null;
      drawing.current = false;
    };
  }, [map, active, isBundle, tool, editor.snap, layerReady, say]);

  // ---- commands -----------------------------------------------------------------------------------------------------

  const setClass = (cls: number) => {
    const { editor, patch } = latest.current;
    patch({ activeClass: cls });
    const sel = designStore.getState().selected;
    if (editor.tool === "select" && sel.length) {
      const s = designStore.getState();
      s.begin(`Make ${className(cls).toLowerCase()}`);
      for (const id of sel) updateRegion("", id, { class: cls, hole: OWNED.includes(cls) ? s.doc.regions[id].hole ?? editor.hole : null });
      s.end();
    }
  };
  /** Make a hole active and bring it into view. Holes that do not exist yet are not reachable this way. */
  const goHole = (n: number) => {
    const count = designStore.getState().doc.layout.holes.length;
    if (n > Math.max(1, count)) return say(`There is no hole ${n} yet. Add one with the + button, or press H then N.`);
    const hole = Math.max(1, n);
    latest.current.patch({ hole });
    const view = holeView(designStore.getState().doc, hole);
    if (view && map) flyToRect(map, view);
    else say(`Hole ${hole} has no route or surfaces yet.`);
  };
  const newHole = () => {
    const n = addHole();
    if (n === null) return say("That is the most holes a course can have.");
    latest.current.patch({ hole: n });
    say(`Added hole ${n}. Draw its route with the Route tool (Shift+R).`);
  };
  const assignUnassigned = () => {
    const doc = designStore.getState().doc;
    const found = suggestHoles(doc);
    const n = Object.keys(found).length;
    const left = unassignedCount(doc) - n;
    if (!n) return say(left ? "Nothing to assign: no hole has a route near them yet." : "Every surface already has a hole.");
    assignHoles(found);
    say(`Assigned ${n} surface${n === 1 ? "" : "s"} to the nearest hole${left ? `; ${left} had none near enough` : ""}.`);
  };
  const hasSelection = () => designStore.getState().selected.length > 0;
  const S = "editor:course" as const;
  const sel = "tool:course/select" as const;

  const commands: Command[] = [];
  for (const t of TOOLS) commands.push({ id: `course.tool.${t.id}`, label: `${t.label} tool`, scope: S, keys: [t.key], group: "Tools", run: () => latest.current.patch({ tool: t.id }) });
  for (const c of CLASS_KEYS) commands.push({ id: `course.class.${c.cls}`, label: `${c.label} surface`, scope: S, keys: [c.key], group: "Surfaces", run: () => setClass(c.cls) });
  commands.push(
    { id: "course.hole.next", label: "Next hole", scope: S, keys: ["BracketRight"], group: "Holes", run: () => goHole(latest.current.editor.hole + 1) },
    { id: "course.hole.prev", label: "Previous hole", scope: S, keys: ["BracketLeft"], group: "Holes", run: () => goHole(latest.current.editor.hole - 1) },
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n): Command => ({ id: `course.hole.${n}`, label: `Hole ${n}`, scope: S, keys: [`h ${n}`], group: "Holes", run: () => goHole(n) })),
    { id: "course.hole.new", label: "Add a hole", scope: S, keys: ["h n"], group: "Holes", run: newHole },
    { id: "course.hole.only", label: "Show only the active hole", scope: S, keys: ["h o"], group: "Holes", run: () => latest.current.patch({ hideOthers: !latest.current.editor.hideOthers }) },
    { id: "course.hole.assign", label: "Assign unassigned surfaces to the nearest hole", scope: S, keys: ["h a"], group: "Holes", run: assignUnassigned },
    { id: "course.front", label: "Bring selection to front", scope: S, keys: ["Shift+BracketRight"], group: "Edit", when: hasSelection, run: () => reorderRegions("Bring to front", designStore.getState().selected, "front") },
    { id: "course.back", label: "Send selection to back", scope: S, keys: ["Shift+BracketLeft"], group: "Edit", when: hasSelection, run: () => reorderRegions("Send to back", designStore.getState().selected, "back") },
    { id: "course.delete", label: "Delete selection", scope: sel, keys: ["Delete", "Backspace"], group: "Edit", when: hasSelection, run: () => {
      const ids = designStore.getState().selected;
      designStore.getState().select([]);
      removeRegions(ids.length > 1 ? "Delete regions" : "Delete region", ids);
    } },
    { id: "course.deselect", label: "Clear selection", scope: sel, keys: ["Escape"], group: "Edit", when: hasSelection, run: () => designStore.getState().select([]) },
  );
  const polygon = "tool:course/draw" as const;
  const routeScope = "tool:course/route" as const;
  const freehand = "tool:course/freehand" as const;
  const freehandActive = () => !!freehandRef.current?.isDrawing;
  commands.push(
    { id: "course.draw.cancel", label: "Cancel the outline", scope: polygon, keys: ["Escape"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.abortDrawing() },
    { id: "course.draw.finish", label: "Finish the outline", scope: polygon, keys: ["Enter"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.finishDrawing() },
    { id: "course.draw.back", label: "Remove the last point", scope: polygon, keys: ["Backspace"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.removeLastPoint() },
    { id: "course.route.cancel", label: "Cancel the route", scope: routeScope, keys: ["Escape"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.abortDrawing() },
    { id: "course.route.finish", label: "Finish the route", scope: routeScope, keys: ["Enter"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.finishDrawing() },
    { id: "course.route.back", label: "Remove the last route point", scope: routeScope, keys: ["Backspace"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.removeLastPoint() },
    { id: "course.freehand.cancel", label: "Cancel the outline", scope: freehand, keys: ["Escape"], group: "Drawing", when: freehandActive, run: () => freehandRef.current?.cancel() },
    { id: "course.freehand.finish", label: "Finish the outline", scope: freehand, keys: ["Enter"], group: "Drawing", when: freehandActive, run: () => {
      const pts = freehandRef.current?.finish();
      if (pts) finishFreehandRef.current(pts);
    } },
    { id: "course.freehand.back", label: "Remove the last stroke", scope: freehand, keys: ["Backspace"], group: "Drawing", when: freehandActive, run: () => freehandRef.current?.undoStroke() },
  );
  // leaving a drawing tool with Escape when nothing is being drawn returns to Select
  commands.push({ id: "course.draw.exit", label: "Back to the Select tool", scope: "editor:course", keys: ["Escape"], group: "Tools", when: () => latest.current.editor.tool !== "select" && !drawing.current && !freehandActive(), run: () => latest.current.patch({ tool: "select" }) });

  return { commands, notice, goHole, newHole, assignUnassigned, leftDragPans: !isBundle || !active || tool === "select" };
}
