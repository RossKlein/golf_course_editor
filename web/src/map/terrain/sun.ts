// The light every terrain view uses. One sun, so the 2D relief and the 3D view agree.

const rad = (deg: number) => (deg * Math.PI) / 180;

export type Sun = {
  /** Compass bearing of the sun, clockwise from north, radians. */
  azimuth: number;
  /** Height above the horizon, radians. */
  altitude: number;
};

/**
 * Where the sun is for a place, a time of year and a time of day. `declination` is the sun's latitude (23.44 at the June
 * solstice) and `hourAngle` is 15 degrees per hour from solar noon, negative in the morning.
 */
export function solarPosition(latitude: number, declination: number, hourAngle: number): Sun {
  const [phi, delta, h] = [rad(latitude), rad(declination), rad(hourAngle)];
  const altitude = Math.asin(Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(h));
  // measured from the south towards the west, then turned to a compass bearing
  const fromSouth = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(delta) * Math.cos(phi));
  return { azimuth: (fromSouth + Math.PI + 2 * Math.PI) % (2 * Math.PI), altitude };
}

/**
 * 11 am daylight time in midsummer on the US east coast, taken at Augusta's latitude. Solar noon there is about 1:25 pm
 * daylight time (the clock runs an hour ahead and the city sits west of its time zone's meridian), so 11 am is about
 * 2.4 hours before it: an hour angle of -36 degrees. That puts the sun nearly due east and high, about 98 degrees round
 * and 57 degrees up.
 */
export const SUN: Sun = solarPosition(33.5, 23.44, -36);

/** The unit vector pointing at the sun in course axes: x east, y up, z south. */
export function sunDirection(sun: Sun = SUN): [number, number, number] {
  const c = Math.cos(sun.altitude);
  return [Math.sin(sun.azimuth) * c, Math.sin(sun.altitude), -Math.cos(sun.azimuth) * c];
}
