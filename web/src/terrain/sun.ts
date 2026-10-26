// The light every terrain view uses: the look's sun, so the 2D relief and the 3D view agree.

import type { Look } from "../api/api";

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

/** Where the look's sun is. */
export const sunOfLook = (look: Look): Sun => solarPosition(look.sun.latitude, look.sun.declination, look.sun.hourAngle);

/** The unit vector pointing at the sun in course axes: x east, y up, z south. */
export function sunDirection(sun: Sun): [number, number, number] {
  const c = Math.cos(sun.altitude);
  return [Math.sin(sun.azimuth) * c, Math.sin(sun.altitude), -Math.cos(sun.azimuth) * c];
}
