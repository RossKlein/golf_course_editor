import { useEffect, useState } from "react";
import type { EditorState } from "../api/api";
import type { LayerState, SceneLayer } from "../map/scene";
import { contourOptions, nearestContour } from "../map/terrain/contours";
import { makeFormatter, type Units } from "../units/units";

type Props = {
  layers: SceneLayer[];
  state: LayerState;
  onChange: (id: string, patch: Partial<LayerState[string]>) => void;
};

/** A visibility checkbox per layer, and an opacity slider for raster layers. */
export default function LayerControls({ layers, state, onChange }: Props) {
  return (
    <section>
      {layers.map((l) => {
        const s = state[l.id];
        if (!s) return null;
        return (
          <div key={l.id} className={l.adjustable ? "layer" : "layer toggle"}>
            <label>
              <input type="checkbox" checked={s.visible} onChange={(e) => onChange(l.id, { visible: e.target.checked })} />
              {l.label}
            </label>
            {l.adjustable && (
              <input
                type="range" min={0} max={1} step={0.05} value={s.opacity}
                onChange={(e) => onChange(l.id, { opacity: Number(e.target.value) })}
              />
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Contour spacing and the slope colouring, drawn by the terrain shader. */
export function TerrainControls({ editor, units, patch }: { editor: EditorState; units: Units; patch: (p: Partial<EditorState>) => void }) {
  const fmt = makeFormatter(units);
  const current = nearestContour(editor.contourInterval, units);
  return (
    <>
      <label title="Contour lines on the terrain, every this much height. Every fifth line is stronger. Shift+C cycles.">
        Contours
        <select value={current} onChange={(e) => patch({ contourInterval: Number(e.target.value) })}>
          {contourOptions(units).map((o) => (
            <option key={o} value={o}>{o === 0 ? "Off" : fmt.height(o, units === "metric" ? 2 : 1)}</option>
          ))}
        </select>
      </label>
      <label className="check" title="Colour the terrain by slope: blue is flat, green about 2%, yellow 4%, orange 8%, red 15% and over. Shift+S toggles.">
        <input type="checkbox" checked={editor.slopeMap} onChange={(e) => patch({ slopeMap: e.target.checked })} /> Slope colours
      </label>
    </>
  );
}

/** Relief exaggeration. Drawing is on the GPU, so the slider is cheap; commits are debounced because each is saved. */
export function ExaggerationSlider({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onCommit(local), 120);
    return () => clearTimeout(t);
  }, [local, value, onCommit]);
  return (
    <label>
      Relief exaggeration ×{local}
      <input type="range" min={1} max={10} step={0.5} value={local} onChange={(e) => setLocal(Number(e.target.value))} />
    </label>
  );
}
