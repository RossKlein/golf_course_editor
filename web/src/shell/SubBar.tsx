import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { EditorState } from "../api/api";
import { CLASS_COLORS, css } from "../bundle/bundleScene";
import { BOUNDS_TOOLS, FEATURE_MODES } from "../editors/bounds/useBoundsEditor";
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

type Tool = { id: string; label: string; key: string; hint: string };

function ToolButtons({ tools, editor, patch }: { tools: readonly Tool[]; editor: EditorState; patch: Props["patch"] }) {
  return (
    <div className="group" role="group" aria-label="Tools">
      {tools.map((t) => (
        <Hint key={t.id} label={t.hint} keys={[t.key]}>
          <button type="button" className={editor.tool === t.id ? "on" : undefined} aria-pressed={editor.tool === t.id} onClick={() => patch({ tool: t.id })}>
            {t.label}
          </button>
        </Hint>
      ))}
    </div>
  );
}

function HoleStepper({ editor, holeCount, onHole, onAddHole, title }: Pick<Props, "editor" | "holeCount" | "onHole" | "onAddHole"> & { title: string }) {
  const label = holeCount ? `Hole ${editor.hole} of ${holeCount}` : "No holes yet";
  return (
    <div className="group" role="group" aria-label="Active hole">
      <Hint label="Previous hole" keys={["BracketLeft"]}>
        <button type="button" className="icon" disabled={editor.hole <= 1} onClick={() => onHole(editor.hole - 1)} aria-label="Previous hole"><ChevronLeft size={14} /></button>
      </Hint>
      <span className="hole-label" title={title}>{label}</span>
      <Hint label="Next hole" keys={["BracketRight"]}>
        <button type="button" className="icon" disabled={editor.hole >= holeCount} onClick={() => onHole(editor.hole + 1)} aria-label="Next hole"><ChevronRight size={14} /></button>
      </Hint>
      <Hint label="Add a hole" keys={["h n"]}>
        <button type="button" className="icon" onClick={onAddHole} aria-label="Add a hole"><Plus size={14} /></button>
      </Hint>
    </div>
  );
}

function Check({ label, hint, keys, checked, onChange }: { label: string; hint: string; keys?: string[]; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Hint label={hint} keys={keys}>
      <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
    </Hint>
  );
}

function Simplify({ editor, patch }: { editor: EditorState; patch: Props["patch"] }) {
  if (editor.tool !== "freehand") return null;
  return (
    <label className="slider" title="How far a freehand line may stray from what you drew when it is saved, in screen pixels. 0 keeps every point.">
      Simplify
      <input type="range" min={0} max={5} step={0.1} value={editor.smoothing} onChange={(e) => patch({ smoothing: Number(e.target.value) })} />
    </label>
  );
}

/** The open editor's options: tools, what it draws with, the active hole, snapping and what to show. */
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
  const bounds = editor.editor === "bounds";
  const tools: readonly Tool[] = bounds ? BOUNDS_TOOLS : TOOLS;
  const toolHint = tools.find((t) => t.id === editor.tool)?.hint;
  return (
    <div className="sub-bar">
      <ToolButtons tools={tools} editor={editor} patch={patch} />
      {bounds ? null : (
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
      )}
      <HoleStepper
        editor={editor}
        holeCount={holeCount}
        onHole={onHole}
        onAddHole={onAddHole}
        title={bounds ? "The hole whose bounds you are drawing" : "New fairways, greens and tees are assigned to this hole"}
      />
      <Check label="Snap" hint="Snap points to existing outlines" checked={editor.snap} onChange={(snap) => patch({ snap })} />
      {bounds ? (
        <>
          <div className="group" role="group" aria-label="Course features">
            <span className="group-label">Features</span>
            {FEATURE_MODES.map((m) => (
              <Hint key={m.id} label={m.hint} keys={m.id === "off" ? ["h f"] : undefined}>
                <button type="button" className={editor.boundsFeatures === m.id ? "on" : undefined} aria-pressed={editor.boundsFeatures === m.id} onClick={() => patch({ boundsFeatures: m.id })}>
                  {m.label}
                </button>
              </Hint>
            ))}
          </div>
          <Check label="All holes" hint="Also show the other holes' routes" keys={["h h"]} checked={editor.boundsAllHoles} onChange={(boundsAllHoles) => patch({ boundsAllHoles })} />
          <Check label="All bounds" hint="Also show the other holes' bounds, faintly" keys={["h b"]} checked={editor.boundsAllBounds} onChange={(boundsAllBounds) => patch({ boundsAllBounds })} />
        </>
      ) : (
        <Check label="Only this hole" hint="Show only the active hole's outlines and route" keys={["h o"]} checked={editor.hideOthers} onChange={(hideOthers) => patch({ hideOthers })} />
      )}
      <Simplify editor={editor} patch={patch} />
      {notice && <span className="sub-notice" role="alert">{notice}</span>}
      {!notice && toolHint && <span className="sub-hint tool-hint" title={toolHint}>{toolHint}</span>}
    </div>
  );
}
