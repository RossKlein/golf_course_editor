import type Map from "ol/Map";
import Feature from "ol/Feature";
import Circle from "ol/geom/Circle";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Stroke as LineStyle, Style } from "ol/style";
import { useEffect, useMemo, useRef } from "react";
import type { EditorState } from "../../core/api/api";
import type { Command } from "../../commands/keymap";
import { BRUSHES, MAX_RADIUS, MIN_RADIUS, resized, type Brush, type BrushKind } from "../../terrain/sculpt/brush";
import type { TerrainSource } from "../../scene/scene";
import type { GroundTool } from "../../scene/groundTool";
import { fromMap, toMap, type Pt } from "../../core/geometry/coords";
import { Stroke } from "./stroke";

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
    () => (session && terrain ? new Stroke({ session, ground: terrain.ground, brush: () => brushOf(latest.current.editor) }) : null),
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
    source.addFeatures([outer, inner]);
    const layer = new VectorLayer({ source, zIndex: 1000, updateWhileInteracting: true, updateWhileAnimating: true });
    layer.setVisible(false);
    map.addLayer(layer);

    let pointer: Pt | null = null;
    const place = () => {
      if (!pointer) return layer.setVisible(false);
      const b = brushOf(latest.current.editor);
      const c = toMap(pointer);
      (outer.getGeometry() as Circle).setCenterAndRadius(c, b.radius);
      (inner.getGeometry() as Circle).setCenterAndRadius(c, Math.max(0.01, b.radius * b.hardness));
      layer.setVisible(true);
    };
    cursor.current = { move: (p) => ((pointer = p), place()) };

    const at = (e: PointerEvent): Pt => fromMap(map.getEventCoordinate(e) as Pt);

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || map.get("spacePan")) return;
      pointer = at(e);
      viewport.setPointerCapture(e.pointerId);
      stroke.begin(() => pointer, e.shiftKey);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      pointer = at(e);
      stroke.shift(e.shiftKey);
      place();
    };
    const finish = () => stroke.end();
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
      map.removeLayer(layer);
      cursor.current = null;
    };
  }, [map, stroke, onMap]);

  // changing the brush with the keys or sliders redraws the ring where it is
  useEffect(() => cursor.current?.move(null), [editor.brushRadius, editor.brushHardness, onMap]);

  // in 3D the view does the pointing; this is what it is handed. A stroke does not outlive the tool.
  const tool3d = useMemo<GroundTool | undefined>(
    () =>
      active && view3d && stroke
        ? { ring: { radius: editor.brushRadius, hardness: editor.brushHardness }, begin: (where, shift) => stroke.begin(where, shift), shift: (down) => stroke.shift(down), end: () => stroke.end() }
        : undefined,
    [active, view3d, stroke, editor.brushRadius, editor.brushHardness],
  );
  const handedOver = !!tool3d;
  useEffect(() => () => stroke?.end(), [stroke, handedOver]);

  const S = "editor:heightmap" as const;
  const commands: Command[] = [];
  for (const b of BRUSHES) commands.push({ id: `height.tool.${b.id}`, label: `${b.label} brush`, scope: S, keys: [b.key], group: "Brushes", run: () => latest.current.patch({ tool: b.id }) });
  commands.push(
    { id: "height.bigger", label: "Bigger brush", scope: S, keys: ["BracketRight"], group: "Brushes", run: () => latest.current.patch({ brushRadius: resized(latest.current.editor.brushRadius, true) }) },
    { id: "height.smaller", label: "Smaller brush", scope: S, keys: ["BracketLeft"], group: "Brushes", run: () => latest.current.patch({ brushRadius: resized(latest.current.editor.brushRadius, false) }) },
    { id: "height.stronger", label: "Stronger brush", scope: S, keys: ["Shift+BracketRight"], group: "Brushes", run: () => latest.current.patch({ brushStrength: Math.min(1, +(latest.current.editor.brushStrength * 1.25).toFixed(3)) }) },
    { id: "height.weaker", label: "Weaker brush", scope: S, keys: ["Shift+BracketLeft"], group: "Brushes", run: () => latest.current.patch({ brushStrength: Math.max(0.02, +(latest.current.editor.brushStrength / 1.25).toFixed(3)) }) },
  );

  return { commands, leftDragPans: !active, canSculpt: !!session, tool3d };
}

export { MAX_RADIUS, MIN_RADIUS };
