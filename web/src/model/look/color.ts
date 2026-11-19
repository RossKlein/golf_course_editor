/** A colour as the look keeps it: red, green and blue, each 0 to 1. */
export type Rgb = [number, number, number];
/** Hue in degrees (0 to 360), saturation and value (0 to 1). */
export type Hsv = [number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const hex2 = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");

export const rgbToHex = ([r, g, b]: Rgb) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** `#rrggbb` or `#rgb` (with or without the `#`) as a colour, or null if it is not one. */
export function hexToRgb(text: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}

export function rgbToHsv([r, g, b]: Rgb): Hsv {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb([h, s, v]: Hsv): Rgb {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const sector = Math.floor((((h % 360) + 360) % 360) / 60);
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector];
  return [r + m, g + m, b + m];
}

/** A colour for CSS. */
export const rgbToCss = ([r, g, b]: Rgb) => `rgb(${Math.round(clamp01(r) * 255)} ${Math.round(clamp01(g) * 255)} ${Math.round(clamp01(b) * 255)})`;
