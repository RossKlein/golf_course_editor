import type Map from "ol/Map";
import type Feature from "ol/Feature";
import type LineString from "ol/geom/LineString";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import { useEffect, useMemo, useRef } from "react";
import type { EditorState } from "../../core/api/api";
import type { Command } from "../../commands/keymap";
import { nearestVertex, snapToRings, withoutLineVertex } from "../../core/geometry/geometry";
import { suggestHoles, unassignedCount } from "../../model/design/holes";
import { OWNED } from "../../views/map2d/design/olRegions";
import type { DesignLayers } from "../../views/map2d/design/useDesignLayers";
import { addRegion, assignHoles, designStore, removeRegions, reorderRegions, setRoute, updateRegion, useDesign } from "../../model/design/store";
import { cutRegions } from "../../model/design/cut";
import { roundRegions } from "../../model/design/round";
import { Fill, Stroke, Style } from "ol/style";
import { fromMap, toMap, type Pt } from "../../core/geometry/coords";
import { useFormatter } from "../../ui/useUnits";
import { holeCommands, makeHoleNav } from "../_shared/holeNav";
import { installPathTool } from "./pathTool";
import { addCollars } from "../../model/design/collar";
import { installPolygonTools, polygonCommands, type Corner, type PolygonControls, type PolygonTarget } from "../_shared/polygonTools";
import { setMeasureLabel } from "./measure";
import { MeasureInteraction } from "./measureTool";

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
  { cls: 255, key: "n", label: "Void" }, // no ground at all (n for nothing)
];

export const TOOLS = [
  { id: "select", label: "Select", key: "v", hint: "Click a region to select it. Drag a corner to move it, drag along an edge to add a point. Ctrl+drag a selected region to move all of it. Right-click a corner to remove it, or inside a region to delete it. Shift+O adds points to the selected regions to round them" },
  { id: "draw", label: "Polygon", key: "d", hint: "Click to add points; click the first point or press Enter to finish" },
  { id: "freehand", label: "Freehand", key: "Shift+D", hint: "Drag to draw, lift and keep going as often as you like. Enter finishes the outline, Backspace removes the last stroke, Esc cancels. Middle-drag pans." },
  { id: "cut", label: "Cut", key: "x", hint: "Draw an outline to cut out of the selected regions, or out of every region it touches when none is selected. Click to add points; click the first point or press Enter to finish. A cut across a region leaves two. Esc cancels" },
  { id: "path", label: "Path", key: "Shift+P", hint: "Draw the line a path follows: click points, drag freehand, or both. Enter makes it a path of the width set here, with smooth edges and round ends; Backspace removes the last stroke, Esc cancels. Raise Simplify to smooth a shaky hand" },
  { id: "route", label: "Route", key: "Shift+R", hint: "Click along the active hole from tee to green, replacing its route. Enter or double-click finishes, Backspace removes the last point, Esc cancels" },
  { id: "measure", label: "Measure", key: "m", hint: "Click points to measure the horizontal distance. Drag pans. Double-click or Enter finishes, Backspace removes the last point, Esc clears" },
] as const;
export type ToolId = (typeof TOOLS)[number]["id"];

/** The outline of a cut while it is drawn: red, so it is not mistaken for a new surface. */
const CUT_SKETCH = new Style({ fill: new Fill({ color: "rgba(255, 90, 70, 0.22)" }), stroke: new Stroke({ color: "rgba(255, 90, 70, 0.95)", width: 2, lineDash: [6, 4] }) });

const className = (cls: number) => CLASS_KEYS.find((c) => c.cls === cls)?.label ?? `class ${cls}`;

type Props = {
  map: Map | null;
  layers: DesignLayers | null;
  /** The Course editor is the open editor. */
  active: boolean;
  editor: EditorState;
  patch: (p: Partial<EditorState>) => void;
  say: (text: string) => void;
  /** A range has one tee and any number of greens and fairways, so new surfaces are not assigned to a hole. */
  isRange: boolean;
};

/**
 * The Course editor: the interactions for the active tool and the keyboard commands. The store is the document and the
 * layers (see useDesignLayers) mirror it; everything here turns map gestures into store actions.
 */
export function useCourseEditor({ map, layers, active, editor, patch, say, isRange }: Props) {
  const holeCount = useDesign((s) => s.doc.layout.holes.length);
  const drawRef = useRef<Draw | null>(null); // the route tool's
  const controlsRef = useRef<PolygonControls | null>(null);
  const measureRef = useRef<MeasureInteraction | null>(null);
  const pathRef = useRef<{ redraw: () => void } | null>(null);
  const drawing = useRef(false);
  const fmt = useFormatter();
  const fmtRef = useRef(fmt);
  fmtRef.current = fmt;
  const latest = useRef({ editor, patch, isRange });
  latest.current = { editor, patch, isRange };
  const tool = editor.tool as ToolId;

  // removing holes can leave the active one past the end
  useEffect(() => {
    if (active && editor.hole > Math.max(1, holeCount)) latest.current.patch({ hole: Math.max(1, holeCount) });
  }, [active, holeCount, editor.hole]);

  // interactions for the active tool
  useEffect(() => {
    if (!map || !layers || !active || tool === "measure") return;
    const { regions, routes } = layers;
    const doc = () => designStore.getState().doc;

    const target: PolygonTarget = {
      noun: "region",
      layer: regions.layer,
      source: regions.source,
      find: (id) => doc().regions[id] as { id: string; outer: Pt[]; inner: Pt[][] } | undefined,
      create: (ring) => {
        const { editor } = latest.current;
        const cls = editor.activeClass;
        const id = addRegion(`Draw ${className(cls).toLowerCase()}`, { class: cls, hole: OWNED.includes(cls) && !latest.current.isRange ? editor.hole : null, outer: ring, inner: [] });
        designStore.getState().select([id]);
      },
      update: (label, id, rings) => updateRegion(label, id, rings),
      remove: (ids) => removeRegions(ids.length > 1 ? "Delete regions" : "Delete region", ids),
      snapRings: () => {
        const d = doc();
        return d.order.flatMap((id) => [d.regions[id].outer as Pt[], ...(d.regions[id].inner as Pt[][])]);
      },
      extraCorners: (p, near, tol) => {
        const corners: Corner[] = [];
        for (const f of routes.source.getFeaturesInExtent(near)) {
          const number = f.get("number") as number;
          const route = doc().layout.holes.find((h) => h.number === number)?.route as Pt[] | undefined;
          const v = route && nearestVertex(route, p, tol);
          if (!route || !v) continue;
          const cut = withoutLineVertex(route, v.index);
          corners.push({ distance: v.distance, blocked: "A route needs at least two points.", remove: () => cut && setRoute(number, cut) });
        }
        return corners;
      },
    };

    // a cut is drawn like a polygon, and what is drawn is taken out of the regions instead of being added
    const cutTarget: PolygonTarget = {
      ...target,
      noun: "cut",
      create: (ring) => {
        const selected = designStore.getState().selected.filter((id) => !!doc().regions[id]);
        const s = cutRegions("Cut", ring, selected.length ? selected : undefined);
        if (!s.touched) return say(selected.length ? "That outline does not touch the selected regions." : "That outline does not touch any region.");
        const more = [s.created ? `split into ${s.created} more` : "", s.removed ? `${s.removed} cut away entirely` : ""].filter(Boolean).join(", ");
        say(`Cut ${s.touched} region${s.touched === 1 ? "" : "s"}${more ? `: ${more}` : ""}. Ctrl+Z puts it back.`);
      },
    };

    const cleanups: (() => void)[] = [];
    if (tool === "route") {
      const draw = new Draw({ type: "LineString" });
      draw.on("drawstart", () => (drawing.current = true));
      draw.on("drawabort", () => (drawing.current = false));
      draw.on("drawend", (e) => {
        drawing.current = false;
        const pts = ((e.feature as Feature<LineString>).getGeometry()!.getCoordinates() as [number, number][]).map((c) => fromMap(c));
        const route = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
        if (route.length < 2) return say("A route needs at least two points.");
        const hole = latest.current.editor.hole;
        setRoute(hole, route);
        say(`Route set for hole ${hole}.`);
      });
      drawRef.current = draw;
      map.addInteraction(draw);
      cleanups.push(() => map.removeInteraction(draw));
    } else if (tool === "path") {
      const path = installPathTool({
        map, snap: editor.snap, snapRings: target.snapRings, width: () => latest.current.editor.pathWidth, smoothing: () => latest.current.editor.smoothing, say,
      });
      controlsRef.current = path.controls;
      pathRef.current = path;
      cleanups.push(path.dispose);
    } else {
      const cutting = tool === "cut";
      const tools = installPolygonTools({
        map, tool: cutting ? "draw" : tool, target: cutting ? cutTarget : target, snap: editor.snap, smoothing: () => latest.current.editor.smoothing, say, sketch: cutting ? CUT_SKETCH : undefined,
      });
      controlsRef.current = tools.controls;
      cleanups.push(tools.dispose);
      if (tool === "select") {
        // routes can be reshaped from here too
        const editRoute = new Modify({ source: routes.source });
        editRoute.on("modifyend", (e) => {
          e.features.forEach((f) => {
            const hole = f.get("number") as number;
            const geom = (f as Feature<LineString>).getGeometry()!;
            const coords = (geom.getCoordinates() as [number, number][]).map((c) => fromMap(c));
            if (coords.length < 2) {
              const cur = doc().layout.holes.find((h) => h.number === hole);
              if (cur) geom.setCoordinates(cur.route.map((p) => toMap(p as Pt)));
              say("A route needs at least two points.");
            } else {
              setRoute(hole, coords);
            }
          });
        });
        map.addInteraction(editRoute);
        cleanups.push(() => map.removeInteraction(editRoute));
      }
    }

    return () => {
      cleanups.forEach((c) => c());
      drawRef.current = null;
      controlsRef.current = null;
      pathRef.current = null;
      drawing.current = false;
    };
  }, [map, layers, active, tool, editor.snap, say]);

  // the path being drawn is shown at the width the slider says
  useEffect(() => pathRef.current?.redraw(), [editor.pathWidth, editor.smoothing]);

  // The measure tool draws nothing into the design, so it stays off the polygon interactions above. Snap is read when
  // the pointer moves, which is why turning Snap on does not wipe the line already drawn.
  useEffect(() => {
    if (!map || !active || tool !== "measure") return;
    const measure = new MeasureInteraction({
      snap: (c) => {
        if (!latest.current.editor.snap) return c;
        const tol = (map.getView().getResolution() ?? 1) * 10;
        const p = fromMap(c);
        const d = designStore.getState().doc;
        const rings: Pt[][] = [];
        for (const id of d.order) {
          const r = d.regions[id];
          rings.push(r.outer as Pt[], ...(r.inner as Pt[][]));
        }
        for (const h of d.layout.holes) if (h.route.length) rings.push(h.route as Pt[]);
        return toMap(snapToRings(p, rings, tol));
      },
      format: (m) => fmtRef.current.distance(m),
      onReadout: setMeasureLabel,
      say,
    });
    measureRef.current = measure;
    map.addInteraction(measure);
    const el = map.getTargetElement();
    const prevCursor = el?.style.cursor ?? "";
    if (el) el.style.cursor = "crosshair";
    return () => {
      measureRef.current = null;
      map.removeInteraction(measure);
      setMeasureLabel("");
      if (el) el.style.cursor = prevCursor;
    };
  }, [map, active, tool, say]);

  useEffect(() => {
    measureRef.current?.redraw();
  }, [fmt]);

  // ---- commands -----------------------------------------------------------------------------------------------------

  const nav = useMemo(() => makeHoleNav({ map, patch: (p) => latest.current.patch(p), say, added: "Draw its route with the Route tool (Shift+R)." }), [map, say]);

  const setClass = (cls: number) => {
    const { editor, patch } = latest.current;
    patch({ activeClass: cls });
    const sel = designStore.getState().selected;
    if (editor.tool === "select" && sel.length) {
      const s = designStore.getState();
      s.begin(`Make ${className(cls).toLowerCase()}`);
      for (const id of sel) updateRegion("", id, { class: cls, hole: OWNED.includes(cls) && !latest.current.isRange ? s.doc.regions[id].hole ?? editor.hole : null });
      s.end();
    }
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
  const roundSelected = () => {
    const doc = designStore.getState().doc;
    const ids = designStore.getState().selected.filter((id) => !!doc.regions[id]);
    if (!ids.length) return say("Select a region to round first.");
    const r = roundRegions(ids.length > 1 ? "Round regions" : "Round region", ids);
    if (r.rounded) {
      const skipped = [r.crossed ? `${r.crossed} left alone: rounding would make its outline cross itself` : "", r.fine ? `${r.fine} had no edge long enough to add to` : ""].filter(Boolean).join("; ");
      return say(`Rounded ${r.rounded} region${r.rounded === 1 ? "" : "s"}: ${r.added} points added${skipped ? `; ${skipped}` : ""}. Press again for more points; Ctrl+Z undoes one press.`);
    }
    say(r.crossed ? "Rounding would make that outline cross itself, so it was left as it is. Move some corners apart first." : "Every edge is already shorter than half a metre, so there is nothing to add to.");
  };
  const collar = () => {
    const doc = designStore.getState().doc;
    const sel = designStore.getState().selected.filter((id) => doc.regions[id]?.class === 2);
    const thickness = latest.current.editor.collarThickness;
    const s = addCollars(sel.length > 1 ? "Add collars" : "Add collar", thickness, sel.length ? sel : undefined);
    const had = s.had ? ` ${s.had} already had one all round.` : "";
    if (!s.made) return say(s.had ? `Nothing to add.${had}` : "There is no green to give a collar. Paint one first.");
    say(`Added a collar to ${s.made} green${s.made === 1 ? "" : "s"}, ${thickness} m thick, under each green.${had} Ctrl+Z takes it back; Select it to reshape it.`);
  };
  const S = "editor:course" as const;
  const routeScope = "tool:course/route" as const;
  const measureScope = "tool:course/measure" as const;
  const onRegions = (id: string) => !!designStore.getState().doc.regions[id];

  const commands: Command[] = [];
  for (const t of TOOLS) commands.push({ id: `course.tool.${t.id}`, label: `${t.label} tool`, scope: S, keys: [t.key], group: "Tools", run: () => latest.current.patch({ tool: t.id }) });
  for (const c of CLASS_KEYS) commands.push({ id: `course.class.${c.cls}`, label: `${c.label} surface`, scope: S, keys: [c.key], group: "Surfaces", run: () => setClass(c.cls) });
  commands.push(
    ...holeCommands("course", () => nav, () => latest.current.editor.hole),
    { id: "course.hole.only", label: "Show only the active hole", scope: S, keys: ["h o"], group: "Holes", run: () => latest.current.patch({ hideOthers: !latest.current.editor.hideOthers }) },
    { id: "course.hole.assign", label: "Assign unassigned surfaces to the nearest hole", scope: S, keys: ["h a"], group: "Holes", run: assignUnassigned },
    { id: "course.collar", label: "Add a collar round the selected greens (or every green)", scope: S, keys: ["Shift+K"], group: "Edit", run: collar },
    { id: "course.round", label: "Round selected regions (add points)", scope: S, keys: ["Shift+O"], group: "Edit", when: hasSelection, run: roundSelected },
    { id: "course.front", label: "Bring selection to front", scope: S, keys: ["Shift+BracketRight"], group: "Edit", when: hasSelection, run: () => reorderRegions("Bring to front", designStore.getState().selected, "front") },
    { id: "course.back", label: "Send selection to back", scope: S, keys: ["Shift+BracketLeft"], group: "Edit", when: hasSelection, run: () => reorderRegions("Send to back", designStore.getState().selected, "back") },
    { id: "course.route.cancel", label: "Cancel the route", scope: routeScope, keys: ["Escape"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.abortDrawing() },
    { id: "course.route.finish", label: "Finish the route", scope: routeScope, keys: ["Enter"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.finishDrawing() },
    { id: "course.route.back", label: "Remove the last route point", scope: routeScope, keys: ["Backspace"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.removeLastPoint() },
    { id: "course.measure.finish", label: "Finish the measurement", scope: measureScope, keys: ["Enter"], group: "Drawing", when: () => !!measureRef.current?.isDrawing, run: () => measureRef.current?.finish() },
    { id: "course.measure.back", label: "Remove the last measure point", scope: measureScope, keys: ["Backspace"], group: "Drawing", when: () => !!measureRef.current?.hasPoints, run: () => measureRef.current?.back() },
    { id: "course.measure.clear", label: "Clear the measurement", scope: measureScope, keys: ["Escape"], group: "Drawing", when: () => !!measureRef.current?.hasPoints, run: () => measureRef.current?.cancel() },
    ...polygonCommands({
      editor: "course",
      controls: () => controlsRef.current,
      otherBusy: () => drawing.current || !!measureRef.current?.hasPoints,
      tool: () => latest.current.editor.tool,
      setTool: (id) => latest.current.patch({ tool: id }),
      alsoPolygon: ["cut", "path"],
      hasSelection,
      deleteSelected: () => {
        const ids = designStore.getState().selected.filter(onRegions);
        designStore.getState().select([]);
        removeRegions(ids.length > 1 ? "Delete regions" : "Delete region", ids);
      },
    }),
  );

  return { commands, goHole: nav.goHole, newHole: nav.newHole, assignUnassigned, roundSelected, collar, leftDragPans: !active || tool === "select" || tool === "measure" };
}
