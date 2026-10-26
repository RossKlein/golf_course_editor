// Which way the mowing stripes run on each hole.

export const MAX_HOLES = 24;

/**
 * The direction across a hole's mowing stripes, as a unit (x, z): perpendicular to the line from tee to green, because
 * stripes run along the line of play. A hole without a route gets stripes across x.
 */
export function stripeAcross(route: readonly (readonly [number, number])[]): [number, number] {
  if (route.length < 2) return [1, 0];
  const [x0, z0] = route[0], [x1, z1] = route[route.length - 1];
  const len = Math.hypot(x1 - x0, z1 - z0);
  return len < 1e-6 ? [1, 0] : [-(z1 - z0) / len, (x1 - x0) / len];
}

/** One across-direction per hole number, 24 of them flattened to x, z pairs for a uniform array. */
export function stripeDirections(routes: readonly (readonly (readonly [number, number])[])[]): Float32Array {
  const out = new Float32Array(MAX_HOLES * 2);
  for (let h = 0; h < MAX_HOLES; h++) out.set(stripeAcross(routes[h] ?? []), h * 2);
  return out;
}
