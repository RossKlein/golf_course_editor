import { Tabs } from "radix-ui";
import type { BuildStatus, EditorState, TifView } from "../core/api/api";
import type { BundleData } from "../scene/bundleScene";
import type { LayerState, ReadoutLine, Scene } from "../scene/scene";
import LayerControls, { ExaggerationSlider, TerrainControls } from "../panel/LayerControls";
import TifPanel from "../tif/TifPanel";
import type { Formatter, Units } from "../core/units/units";
import DataTab from "./DataTab";

type Props = {
  scene: Scene;
  tif: TifView | null;
  bundle: BundleData | null;
  build: BuildStatus | null;
  editor: EditorState;
  patch: (p: Partial<EditorState>) => void;
  layerState: LayerState;
  onLayer: (id: string, patch: Partial<LayerState[string]>) => void;
  readout: ReadoutLine[] | null;
  fmt: Formatter;
  units: Units;
  onBaked: () => void;
  onHole: (n: number) => void;
  onAddHole: () => void;
  onAssign: () => void;
};

/** The viewer and info side: a View tab (layers, readout) and a Data tab (selection, builds, problems, bake). */
export default function RightPanel({ scene, tif, bundle, build, editor, patch, layerState, onLayer, readout, fmt, units, onBaked, onHole, onAddHole, onAssign }: Props) {
  return (
    <aside className="panel">
      <h1>{scene.title}</h1>
      <p className="muted">{scene.subtitle(fmt)}</p>
      <Tabs.Root value={editor.rightTab} onValueChange={(v) => patch({ rightTab: v as EditorState["rightTab"] })}>
        <Tabs.List className="side-tabs" aria-label="Panel">
          <Tabs.Trigger value="view">View</Tabs.Trigger>
          <Tabs.Trigger value="data">Data</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="view">
          <LayerControls layers={scene.layers} state={layerState} onChange={onLayer} />
          {scene.layers.some((l) => l.id === "hillshade") && (
            <>
              <ExaggerationSlider value={editor.exaggeration} onCommit={(exaggeration) => patch({ exaggeration })} />
              <TerrainControls editor={editor} units={units} patch={patch} />
            </>
          )}
          {bundle && (
            <label title="How strongly the surfaces, bounds and other editor shapes are drawn over the map. Routes are not affected.">
              Overlay opacity {Math.round(editor.overlayOpacity * 100)}%
              <input type="range" min={0} max={1} step={0.05} value={editor.overlayOpacity} onChange={(e) => patch({ overlayOpacity: Number(e.target.value) })} />
            </label>
          )}
          <pre className="readout">
            {readout
              ? readout.map((line, i) => (
                  <div key={i}>
                    {line.color && <span className="swatch" style={{ background: line.color }} />}
                    {line.text}
                  </div>
                ))
              : "Move over the map."}
          </pre>
          <p className="muted">Drag to pan, wheel to zoom. Press <kbd>?</kbd> for every shortcut.</p>
        </Tabs.Content>
        <Tabs.Content value="data">
          {bundle ? (
            <DataTab data={bundle} build={build} fmt={fmt} editor={editor.editor} hole={editor.hole} onHole={onHole} onAddHole={onAddHole} onAssign={onAssign} />
          ) : tif ? (
            <TifPanel key={tif.path} view={tif} onBaked={onBaked} />
          ) : null}
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}
