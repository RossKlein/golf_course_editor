import type Map from "ol/Map";
import Feature from "ol/Feature";
import Circle from "ol/geom/Circle";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Stroke, Style } from "ol/style";
import { useEffect, useRef } from "react";
import type { EditorState } from "../../core/api/api";
import type { Command } from "../../commands/keymap";
import { BRUSHES, MAX_RADIUS, MIN_RADIUS, perStamp, resized, stampPoints, type Brush, type BrushKind } from "../../terrain/sculpt/brush";
import type { TerrainSource } from "../../map/scene";
import { fromMap, toMap, type Pt } from "../../core/geometry/coords";

type Props = {
  map: Map | null;
  terrain: TerrainSource | undefined;
  /** The Heightmap editor is the open editor. */
  active: boolean;
  editor: EditorState;
  patch: (p: Partial<EditorState>) => void;
  say: (text: string) => void;
};

const isBrush = (id: string): id is BrushKind => BRUSHES.some((b) => b.id === id);
const SWAPPED: Partial<Record<BrushKind, BrushKind>> = { raise: "lower", lower: "raise" };

const ring = (color: string, width: number, dash?: number[]) => new Style({ stroke: new Stroke({ color, width, lineDash: dash }) });
const OUTER = [ring("rgba(0, 0, 0, 0.6)", 4), ring("#ffffff", 1.5)];
const INNER = [ring("rgba(0, 0, 0, 0.45)", 3, [4, 4]), ring("rgba(255, 255, 255, 0.9)", 1, [4, 4])];

/**
 * The Heightmap editor: a round brush on the map that raises, lowers, smooths, flattens or restores the terrain. The brush
 * is stamped every frame the button is held, so holding still builds up; the work itself is on the GPU (see Sculptor).
 */
export function useHeightEditor({ map, terrain, active, editor, patch, say }: Props) {
  const session = terrain?.sculpt;
  const latest = useRef({ editor, patch, say });
  latest.current = { editor, patch, say };
  const cursor = useRef<{ move: (p: Pt | null) => void } | null>(null);

  useEffect(() => {
    if (!session) return;
    session.onError = (message) => message && latest.current.say(message);
    return () => {
      session.onError = () => {};
    };
  }, [session]);

  // the brush ring follows the pointer, and holding the button sculpts
  useEffect(() => {
    if (!map || !session || !terrain || !active) return;
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
    let last: Pt | null = null;
    let level = 0;
    let down = false;
    let shift = false;
    let frame = 0;
    let before = 0;

    const brush = (): Brush => {
      const e = latest.current.editor;
      const kind = isBrush(e.tool) ? e.tool : "raise";
      return { kind, radius: e.brushRadius, hardness: e.brushHardness, strength: e.brushStrength };
    };
    const place = () => {
      if (!pointer) return layer.setVisible(false);
      const b = brush();
      const c = toMap(pointer);
      (outer.getGeometry() as Circle).setCenterAndRadius(c, b.radius);
      (inner.getGeometry() as Circle).setCenterAndRadius(c, Math.max(0.01, b.radius * b.hardness));
      layer.setVisible(true);
    };
    cursor.current = { move: (p) => ((pointer = p), place()) };

    const at = (e: PointerEvent): Pt => fromMap(map.getEventCoordinate(e) as Pt);

    const stampFrame = (now: number) => {
      frame = requestAnimationFrame(stampFrame);
      if (!pointer) return;
      const dt = Math.min(0.05, (now - before) / 1000);
      before = now;
      const b = brush();
      const points = stampPoints(last, pointer, b.radius);
      const { amount, k } = perStamp(b, dt, points.length);
      const kind = shift ? SWAPPED[b.kind] ?? b.kind : b.kind;
      for (const [x, z] of points) session.stamp({ kind, x, z, radius: b.radius, hardness: b.hardness, amount, pull: k, level });
      last = pointer;
      session.show();
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || map.get("spacePan")) return;
      pointer = at(e);
      shift = e.shiftKey;
      level = terrain.ground(pointer[0], pointer[1]) ?? 0; // flatten levels to where the stroke began
      last = null;
      down = true;
      viewport.setPointerCapture(e.pointerId);
      before = performance.now();
      frame = requestAnimationFrame(stampFrame);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      pointer = at(e);
      shift = e.shiftKey;
      place();
    };
    const finish = () => {
      if (!down) return;
      down = false;
      cancelAnimationFrame(frame);
      session.end();
    };
    const onLeave = () => {
      if (down) return;
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
      cancelAnimationFrame(frame);
      viewport.removeEventListener("pointerdown", onDown);
      viewport.removeEventListener("pointermove", onMove);
      viewport.removeEventListener("pointerup", finish);
      viewport.removeEventListener("pointercancel", finish);
      viewport.removeEventListener("pointerleave", onLeave);
      map.removeLayer(layer);
      cursor.current = null;
    };
  }, [map, session, terrain, active]);

  // changing the brush with the keys or sliders redraws the ring where it is
  useEffect(() => cursor.current?.move(null), [editor.brushRadius, editor.brushHardness, active]);

  const S = "editor:heightmap" as const;
  const commands: Command[] = [];
  for (const b of BRUSHES) commands.push({ id: `height.tool.${b.id}`, label: `${b.label} brush`, scope: S, keys: [b.key], group: "Brushes", run: () => latest.current.patch({ tool: b.id }) });
  commands.push(
    { id: "height.bigger", label: "Bigger brush", scope: S, keys: ["BracketRight"], group: "Brushes", run: () => latest.current.patch({ brushRadius: resized(latest.current.editor.brushRadius, true) }) },
    { id: "height.smaller", label: "Smaller brush", scope: S, keys: ["BracketLeft"], group: "Brushes", run: () => latest.current.patch({ brushRadius: resized(latest.current.editor.brushRadius, false) }) },
    { id: "height.stronger", label: "Stronger brush", scope: S, keys: ["Shift+BracketRight"], group: "Brushes", run: () => latest.current.patch({ brushStrength: Math.min(1, +(latest.current.editor.brushStrength * 1.25).toFixed(3)) }) },
    { id: "height.weaker", label: "Weaker brush", scope: S, keys: ["Shift+BracketLeft"], group: "Brushes", run: () => latest.current.patch({ brushStrength: Math.max(0.02, +(latest.current.editor.brushStrength / 1.25).toFixed(3)) }) },
  );

  return { commands, leftDragPans: !active, canSculpt: !!session };
}

export { MAX_RADIUS, MIN_RADIUS };
