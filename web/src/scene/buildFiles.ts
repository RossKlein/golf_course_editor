/**
 * What a finished build changed. The server says, for each file it wrote, a hash of it (`BuildStatus.files`); a file whose hash is
 * the one the viewer last saw is not fetched, decoded or uploaded again. A tree edit changes trees.bin and course.json and nothing
 * else, and reloading the class map for it (a 10-million-cell image) was most of what made the editor stutter.
 */
export type BuildFiles = Readonly<Record<string, string>>;

/**
 * The files whose hash differs from `seen`, or `"all"` when there is nothing to compare with (the first build the viewer sees, or a
 * server that does not report hashes), so the viewer reloads everything once rather than guess.
 */
export function changedFiles(seen: BuildFiles | null, now: BuildFiles | undefined): ReadonlySet<string> | "all" {
  if (!seen || !now || !Object.keys(now).length) return "all";
  return new Set(Object.keys(now).filter((name) => seen[name] !== now[name]));
}

/** Whether a build changed `file`: true for everything when `changed` is `"all"`. */
export const touches = (changed: ReadonlySet<string> | "all", file: string) => changed === "all" || changed.has(file);
