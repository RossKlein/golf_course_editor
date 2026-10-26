import { viewLayer } from "../layers";
import { TerrainRenderer, type TerrainGrid, type TerrainStyle } from "./renderer";

/**
 * Shaded terrain as a map layer, drawn by the GPU for exactly what is on screen. `style` is read at every render, so
 * change what it returns and call `redraw`. With `multiply` the shading darkens the layers beneath (the aerial).
 */
export function terrainLayer(opts: { data: TerrainGrid; style: () => TerrainStyle; multiply: boolean }) {
  const renderer = new TerrainRenderer(opts.data);
  let failed = false;
  const { layer, redraw } = viewLayer({
    multiply: opts.multiply,
    draw: (extent, size) => {
      if (failed) return null;
      try {
        return renderer.render(extent, size, opts.style());
      } catch (e) {
        failed = true; // say it once, not on every frame
        console.error(e);
        return null;
      }
    },
  });
  return { layer, redraw, dispose: () => renderer.dispose() };
}
