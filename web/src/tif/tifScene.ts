import { api, tifElevationUrl, tifRgbUrl, type TifView } from "../api/api";
import { buildHillshade, decodeHeights, loadImage, loadPixels, memoLast, sampleGrid } from "../decode/decode";
import type { Layer, ReadoutLine, Scene } from "../map/scene";

/** A GeoTIFF on the map, in metres from its top-left corner (x east, z south). */
export async function loadTifScene(path: string): Promise<{ scene: Scene; view: TifView }> {
  const view = await api.tif(path);
  const [a, b, c, d, e, f] = view.transform;
  const w = (view.rgb ?? view.elevation)?.width ?? 0;
  const h = (view.rgb ?? view.elevation)?.height ?? 0;
  if (!w || !h) throw new Error(`${path} has neither RGB bands nor an elevation band to display`);
  const rect = { x: 0, z: 0, w: w * view.resX, h: h * view.resZ };

  const layers: Layer[] = [];
  if (view.rgb) {
    layers.push({
      id: "rgb", label: "Imagery", visible: true, opacity: 1,
      raster: { image: await loadImage(tifRgbUrl(path)), rect, smooth: true },
    });
  }
  const grid = view.elevation
    ? decodeHeights(await loadPixels(tifElevationUrl(path)), view.elevation.hMin, view.elevation.hMax)
    : null;
  if (grid) {
    const shade = memoLast((exaggeration: number) => buildHillshade(grid, view.resX, view.resZ, exaggeration));
    layers.push({
      id: "hillshade", label: "Hillshade", visible: true, opacity: view.rgb ? 0.55 : 1,
      raster: { image: (p) => shade(p.exaggeration), rect, smooth: true, blend: "multiply" },
    });
  }

  const readout = (x: number, z: number): ReadoutLine[] => {
    const col = x / view.resX;
    const row = z / view.resZ;
    if (col < 0 || row < 0 || col > w || row > h) return [{ text: "outside the raster" }];
    const cx = a * col + b * row + c;
    const cy = d * col + e * row + f;
    const lines: ReadoutLine[] = [
      { text: `pixel ${Math.floor(col * view.decimation)}, ${Math.floor(row * view.decimation)}` },
      { text: view.geographic ? `lon ${cx.toFixed(6)}  lat ${cy.toFixed(6)}` : `E ${cx.toFixed(1)}  N ${cy.toFixed(1)}` },
      { text: `${x.toFixed(1)} m east, ${z.toFixed(1)} m south of the corner` },
    ];
    if (grid) {
      const height = sampleGrid(grid, col - 0.5, row - 0.5);
      lines.push({ text: height === null ? "elevation: no data" : `elevation ${height.toFixed(2)} m` });
    }
    return lines;
  };

  const sizeText = `${view.width} x ${view.height} px, ${rect.w.toFixed(0)} x ${rect.h.toFixed(0)} m`;
  return {
    view,
    scene: { key: `tif:${path}`, title: path.split("/").pop()!, subtitle: `${path} · ${sizeText}`, extent: rect, layers, readout },
  };
}
