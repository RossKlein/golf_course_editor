import type Map from "ol/Map";
import type Feature from "ol/Feature";
import type LineString from "ol/geom/LineString";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import { useEffect, useMemo, useRef } from "react";
import type { EditorState } from "../../core/api/api";
import type { Command } from "../../commands/keymap";
import { nearestVertex, withoutLineVertex } from "../../core/geometry/geometry";
import { suggestHoles, unassignedCount } from "../../model/design/holes";
import { OWNED } from "../../views/map2d/design/olRegions";
import type { DesignLayers } from "../../views/map2d/design/useDesignLayers";
import { addRegion, assignHoles, designStore, removeRegions, reorderRegions, setRoute, updateRegion, useDesign } from "../../model/design/store";
import { fromMap, toMap, type Pt } from "../../core/geometry/coords";
import { holeCommands, makeHoleNav } from "../_shared/holeNav";
import { installPolygonTools, polygonCommands, type Corner, type PolygonControls, type PolygonTarget } from "../_shared/polygonTools";

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
  { id: "select", label: "Select", key: "v", hint: "Click a region to select it. Drag a corner to move it, drag along an edge to add a point. Right-click a corner to remove it, or inside a region to delete it" },
  { id: "draw", label: "Polygon", key: "d", hint: "Click to add points; click the first point or press Enter to finish" },
  { id: "freehand", label: "Freehand", key: "Shift+D", hint: "Drag to draw, lift and keep going as often as you like. Enter finishes the outline, Backspace removes the last stroke, Esc cancels. Middle-drag pans." },
  { id: "route", label: "Route", key: "Shift+R", hint: "Click along the active hole from tee to green, replacing its route. Enter or double-click finishes, Backspace removes the last point, Esc cancels" },
] as const;
export type ToolId = (typeof TOOLS)[number]["id"];

const className = (cls: number) => CLASS_KEYS.find((c) => c.cls === cls)?.label ?? `class ${cls}`;

type Props = {
  map: Map | null;
  layers: DesignLayers | null;
  /** The Course editor is the open editor. */
  active: boolean;
  editor: EditorState;
  patch: (p: Partial<EditorState>) => void;
  say: (text: string) => void;
};

/**
 * The Course editor: the interactions for the active tool and the keyboard commands. The store is the document and the
 * layers (see useDesignLayers) mirror it; everything here turns map gestures into store actions.
 */
export function useCourseEditor({ map, layers, active, editor, patch, say }: Props) {
  const holeCount = useDesign((s) => s.doc.layout.holes.length);
  const drawRef = useRef<Draw | null>(null); // the route tool's
  const controlsRef = useRef<PolygonControls | null>(null);
  const drawing = useRef(false);
  const latest = useRef({ editor, patch });
  latest.current = { editor, patch };
  const tool = editor.tool as ToolId;

  // removing holes can leave the active one past the end
  useEffect(() => {
    if (active && editor.hole > Math.max(1, holeCount)) latest.current.patch({ hole: Math.max(1, holeCount) });
  }, [active, holeCount, editor.hole]);

  // interactions for the active tool
  useEffect(() => {
    if (!map || !layers || !active) return;
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
        const id = addRegion(`Draw ${className(cls).toLowerCase()}`, { class: cls, hole: OWNED.includes(cls) ? editor.hole : null, outer: ring, inner: [] });
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
    } else {
      const tools = installPolygonTools({ map, tool, target, snap: editor.snap, smoothing: () => latest.current.editor.smoothing, say });
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
      drawing.current = false;
    };
  }, [map, layers, active, tool, editor.snap, say]);

  // ---- commands -----------------------------------------------------------------------------------------------------

  const nav = useMemo(() => makeHoleNav({ map, patch: (p) => latest.current.patch(p), say, added: "Draw its route with the Route tool (Shift+R)." }), [map, say]);

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
  const routeScope = "tool:course/route" as const;
  const onRegions = (id: string) => !!designStore.getState().doc.regions[id];

  const commands: Command[] = [];
  for (const t of TOOLS) commands.push({ id: `course.tool.${t.id}`, label: `${t.label} tool`, scope: S, keys: [t.key], group: "Tools", run: () => latest.current.patch({ tool: t.id }) });
  for (const c of CLASS_KEYS) commands.push({ id: `course.class.${c.cls}`, label: `${c.label} surface`, scope: S, keys: [c.key], group: "Surfaces", run: () => setClass(c.cls) });
  commands.push(
    ...holeCommands("course", () => nav, () => latest.current.editor.hole),
    { id: "course.hole.only", label: "Show only the active hole", scope: S, keys: ["h o"], group: "Holes", run: () => latest.current.patch({ hideOthers: !latest.current.editor.hideOthers }) },
    { id: "course.hole.assign", label: "Assign unassigned surfaces to the nearest hole", scope: S, keys: ["h a"], group: "Holes", run: assignUnassigned },
    { id: "course.front", label: "Bring selection to front", scope: S, keys: ["Shift+BracketRight"], group: "Edit", when: hasSelection, run: () => reorderRegions("Bring to front", designStore.getState().selected, "front") },
    { id: "course.back", label: "Send selection to back", scope: S, keys: ["Shift+BracketLeft"], group: "Edit", when: hasSelection, run: () => reorderRegions("Send to back", designStore.getState().selected, "back") },
    { id: "course.route.cancel", label: "Cancel the route", scope: routeScope, keys: ["Escape"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.abortDrawing() },
    { id: "course.route.finish", label: "Finish the route", scope: routeScope, keys: ["Enter"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.finishDrawing() },
    { id: "course.route.back", label: "Remove the last route point", scope: routeScope, keys: ["Backspace"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.removeLastPoint() },
    ...polygonCommands({
      editor: "course",
      controls: () => controlsRef.current,
      otherBusy: () => drawing.current,
      tool: () => latest.current.editor.tool,
      setTool: (id) => latest.current.patch({ tool: id }),
      hasSelection,
      deleteSelected: () => {
        const ids = designStore.getState().selected.filter(onRegions);
        designStore.getState().select([]);
        removeRegions(ids.length > 1 ? "Delete regions" : "Delete region", ids);
      },
    }),
  );

  return { commands, goHole: nav.goHole, newHole: nav.newHole, assignUnassigned, leftDragPans: !active || tool === "select" };
}
