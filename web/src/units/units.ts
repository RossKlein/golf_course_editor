// Display units. Everything stored and sent is metres (the CRS, the bundle format and the game all are); this module
// only decides how a value is shown and how typed input is read. Golf convention in the US mixes units: long
// horizontal distances in yards, heights and short distances in feet.

export type Units = "us" | "metric";
export type Kind = "distance" | "height";

export const M_PER_FT = 0.3048; // the international foot, exact
export const M_PER_YD = 0.9144; // 3 ft, exact

export type Formatter = {
  units: Units;
  /** Long horizontal distances: yards (US) or metres. */
  distance: (metres: number, digits?: number) => string;
  /** Elevations, heights, depths and short distances: feet (US) or metres. */
  height: (metres: number, digits?: number) => string;
};

export const unitName = (units: Units, kind: Kind) => (units === "metric" ? "m" : kind === "distance" ? "yd" : "ft");

/** Metres per display unit for a kind of value. */
export const metresPer = (units: Units, kind: Kind) =>
  units === "metric" ? 1 : kind === "distance" ? M_PER_YD : M_PER_FT;

export const fromMetres = (metres: number, units: Units, kind: Kind) => metres / metresPer(units, kind);
export const toMetres = (value: number, units: Units, kind: Kind) => value * metresPer(units, kind);

const DEFAULT_DIGITS: Record<Units, Record<Kind, number>> = {
  us: { distance: 1, height: 1 },
  metric: { distance: 1, height: 2 },
};

export function makeFormatter(units: Units): Formatter {
  const show = (kind: Kind) => (metres: number, digits = DEFAULT_DIGITS[units][kind]) =>
    `${fromMetres(metres, units, kind).toFixed(digits)} ${unitName(units, kind)}`;
  return { units, distance: show("distance"), height: show("height") };
}

/** Read a typed length. A unit suffix (m, yd, ft, in) wins; otherwise the value is in the display unit. */
export function parseLength(text: string, units: Units, kind: Kind): number | null {
  const m = /^\s*(-?\d+(?:\.\d+)?|-?\.\d+)\s*(m|meters?|metres?|yd|yds|yards?|ft|feet|foot|in|inch|inches)?\s*$/i.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  const suffix = m[2]?.toLowerCase();
  if (!suffix) return toMetres(value, units, kind);
  if (/^(m|meters?|metres?)$/.test(suffix)) return value;
  if (/^(yd|yds|yards?)$/.test(suffix)) return value * M_PER_YD;
  if (/^(ft|feet|foot)$/.test(suffix)) return value * M_PER_FT;
  return (value * M_PER_FT) / 12; // inches
}

const SCALE_STEPS: Record<Units, number[]> = {
  us: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500],
  metric: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000],
};

/** A round scale-bar length at least `minPx` wide: its length in metres and its label. */
export function scaleBar(units: Units, pxPerMetre: number, minPx = 80): { metres: number; label: string } {
  const steps = SCALE_STEPS[units];
  const unit = metresPer(units, "distance");
  const step = steps.find((s) => s * unit * pxPerMetre >= minPx) ?? steps[steps.length - 1];
  const label = units === "metric" && step >= 1000 ? `${step / 1000} km` : `${step} ${unitName(units, "distance")}`;
  return { metres: step * unit, label };
}
