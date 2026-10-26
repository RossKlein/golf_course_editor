export type DragMode = "orbit" | "pan";

/**
 * What dragging with a mouse button does to the 3D camera, or null when the button is not the camera's.
 *
 * Normally the left button orbits and the others (or any with Shift or Ctrl) pan. While a tool works on the ground the left
 * button belongs to it, so orbiting moves to the right button; the middle button, Shift with the right, or Space with the
 * left pan, as on the map.
 */
export function dragMode(e: { button: number; shiftKey: boolean; ctrlKey: boolean }, tool: boolean, space: boolean): DragMode | null {
  if (!tool) return e.button === 0 && !e.shiftKey && !e.ctrlKey ? "orbit" : "pan";
  if (e.button === 1 || (e.button === 0 && space) || (e.button === 2 && e.shiftKey)) return "pan";
  if (e.button === 2) return "orbit";
  return null;
}
