import { ChevronLeft, ChevronRight } from "lucide-react";
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
};

/** The open editor's options: tools, surface palette, active hole, snapping. */
export default function SubBar({ editor, patch, notice, canEdit, holeCount }: Props) {
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
  const holeLabel = holeCount ? `Hole ${editor.hole} of ${holeCount}` : `Hole ${editor.hole}`;
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
          <button type="button" className="icon" onClick={() => patch({ hole: Math.max(1, editor.hole - 1) })} aria-label="Previous hole"><ChevronLeft size={14} /></button>
        </Hint>
        <span className="hole-label" title="New fairways, greens and tees are assigned to this hole">{holeLabel}</span>
        <Hint label="Next hole" keys={["BracketRight"]}>
          <button type="button" className="icon" onClick={() => patch({ hole: Math.min(24, editor.hole + 1) })} aria-label="Next hole"><ChevronRight size={14} /></button>
        </Hint>
      </div>
      <label className="check"><input type="checkbox" checked={editor.snap} onChange={(e) => patch({ snap: e.target.checked })} /> Snap</label>
      {editor.tool === "freehand" && (
        <label className="slider" title="How much a freehand line is simplified, in metres">
          Smoothing
          <input type="range" min={0.2} max={5} step={0.1} value={editor.smoothing} onChange={(e) => patch({ smoothing: Number(e.target.value) })} />
        </label>
      )}
      {notice && <span className="sub-notice" role="alert">{notice}</span>}
    </div>
  );
}
