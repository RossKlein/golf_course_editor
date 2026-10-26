import { Tabs } from "radix-ui";
import { Redo2, Undo2, CircleHelp, Hammer } from "lucide-react";
import type { BuildStatus } from "../api/api";
import type { DesignSave } from "../design/useDesignSession";
import { EDITORS } from "../editors/registry";
import { Hint } from "../ui/Hint";

type Props = {
  editor: string;
  onEditor: (id: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onHelp: () => void;
  onBuild: () => void;
  editable: boolean;
  save: DesignSave;
  build: BuildStatus | null;
  loadError: string | null;
};

function status(save: DesignSave, build: BuildStatus | null, loadError: string | null) {
  if (loadError) return { text: `Design problem: ${loadError}`, tone: "bad" as const };
  if (save.kind === "error") return { text: `Couldn't save: ${save.message}`, tone: "bad" as const };
  if (save.kind === "saving") return { text: "Saving…", tone: "" as const };
  if (build?.state === "failed") return { text: `Build failed: ${build.error}`, tone: "bad" as const };
  if (build?.state === "building") return { text: "Building…", tone: "" as const };
  const problems = build?.report?.errors.length ?? 0;
  const parts = [save.kind === "saved" ? "Saved" : null, build?.id ? `Built #${build.id}` : null, problems ? `${problems} problem${problems === 1 ? "" : "s"}` : null].filter(Boolean);
  return { text: parts.join(" · ") || "No changes yet", tone: problems ? ("warn" as const) : ("" as const) };
}

/** The top bar: which editor is open, undo/redo, and one line saying where saving and building stand. */
export default function EditorBar({ editor, onEditor, canUndo, canRedo, onUndo, onRedo, onHelp, onBuild, editable, save, build, loadError }: Props) {
  const st = status(save, build, loadError);
  return (
    <header className="editor-bar">
      <Tabs.Root value={editor} onValueChange={onEditor}>
        <Tabs.List className="editor-tabs" aria-label="Editors">
          {EDITORS.map((e) => (
            <Hint key={e.id} label={e.enabled ? e.hint : `${e.label}: coming in a later phase`} keys={e.enabled ? [e.goto] : undefined}>
              <span>
                <Tabs.Trigger value={e.id} disabled={!e.enabled} className="editor-tab">
                  {e.label}
                </Tabs.Trigger>
              </span>
            </Hint>
          ))}
        </Tabs.List>
      </Tabs.Root>
      <div className="bar-right">
        {editable && (
          <>
            <Hint label="Undo" keys={["$mod+z"]}>
              <button type="button" className="icon" disabled={!canUndo} onClick={onUndo} aria-label="Undo"><Undo2 size={16} /></button>
            </Hint>
            <Hint label="Redo" keys={["$mod+Shift+z", "$mod+y"]}>
              <button type="button" className="icon" disabled={!canRedo} onClick={onRedo} aria-label="Redo"><Redo2 size={16} /></button>
            </Hint>
            <Hint label="Build the bundle now" keys={["$mod+s"]}>
              <button type="button" className="icon" onClick={onBuild} aria-label="Build now"><Hammer size={16} /></button>
            </Hint>
            <span className={`bar-status ${st.tone}`} role="status">{st.text}</span>
          </>
        )}
        <Hint label="Keyboard shortcuts" keys={["Shift+Slash"]}>
          <button type="button" className="icon" onClick={onHelp} aria-label="Keyboard shortcuts"><CircleHelp size={16} /></button>
        </Hint>
      </div>
    </header>
  );
}
