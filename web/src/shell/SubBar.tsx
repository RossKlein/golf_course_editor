import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EditorState } from "../core/api/api";
import { CLASS_COLORS, css } from "../scene/bundleScene";
import { BOUNDS_TOOLS, FEATURE_MODES } from "../editors/bounds/useBoundsEditor";
import { useMeasureLabel } from "../editors/course/measure";
import { CLASS_KEYS, TOOLS } from "../editors/course/useCourseEditor";
import { editorMeta } from "../editors/registry";
import { TREE_TOOLS } from "../editors/trees/tools";
import { ALL_HEIGHT_TOOLS, HEIGHT_TOOLS, hasPanel, isBrushTool } from "../editors/heightmap/tools";
import MeshBar from "./MeshBar";
import { MAX_RADIUS, MIN_RADIUS } from "../terrain/sculpt/brush";
import type { Formatter } from "../core/units/units";
import { Hint } from "../ui/Hint";
import { useDesign } from "../model/design/store";
import type { Pt } from "../core/geometry/coords";
import { shapeWidth } from "../core/geometry/pathShape";
import { PATH_CLASS, PATH_WIDTH } from "../model/design/path";
import { MIN_PATH_WIDTH, selectedPaths, startWidthSession, type WidthSession } from "../model/design/pathWidth";

type Props = {
  editor: EditorState;
  patch: (p: Partial<EditorState>) => void;
  notice: string;
  canEdit: boolean;
  holeCount: number;
  /** Make a hole active and bring it into view. */
  onHole: (n: number) => void;
  onAddHole: () => void;
  /** A range is not played as holes, so the hole stepper and the route tool stay hidden. */
  isRange: boolean;
  /** The 3D view is showing, so the editor's tools are idle. */
  view3d: boolean;
  fmt: Formatter;
  /** The Heightmap editor can sculpt here (the GPU renders to float textures). */
  canSculpt: boolean;
  /** Add points to the selected regions to round their outlines (the Course editor). */
  onRound: () => void;
  /** Give the selected greens, or every green, a collar (the Course editor). */
  onCollar: () => void;
  /** The open bundle (null for a GeoTIFF), for the Heightmap editor's second bar. */
  bundle: string | null;
  /** Put the terrain back to what was baked. */
  onRestoreAll: () => void;
  /** Save what the editor has not yet, before the server rewrites the bundle's files. */
  save: () => Promise<void>;
  say: (text: string) => void;
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

/** Rounds the selected regions' outlines: shown with the Select tool in the Course editor, and enabled when a region is selected. */
function RoundButton({ editor, onRound }: { editor: EditorState; onRound: () => void }) {
  const selected = useDesign((s) => s.selected.filter((id) => !!s.doc.regions[id]).length);
  if (editor.tool !== "select") return null;
  return (
    <Hint label="Add a point on the smooth curve between every pair of corners of the selected regions, to round them. Corners stay where they are; press again for more points" keys={["Shift+O"]}>
      <button type="button" disabled={!selected} onClick={onRound}>Round{selected > 1 ? ` ${selected}` : ""}</button>
    </Hint>
  );
}

/** Adds a collar round the selected greens (or every green when none is selected), shown with the Select tool beside Round. */
function CollarControls({ editor, patch, fmt, onCollar }: { editor: EditorState; patch: Props["patch"]; fmt: Formatter; onCollar: () => void }) {
  const greens = useDesign((s) => s.doc.order.filter((id) => s.doc.regions[id]?.class === 2).length);
  const selected = useDesign((s) => s.selected.filter((id) => s.doc.regions[id]?.class === 2).length);
  if (editor.tool !== "select") return null;
  return (
    <>
      <Hint label="Ring the selected greens with a collar, or every green when none is selected: a Collar region the green's outline grown outward by the thickness, tucked under the green. A green that already has one is skipped" keys={["Shift+K"]}>
        <button type="button" disabled={!greens} onClick={onCollar}>Collar{selected ? ` ${selected}` : greens > 1 ? " all" : ""}</button>
      </Hint>
      <label className="slider" title="How thick the collar is, from the green's edge outward">
        Thickness {fmt.distance(editor.collarThickness, 1)}
        <input type="range" min={0.3} max={5} step={0.1} value={editor.collarThickness} onChange={(e) => patch({ collarThickness: Number(e.target.value) })} />
      </label>
    </>
  );
}

/**
 * The width of the selected paths, shown with the Select tool whenever one is selected: drag to widen or narrow them (their whole edge moves
 * in or out, live), as one undo step. The slider starts at the first selected path's width, worked out from its outline, so it is close for a
 * long path and a little low for a short one.
 */
function SelectedPathWidth({ fmt, say }: { fmt: Formatter; say: (text: string) => void }) {
  const first = useDesign((s) => {
    const id = s.selected.find((x) => s.doc.regions[x]?.class === PATH_CLASS);
    const r = id ? s.doc.regions[id] : undefined;
    return r ? Math.round(shapeWidth(r.outer as Pt[], r.inner as Pt[][]) * 10) / 10 : 0;
  });
  const count = useDesign((s) => s.selected.filter((x) => s.doc.regions[x]?.class === PATH_CLASS).length);
  const session = useRef<WidthSession | null>(null);
  const frame = useRef(0);
  const latest = useRef<number | null>(null); // the width the slider is at, until it has been applied
  const [dragging, setDragging] = useState<number | null>(null);

  // end the drag: the last value is applied at once (not left to the next frame), and the whole drag is one undo step
  const finish = () => {
    cancelAnimationFrame(frame.current);
    const s = session.current;
    if (!s) return;
    if (latest.current !== null) s.set(latest.current);
    latest.current = null;
    session.current = null;
    setDragging(null);
    const split = s.end();
    if (split) say(`Narrowing split ${split === 1 ? "a path" : `${split} paths`} in two, so only the larger piece of each was kept. Ctrl+Z puts it back.`);
  };
  useEffect(() => finish, []); // leaving mid-drag still ends the undo step
  useEffect(() => void (count === 0 && finish()), [count]);

  if (!count) return null;
  const change = (width: number) => {
    session.current ??= startWidthSession(selectedPaths());
    if (!session.current) return;
    setDragging(width);
    latest.current = width;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (latest.current !== null) session.current?.set(latest.current); // the latest value, at most once a frame
      latest.current = null;
    });
  };
  const shown = dragging ?? first;
  return (
    <label className="slider" title="How wide the selected path is, edge to edge: drag to widen or narrow it. The whole edge moves in or out, so a bend or a rounded end keeps its shape. Worked out from the outline, so it is approximate for a short path">
      Path width {fmt.distance(shown, 1)}
      <input
        type="range"
        min={MIN_PATH_WIDTH}
        max={PATH_WIDTH.max}
        step={0.1}
        value={Math.min(Math.max(shown, MIN_PATH_WIDTH), PATH_WIDTH.max)}
        onChange={(e) => change(Number(e.target.value))}
        onPointerUp={finish}
        onKeyUp={finish}
        onBlur={finish}
      />
    </label>
  );
}

/** The width a path is made at: shown with the Path tool. */
function PathWidth({ editor, patch, fmt }: { editor: EditorState; patch: Props["patch"]; fmt: Formatter }) {
  if (editor.tool !== "path") return null;
  return (
    <label className="slider" title="How wide the path is made, edge to edge">
      Width {fmt.distance(editor.pathWidth, 1)}
      <input type="range" min={0.5} max={16} step={0.1} value={editor.pathWidth} onChange={(e) => patch({ pathWidth: Number(e.target.value) })} />
    </label>
  );
}

function Simplify({ editor, patch }: { editor: EditorState; patch: Props["patch"] }) {
  if (editor.tool !== "freehand" && editor.tool !== "path") return null;
  return (
    <label className="slider" title="How far a freehand line may stray from what you drew when it is saved, in screen pixels. 0 keeps every point.">
      Simplify
      <input type="range" min={0} max={5} step={0.1} value={editor.smoothing} onChange={(e) => patch({ smoothing: Number(e.target.value) })} />
    </label>
  );
}

/** The open editor's options: tools, what it draws with, the active hole, snapping and what to show. */
export default function SubBar({ editor, patch, notice, canEdit, holeCount, onHole, onAddHole, isRange, view3d, fmt, canSculpt, onRound, onCollar, bundle, onRestoreAll, save, say }: Props) {
  const measured = useMeasureLabel();
  const meta = editorMeta(editor.editor);
  const sculpting3d = view3d && editor.editor === "heightmap" && canEdit && canSculpt; // the brush works in 3D, so it keeps its bar
  const treeing3d = view3d && editor.editor === "trees" && canEdit; // so do the Trees editor's tools
  if (view3d && !sculpting3d && !treeing3d) {
    return (
      <div className="sub-bar">
        <span className="sub-hint">3D view: drag to orbit, right-drag to pan, wheel to zoom. Press <kbd>3</kbd> to go back to the 2D map and keep editing.</span>
      </div>
    );
  }
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
  if (editor.editor === "heightmap") {
    if (!canSculpt) {
      return (
        <div className="sub-bar">
          <span className="sub-hint">Sculpting needs a GPU that can render to float textures (WebGL2 with EXT_color_buffer_float), and this one cannot.</span>
        </div>
      );
    }
    const brush = ALL_HEIGHT_TOOLS.find((b) => b.id === editor.tool);
    // the second bar, attached under the first: what changes the shape of the map
    const bars = (first: ReactNode) => (
      <div className="sub-bars">
        {first}
        {bundle && <MeshBar editor={editor} patch={patch} bundle={bundle} onRestoreAll={onRestoreAll} save={save} say={say} />}
      </div>
    );
    if (!isBrushTool(editor.tool)) {
      // the lake basin, the crop and the outline tools take no brush, so there are no sliders (the basin and the crop have a panel)
      return bars(
        <div className="sub-bar">
          <ToolButtons tools={HEIGHT_TOOLS} editor={editor} patch={patch} />
          {notice ? <span className="sub-notice" role="alert">{notice}</span> : <span className="sub-hint tool-hint" title={brush?.hint}>{brush?.hint}{hasPanel(editor.tool) ? ". The settings are in the panel." : "."}</span>}
        </div>,
      );
    }
    return bars(
      <div className="sub-bar">
        <ToolButtons tools={HEIGHT_TOOLS} editor={editor} patch={patch} />
        <label className="slider" title="Brush size. [ and ] change it">
          Size {fmt.distance(editor.brushRadius, 0)}
          <input type="range" min={MIN_RADIUS} max={MAX_RADIUS} step={1} value={editor.brushRadius} onChange={(e) => patch({ brushRadius: Number(e.target.value) })} />
        </label>
        <label className="slider" title="How fast the brush works. Shift+[ and Shift+] change it">
          Strength {Math.round(editor.brushStrength * 100)}%
          <input type="range" min={0.02} max={1} step={0.01} value={editor.brushStrength} onChange={(e) => patch({ brushStrength: Number(e.target.value) })} />
        </label>
        <label className="slider" title="0 is a soft dome; 1 is full strength right out to the edge">
          Hardness {Math.round(editor.brushHardness * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={editor.brushHardness} onChange={(e) => patch({ brushHardness: Number(e.target.value) })} />
        </label>
        {editor.tool === "clone" && (
          <Check label="Shape only" hint="Copy how much the source rises and falls, and set it on the ground where you start painting, so a hill sits on its new ground. Off copies the exact heights, cliffs and all" checked={editor.cloneRelative} onChange={(cloneRelative) => patch({ cloneRelative })} />
        )}
        {notice ? (
          <span className="sub-notice" role="alert">{notice}</span>
        ) : (
          <span className="sub-hint tool-hint" title={brush?.hint}>{brush?.hint}. {view3d ? <>Press <kbd>3</kbd> for the 2D map.</> : <><kbd>Shift</kbd>+<kbd>C</kbd> contours, <kbd>Shift</kbd>+<kbd>S</kbd> slope.</>}</span>
        )}
      </div>,
    );
  }
  if (editor.editor === "trees") {
    const brushed = editor.tool === "remove" || editor.tool === "erase";
    const tool = TREE_TOOLS.find((t) => t.id === editor.tool);
    return (
      <div className="sub-bar">
        <ToolButtons tools={TREE_TOOLS} editor={editor} patch={patch} />
        {brushed && (
          <label className="slider" title="Brush size. [ and ] change it">
            Size {fmt.distance(editor.brushRadius, 0)}
            <input type="range" min={MIN_RADIUS} max={MAX_RADIUS} step={1} value={editor.brushRadius} onChange={(e) => patch({ brushRadius: Number(e.target.value) })} />
          </label>
        )}
        {notice ? <span className="sub-notice" role="alert">{notice}</span> : <span className="sub-hint tool-hint" title={tool?.hint}>{tool?.hint}{view3d ? <>. Press <kbd>3</kbd> for the 2D map.</> : "."}</span>}
      </div>
    );
  }
  const bounds = editor.editor === "bounds";
  const tools: readonly Tool[] = bounds ? BOUNDS_TOOLS : isRange ? TOOLS.filter((t) => t.id !== "route") : TOOLS;
  const toolHint = tools.find((t) => t.id === editor.tool)?.hint;
  return (
    <div className="sub-bar">
      <ToolButtons tools={tools} editor={editor} patch={patch} />
      {!bounds && editor.tool === "measure" && measured && <span className="measure-readout">{measured}</span>}
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
      {isRange ? null : (
      <HoleStepper
        editor={editor}
        holeCount={holeCount}
        onHole={onHole}
        onAddHole={onAddHole}
        title={bounds ? "The hole whose bounds you are drawing" : "New fairways, greens and tees are assigned to this hole"}
      />
      )}
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
      <PathWidth editor={editor} patch={patch} fmt={fmt} />
      <Simplify editor={editor} patch={patch} />
      {bounds ? null : <RoundButton editor={editor} onRound={onRound} />}
      {bounds ? null : <CollarControls editor={editor} patch={patch} fmt={fmt} onCollar={onCollar} />}
      {bounds || editor.tool !== "select" ? null : <SelectedPathWidth fmt={fmt} say={say} />}
      {notice && <span className="sub-notice" role="alert">{notice}</span>}
      {!notice && toolHint && <span className="sub-hint tool-hint" title={toolHint}>{toolHint}</span>}
    </div>
  );
}
