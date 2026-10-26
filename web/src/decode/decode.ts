import { SUN } from "../map/terrain/sun";

// Pixel decoding shared by the bundle and GeoTIFF views. PNGs are decoded with no color conversion, exactly as
// the game's loader will (docs/golf-course-format.md): 16-bit heights live in R (high byte) and G (low byte).

export type HeightGrid = { values: Float32Array; valid: Uint8Array; cols: number; rows: number };

export async function loadPixels(url: string): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  const bitmap = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const off = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = off.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0);
  return g.getImageData(0, 0, bitmap.width, bitmap.height);
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

export async function loadBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.arrayBuffer();
}

export function pixelCanvas(width: number, height: number, fill: (data: Uint8ClampedArray) => void) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const img = new ImageData(width, height);
  fill(img.data);
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

/** Heights in metres from an RG16 image. A = 0 marks no data (only GeoTIFF renders use it). */
export function decodeHeights(px: ImageData, hMin: number, hMax: number): HeightGrid {
  const n = px.width * px.height;
  const values = new Float32Array(n);
  const valid = new Uint8Array(n);
  const scale = (hMax - hMin) / 65535;
  for (let i = 0; i < n; i++) {
    values[i] = hMin + (px.data[i * 4] * 256 + px.data[i * 4 + 1]) * scale;
    valid[i] = px.data[i * 4 + 3] > 0 ? 1 : 0;
  }
  return { values, valid, cols: px.width, rows: px.height };
}

/** Bilinear sample at fractional sample indices, clamped to the grid; null where data is missing. */
export function sampleGrid(grid: HeightGrid, fx: number, fz: number): number | null {
  const { values, valid, cols, rows } = grid;
  if (cols < 2 || rows < 2) return valid[0] ? values[0] : null;
  fx = Math.min(Math.max(fx, 0), cols - 1);
  fz = Math.min(Math.max(fz, 0), rows - 1);
  const c0 = Math.min(Math.floor(fx), cols - 2);
  const r0 = Math.min(Math.floor(fz), rows - 2);
  const k = [r0 * cols + c0, r0 * cols + c0 + 1, (r0 + 1) * cols + c0, (r0 + 1) * cols + c0 + 1];
  if (!k.every((i) => valid[i])) return null;
  const tx = fx - c0;
  const tz = fz - r0;
  const v = k.map((i) => values[i]);
  return (v[0] * (1 - tx) + v[1] * tx) * (1 - tz) + (v[2] * (1 - tx) + v[3] * tx) * tz;
}

/** Grey hillshade lit by the terrain sun (map/terrain/sun.ts). Missing data is transparent. */
export function buildHillshade(grid: HeightGrid, resX: number, resZ: number, exaggeration: number) {
  return pixelCanvas(grid.cols, grid.rows, (d) => hillshadePixels(grid, resX, resZ, exaggeration, d));
}

/** The pixels of the hillshade, written into `d` (RGBA, one per sample). The viewer's fallback when WebGL2 is missing. */
export function hillshadePixels(grid: HeightGrid, resX: number, resZ: number, exaggeration: number, d: Uint8ClampedArray) {
  const { values, valid, cols, rows } = grid;
  const az = SUN.azimuth;
  const alt = SUN.altitude;
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

/** Remember the last result of a one-argument function (layer images rebuilt only when their input changes). */
export function memoLast<K, V>(fn: (key: K) => V): (key: K) => V {
  let last: { key: K; value: V } | null = null;
  return (key) => {
    if (!last || last.key !== key) last = { key, value: fn(key) };
    return last.value;
  };
}
