import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { EditorState } from "../api/api";
import { CLASS_COLORS, css } from "../bundle/bundleScene";
import { CLASS_KEYS, TOOLS } from "../editors/course/useCourseEditor";
import { editorMeta } from "../editors/registry";
import { Hint } from "../ui/Hint";

type Props = {
  editor: EditorState;
  patch: (p: Partial<EditorState>) => void;
  notice: string;
  canEdit: boolean;
  holeCount: number;
  /** Make a hole active and bring it into view. */
  onHole: (n: number) => void;
  onAddHole: () => void;
};

/** The open editor's options: tools, surface palette, active hole, snapping. */
export default function SubBar({ editor, patch, notice, canEdit, holeCount, onHole, onAddHole }: Props) {
  const meta = editorMeta(editor.editor);
  if (editor.editor === "view") {
    return (
      <div className="sub-bar">
        <span className="sub-hint">{meta.hint}. Press <kbd>g</kbd> <kbd>c</kbd> to open the Course editor, <kbd>?</kbd> for every shortcut.</span>
      </div>
    );
  }
  if (!canEdit) {
    return (
      <div className="sub-bar">
        <span className="sub-hint">Open a bundle to edit it. A GeoTIFF has no design to edit; bake it into a bundle first.</span>
      </div>
    );
  }
  const toolHint = TOOLS.find((t) => t.id === editor.tool)?.hint;
  const holeLabel = holeCount ? `Hole ${editor.hole} of ${holeCount}` : "No holes yet";
  return (
    <div className="sub-bar">
      <div className="group" role="group" aria-label="Tools">
        {TOOLS.map((t) => (
          <Hint key={t.id} label={t.hint} keys={[t.key]}>
            <button type="button" className={editor.tool === t.id ? "on" : undefined} aria-pressed={editor.tool === t.id} onClick={() => patch({ tool: t.id })}>
              {t.label}
            </button>
          </Hint>
        ))}
      </div>
      <div className="group palette" role="group" aria-label="Surface">
        {CLASS_KEYS.map((c) => (
          <Hint key={c.cls} label={`${c.label} surface`} keys={[c.key]}>
            <button type="button" className={editor.activeClass === c.cls ? "on" : undefined} aria-pressed={editor.activeClass === c.cls} onClick={() => patch({ activeClass: c.cls })}>
              <span className="swatch" style={{ background: css(CLASS_COLORS[c.cls]) }} />
              {c.label}
              <kbd>{c.key.toUpperCase()}</kbd>
            </button>
          </Hint>
        ))}
      </div>
      <div className="group" role="group" aria-label="Active hole">
        <Hint label="Previous hole" keys={["BracketLeft"]}>
          <button type="button" className="icon" disabled={editor.hole <= 1} onClick={() => onHole(editor.hole - 1)} aria-label="Previous hole"><ChevronLeft size={14} /></button>
        </Hint>
        <span className="hole-label" title="New fairways, greens and tees are assigned to this hole">{holeLabel}</span>
        <Hint label="Next hole" keys={["BracketRight"]}>
          <button type="button" className="icon" disabled={editor.hole >= holeCount} onClick={() => onHole(editor.hole + 1)} aria-label="Next hole"><ChevronRight size={14} /></button>
        </Hint>
        <Hint label="Add a hole" keys={["h n"]}>
          <button type="button" className="icon" onClick={onAddHole} aria-label="Add a hole"><Plus size={14} /></button>
        </Hint>
      </div>
      <label className="check"><input type="checkbox" checked={editor.snap} onChange={(e) => patch({ snap: e.target.checked })} /> Snap</label>
      <Hint label="Show only the active hole's outlines and route" keys={["h o"]}>
        <label className="check"><input type="checkbox" checked={editor.hideOthers} onChange={(e) => patch({ hideOthers: e.target.checked })} /> Only this hole</label>
      </Hint>
      {editor.tool === "freehand" && (
        <label className="slider" title="How far a freehand line may stray from what you drew when it is saved, in screen pixels. 0 keeps every point.">
          Simplify
          <input type="range" min={0} max={5} step={0.1} value={editor.smoothing} onChange={(e) => patch({ smoothing: Number(e.target.value) })} />
        </label>
      )}
      {notice && <span className="sub-notice" role="alert">{notice}</span>}
      {!notice && toolHint && <span className="sub-hint tool-hint" title={toolHint}>{toolHint}</span>}
    </div>
  );
}
