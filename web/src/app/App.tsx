import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type Map from "ol/Map";
import { Tooltip } from "radix-ui";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { api, type EditorState, type Index, type TifView, type Viewport } from "../api/api";
import { loadBundleScene, type BundleData } from "../bundle/bundleScene";
import { globalCommands } from "../commands/globalCommands";
import HelpDialog from "../commands/HelpDialog";
import type { Scope } from "../commands/keymap";
import { useHotkeys } from "../commands/useHotkeys";
import { designStore, useDesign } from "../design/store";
import { useDesignSession } from "../design/useDesignSession";
import { defaultEditorState, mergeSaved } from "../editor/editorState";
import { useEditorPersistence } from "../editor/useEditorPersistence";
import { useDesignLayers } from "../design/useDesignLayers";
import { useBoundsEditor } from "../editors/bounds/useBoundsEditor";
import { useCourseEditor } from "../editors/course/useCourseEditor";
import { useNotice } from "../editors/shared/holeNav";
import FileList from "../files/FileList";
import OlMap from "../map/OlMap";
import { fromMap, toMap } from "../map/coords";
import type { Scene } from "../map/scene";
import { fitRect, panBy, zoomBy } from "../map/view";
import { hashFor, useSelection } from "../selection/selection";
import EditorBar from "../shell/EditorBar";
import RightPanel from "../shell/RightPanel";
import SubBar from "../shell/SubBar";
import { loadTifScene } from "../tif/tifScene";
import { nextContour } from "../map/terrain/contours";
import { cameraFor, visibleHeightOf, type Camera } from "../view3d/camera";
import Terrain3D, { type Controls3d } from "../view3d/Terrain3D";
import { setUnits, useFormatter, useUnits } from "../units/useUnits";

type Loaded =
  | { kind: "tif"; scene: Scene; view: TifView; editor: EditorState }
  | { kind: "bundle"; scene: Scene; data: BundleData; editor: EditorState };
type Status = { text: string; error?: boolean } | null;

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
  const [map, setMap] = useState<Map | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const left = usePanelRef();
  const [view3d, setView3d] = useState(false);
  const camera3d = useRef<Camera>(cameraFor(0, 0, 500));
  const controls3d = useRef<Controls3d | null>(null);

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
    const job: Promise<Loaded & { resetNotice?: boolean }> =
      kind === "tif"
        ? loadTifScene(path).then((r) => ({ kind: "tif" as const, ...r, editor: mergeSaved(r.scene, null, 0) }))
        : Promise.all([loadBundleScene(path), api.editor(path)]).then(([r, saved]) => ({
            kind: "bundle" as const,
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
        setStatus(next.resetNotice ? { text: "The saved editor state was unreadable, so it was reset (kept as editor.json.bad)." } : null);
      })
      .catch((e: Error) => !cancelled && setStatus({ text: e.message, error: true }));
    return () => {
      cancelled = true;
    };
  }, [kind, path]);

  const scene = loaded?.scene ?? null;
  const bundle = loaded?.kind === "bundle" ? loaded.data.path : null;
  const { viewChanged } = useEditorPersistence(bundle, editor, viewport);
  const session = useDesignSession(bundle, scene);

  const patch = useCallback((p: Partial<EditorState>) => setEditor((s) => ({ ...s, ...p })), []);
  const setLayer = useCallback(
    (id: string, p: Partial<EditorState["layers"][string]>) => setEditor((s) => ({ ...s, layers: { ...s.layers, [id]: { ...s.layers[id], ...p } } })),
    [],
  );
  const onViewChange = useCallback(
    (v: Viewport) => {
      viewport.current = v;
      viewChanged();
    },
    [viewChanged],
  );

  const canEdit = !!bundle && session.ready;

  // the 3D view takes over from the 2D map, looking at the same place, and hands the place back when it closes
  const canView3d = !!scene?.terrain;
  const toggle3d = () => {
    if (!map) return;
    const mapView = map.getView();
    if (view3d) {
      const cam = camera3d.current;
      const size = map.getSize();
      mapView.setCenter(toMap([cam.x, cam.z]));
      if (size?.[1]) mapView.setResolution(visibleHeightOf(cam) / size[1]);
      setView3d(false);
      return;
    }
    const centre = mapView.getCenter();
    const res = mapView.getResolution();
    const size = map.getSize();
    if (!canView3d) return say("This scene has no elevation to show in 3D.");
    if (!centre || !res || !size) return;
    const [x, z] = fromMap(centre as [number, number]);
    camera3d.current = cameraFor(x, z, res * size[1], camera3d.current);
    setView3d(true);
  };
  useEffect(() => setView3d(false), [scene]);
  const { notice, say } = useNotice();
  const layers = useDesignLayers(map, loaded?.kind === "bundle", canEdit, editor);
  const course = useCourseEditor({ map, layers, active: canEdit && editor.editor === "course", editor, patch, say });
  const bounds = useBoundsEditor({ map, layers, active: canEdit && editor.editor === "bounds", editor, patch, say });
  const nav = editor.editor === "bounds" ? bounds : course; // the open editor's way of moving between holes
  const holeCount = useDesign((s) => s.doc.layout.holes.length);
  const canUndo = useDesign((s) => s.past.length > 0);
  const canRedo = useDesign((s) => s.future.length > 0);

  // a selection belongs to the editor it was made in
  useEffect(() => designStore.getState().select([]), [editor.editor]);

  // the file panel collapses to nothing; the saved state and the panel stay in step
  useEffect(() => {
    const p = left.current;
    if (!p) return;
    if (editor.leftCollapsed && !p.isCollapsed()) p.collapse();
    else if (!editor.leftCollapsed && p.isCollapsed()) p.expand();
  }, [editor.leftCollapsed, left]);

  // commands and keys
  const commands = [
    ...globalCommands({
      canEdit,
      undo: () => designStore.getState().undo(),
      redo: () => designStore.getState().redo(),
      build: () => void session.buildNow(),
      fit: () => (view3d ? controls3d.current?.fit() : map && scene && fitRect(map, scene.extent)),
      zoom: (f) => (view3d ? controls3d.current?.zoom(f) : map && zoomBy(map, f)),
      pan: (fx, fy) => (view3d ? controls3d.current?.nudge(fx, -fy) : map && panBy(map, fx, fy)),
      toggle3d,
      toggleLeft: () => patch({ leftCollapsed: !editor.leftCollapsed }),
      toggleUnits: () => setUnits(units === "us" ? "metric" : "us"),
      cycleContours: () => patch({ contourInterval: nextContour(editor.contourInterval, units) }),
      toggleSlope: () => patch({ slopeMap: !editor.slopeMap }),
      help: () => setHelpOpen(true),
      goto: (id) => patch({ editor: id }),
    }),
    ...course.commands,
    ...bounds.commands,
  ];
  const scopes: Scope[] = ["global"];
  if (canEdit && !view3d && editor.editor !== "view") scopes.push(`editor:${editor.editor}`, `tool:${editor.editor}/${editor.tool}`);
  useHotkeys(commands, scopes, !helpOpen);

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

  const readout = scene && hover ? scene.readout(hover.x, hover.z, fmt) : null;

  return (
    <Tooltip.Provider>
      <div className="shell">
        <EditorBar
          editor={editor.editor}
          onEditor={(id) => patch({ editor: id })}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => designStore.getState().undo()}
          onRedo={() => designStore.getState().redo()}
          onHelp={() => setHelpOpen(true)}
          onBuild={() => void session.buildNow()}
          editable={!!bundle}
          save={session.save}
          build={session.build}
          loadError={session.loadError}
          view3d={view3d}
          canView3d={canView3d}
          onView3d={toggle3d}
        />
        <SubBar editor={editor} patch={patch} notice={notice} canEdit={canEdit} holeCount={holeCount} onHole={nav.goHole} onAddHole={nav.newHole} view3d={view3d} />
        <Group orientation="horizontal" className="body">
          <Panel
            panelRef={left}
            collapsible
            collapsedSize={0}
            minSize={200}
            defaultSize={260}
            onResize={() => {
              const c = left.current?.isCollapsed() ?? false;
              setEditor((s) => (s.leftCollapsed === c ? s : { ...s, leftCollapsed: c }));
            }}
          >
            <FileList index={index} error={indexError} selection={selection} onRescan={refresh} onUpload={upload} />
          </Panel>
          <Separator className="sep" />
          <Panel minSize={300}>
            <main
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setDropping(true);
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={onDrop}
            >
              <OlMap
                scene={scene}
                layerState={editor.layers}
                params={{ exaggeration: editor.exaggeration, hole: editor.hole, contour: editor.contourInterval, slope: editor.slopeMap }}
                units={units}
                initialViewport={loaded?.editor.viewport ?? null}
                onViewChange={onViewChange}
                onHover={setHover}
                onMap={setMap}
                leftDragPans={course.leftDragPans && bounds.leftDragPans}
              />
              {scene?.terrain && (
                <Terrain3D
                  terrain={scene.terrain}
                  extent={scene.extent}
                  active={view3d}
                  cameraRef={camera3d}
                  controlsRef={controls3d}
                  contour={editor.contourInterval}
                  slope={editor.slopeMap}
                  hasDesign={loaded?.kind === "bundle"}
                />
              )}
              {!scene && !status && <div className="empty">Choose a bundle or GeoTIFF, or drop a .tif here.</div>}
              {status && <div className={status.error ? "status error" : "status"}>{status.text}</div>}
              {dropping && <div className="drop">Drop to copy into uploads/</div>}
            </main>
          </Panel>
          <Separator className="sep" />
          <Panel minSize={260} defaultSize={340}>
            {loaded && scene ? (
              <RightPanel
                scene={scene}
                tif={loaded.kind === "tif" ? loaded.view : null}
                bundle={loaded.kind === "bundle" ? loaded.data : null}
                build={session.build}
                editor={editor}
                patch={patch}
                layerState={editor.layers}
                onLayer={setLayer}
                readout={readout}
                fmt={fmt}
                units={units}
                onBaked={() => void refresh()}
                onHole={nav.goHole}
                onAddHole={nav.newHole}
                onAssign={course.assignUnassigned}
              />
            ) : (
              <aside className="panel" />
            )}
          </Panel>
        </Group>
        <HelpDialog commands={commands} open={helpOpen} onOpenChange={setHelpOpen} />
      </div>
    </Tooltip.Provider>
  );
}
