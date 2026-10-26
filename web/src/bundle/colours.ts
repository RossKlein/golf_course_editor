// Colours for surface classes and holes, shared by the 2D layers and the 3D view.

export const CLASS_COLORS: [number, number, number][] = [
  [106, 143, 58], [143, 209, 79], [31, 170, 89], [127, 199, 122], [224, 184, 74],
  [241, 227, 160], [59, 130, 196], [154, 154, 154], [47, 90, 42],
];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
export const holeColor = (n: number) => hslToRgb((n * 47) % 360, 0.7, 0.55);
export const css = ([r, g, b]: [number, number, number], a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`;
