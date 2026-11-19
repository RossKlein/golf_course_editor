import type OlMap from "ol/Map";
import Feature from "ol/Feature";
import Circle from "ol/geom/Circle";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke as LineStyle, Style } from "ol/style";
import { useEffect, useMemo, useRef } from "react";
import type { EditorState, Landmark, TreeKind } from "../../core/api/api";
import type { Command } from "../../commands/keymap";
import { fromMap, toMap, type Pt } from "../../core/geometry/coords";
import { removePlacedTree } from "../../model/design/forest";
import { designStore } from "../../model/design/store";
import type { GroundTool } from "../../scene/groundTool";
import { MAX_RADIUS, MIN_RADIUS, resized } from "../../terrain/sculpt/brush";
import { marks, withSelection, type Mark } from "./overlays";
import { isTreeTool, makeTreeTool, TREE_TOOLS, type ToolEnv, type TreeToolId } from "./tools";
import { treesUi } from "./treesUi";

type Props = {
  map: OlMap | null;
  landmarks: readonly Landmark[];
  kinds: readonly TreeKind[];
  /** The Trees editor is the open editor. */
  active: boolean;
  /** The 3D view is showing instead of the map. */
  view3d: boolean;
  editor: EditorState;
  patch: (p: Partial<EditorState>) => void;
  say: (text: string) => void;
  /** Ask for the design to be saved and built now, so a change shows without waiting out the autosave. */
  requestBuild: () => void;
};

const ring = (color: string, width: number, dash?: number[]) => new Style({ stroke: new LineStyle({ color, width, lineDash: dash }) });
const CURSOR = [ring("rgba(0, 0, 0, 0.6)", 4), ring("#ffffff", 1.5)];

const GREEN = "46, 125, 50";
const STYLES = {
  patch: (m: Extract<Mark, { type: "patch" }>) =>
    new Style({ fill: new Fill({ color: `rgba(${GREEN}, ${m.alpha})` }), stroke: new LineStyle({ color: m.selected ? "#b8e26a" : "rgba(255, 255, 255, 0.45)", width: m.selected ? 3 : 1 }) }),
  tree: (m: Extract<Mark, { type: "tree" }>) =>
    new Style({ image: new CircleStyle({ radius: m.selected ? 6 : 4, fill: new Fill({ color: "#ffd24a" }), stroke: new LineStyle({ color: m.selected ? "#ffffff" : "#000000", width: m.selected ? 2 : 1 }) }) }),
  derived: new Style({ fill: new Fill({ color: "rgba(120, 180, 255, 0.10)" }), stroke: new LineStyle({ color: "rgba(120, 180, 255, 0.9)", width: 1.5, lineDash: [5, 4] }) }),
  hand: new Style({ fill: new Fill({ color: "rgba(255, 110, 90, 0.14)" }), stroke: new LineStyle({ color: "rgba(255, 110, 90, 0.95)", width: 1.5 }) }),
};

function featureOf(m: Mark): Feature {
  const f =
    m.type === "patch" ? new Feature(new Polygon(m.rings.map((r) => r.map((p) => toMap(p)))))
    : m.type === "tree" ? new Feature(new Point(toMap([m.x, m.z])))
    : new Feature(new Circle(toMap([m.x, m.z]), m.r));
  f.setStyle(m.type === "patch" ? STYLES.patch(m) : m.type === "tree" ? STYLES.tree(m) : m.source === "derived" ? STYLES.derived : STYLES.hand);
  return f;
}

/**
 * The Trees editor: plant trees, clear ground, erase, and pick a woods patch to set how it is planted (the card does the setting).
 * The four tools are GroundTools (see tools.ts). On the map this listens to the pointer itself and draws the brush ring; in 3D it hands
 * the view the tool and the view finds the ground. Over the map it draws the patches by density, the placed trees and the clearings.
 */
export function useTreesEditor({ map, landmarks, kinds, active, view3d, editor, patch, say, requestBuild }: Props) {
  const latest = useRef({ editor, patch, say, requestBuild, kinds, landmarks });
  latest.current = { editor, patch, say, requestBuild, kinds, landmarks };
  const cursor = useRef<{ move: (p: Pt | null) => void } | null>(null);

  const toolId: TreeToolId = isTreeTool(editor.tool) ? editor.tool : "select";
  const env = useMemo<ToolEnv>(
    () => ({ radius: () => latest.current.editor.brushRadius, kinds: () => latest.current.kinds, say: (t) => latest.current.say(t), changed: () => latest.current.requestBuild() }),
    [],
  );
  const tool = useMemo(() => makeTreeTool(toolId, env), [toolId, env]);
  const brushed = toolId === "remove" || toolId === "erase";

  // on the map, the ring follows the pointer, and the button works the tool
  const onMap = active && !view3d;
  useEffect(() => {
    if (!map || !onMap) return;
    const viewport = map.getViewport() as HTMLElement;
    const source = new VectorSource();
    const outer = new Feature(new Circle([0, 0], 1));
    outer.setStyle(CURSOR);
    source.addFeature(outer);
    const layer = new VectorLayer({ source, zIndex: 1000, updateWhileInteracting: true, updateWhileAnimating: true });
    layer.setVisible(false);
    map.addLayer(layer);

    let pointer: Pt | null = null;
    const place = () => {
      if (!pointer) return layer.setVisible(false);
      (outer.getGeometry() as Circle).setCenterAndRadius(toMap(pointer), tool.ring.radius);
      layer.setVisible(true);
    };
    cursor.current = { move: (p) => ((pointer = p), place()) };
    const at = (e: PointerEvent): Pt => fromMap(map.getEventCoordinate(e) as Pt);

    let down = false;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || map.get("spacePan")) return;
      pointer = at(e);
      down = true;
      viewport.setPointerCapture(e.pointerId);
      tool.begin(() => pointer, e.shiftKey);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      pointer = at(e);
      place();
    };
    const finish = () => {
      if (!down) return;
      down = false;
      tool.end();
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
      viewport.removeEventListener("pointerdown", onDown);
      viewport.removeEventListener("pointermove", onMove);
      viewport.removeEventListener("pointerup", finish);
      viewport.removeEventListener("pointercancel", finish);
      viewport.removeEventListener("pointerleave", onLeave);
      map.removeLayer(layer);
      cursor.current = null;
    };
  }, [map, onMap, tool]);

  // a brush resized with the keys or the slider redraws its ring where it is
  useEffect(() => cursor.current?.move(null), [editor.brushRadius, onMap]);

  // over the map: the patches by density, the placed trees and the clearings, redrawn whenever the design or the options change
  useEffect(() => {
    if (!map || !onMap) return;
    const source = new VectorSource();
    const layer = new VectorLayer({ source, zIndex: 900, updateWhileInteracting: true });
    map.addLayer(layer);
    // A patch's polygon has thousands of vertices and rarely changes, but its tint changes with every tick of a spacing slider. So a patch's
    // feature is kept while its outline is the same object (the design keeps what it did not change) and only restyled; the trees and
    // clearings, which are small, are made again each time.
    const patches = new Map<string, { feature: Feature; outer: unknown; alpha: number; selected: boolean }>();
    let transient: Feature[] = [];
    const render = () => {
      const { landmarks, kinds } = latest.current;
      const state = designStore.getState();
      const list = withSelection(marks(state.doc, landmarks, kinds, treesUi.getState()), state.selected);
      source.removeFeatures(transient);
      transient = [];
      const seen = new Set<string>();
      for (const m of list) {
        if (m.type !== "patch") {
          transient.push(featureOf(m));
          continue;
        }
        seen.add(m.id);
        const have = patches.get(m.id);
        if (have && have.outer === m.rings[0]) {
          if (have.alpha !== m.alpha || have.selected !== m.selected) {
            have.feature.setStyle(STYLES.patch(m));
            have.alpha = m.alpha;
            have.selected = m.selected;
          }
          continue;
        }
        if (have) source.removeFeature(have.feature);
        const feature = featureOf(m);
        source.addFeature(feature);
        patches.set(m.id, { feature, outer: m.rings[0], alpha: m.alpha, selected: m.selected });
      }
      for (const [id, have] of patches) {
        if (seen.has(id)) continue;
        source.removeFeature(have.feature);
        patches.delete(id);
      }
      source.addFeatures(transient); // after the patches, so they draw over them
    };
    // a slider or a brush changes the design many times a second: redraw at most once a frame
    let frame = 0;
    const draw = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), render()));
    };
    render();
    const stop = [designStore.subscribe(draw), treesUi.subscribe(draw)];
    return () => {
      stop.forEach((s) => s());
      cancelAnimationFrame(frame);
      map.removeLayer(layer);
    };
  }, [map, onMap, landmarks, kinds]);

  // in 3D the view does the pointing; this is what it is handed. The ring is read when it is drawn, so a new object follows the brush size.
  const tool3d = useMemo<GroundTool | undefined>(
    () => (active && view3d ? { ring: tool.ring, begin: (where, shift) => tool.begin(where, shift), shift: (down) => tool.shift(down), end: () => tool.end() } : undefined),
    [active, view3d, tool, editor.brushRadius], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const handedOver = !!tool3d;
  useEffect(() => () => tool.end(), [tool, handedOver]);

  // leaving the editor leaves nothing selected
  useEffect(() => {
    if (!active) treesUi.getState().set({ selectedTree: null });
  }, [active]);

  const S = "editor:trees" as const;
  const commands: Command[] = TREE_TOOLS.map((t) => ({ id: `trees.tool.${t.id}`, label: t.hint.split(".")[0], scope: S, keys: [t.key], group: "Tools", run: () => latest.current.patch({ tool: t.id }) }));
  commands.push(
    { id: "trees.bigger", label: "Bigger brush", scope: S, keys: ["BracketRight"], group: "Tools", run: () => latest.current.patch({ brushRadius: resized(latest.current.editor.brushRadius, true) }) },
    { id: "trees.smaller", label: "Smaller brush", scope: S, keys: ["BracketLeft"], group: "Tools", run: () => latest.current.patch({ brushRadius: resized(latest.current.editor.brushRadius, false) }) },
    {
      id: "trees.delete",
      label: "Delete the selected placed tree",
      scope: S,
      keys: ["Delete", "Backspace"],
      group: "Tools",
      when: () => treesUi.getState().selectedTree !== null,
      run: () => {
        const i = treesUi.getState().selectedTree;
        if (i === null) return;
        removePlacedTree("Delete tree", i);
        treesUi.getState().set({ selectedTree: null });
        latest.current.requestBuild();
      },
    },
  );

  return { commands, leftDragPans: !active, tool3d, brushed };
}

export { MAX_RADIUS, MIN_RADIUS };
