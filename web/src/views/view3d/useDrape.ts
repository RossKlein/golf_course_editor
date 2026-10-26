import { useCallback, useEffect, useRef } from "react";
import type { Rect } from "../../core/geometry/coords";
import { designStore } from "../../model/design/store";
import { DRAPE_PIXELS, paintDrape } from "../../scene/drape";
import type { TerrainSource } from "../../scene/scene";

/**
 * Keeps the design (surfaces and outlines) painted over the ground in 3D. The design is painted for a square of ground sized to
 * the camera, so it stays sharp close up; it is repainted when that square moves or the design changes. Returns the function
 * to call each frame with the square, and asks for a redraw (`onChange`) when the design changes.
 */
export function useDrape(terrain: TerrainSource, hasDesign: boolean, active: () => boolean, onChange: () => void) {
  const canvases = useRef<{ fill: HTMLCanvasElement; lines: HTMLCanvasElement; key: string } | null>(null);
  const version = useRef(0);

  useEffect(() => {
    if (!hasDesign) return;
    return designStore.subscribe(() => {
      version.current += 1;
      if (active()) onChange();
    });
  }, [hasDesign, active, onChange]);

  // free the GPU and the canvases when the scene goes
  useEffect(
    () => () => {
      terrain.renderer.setDrape(null, null, null);
      canvases.current = null;
    },
    [terrain],
  );

  return useCallback(
    (rect: Rect) => {
      if (!hasDesign) return;
      const key = `${rect.x},${rect.z},${rect.w},${version.current}`;
      if (!canvases.current) {
        const make = () => Object.assign(document.createElement("canvas"), { width: DRAPE_PIXELS, height: DRAPE_PIXELS });
        canvases.current = { fill: make(), lines: make(), key: "" };
      }
      const c = canvases.current;
      if (c.key === key) return;
      c.key = key;
      paintDrape(c.fill.getContext("2d")!, c.lines.getContext("2d")!, designStore.getState().doc, rect, DRAPE_PIXELS);
      terrain.renderer.setDrape(c.fill, c.lines, rect);
    },
    [terrain, hasDesign],
  );
}
