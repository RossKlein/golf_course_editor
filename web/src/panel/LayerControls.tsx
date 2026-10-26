import { useEffect, useState } from "react";
import type { LayerState, SceneLayer } from "../map/scene";

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

/** Relief exaggeration; rebuilding the hillshade is costly, so commits are debounced. */
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
