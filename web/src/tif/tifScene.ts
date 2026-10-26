import { api, tifElevationUrl, tifRgbUrl, type TifView } from "../api/api";
import { sunOfLook } from "../map/terrain/sun";
import { buildHillshade, decodeHeights, loadImage, loadPixels, memoLast, sampleGrid } from "../decode/decode";
import { rasterLayer } from "../map/layers";
import { TerrainRenderer, terrainSupported } from "../map/terrain/renderer";
import { terrainLayer } from "../map/terrain/terrainLayer";
import type { ReadoutLine, Scene, SceneLayer, TerrainSource } from "../map/scene";
import type { Formatter } from "../units/units";

/** A GeoTIFF on the map, in metres from its top-left corner (x east, z south). */
export async function loadTifScene(path: string): Promise<{ scene: Scene; view: TifView }> {
  const view = await api.tif(path);
  const [a, b, c, d, e, f] = view.transform;
  const w = (view.rgb ?? view.elevation)?.width ?? 0;
  const h = (view.rgb ?? view.elevation)?.height ?? 0;
  if (!w || !h) throw new Error(`${path} has neither RGB bands nor an elevation band to display`);
  const rect = { x: 0, z: 0, w: w * view.resX, h: h * view.resZ };

  const layers: SceneLayer[] = [];
  const add = (id: string, label: string, opts: Parameters<typeof rasterLayer>[0], opacity: number) => {
    const { layer, redraw } = rasterLayer(opts);
    layer.setOpacity(opacity);
    const entry: SceneLayer = { id, label, visible: true, opacity, adjustable: true, olLayer: layer };
    layers.push(entry);
    return { entry, redraw };
  };

  let imagery: HTMLImageElement | null = null;
  if (view.rgb) {
    imagery = await loadImage(tifRgbUrl(path));
    add("rgb", "Imagery", { image: () => imagery, rect, smooth: true }, 1);
  }
  let terrainSource: TerrainSource | undefined;
  const grid = view.elevation
    ? decodeHeights(await loadPixels(tifElevationUrl(path)), view.elevation.hMin, view.elevation.hMax)
    : null;
  if (grid) {
    const look = await api.defaultLook(); // a raster has no course, so it is lit by the look a new course starts with
    let style = { exaggeration: 3, contour: 0, slope: false };
    const opacity = view.rgb ? 0.55 : 1;
    if (terrainSupported(grid)) {
      // elevation samples are pixel centres
      const renderer = new TerrainRenderer({ grid, origin: { x: view.resX / 2, z: view.resZ / 2 }, resX: view.resX, resZ: view.resZ }, look);
      const aerial = imagery ? { image: imagery, rect } : null;
      renderer.setAerial(aerial?.image ?? null, aerial?.rect ?? null);
      terrainSource = { renderer, ground: (x, z) => sampleGrid(grid, x / view.resX - 0.5, z / view.resZ - 0.5), aerial, redraw: () => {} };
      const terrain = terrainLayer({ renderer, style: () => style, multiply: !!view.rgb });
      terrain.layer.setOpacity(opacity);
      layers.push({ id: "hillshade", label: "Hillshade", visible: true, opacity, adjustable: true, olLayer: terrain.layer, dispose: terrain.dispose,
        onParams: (p) => {
          if (p.exaggeration === style.exaggeration && p.contour === style.contour && p.slope === style.slope) return;
          style = { exaggeration: p.exaggeration, contour: p.contour, slope: p.slope };
          terrain.redraw();
        } });
    } else {
      const shade = memoLast((exaggeration: number) => buildHillshade(grid, view.resX, view.resZ, exaggeration, sunOfLook(look)));
      const hs = add("hillshade", "Hillshade", { image: () => shade(style.exaggeration), rect, smooth: true, multiply: !!view.rgb }, opacity);
      hs.entry.onParams = (p) => {
        if (p.exaggeration !== style.exaggeration) {
          style = { ...style, exaggeration: p.exaggeration };
          hs.redraw();
        }
      };
    }
  }

  const readout = (x: number, z: number, fmt: Formatter): ReadoutLine[] => {
    const col = x / view.resX;
    const row = z / view.resZ;
    if (col < 0 || row < 0 || col > w || row > h) return [{ text: "outside the raster" }];
    const cx = a * col + b * row + c;
    const cy = d * col + e * row + f;
    const lines: ReadoutLine[] = [
      { text: `pixel ${Math.floor(col * view.decimation)}, ${Math.floor(row * view.decimation)}` },
      { text: view.geographic ? `lon ${cx.toFixed(6)}  lat ${cy.toFixed(6)}` : `E ${cx.toFixed(1)}  N ${cy.toFixed(1)}` },
      { text: `${fmt.distance(x)} east, ${fmt.distance(z)} south of the corner` },
    ];
    if (grid) {
      const height = sampleGrid(grid, col - 0.5, row - 0.5);
      lines.push({ text: height === null ? "elevation: no data" : `elevation ${fmt.height(height)}` });
    }
    return lines;
  };

  return {
    view,
    scene: {
      key: `tif:${path}`,
      kind: "tif",
      title: path.split("/").pop()!,
      subtitle: (fmt) => `${path} · ${view.width} x ${view.height} px, ${fmt.distance(rect.w, 0)} x ${fmt.distance(rect.h, 0)}`,
      extent: rect, layers, readout, terrain: terrainSource,
    },
  };
}
