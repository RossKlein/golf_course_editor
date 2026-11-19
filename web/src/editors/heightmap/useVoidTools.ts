import type Map from "ol/Map";
import { useEffect, useMemo, useRef } from "react";
import type { Command } from "../../commands/keymap";
import type { Pt } from "../../core/geometry/coords";
import { cutHole, makeIsland } from "../../model/design/void";
import { designStore } from "../../model/design/store";
import type { DesignLayers } from "../../views/map2d/design/useDesignLayers";
import { installPolygonTools, polygonCommands, type PolygonControls, type PolygonTarget } from "../_shared/polygonTools";

type Props = {
  map: Map | null;
  layers: DesignLayers | null;
  /** The Cut or Island tool is the open tool, on the 2D map. */
  active: boolean;
  tool: "cut" | "island";
  snap: boolean;
  /** The map's size in metres. */
  size: { w: number; h: number } | null;
  say: (text: string) => void;
};

/**
 * The Heightmap editor's Cut and Island tools: an outline is drawn on the map like a polygon in the Course editor, and becomes a void (ground
 * that is not there). Cut makes the inside of the outline void; Island keeps the inside and makes everything else on the map void. Both are one
 * undo step, and the void is an ordinary region (surface "Void"), so the Course editor can select, reshape or delete it afterwards.
 */
export function useVoidTools({ map, layers, active, tool, snap, size, say }: Props) {
  const controls = useRef<PolygonControls | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const w = size?.w, h = size?.h;

  useEffect(() => {
    if (!map || !layers || !active) return;
    const doc = () => designStore.getState().doc;
    const target: PolygonTarget = {
      noun: tool === "cut" ? "cut" : "island",
      layer: layers.regions.layer,
      source: layers.regions.source,
      find: (id) => doc().regions[id] as { id: string; outer: Pt[]; inner: Pt[][] } | undefined,
      create: (ring) => {
        if (tool === "cut") {
          cutHole(ring);
          say("Ground cut away. Select it in the Course editor to reshape or delete it; Ctrl+Z puts it back.");
          return;
        }
        const map = sizeRef.current;
        const made = map ? makeIsland(ring, map) : 0;
        say(made ? "Island made: everything else on the map is void. Ctrl+Z puts it back." : "That outline is not on the map, or covers all of it, so nothing was cut away.");
      },
      update: () => undefined, // these tools only draw
      remove: () => undefined,
      snapRings: () => Object.values(doc().regions).flatMap((r) => [r.outer as Pt[], ...(r.inner as Pt[][])]),
    };
    const tools = installPolygonTools({ map, tool: "draw", target, snap, smoothing: () => 0, say });
    controls.current = tools.controls;
    return () => {
      tools.dispose();
      controls.current = null;
    };
  }, [map, layers, active, tool, snap, say, w, h]);

  const commands = useMemo<Command[]>(
    () =>
      polygonCommands({
        editor: "heightmap",
        controls: () => controls.current,
        tool: () => tool,
        setTool: () => undefined,
        hasSelection: () => false,
        deleteSelected: () => undefined,
        alsoPolygon: ["cut", "island"],
      }).filter((c) => c.id.startsWith("heightmap.cut.") || c.id.startsWith("heightmap.island.")), // finish, cancel and step back; the rest are the Course editor's
    [tool],
  );
  return { commands };
}
