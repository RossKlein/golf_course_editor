import type OlMap from "ol/Map";
import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke as LineStyle, Style } from "ol/style";
import { useEffect, useMemo, useRef } from "react";
import { fromMap, toMap, type Pt } from "../../core/geometry/coords";
import { pointInPolygon } from "../../core/geometry/geometry";
import { designStore } from "../../model/design/store";
import type { GroundTool } from "../../scene/groundTool";
import type { TerrainSource } from "../../scene/scene";
import { BUNKER_CLASS } from "../../terrain/sculpt/trap";
import { trapUi } from "./trapUi";

type Props = {
  map: OlMap | null;
  terrain: TerrainSource | undefined;
  /** The Sand trap tool is the open tool. */
  active: boolean;
  /** The 3D view is showing instead of the map. */
  view3d: boolean;
  say: (text: string) => void;
};

const OUTLINE = [
  new Style({ stroke: new LineStyle({ color: "rgba(0, 0, 0, 0.7)", width: 5 }) }),
  new Style({ fill: new Fill({ color: "rgba(255, 210, 74, 0.18)" }), stroke: new LineStyle({ color: "#ffd24a", width: 2.5 }) }),
];

/** The bunker region at a point: the last region painted there, if it is a bunker (as the build decides, a fairway painted over it has none). */
export function bunkerAt(p: Pt): { rings: Pt[][] } | null {
  const doc = designStore.getState().doc;
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const r = doc.regions[doc.order[i]];
    if (r && pointInPolygon(r.outer as Pt[], r.inner as Pt[][], p)) return r.class === BUNKER_CLASS ? { rings: [r.outer as Pt[], ...(r.inner as Pt[][])] } : null;
  }
  return null;
}

/**
 * The Heightmap editor's Sand trap tool: click a bunker to pick it, and the card (TrapPanel) shapes it. Like the Trees editor's Select tool
 * it is a GroundTool, so a click works the same on the map (which feeds it the pointer) and in 3D (where the view finds the ground). On
 * the map the bunker that is picked is outlined.
 */
export function useTrapEditor({ map, terrain, active, view3d, say }: Props) {
  const latest = useRef({ terrain, say });
  latest.current = { terrain, say };

  const tool = useMemo<GroundTool>(
    () => ({
      ring: { radius: 1, hardness: 1 },
      shift() {},
      end() {},
      begin(where) {
        const p = where();
        const session = latest.current.terrain?.sculpt;
        if (!p || !session) return;
        if (!session.isBunker(p)) return latest.current.say("That is not a bunker. Paint one with the Course editor (surface Bunker) and let it build, then click it here.");
        trapUi.getState().set({ anchor: [+p[0].toFixed(2), +p[1].toFixed(2)] });
      },
    }),
    [],
  );

  // on the map: a click picks, and the picked bunker is outlined
  const onMap = active && !view3d;
  useEffect(() => {
    if (!map || !onMap) return;
    const viewport = map.getViewport() as HTMLElement;
    const before = viewport.style.cursor;
    viewport.style.cursor = "crosshair";

    const source = new VectorSource<Feature<Polygon>>();
    const layer = new VectorLayer({ source, style: OUTLINE, zIndex: 900 });
    map.addLayer(layer);
    const outline = () => {
      source.clear();
      const anchor = trapUi.getState().anchor;
      const hit = anchor && bunkerAt(anchor);
      if (hit) source.addFeature(new Feature(new Polygon(hit.rings.map((ring) => ring.map((q) => toMap(q))))));
    };
    outline();
    const stops = [trapUi.subscribe(outline), designStore.subscribe(outline)];

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || map.get("spacePan")) return;
      const p = fromMap(map.getEventCoordinate(e) as Pt);
      tool.begin(() => p, e.shiftKey);
      e.preventDefault();
    };
    viewport.addEventListener("pointerdown", onDown);
    return () => {
      viewport.removeEventListener("pointerdown", onDown);
      stops.forEach((stop) => stop());
      viewport.style.cursor = before;
      map.removeLayer(layer);
    };
  }, [map, onMap, tool]);

  return {
    /** For the 3D view, which finds the ground under the pointer for it. */
    tool3d: active && view3d && terrain?.sculpt ? tool : undefined,
    /** The left button picks, so it does not pan the map. */
    leftDragPans: !active,
  };
}
