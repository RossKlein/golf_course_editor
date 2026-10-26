/** The editors, in the order of the editor bar. Only enabled ones can be opened; the rest are placeholders for later phases. */
export type EditorMeta = { id: string; label: string; goto: string; enabled: boolean; hint: string };

export const EDITORS: EditorMeta[] = [
  { id: "view", label: "View", goto: "g v", enabled: true, hint: "Look around: layers, readouts and problems" },
  { id: "course", label: "Course", goto: "g c", enabled: true, hint: "Draw surfaces, assign holes, edit course data" },
  { id: "bounds", label: "Out of bounds", goto: "g o", enabled: true, hint: "Draw where each hole may be played from" },
  { id: "patches", label: "Hi-res patches", goto: "g p", enabled: false, hint: "0.25 m height patches" },
  { id: "greens", label: "Greens", goto: "g r", enabled: false, hint: "Contour greens" },
  { id: "heightmap", label: "Heightmap", goto: "g h", enabled: false, hint: "Sculpt the 1 m terrain" },
  { id: "trees", label: "Trees", goto: "g t", enabled: false, hint: "Forest zones and trees" },
  { id: "landmarks", label: "Landmarks", goto: "g l", enabled: false, hint: "Place special objects" },
];

export const editorMeta = (id: string) => EDITORS.find((e) => e.id === id) ?? EDITORS[0];
