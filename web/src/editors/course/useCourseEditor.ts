import type Map from "ol/Map";
import type Feature from "ol/Feature";
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
import { cleanFreehand, closeRing, dedupe, selfIntersects } from "../../design/geometry";
import { createRegionLayer, mapRings, OWNED, ringsOf } from "../../design/olRegions";
import { addRegion, designStore, removeRegions, reorderRegions, updateRegion } from "../../design/store";
import type { Scene } from "../../map/scene";

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
  { id: "freehand", label: "Freehand", key: "Shift+D", hint: "Drag to draw; the line is simplified and smoothed when you let go" },
] as const;
export type ToolId = (typeof TOOLS)[number]["id"];

const className = (cls: number) => CLASS_KEYS.find((c) => c.cls === cls)?.label ?? `class ${cls}`;
const MAX_HOLE = 24;

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
  const [layerReady, setLayerReady] = useState(false);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawRef = useRef<Draw | null>(null);
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
    layerRef.current = r;
    map.addLayer(r.layer);
    setLayerReady(true);
    return () => {
      map.removeLayer(r.layer);
      r.dispose();
      layerRef.current = null;
      setLayerReady(false);
    };
  }, [map, isBundle]);

  useEffect(() => {
    layerRef.current?.layer.setVisible(active);
  }, [active, layerReady]);

  // interactions for the active tool
  useEffect(() => {
    const r = layerRef.current;
    if (!map || !r || !active || !isBundle) return;
    const interactions: Interaction[] = [];
    const add = (i: Interaction) => {
      map.addInteraction(i);
      interactions.push(i);
    };

    const finish = (f: Feature<Polygon>, freehand: boolean) => {
      const { editor } = latest.current;
      const { outer } = ringsOf(f);
      const ring = dedupe(freehand ? cleanFreehand(outer, editor.smoothing) : outer);
      if (ring.length < 4) return say("Not enough points for a polygon.");
      if (selfIntersects(ring)) return say("That outline crosses itself, so it was not added. Undo is not needed; just draw it again.");
      const cls = editor.activeClass;
      const id = addRegion(`Draw ${className(cls).toLowerCase()}`, { class: cls, hole: OWNED.includes(cls) ? editor.hole : null, outer: closeRing(ring), inner: [] });
      designStore.getState().select([id]);
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
    } else {
      const draw = new Draw({ type: "Polygon", freehand: tool === "freehand", snapTolerance: 12 });
      draw.on("drawstart", () => (drawing.current = true));
      draw.on("drawabort", () => (drawing.current = false));
      draw.on("drawend", (e) => {
        drawing.current = false;
        finish(e.feature as Feature<Polygon>, tool === "freehand");
      });
      drawRef.current = draw;
      add(draw);
    }
    if (editor.snap) add(new Snap({ source: r.source, pixelTolerance: 10 }));

    return () => {
      for (const i of interactions) {
        const u = (i as unknown as { unsub?: () => void }).unsub;
        if (u) u();
        else map.removeInteraction(i);
      }
      drawRef.current = null;
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
  const setHole = (n: number) => latest.current.patch({ hole: Math.min(MAX_HOLE, Math.max(1, n)) });
  const hasSelection = () => designStore.getState().selected.length > 0;
  const S = "editor:course" as const;
  const sel = "tool:course/select" as const;

  const commands: Command[] = [];
  for (const t of TOOLS) commands.push({ id: `course.tool.${t.id}`, label: `${t.label} tool`, scope: S, keys: [t.key], group: "Tools", run: () => latest.current.patch({ tool: t.id }) });
  for (const c of CLASS_KEYS) commands.push({ id: `course.class.${c.cls}`, label: `${c.label} surface`, scope: S, keys: [c.key], group: "Surfaces", run: () => setClass(c.cls) });
  commands.push(
    { id: "course.hole.next", label: "Next hole", scope: S, keys: ["BracketRight"], group: "Holes", run: () => setHole(latest.current.editor.hole + 1) },
    { id: "course.hole.prev", label: "Previous hole", scope: S, keys: ["BracketLeft"], group: "Holes", run: () => setHole(latest.current.editor.hole - 1) },
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n): Command => ({ id: `course.hole.${n}`, label: `Hole ${n}`, scope: S, keys: [`h ${n}`], group: "Holes", run: () => setHole(n) })),
    { id: "course.front", label: "Bring selection to front", scope: S, keys: ["Shift+BracketRight"], group: "Edit", when: hasSelection, run: () => reorderRegions("Bring to front", designStore.getState().selected, "front") },
    { id: "course.back", label: "Send selection to back", scope: S, keys: ["Shift+BracketLeft"], group: "Edit", when: hasSelection, run: () => reorderRegions("Send to back", designStore.getState().selected, "back") },
    { id: "course.delete", label: "Delete selection", scope: sel, keys: ["Delete", "Backspace"], group: "Edit", when: hasSelection, run: () => {
      const ids = designStore.getState().selected;
      designStore.getState().select([]);
      removeRegions(ids.length > 1 ? "Delete regions" : "Delete region", ids);
    } },
    { id: "course.deselect", label: "Clear selection", scope: sel, keys: ["Escape"], group: "Edit", when: hasSelection, run: () => designStore.getState().select([]) },
  );
  for (const t of ["draw", "freehand"]) {
    const T = `tool:course/${t}` as const;
    commands.push(
      { id: `course.${t}.cancel`, label: "Cancel the outline", scope: T, keys: ["Escape"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.abortDrawing() },
      { id: `course.${t}.finish`, label: "Finish the outline", scope: T, keys: ["Enter"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.finishDrawing() },
      { id: `course.${t}.back`, label: "Remove the last point", scope: T, keys: ["Backspace"], group: "Drawing", when: () => drawing.current, run: () => drawRef.current?.removeLastPoint() },
    );
  }
  // leaving a drawing tool with Escape when nothing is being drawn returns to Select
  commands.push({ id: "course.draw.exit", label: "Back to the Select tool", scope: "editor:course", keys: ["Escape"], group: "Tools", when: () => latest.current.editor.tool !== "select" && !drawing.current, run: () => latest.current.patch({ tool: "select" }) });

  return { commands, notice, leftDragPans: !isBundle || !active || tool === "select" };
}
