/** Where a field is in the look: `["surfaces", "fairway", "color"]`, `["trees", "kinds", 0, "parts", 2, "r0"]`. */
export type Path = readonly (string | number)[];

/** The value at `path`, or undefined where the look has none (an optional colour a surface lacks). */
export function getPath(root: unknown, path: Path): unknown {
  let at = root;
  for (const key of path) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string | number, unknown>)[key];
  }
  return at;
}

/** Set the value at `path` in `root`, which must be a draft (Immer's) or a copy you own. A path through something missing is an error. */
export function assignPath(root: unknown, path: Path, value: unknown): void {
  if (!path.length) throw new Error("a path needs at least one step");
  const parent = getPath(root, path.slice(0, -1));
  if (parent === null || typeof parent !== "object") throw new Error(`nothing to set ${path.join(".")} in`);
  (parent as Record<string | number, unknown>)[path[path.length - 1]] = value;
}

/** `["surfaces", "fairway", "color"]` as `surfaces.fairway.color`, for keys and messages. */
export const pathKey = (path: Path) => path.join(".");

/** Every path to a leaf of `root`: a number, string, boolean or null, or a list of numbers (a colour or a range). */
export function leafPaths(root: unknown, prefix: Path = []): Path[] {
  if (Array.isArray(root) && root.every((v) => typeof v === "number")) return [prefix];
  if (root !== null && typeof root === "object") {
    return Object.entries(root).flatMap(([k, v]) => leafPaths(v, [...prefix, Array.isArray(root) ? Number(k) : k]));
  }
  return [prefix];
}
