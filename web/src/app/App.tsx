import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { api, type EditorState, type Index, type TifView, type Viewport } from "../api/api";
import BundlePanel from "../bundle/BundlePanel";
import { loadBundleScene, type BundleData } from "../bundle/bundleScene";
import { defaultEditorState, mergeSaved } from "../editor/editorState";
import { useEditorPersistence, type SaveStatus } from "../editor/useEditorPersistence";
import FileList from "../files/FileList";
import MapView from "../map/MapView";
import type { Scene } from "../map/scene";
import LayerControls, { ExaggerationSlider } from "../panel/LayerControls";
import { hashFor, useSelection } from "../selection/selection";
import TifPanel from "../tif/TifPanel";
import { loadTifScene } from "../tif/tifScene";
import { useFormatter, useUnits } from "../units/useUnits";

type Loaded =
  | { kind: "tif"; scene: Scene; view: TifView; editor: EditorState }
  | { kind: "bundle"; scene: Scene; data: BundleData; editor: EditorState };
type Status = { text: string; error?: boolean } | null;

function saveText(s: SaveStatus): { text: string; error: boolean } | null {
  switch (s.kind) {
    case "saving": return { text: "Saving…", error: false };
    case "saved": return { text: "Saved to .course_maker/editor.json", error: false };
    case "error": return { text: `Couldn't save: ${s.message}`, error: true };
    default: return null;
  }
}

export default function App() {
  const selection = useSelection();
  const units = useUnits();
  const fmt = useFormatter();
  const [index, setIndex] = useState<Index | null>(null);
  const [indexError, setIndexError] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<Status>(null);
  // Everything about how the user is working. Saved into the bundle's .course_maker/editor.json for bundles.
  const [editor, setEditor] = useState<EditorState>(defaultEditorState);
  const viewport = useRef<Viewport | null>(null); // the live map view; changes too often for React state
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
        ? loadTifScene(path).then((r) => ({ kind: "tif", ...r, editor: mergeSaved(r.scene, null, 0) }))
        : Promise.all([loadBundleScene(path), api.editor(path)]).then(([r, saved]) => ({
            kind: "bundle",
            scene: r.scene,
            data: r.data,
            editor: mergeSaved(r.scene, saved.status === "default" ? null : saved.state, r.data.course.holes.length),
            resetNotice: saved.status === "reset",
          }));
    job
      .then((next) => {
        if (cancelled) return;
        viewport.current = next.editor.viewport;
        setLoaded(next);
        setEditor(next.editor);
        setHover(null);
        setStatus(
          "resetNotice" in next && next.resetNotice
            ? { text: "The saved editor state was unreadable, so it was reset (kept as editor.json.bad)." }
            : null,
        );
      })
      .catch((e: Error) => !cancelled && setStatus({ text: e.message, error: true }));
    return () => {
      cancelled = true;
    };
  }, [kind, path]);

  const bundle = loaded?.kind === "bundle" ? loaded.data.path : null;
  const { status: saveStatus, viewChanged } = useEditorPersistence(bundle, editor, viewport);

  const onViewChange = useCallback(
    (v: Viewport) => {
      viewport.current = v;
      viewChanged();
    },
    [viewChanged],
  );
  const setLayer = useCallback(
    (id: string, patch: Partial<EditorState["layers"][string]>) =>
      setEditor((s) => ({ ...s, layers: { ...s.layers, [id]: { ...s.layers[id], ...patch } } })),
    [],
  );
  const setExaggeration = useCallback((exaggeration: number) => setEditor((s) => ({ ...s, exaggeration })), []);
  const setHole = useCallback((hole: number) => setEditor((s) => ({ ...s, hole })), []);

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
  const readout = scene && hover ? scene.readout(hover.x, hover.z, fmt) : null;
  const saved = saveText(saveStatus);

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
        <MapView
          scene={scene}
          layerState={editor.layers}
          params={{ exaggeration: editor.exaggeration, hole: editor.hole }}
          units={units}
          initialViewport={loaded?.editor.viewport ?? null}
          onViewChange={onViewChange}
          onHover={setHover}
        />
        {!scene && !status && <div className="empty">Choose a bundle or GeoTIFF, or drop a .tif here.</div>}
        {status && <div className={status.error ? "status error" : "status"}>{status.text}</div>}
        {dropping && <div className="drop">Drop to copy into uploads/</div>}
      </main>
      {loaded && (
        <aside className="panel">
          <h1>{loaded.scene.title}</h1>
          <p className="muted">{loaded.scene.subtitle(fmt)}</p>
          <LayerControls layers={loaded.scene.layers} state={editor.layers} onChange={setLayer} />
          {loaded.scene.layers.some((l) => l.id === "hillshade") && (
            <ExaggerationSlider value={editor.exaggeration} onCommit={setExaggeration} />
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
          {saved && <p className={saved.error ? "error save" : "muted save"}>{saved.text}</p>}
          {loaded.kind === "tif" ? (
            <TifPanel key={loaded.view.path} view={loaded.view} onBaked={() => void refresh()} />
          ) : (
            <BundlePanel data={loaded.data} hole={editor.hole} onHole={setHole} />
          )}
        </aside>
      )}
    </div>
  );
}
