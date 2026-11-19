import type Map from "ol/Map";
import Feature from "ol/Feature";
import Circle from "ol/geom/Circle";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { RegularShape, Stroke as LineStyle, Style } from "ol/style";
import Point from "ol/geom/Point";
import { useEffect, useMemo, useRef } from "react";
import type { EditorState } from "../../core/api/api";
import type { Command } from "../../commands/keymap";
import { BRUSHES, MAX_RADIUS, MIN_RADIUS, resized, type Brush, type BrushKind } from "../../terrain/sculpt/brush";
import type { TerrainSource } from "../../scene/scene";
import type { GroundTool } from "../../scene/groundTool";
import { fromMap, toMap, type Pt } from "../../core/geometry/coords";
import { Stroke } from "./stroke";
import { BASIN_TOOL, isBrushTool, MESH_TOOLS, TRAP_TOOL } from "./tools";

type Props = {
  map: Map | null;
  terrain: TerrainSource | undefined;
  /** The Heightmap editor is the open editor. */
  active: boolean;
  /** The 3D view is showing instead of the map. */
  view3d: boolean;
  editor: EditorState;
  patch: (p: Partial<EditorState>) => void;
  say: (text: string) => void;
};

const isBrush = (id: string): id is BrushKind => BRUSHES.some((b) => b.id === id);
const brushOf = (e: EditorState): Brush => ({ kind: isBrush(e.tool) ? e.tool : "raise", radius: e.brushRadius, hardness: e.brushHardness, strength: e.brushStrength });

const ring = (color: string, width: number, dash?: number[]) => new Style({ stroke: new LineStyle({ color, width, lineDash: dash }) });
const OUTER = [ring("rgba(0, 0, 0, 0.6)", 4), ring("#ffffff", 1.5)];
const INNER = [ring("rgba(0, 0, 0, 0.45)", 3, [4, 4]), ring("rgba(255, 255, 255, 0.9)", 1, [4, 4])];
const SOURCE_OUTER = [ring("rgba(0, 0, 0, 0.6)", 4), ring("#ffd24a", 1.5)];
const SOURCE_INNER = [ring("rgba(0, 0, 0, 0.45)", 3, [4, 4]), ring("rgba(255, 210, 74, 0.9)", 1, [4, 4])];
/** A cross on the spot the clone brush copies from. */
const SOURCE = [
  new Style({ image: new RegularShape({ points: 4, radius: 11, radius2: 0, angle: 0, stroke: new LineStyle({ color: "rgba(0, 0, 0, 0.75)", width: 5 }) }) }),
  new Style({ image: new RegularShape({ points: 4, radius: 11, radius2: 0, angle: 0, stroke: new LineStyle({ color: "#ffd24a", width: 2 }) }) }),
];

/**
 * The Heightmap editor: a round brush that raises, lowers, smooths, flattens or restores the terrain. It works in either
 * view. On the map it listens to the pointer itself and draws its ring; in 3D it hands the view a `GroundTool` and the view
 * finds the ground under the pointer. Either way the stroke is the same (see Stroke), and the work is on the GPU (see Sculptor).
 */
export function useHeightEditor({ map, terrain, active, view3d, editor, patch, say }: Props) {
  const session = terrain?.sculpt;
  const latest = useRef({ editor, patch, say });
  latest.current = { editor, patch, say };
  const cursor = useRef<{ move: (p: Pt | null) => void } | null>(null);
  const stroke = useMemo(
    () =>
      session && terrain
        ? new Stroke({
            session,
            ground: terrain.ground,
            brush: () => brushOf(latest.current.editor),
            clone: { relative: () => latest.current.editor.cloneRelative, say: (t) => latest.current.say(t) },
          })
        : null,
    [session, terrain],
  );

  useEffect(() => {
    if (!session) return;
    session.onError = (message) => message && latest.current.say(message);
    return () => {
      session.onError = () => {};
    };
  }, [session]);

  // on the map, the brush ring follows the pointer, and holding the button sculpts
  const onMap = active && !view3d;
  useEffect(() => {
    if (!map || !stroke || !onMap) return;
    const viewport = map.getViewport() as HTMLElement;
    const source = new VectorSource();
    const outer = new Feature(new Circle([0, 0], 1));
    const inner = new Feature(new Circle([0, 0], 1));
    outer.setStyle(OUTER);
    inner.setStyle(INNER);
    // where the clone brush copies from: a ring the brush's size, with a cross in the middle
    const cross = new Feature(new Point([0, 0]));
    cross.setStyle(SOURCE);
    const sourceOuter = new Feature<Circle>();
    const sourceInner = new Feature<Circle>();
    sourceOuter.setStyle(SOURCE_OUTER);
    sourceInner.setStyle(SOURCE_INNER);
    source.addFeatures([sourceOuter, sourceInner, outer, inner, cross]);
    const layer = new VectorLayer({ source, zIndex: 1000, updateWhileInteracting: true, updateWhileAnimating: true });
    layer.setVisible(false);
    map.addLayer(layer);

    let pointer: Pt | null = null;
    // the clone brush's source: where it was picked, or, while painting, where it is copying from now
    const markSource = () => {
      const spot = latest.current.editor.tool === "clone" ? stroke.spot(pointer) : null;
      const b = brushOf(latest.current.editor);
      const c = spot ? toMap(spot) : null;
      cross.setGeometry(c ? new Point(c) : undefined);
      sourceOuter.setGeometry(c ? new Circle(c, b.radius) : undefined);
      sourceInner.setGeometry(c ? new Circle(c, Math.max(0.01, b.radius * b.hardness)) : undefined);
      layer.changed();
    };
    stroke.onSource = () => markSource();
    const place = () => {
      if (!isBrushTool(latest.current.editor.tool)) return layer.setVisible(false); // the basin and the mesh tools have no brush to show
      layer.setVisible(true);
      // the ring follows the pointer and is gone when it is off the map; the clone's source stays where it was picked
      outer.setStyle(pointer ? OUTER : null);
      inner.setStyle(pointer ? INNER : null);
      if (pointer) {
        const b = brushOf(latest.current.editor);
        const c = toMap(pointer);
        (outer.getGeometry() as Circle).setCenterAndRadius(c, b.radius);
        (inner.getGeometry() as Circle).setCenterAndRadius(c, Math.max(0.01, b.radius * b.hardness));
      }
      markSource();
    };
    cursor.current = { move: (p) => ((pointer = p), place()) };

    const at = (e: PointerEvent): Pt => fromMap(map.getEventCoordinate(e) as Pt);

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || map.get("spacePan") || !isBrushTool(latest.current.editor.tool)) return;
      pointer = at(e);
      viewport.setPointerCapture(e.pointerId);
      stroke.begin(() => pointer, e.shiftKey, performance.now(), e.ctrlKey);
      markSource();
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      pointer = at(e);
      stroke.shift(e.shiftKey);
      place();
    };
    const finish = () => {
      stroke.end();
      markSource();
    };
    const onLeave = () => {
      if (stroke.active) return;
      pointer = null;
      place();
    };

    viewport.addEventListener("pointerdown", onDown);
    viewport.addEventListener("pointermove", onMove);
    viewport.addEventListener("pointerup", finish);
    viewport.addEventListener("pointercancel", finish);
    viewport.addEventListener("pointerleave", onLeave);
    return () => {
      finish();
      viewport.removeEventListener("pointerdown", onDown);
      viewport.removeEventListener("pointermove", onMove);
      viewport.removeEventListener("pointerup", finish);
      viewport.removeEventListener("pointercancel", finish);
      viewport.removeEventListener("pointerleave", onLeave);
      stroke.onSource = () => {};
      map.removeLayer(layer);
      cursor.current = null;
    };
  }, [map, stroke, onMap]);

  // changing the brush with the keys or sliders redraws the ring where it is
  useEffect(() => cursor.current?.move(null), [editor.brushRadius, editor.brushHardness, editor.tool, onMap]);

  // in 3D the view does the pointing; this is what it is handed. A stroke does not outlive the tool. The basin takes no strokes.
  const brushing = isBrushTool(editor.tool);
  const tool3d = useMemo<GroundTool | undefined>(
    () =>
      active && view3d && stroke && brushing
        ? {
            ring: { radius: editor.brushRadius, hardness: editor.brushHardness },
            // the clone brush's source, as a ring of the brush's size: where it was picked, or where it is copying from during a stroke
            marks: (pointer) => {
              const spot = editor.tool === "clone" ? stroke.spot(pointer) : null;
              return spot ? [{ at: spot, ring: { radius: editor.brushRadius, hardness: editor.brushHardness } }] : [];
            },
            begin: (where, shift, ctrl) => stroke.begin(where, shift, performance.now(), ctrl), shift: (down) => stroke.shift(down), end: () => stroke.end() }
        : undefined,
    [active, view3d, stroke, brushing, editor.tool, editor.brushRadius, editor.brushHardness],
  );
  const handedOver = !!tool3d;
  useEffect(() => () => stroke?.end(), [stroke, handedOver]);

  const S = "editor:heightmap" as const;
  const commands: Command[] = [];
  for (const b of BRUSHES) commands.push({ id: `height.tool.${b.id}`, label: `${b.label} brush`, scope: S, keys: [b.key], group: "Brushes", run: () => latest.current.patch({ tool: b.id }) });
  commands.push(
    { id: `height.tool.${BASIN_TOOL.id}`, label: BASIN_TOOL.label, scope: S, keys: [BASIN_TOOL.key], group: "Brushes", run: () => latest.current.patch({ tool: BASIN_TOOL.id }) },
    { id: `height.tool.${TRAP_TOOL.id}`, label: TRAP_TOOL.label, scope: S, keys: [TRAP_TOOL.key], group: "Brushes", run: () => latest.current.patch({ tool: TRAP_TOOL.id }) },
    ...MESH_TOOLS.map((t): Command => ({ id: `height.tool.${t.id}`, label: `${t.label} tool`, scope: S, keys: [t.key], group: "Map shape", run: () => latest.current.patch({ tool: t.id }) })),
    { id: "height.bigger", label: "Bigger brush", scope: S, keys: ["BracketRight"], group: "Brushes", run: () => latest.current.patch({ brushRadius: resized(latest.current.editor.brushRadius, true) }) },
    { id: "height.smaller", label: "Smaller brush", scope: S, keys: ["BracketLeft"], group: "Brushes", run: () => latest.current.patch({ brushRadius: resized(latest.current.editor.brushRadius, false) }) },
    { id: "height.stronger", label: "Stronger brush", scope: S, keys: ["Shift+BracketRight"], group: "Brushes", run: () => latest.current.patch({ brushStrength: Math.min(1, +(latest.current.editor.brushStrength * 1.25).toFixed(3)) }) },
    { id: "height.weaker", label: "Weaker brush", scope: S, keys: ["Shift+BracketLeft"], group: "Brushes", run: () => latest.current.patch({ brushStrength: Math.max(0.02, +(latest.current.editor.brushStrength / 1.25).toFixed(3)) }) },
  );

  // every tool but the lake basin takes the left button (a brush, or the crop's handles); the basin works from its panel and the button pans
  const leftDragPans = !active || !(brushing || MESH_TOOLS.some((t) => t.id === editor.tool));

  /** Put the terrain back to what was baked, everywhere. One undo step. */
  const restoreAll = () => {
    if (!session) return;
    say(session.restoreAll() ? "Restored the original terrain everywhere. Ctrl+Z puts your sculpting back." : "The terrain has not been changed, so there is nothing to restore.");
  };

  return { commands, leftDragPans, canSculpt: !!session, tool3d, restoreAll };
}

export { MAX_RADIUS, MIN_RADIUS };
