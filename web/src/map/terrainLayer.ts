import { viewLayer } from "./layers";
import type { TerrainRenderer, TerrainStyle } from "../terrain/terrain";

/**
 * Shaded terrain as a map layer, drawn by the GPU for exactly what is on screen. `style` is read at every render, so
 * change what it returns and call `redraw`. With `multiply` the shading darkens the layers beneath (the aerial).
 */
export function terrainLayer(opts: { renderer: TerrainRenderer; style: () => TerrainStyle; multiply: boolean }) {
  let failed = false;
  const { layer, redraw } = viewLayer({
    multiply: opts.multiply,
    draw: (extent, size) => {
      if (failed) return null;
      try {
        return opts.renderer.render(extent, size, opts.style());
      } catch (e) {
        failed = true; // say it once, not on every frame
        console.error(e);
        return null;
      }
    },
  });
  return { layer, redraw, dispose: () => opts.renderer.dispose() };
}
