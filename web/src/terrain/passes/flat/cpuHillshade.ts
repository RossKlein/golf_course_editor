import { pixelCanvas, type HeightGrid } from "../../../core/decode/decode";
import type { Sun } from "../../sun";

// The map's hillshade on the CPU: what the viewer shows when the GPU cannot draw the terrain. The same maths as the flat pass.

/** Grey hillshade lit by the sun (the look's, see sun.ts). Missing data is transparent. */
export function buildHillshade(grid: HeightGrid, resX: number, resZ: number, exaggeration: number, sun: Sun) {
  return pixelCanvas(grid.cols, grid.rows, (d) => hillshadePixels(grid, resX, resZ, exaggeration, d, sun));
}

/** The pixels of the hillshade, written into `d` (RGBA, one per sample). The viewer's fallback when WebGL2 is missing. */
export function hillshadePixels(grid: HeightGrid, resX: number, resZ: number, exaggeration: number, d: Uint8ClampedArray, sun: Sun) {
  const { values, valid, cols, rows } = grid;
  const az = sun.azimuth;
  const alt = sun.altitude;
  {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!valid[i]) continue;
        const h = (rr: number, cc: number) => {
          const k = Math.min(rows - 1, Math.max(0, rr)) * cols + Math.min(cols - 1, Math.max(0, cc));
          return valid[k] ? values[k] : values[i];
        };
        const spanX = (c === 0 || c === cols - 1 ? 1 : 2) * resX;
        const spanZ = (r === 0 || r === rows - 1 ? 1 : 2) * resZ;
        const dx = ((h(r, c + 1) - h(r, c - 1)) / spanX) * exaggeration;
        const dz = ((h(r + 1, c) - h(r - 1, c)) / spanZ) * exaggeration;
        const slope = Math.PI / 2 - Math.atan(Math.hypot(dx, dz));
        const aspect = Math.atan2(-dx, dz);
        const shade = Math.sin(alt) * Math.sin(slope) + Math.cos(alt) * Math.cos(slope) * Math.cos(az - aspect);
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, shade)) * 255);
        d[i * 4 + 3] = 255;
      }
    }
  }
}
