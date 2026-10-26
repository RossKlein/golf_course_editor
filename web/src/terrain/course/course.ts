import type { Course } from "../../api/api";
import { loadBytes, loadPixels } from "../../decode/decode";

/** The files a bundle's course.json names, read and decoded: what a renderer needs to draw the course. */
export type CourseFiles = {
  /** The macro heightmap, as the PNG's pixels (decode with decodeHeights and the course's hMin and hMax). */
  height: ImageData;
  /** The class map: R = surface class, G = owning hole. */
  classes: ImageData;
  /** The bounds map: one in-bounds bit per hole. */
  bounds: ImageData;
  /** trees.bin, as bytes (see treesFromBin). */
  trees: ArrayBuffer;
};

/**
 * Fetch and decode the files of a course. `url` turns a file name from course.json into where to get it, so the editor and
 * the game can serve a bundle from wherever they keep it. `heightUrl` replaces the heightmap's address, for the editor, whose
 * heights are the baked base that sculpting is an offset from.
 */
export async function loadCourseFiles(course: Course, url: (file: string) => string, heightUrl?: string): Promise<CourseFiles> {
  const [height, classes, bounds, trees] = await Promise.all([
    loadPixels(heightUrl ?? url(course.height.file)),
    loadPixels(url(course.class.file)),
    loadPixels(url(course.bounds.file)),
    loadBytes(url(course.trees.file)),
  ]);
  return { height, classes, bounds, trees };
}
