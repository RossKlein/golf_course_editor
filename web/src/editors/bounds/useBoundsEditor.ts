import type Map from "ol/Map";
import { useEffect, useMemo, useRef } from "react";
import type { EditorState } from "../../api/api";
import type { Command } from "../../commands/keymap";
import { ringsOf } from "../../design/olRegions";
import type { DesignLayers } from "../../design/useDesignLayers";
import { addBoundsArea, designStore, removeBoundsAreas, updateBoundsArea, useDesign } from "../../design/store";
import type { Pt } from "../../map/coords";
import { holeCommands, makeHoleNav } from "../shared/holeNav";
import { installPolygonTools, polygonCommands, type PolygonControls, type PolygonTarget } from "../shared/polygonTools";

export const BOUNDS_TOOLS = [
  { id: "select", label: "Select", key: "v", hint: "Click an area to select it. Drag a corner to move it, drag along an edge to add a point. Right-click a corner to remove it, or inside an area to delete it" },
  { id: "draw", label: "Polygon", key: "d", hint: "Click to outline where this hole may be played from; click the first point or press Enter to finish. Add as many areas as you need" },
  { id: "freehand", label: "Freehand", key: "Shift+D", hint: "Drag to draw, lift and keep going as often as you like. Enter finishes the outline, Backspace removes the last stroke, Esc cancels. Middle-drag pans." },
] as const;

/** What to show under the bounds, in the order the toggle cycles. */
export const FEATURE_MODES = [
  { id: "off", label: "Off", hint: "Show only the bounds" },
  { id: "hole", label: "Hole", hint: "Show the active hole's surfaces and route, and shared surfaces near it" },
  { id: "course", label: "Course", hint: "Show every surface on the course" },
] as const;

type Props = {
  map: Map | null;
  layers: DesignLayers | null;
  /** The Out-of-bounds editor is the open editor. */
  active: boolean;
  editor: EditorState;
  patch: (p: Partial<EditorState>) => void;
  say: (text: string) => void;
};

/** The Out-of-bounds editor: where each hole may be played from. A hole's ground is the union of its areas. */
export function useBoundsEditor({ map, layers, active, editor, patch, say }: Props) {
  const holeCount = useDesign((s) => s.doc.layout.holes.length);
  const controlsRef = useRef<PolygonControls | null>(null);
  const latest = useRef({ editor, patch });
  latest.current = { editor, patch };
  const tool = editor.tool as (typeof BOUNDS_TOOLS)[number]["id"];

  // the course editor may have left a tool this editor does not have
  useEffect(() => {
    if (active && !BOUNDS_TOOLS.some((t) => t.id === editor.tool)) latest.current.patch({ tool: "select" });
  }, [active, editor.tool]);

  useEffect(() => {
    if (active && editor.hole > Math.max(1, holeCount)) latest.current.patch({ hole: Math.max(1, holeCount) });
  }, [active, holeCount, editor.hole]);

  useEffect(() => {
    if (!map || !layers || !active || !BOUNDS_TOOLS.some((t) => t.id === tool)) return;
    const { bounds, regions } = layers;
    const reference = editor.boundsFeatures !== "off";
    const snapSources = [bounds.context.getSource()!, ...(reference ? [regions.source] : [])];
    const target: PolygonTarget = {
      noun: "bounds area",
      layer: bounds.layer,
      source: bounds.source,
      snapSources,
      find: (id) => designStore.getState().doc.bounds[id] as { id: string; outer: Pt[]; inner: Pt[][] } | undefined,
      create: (ring) => {
        const hole = latest.current.editor.hole;
        const id = addBoundsArea(`Draw bounds for hole ${hole}`, { hole, outer: ring, inner: [] });
        designStore.getState().select([id]);
      },
      update: (label, id, rings) => updateBoundsArea(label, id, rings),
      remove: (ids) => removeBoundsAreas(ids.length > 1 ? "Delete bounds areas" : "Delete bounds area", ids),
      // whatever can be snapped to on the map
      snapRings: () => [bounds.source, ...snapSources].flatMap((s) => s.getFeatures().flatMap((f) => {
        const { outer, inner } = ringsOf(f);
        return [outer, ...inner];
      })),
    };
    const tools = installPolygonTools({ map, tool, target, snap: editor.snap, smoothing: () => latest.current.editor.smoothing, say });
    controlsRef.current = tools.controls;
    return () => {
      tools.dispose();
      controlsRef.current = null;
    };
  }, [map, layers, active, tool, editor.snap, editor.boundsFeatures, say]);

  const nav = useMemo(() => makeHoleNav({ map, patch: (p) => latest.current.patch(p), say, withBounds: true, added: "Draw where it may be played from." }), [map, say]);

  const S = "editor:bounds" as const;
  const hasSelection = () => designStore.getState().selected.some((id) => !!designStore.getState().doc.bounds[id]);
  const cycleFeatures = () => {
    const i = FEATURE_MODES.findIndex((m) => m.id === latest.current.editor.boundsFeatures);
    const next = FEATURE_MODES[(i + 1) % FEATURE_MODES.length];
    latest.current.patch({ boundsFeatures: next.id });
    say(`Course features: ${next.label.toLowerCase()}.`);
  };

  const commands: Command[] = [];
  for (const t of BOUNDS_TOOLS) commands.push({ id: `bounds.tool.${t.id}`, label: `${t.label} tool`, scope: S, keys: [t.key], group: "Tools", run: () => latest.current.patch({ tool: t.id }) });
  commands.push(
    ...holeCommands("bounds", () => nav, () => latest.current.editor.hole),
    { id: "bounds.features", label: "Cycle course features: off, hole, course", scope: S, keys: ["h f"], group: "Overview", run: cycleFeatures },
    { id: "bounds.allHoles", label: "Show or hide the other holes' routes", scope: S, keys: ["h h"], group: "Overview", run: () => latest.current.patch({ boundsAllHoles: !latest.current.editor.boundsAllHoles }) },
    { id: "bounds.allBounds", label: "Show or hide the other holes' bounds", scope: S, keys: ["h b"], group: "Overview", run: () => latest.current.patch({ boundsAllBounds: !latest.current.editor.boundsAllBounds }) },
    ...polygonCommands({
      editor: "bounds",
      controls: () => controlsRef.current,
      tool: () => latest.current.editor.tool,
      setTool: (id) => latest.current.patch({ tool: id }),
      hasSelection,
      deleteSelected: () => {
        const ids = designStore.getState().selected.filter((id) => designStore.getState().doc.bounds[id]);
        designStore.getState().select([]);
        removeBoundsAreas(ids.length > 1 ? "Delete bounds areas" : "Delete bounds area", ids);
      },
    }),
  );

  return { commands, goHole: nav.goHole, newHole: nav.newHole, leftDragPans: !active || tool === "select" };
}
