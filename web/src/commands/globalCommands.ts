import { EDITORS } from "../editors/registry";
import type { Command } from "./keymap";

export type GlobalActions = {
  canEdit: boolean;
  undo: () => void;
  redo: () => void;
  build: () => void;
  fit: () => void;
  zoom: (factor: number) => void;
  pan: (fx: number, fy: number) => void;
  toggleLeft: () => void;
  toggleUnits: () => void;
  help: () => void;
  goto: (editor: string) => void;
};

/** Commands that work in every editor. */
export function globalCommands(a: GlobalActions): Command[] {
  const g = "global" as const;
  const edit = () => a.canEdit;
  return [
    { id: "edit.undo", label: "Undo", scope: g, keys: ["$mod+z"], group: "Edit", when: edit, run: a.undo },
    { id: "edit.redo", label: "Redo", scope: g, keys: ["$mod+Shift+z", "$mod+y"], group: "Edit", when: edit, run: a.redo },
    { id: "edit.build", label: "Build the bundle now", scope: g, keys: ["$mod+s"], group: "Edit", when: edit, run: a.build },
    { id: "view.fit", label: "Fit the course", scope: g, keys: ["0", "Shift+F"], group: "View", run: a.fit },
    { id: "view.zoomIn", label: "Zoom in", scope: g, keys: ["Equal", "Shift+Equal", "NumpadAdd"], group: "View", run: () => a.zoom(1.5) },
    { id: "view.zoomOut", label: "Zoom out", scope: g, keys: ["Minus", "NumpadSubtract"], group: "View", run: () => a.zoom(1 / 1.5) },
    { id: "view.panLeft", label: "Pan left", scope: g, keys: ["ArrowLeft"], group: "View", run: () => a.pan(-0.25, 0) },
    { id: "view.panRight", label: "Pan right", scope: g, keys: ["ArrowRight"], group: "View", run: () => a.pan(0.25, 0) },
    { id: "view.panUp", label: "Pan up", scope: g, keys: ["ArrowUp"], group: "View", run: () => a.pan(0, -0.25) },
    { id: "view.panDown", label: "Pan down", scope: g, keys: ["ArrowDown"], group: "View", run: () => a.pan(0, 0.25) },
    { id: "view.left", label: "Show or hide the file panel", scope: g, keys: ["$mod+b"], group: "View", run: a.toggleLeft },
    { id: "view.units", label: "Switch between US and metric units", scope: g, keys: ["Shift+U"], group: "View", run: a.toggleUnits },
    { id: "help", label: "Keyboard shortcuts", scope: g, keys: ["Shift+Slash", "F1"], group: "Help", run: a.help },
    ...EDITORS.filter((e) => e.enabled).map((e): Command => ({ id: `goto.${e.id}`, label: `Open the ${e.label} editor`, scope: g, keys: [e.goto], group: "Go to", run: () => a.goto(e.id) })),
  ];
}
