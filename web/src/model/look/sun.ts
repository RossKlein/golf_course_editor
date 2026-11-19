// The sun's controls in words. The look keeps a latitude, a declination (the sun's latitude: where it is in the year) and an hour
// angle (15 degrees an hour from solar noon, negative in the morning); the panel shows the year and the day as dates and hours.

/** The sun's declination on day `n` of the year (1 is January 1), good to about a degree. */
export const declinationOnDay = (n: number) => 23.44 * Math.sin(((2 * Math.PI) / 365) * (n + 284));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Day `n` of the year as "Apr 25". */
export function dateOfDay(n: number): string {
  let left = Math.round(n);
  for (let m = 0; m < 12; m++) {
    if (left <= MONTH_DAYS[m]) return `${MONTHS[m]} ${left}`;
    left -= MONTH_DAYS[m];
  }
  return "Dec 31";
}

/**
 * The two dates in a year when the sun's declination is `dec`, one on the way to the June solstice and one on the way back, as
 * "Apr 25" and "Aug 17". At the June solstice they are one date.
 */
export function datesOfDeclination(dec: number): [string, string] {
  const phase = Math.asin(Math.min(1, Math.max(-1, dec / 23.44))); // radians, -90 to 90 degrees
  const wrap = (n: number) => ((Math.round(n) - 1 + 365 * 4) % 365) + 1; // into 1..365
  const rising = (phase / (2 * Math.PI)) * 365 - 284;
  const falling = ((Math.PI - phase) / (2 * Math.PI)) * 365 - 284;
  return [dateOfDay(wrap(rising)), dateOfDay(wrap(falling))];
}

/** Hours from solar noon (negative before it) for an hour angle in degrees, and back. */
export const hoursFromAngle = (angle: number) => angle / 15;
export const angleFromHours = (hours: number) => hours * 15;

/** "2.4 h before solar noon", "solar noon", "1 h after solar noon". */
export function describeHours(hours: number): string {
  const h = Math.abs(Math.round(hours * 10) / 10);
  if (h === 0) return "solar noon";
  return `${h} h ${hours < 0 ? "before" : "after"} solar noon`;
}
