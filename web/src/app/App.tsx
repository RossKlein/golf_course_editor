import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type Map from "ol/Map";
import { Tooltip } from "radix-ui";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { api, type EditorState, type Index, type TifView, type Viewport } from "../core/api/api";
import { loadBundleScene, type BundleData } from "../scene/bundleScene";
import { globalCommands } from "../commands/globalCommands";
import HelpDialog from "../commands/HelpDialog";
import type { Scope } from "../commands/keymap";
import { useHotkeys } from "../commands/useHotkeys";
import { woodsIds } from "../model/design/forest";
import { designStore, useDesign } from "../model/design/store";
import { useDesignSession } from "../scene/useDesignSession";
import { useLookBinding } from "../scene/useLookBinding";
import { useTreesPreview } from "../scene/useTreesPreview";
import { LookSessionContext } from "../scene/lookSession";
import { editLook } from "../model/look/edit";
import LookPanel from "../editors/look/LookPanel";
import TreesPanel from "../editors/trees/TreesPanel";
import { TREE_TOOLS } from "../editors/trees/tools";
import { useTreesEditor } from "../editors/trees/useTreesEditor";
import type { ValueEdit } from "../shell/LayerControls";
import { defaultEditorState, defaultViewer, mergeSaved, type Viewer } from "../scene/editorState/editorState";
import { useEditorPersistence } from "../scene/editorState/useEditorPersistence";
import { useDesignLayers } from "../views/map2d/design/useDesignLayers";
import { BOUNDS_TOOLS, useBoundsEditor } from "../editors/bounds/useBoundsEditor";
import { TOOLS, useCourseEditor } from "../editors/course/useCourseEditor";
import { useHeightEditor } from "../editors/heightmap/useHeightEditor";
import { ALL_HEIGHT_TOOLS, isBasin } from "../editors/heightmap/tools";
import CropPanel from "../editors/heightmap/CropPanel";
import { takeNotice } from "../editors/heightmap/cropNotice";
import { useCropTool } from "../editors/heightmap/useCropTool";
import { useVoidTools } from "../editors/heightmap/useVoidTools";
import { useTrapEditor } from "../editors/heightmap/useTrapEditor";
import TrapPanel from "../editors/heightmap/TrapPanel";
import BasinPanel from "../editors/heightmap/BasinPanel";
import { useNotice } from "../editors/_shared/holeNav";
import { EDITORS } from "../editors/registry";
import FileList from "../shell/FileList";
import OlMap from "../views/map2d/OlMap";
import { fromMap, toMap } from "../core/geometry/coords";
import type { Scene } from "../scene/scene";
import { fitRect, panBy, zoomBy } from "../views/map2d/view";
import { hashFor, useSelection } from "../scene/selection";
import EditorBar from "../shell/EditorBar";
import RightPanel from "../shell/RightPanel";
import SubBar from "../shell/SubBar";
import { loadTifScene } from "../scene/tifScene";
import { nextContour } from "../terrain/passes/flat/contours";
import { cameraFor, visibleHeightOf, type Camera } from "../terrain/camera/camera";
import Terrain3D from "../views/view3d/Terrain3D";
import type { Controls3d } from "../views/view3d/useCameraControls";
import { setUnits, useFormatter, useUnits } from "../ui/useUnits";

type Loaded =
  | { kind: "tif"; scene: Scene; view: TifView; editor: EditorState }
  | { kind: "bundle"; scene: Scene; data: BundleData; editor: EditorState };
type Status = { text: string; error?: boolean } | null;

const NO_KINDS: never[] = [];
const NO_LANDMARKS: never[] = [];

/** The 3D view's settings before any have been chosen or loaded. */
const NO_VIEWER = defaultViewer(false);

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

  // for looking at the same place again, from the console: goTo3d({ x, z, distance, pitch, yaw }) (metres, radians)
  useEffect(() => {
    (window as unknown as { goTo3d: (c: Partial<Camera>) => void }).goTo3d = (c) => controls3d.current?.goTo({ ...camera3d.current, ...c });
  }, []);

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
  const look = useLookBinding(bundle, scene, session.ready);
  const lookSession = { status: look.status, finish: look.finish };
  const [viewerHost, setViewerHost] = useState<HTMLElement | null>(null);

  // A bundle's relief exaggeration and shading are its look, so they are edited like the rest of it, and what is on screen is what
  // has been applied. A raster has no look to save: its exaggeration is the editor's own.
  const storeRelief = useDesign((s) => s.doc.look?.relief.exaggeration);
  const applied = look.status.applied;
  const relief = applied?.relief.exaggeration ?? editor.exaggeration;
  const shading = applied?.relief.shading;

  const patch = useCallback((p: Partial<EditorState>) => setEditor((s) => ({ ...s, ...p })), []);
  const patchViewer = useCallback((p: Partial<Viewer>) => setEditor((s) => ({ ...s, viewer: { ...(s.viewer ?? NO_VIEWER), ...p } })), []);
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
  const exaggeration: ValueEdit =
    storeRelief === undefined
      ? { value: editor.exaggeration, onChange: (v) => patch({ exaggeration: v }), onStart: () => {}, onFinish: () => {} }
      : {
          value: storeRelief,
          onChange: (v) => editLook("Relief exaggeration", (l) => void (l.relief.exaggeration = v)),
          onStart: () => designStore.getState().begin("Relief exaggeration"),
          onFinish: () => {
            designStore.getState().end();
            look.finish();
          },
        };

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
      patch({ view3d: false });
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
    patch({ view3d: true });
  };
  useEffect(() => setView3d(false), [scene]);
  // a bundle that was left in the 3D view opens in it, looking at the place the map was showing (the saved view, or the whole course)
  const restored3d = useRef<typeof scene>(null);
  useEffect(() => {
    if (!scene || !map || restored3d.current === scene) return;
    restored3d.current = scene;
    if (!loaded?.editor.view3d || !canView3d) return;
    const size = map.getSize();
    const [width, height] = size?.[0] && size[1] ? size : [1000, 700]; // the map has no size while it is hidden
    const saved = loaded.editor.viewport;
    const { x, z, w, h } = scene.extent;
    camera3d.current = saved
      ? cameraFor(saved.x, saved.z, height / saved.scale, camera3d.current)
      : cameraFor(x + w / 2, z + h / 2, Math.max(h, (w * height) / width), camera3d.current);
    setView3d(true);
  }, [scene, map, loaded, canView3d]);
  // the Look editor is for looking at the course, so opening it opens the 3D view; going back to the map is the user's to do
  useEffect(() => {
    if (editor.editor === "look" && canView3d && !view3d && map) toggle3d();
  }, [editor.editor, canView3d, map]); // eslint-disable-line react-hooks/exhaustive-deps
  const { notice, say } = useNotice();
  const layers = useDesignLayers(map, loaded?.kind === "bundle", canEdit, editor);
  const isRange = loaded?.kind === "bundle" && loaded.data.course.kind === "range";
  const course = useCourseEditor({ map, layers, active: canEdit && editor.editor === "course", editor, patch, say, isRange });
  const bounds = useBoundsEditor({ map, layers, active: canEdit && editor.editor === "bounds", editor, patch, say });
  const height = useHeightEditor({ map, terrain: scene?.terrain, active: canEdit && editor.editor === "heightmap", view3d, editor, patch, say });
  // the Crop tool: a box on the map, and a panel that does the cutting
  const mapSize = useMemo(() => (loaded?.kind === "bundle" ? { w: loaded.scene.extent.w, h: loaded.scene.extent.h } : null), [loaded]);
  const cropping = canEdit && editor.editor === "heightmap" && editor.tool === "crop";
  useCropTool({ map, active: cropping && !view3d, size: mapSize });
  const trapping = canEdit && editor.editor === "heightmap" && editor.tool === "trap" && height.canSculpt;
  const trap = useTrapEditor({ map, terrain: scene?.terrain, active: trapping, view3d, say });
  const outlineTool = editor.tool === "cut" || editor.tool === "island" ? editor.tool : null;
  const voids = useVoidTools({ map, layers, active: canEdit && editor.editor === "heightmap" && !!outlineTool && !view3d, tool: outlineTool ?? "cut", snap: editor.snap, size: mapSize, say });
  const saveAll = useCallback(async () => {
    await session.flush();
    await scene?.terrain?.sculpt?.save();
  }, [session.flush, scene]); // eslint-disable-line react-hooks/exhaustive-deps
  // a crop or its undo loads the page afresh; this is where what happened is said
  useEffect(() => {
    if (!scene) return;
    const text = takeNotice();
    if (text) say(text);
  }, [scene, say]);
  const treeKinds = useDesign((s) => s.doc.look?.trees.kinds) ?? NO_KINDS;
  const landmarks = loaded?.kind === "bundle" ? loaded.data.course.landmarks : NO_LANDMARKS;
  const requestBuild = useCallback(() => void session.buildNow(), [session.buildNow]); // eslint-disable-line react-hooks/exhaustive-deps
  useTreesPreview({ bundle, terrain: scene?.terrain, enabled: canEdit && editor.editor === "trees" });
  const trees = useTreesEditor({ map, landmarks, kinds: treeKinds, active: canEdit && editor.editor === "trees", view3d, editor, patch, say, requestBuild });
  // A bundle built before the build planted trees has an empty trees.bin. Build it once, when opened, so its woods have their forest.
  const plantedFor = useRef<string | null>(null);
  const treeCount = loaded?.kind === "bundle" ? loaded.data.course.trees.count : null;
  useEffect(() => {
    if (!bundle || !session.ready || treeCount !== 0 || plantedFor.current === bundle) return;
    plantedFor.current = bundle;
    if (woodsIds(designStore.getState().doc).length) requestBuild();
  }, [bundle, session.ready, treeCount, requestBuild]);
  const nav = editor.editor === "bounds" ? bounds : course; // the open editor's way of moving between holes
  const holeCount = useDesign((s) => s.doc.layout.holes.length);
  const canUndo = useDesign((s) => s.past.length > 0);
  const canRedo = useDesign((s) => s.future.length > 0);

  // the tool belongs to the editor too: each has its own set, so switching editors starts on that editor's first
  useEffect(() => {
    const ids: string[] = editor.editor === "heightmap" ? ALL_HEIGHT_TOOLS.map((b) => b.id) : editor.editor === "trees" ? TREE_TOOLS.map((t) => t.id) : editor.editor === "bounds" ? BOUNDS_TOOLS.map((t) => t.id) : editor.editor === "course" ? TOOLS.map((t) => t.id) : [];
    if (ids.length && !ids.includes(editor.tool)) patch({ tool: ids[0] });
  }, [editor.editor, editor.tool, patch]);

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
    }, EDITORS),
    ...course.commands,
    ...bounds.commands,
    ...height.commands,
    ...voids.commands,
    ...trees.commands,
  ];
  const scopes: Scope[] = ["global"];
  // the editors draw on the map, so only the Heightmap and Trees editors, whose tools work in 3D too, keep their keys there
  if (canEdit && (!view3d || editor.editor === "heightmap" || editor.editor === "trees") && editor.editor !== "view") scopes.push(`editor:${editor.editor}`, `tool:${editor.editor}/${editor.tool}`);
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
      <LookSessionContext.Provider value={lookSession}>
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
        <SubBar editor={editor} patch={patch} notice={notice} canEdit={canEdit} holeCount={holeCount} onHole={nav.goHole} onAddHole={nav.newHole} isRange={isRange} view3d={view3d} fmt={fmt} canSculpt={height.canSculpt} onRound={course.roundSelected} onCollar={course.collar} bundle={bundle} onRestoreAll={height.restoreAll} save={saveAll} say={say} />
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
                params={{ exaggeration: relief, hole: editor.hole, contour: editor.contourInterval, slope: editor.slopeMap }}
                units={units}
                initialViewport={loaded?.editor.viewport ?? null}
                onViewChange={onViewChange}
                onHover={setHover}
                onMap={setMap}
                leftDragPans={course.leftDragPans && bounds.leftDragPans && height.leftDragPans && trees.leftDragPans && trap.leftDragPans}
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
                  relief={relief}
                  onRelief={(v) => patch({ exaggeration: v })}
                  shading={shading}
                  lookOpen={editor.editor === "look"}
                  optionsHost={viewerHost}
                  hasDesign={loaded?.kind === "bundle"}
                  opts={editor.viewer ?? NO_VIEWER}
                  onOpts={patchViewer}
                  tool={height.tool3d ?? trees.tool3d ?? trap.tool3d}
                />
              )}
              {editor.editor === "look" && loaded?.kind === "bundle" && <LookPanel terrain={scene?.terrain} onViewerHost={setViewerHost} view3d={view3d} tab={editor.lookTab} onTab={(lookTab) => patch({ lookTab })} />}
              {editor.editor === "heightmap" && isBasin(editor.tool) && canEdit && height.canSculpt && scene?.terrain && <BasinPanel terrain={scene.terrain} />}
              {trapping && scene?.terrain && <TrapPanel terrain={scene.terrain} />}
              {cropping && height.canSculpt && bundle && mapSize && <CropPanel bundle={bundle} size={mapSize} landmarks={landmarks} view3d={view3d} save={saveAll} say={say} />}
              {editor.editor === "trees" && canEdit && <TreesPanel build={session.build} kinds={treeKinds} landmarks={landmarks} requestBuild={requestBuild} />}
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
                exaggeration={exaggeration}
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
      </LookSessionContext.Provider>
    </Tooltip.Provider>
  );
}
