import { useCallback, useEffect, useState, type DragEvent } from "react";
import { api, type Index, type TifView } from "../api/api";
import BundlePanel from "../bundle/BundlePanel";
import { loadBundleScene, type BundleData } from "../bundle/bundleScene";
import FileList from "../files/FileList";
import MapView from "../map/MapView";
import { initialLayerState, type LayerState, type Params, type Scene } from "../map/scene";
import LayerControls, { ExaggerationSlider } from "../panel/LayerControls";
import { hashFor, useSelection } from "../selection/selection";
import TifPanel from "../tif/TifPanel";
import { loadTifScene } from "../tif/tifScene";

type Loaded = { kind: "tif"; scene: Scene; view: TifView } | { kind: "bundle"; scene: Scene; data: BundleData };
type Status = { text: string; error?: boolean } | null;

export default function App() {
  const selection = useSelection();
  const [index, setIndex] = useState<Index | null>(null);
  const [indexError, setIndexError] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [layerState, setLayerState] = useState<LayerState>({});
  const [params, setParams] = useState<Params>({ exaggeration: 3, hole: 1 });
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);
  const [dropping, setDropping] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setIndex(await api.index());
      setIndexError("");
    } catch (e) {
      setIndexError(`Cannot reach the server: ${(e as Error).message}`);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const kind = selection?.kind;
  const path = selection?.path;
  useEffect(() => {
    if (!kind || !path) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    setStatus({ text: `Loading ${path}…` });
    const job: Promise<Loaded> =
      kind === "tif"
        ? loadTifScene(path).then((r) => ({ kind: "tif", ...r }))
        : loadBundleScene(path).then((r) => ({ kind: "bundle", scene: r.scene, data: r.data }));
    job
      .then((next) => {
        if (cancelled) return;
        setLoaded(next);
        setLayerState(initialLayerState(next.scene));
        setParams((p) => ({ ...p, hole: 1 }));
        setHover(null);
        setStatus(null);
      })
      .catch((e: Error) => !cancelled && setStatus({ text: e.message, error: true }));
    return () => {
      cancelled = true;
    };
  }, [kind, path]);

  const upload = async (files: File[]) => {
    for (const file of files) {
      if (!/\.tiff?$/i.test(file.name)) {
        setStatus({ text: `${file.name} is not a .tif`, error: true });
        continue;
      }
      setStatus({ text: `Copying ${file.name} into uploads/…` });
      try {
        const entry = await api.upload(file);
        await refresh();
        setStatus(null);
        location.hash = hashFor({ kind: "tif", path: entry.path });
      } catch (e) {
        setStatus({ text: `${file.name}: ${(e as Error).message}`, error: true });
      }
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    void upload(Array.from(e.dataTransfer.files));
  };

  const scene = loaded?.scene ?? null;
  const readout = scene && hover ? scene.readout(hover.x, hover.z) : null;
  const setExaggeration = useCallback((exaggeration: number) => setParams((p) => ({ ...p, exaggeration })), []);

  return (
    <div className={scene ? "app" : "app no-panel"}>
      <FileList index={index} error={indexError} selection={selection} onRescan={refresh} onUpload={upload} />
      <main
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        <MapView scene={scene} layerState={layerState} params={params} onHover={setHover} />
        {!scene && !status && <div className="empty">Choose a bundle or GeoTIFF, or drop a .tif here.</div>}
        {status && <div className={status.error ? "status error" : "status"}>{status.text}</div>}
        {dropping && <div className="drop">Drop to copy into uploads/</div>}
      </main>
      {loaded && (
        <aside className="panel">
          <h1>{loaded.scene.title}</h1>
          <p className="muted">{loaded.scene.subtitle}</p>
          <LayerControls
            layers={loaded.scene.layers}
            state={layerState}
            onChange={(id, patch) => setLayerState((s) => ({ ...s, [id]: { ...s[id], ...patch } }))}
          />
          {loaded.scene.layers.some((l) => l.id === "hillshade") && (
            <ExaggerationSlider value={params.exaggeration} onCommit={setExaggeration} />
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
          <p className="muted">Drag to pan, wheel to zoom, F to fit.</p>
          {loaded.kind === "tif" ? (
            <TifPanel key={loaded.view.path} view={loaded.view} onBaked={() => void refresh()} />
          ) : (
            <BundlePanel data={loaded.data} hole={params.hole} onHole={(hole) => setParams((p) => ({ ...p, hole }))} />
          )}
        </aside>
      )}
    </div>
  );
}
