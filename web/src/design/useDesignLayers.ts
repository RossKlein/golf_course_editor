import type Map from "ol/Map";
import { useEffect, useState } from "react";
import type { EditorState } from "../core/api/api";
import { createBoundsLayer } from "./olBounds";
import { createRegionLayer } from "./olRegions";
import { createRouteLayer } from "./olRoutes";

export type DesignLayers = {
  regions: ReturnType<typeof createRegionLayer>;
  routes: ReturnType<typeof createRouteLayer>;
  bounds: ReturnType<typeof createBoundsLayer>;
};

/**
 * The map layers that mirror the design (surfaces, hole routes, bounds areas), alive for as long as a bundle is open, and
 * what each shows for the open editor. This is the one place that decides it, so the editors never fight over a layer.
 *  - Course: surfaces and routes, optionally only the active hole's.
 *  - Out of bounds: the bounds areas, with surfaces and routes underneath as dimmed reference, as chosen in the sub-bar.
 *  - Anything else: none of them.
 */
export function useDesignLayers(map: Map | null, isBundle: boolean, editable: boolean, editor: EditorState): DesignLayers | null {
  const [layers, setLayers] = useState<DesignLayers | null>(null);

  useEffect(() => {
    if (!map || !isBundle) return;
    const made: DesignLayers = { regions: createRegionLayer(), routes: createRouteLayer(), bounds: createBoundsLayer() };
    for (const l of [made.bounds.context, made.regions.layer, made.routes.layer, made.bounds.layer]) map.addLayer(l);
    setLayers(made);
    return () => {
      for (const l of [made.bounds.context, made.regions.layer, made.routes.layer, made.bounds.layer]) map.removeLayer(l);
      made.regions.dispose();
      made.routes.dispose();
      made.bounds.dispose();
      setLayers(null);
    };
  }, [map, isBundle]);

  const { editor: open, hole, hideOthers, boundsFeatures, boundsAllHoles, boundsAllBounds, overlayOpacity } = editor;
  useEffect(() => {
    if (!layers) return;
    const course = editable && open === "course";
    const bounds = editable && open === "bounds";
    const sculpt = editable && open === "heightmap"; // the outlines are there to see what the brush is doing
    const reference = (bounds && boundsFeatures !== "off") || sculpt;
    layers.regions.layer.setVisible(course || reference);
    layers.regions.layer.setOpacity(overlayOpacity * (bounds ? 0.55 : sculpt ? 0.4 : 1)); // as reference, surfaces are dimmer
    layers.regions.showOnly(course ? (hideOthers ? hole : null) : bounds && boundsFeatures === "hole" ? hole : null);
    layers.routes.layer.setVisible(course || reference);
    layers.routes.setView({ hole, hideOthers: course ? hideOthers : bounds ? !boundsAllHoles : false });
    layers.bounds.layer.setVisible(bounds);
    layers.bounds.layer.setOpacity(overlayOpacity);
    layers.bounds.context.setVisible(bounds);
    layers.bounds.context.setOpacity(overlayOpacity);
    layers.bounds.setView({ hole, showOthers: boundsAllBounds });
  }, [layers, editable, open, hole, hideOthers, boundsFeatures, boundsAllHoles, boundsAllBounds, overlayOpacity]);

  return layers;
}
