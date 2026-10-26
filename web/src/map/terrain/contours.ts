import { M_PER_FT, type Units } from "../../units/units";

/** Contour spacings on offer, in metres: round numbers in the display unit, off first. */
export function contourOptions(units: Units): number[] {
  return units === "metric" ? [0, 0.1, 0.25, 0.5, 1, 2, 5] : [0, 0.5, 1, 2, 5].map((ft) => ft * M_PER_FT);
}

/** The offered spacing closest to `current` (a spacing saved under the other unit system still finds its place). */
export function nearestContour(current: number, units: Units): number {
  return contourOptions(units).reduce((best, o) => (Math.abs(o - current) < Math.abs(best - current) ? o : best));
}

/** The spacing after `current`, wrapping from the finest back to off. */
export function nextContour(current: number, units: Units): number {
  const options = contourOptions(units);
  return options[(options.indexOf(nearestContour(current, units)) + 1) % options.length];
}
