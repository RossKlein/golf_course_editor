import { useCallback, useEffect, useRef, useState } from "react";
import { api, type BuildStatus } from "../core/api/api";
import { changedFiles, type BuildFiles } from "./buildFiles";
import type { Scene } from "./scene";
import { boundsList, designStore, docFromApi, emptyDoc, regionList } from "../model/design/store";

export type DesignSave = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

const DEBOUNCE_MS = 600;
const POLL_MS = 1000;

/**
 * Everything that connects the design store to the server for one bundle:
 *  - loads the design on open (an invalid design file is reported, never reset),
 *  - autosaves changed files (debounced, flushed when the tab hides or the bundle changes),
 *  - follows the build the server runs after each save and tells the scene to reload when a new one finishes.
 * `bundle` is null for views with nothing to edit (GeoTIFFs).
 */
export function useDesignSession(bundle: string | null, scene: Scene | null) {
  const [save, setSave] = useState<DesignSave>({ kind: "idle" });
  const [build, setBuild] = useState<BuildStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const saved = useRef({ regions: "", layout: "", bounds: "", trees: "" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  // The build the viewer is showing, shared by the poll and buildNow so a build is refreshed once, not by both: its id, and the hash of each file.
  const shown = useRef<{ id: number | null; files: BuildFiles | null }>({ id: null, files: null });

  const flush = useCallback(async (keepalive = false) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!bundle || !ready) return;
    const doc = designStore.getState().doc;
    const regions = JSON.stringify(regionList(doc));
    const layout = JSON.stringify(doc.layout);
    const bounds = JSON.stringify(boundsList(doc));
    const trees = JSON.stringify(doc.trees);
    const mine = generation.current;
    const jobs: Promise<void>[] = [];
    if (regions !== saved.current.regions) jobs.push(api.saveRegions(bundle, regionList(doc), keepalive).then(() => void (saved.current.regions = regions)));
    if (layout !== saved.current.layout) jobs.push(api.saveLayout(bundle, doc.layout, keepalive).then(() => void (saved.current.layout = layout)));
    if (bounds !== saved.current.bounds) jobs.push(api.saveBounds(bundle, boundsList(doc), keepalive).then(() => void (saved.current.bounds = bounds)));
    if (trees !== saved.current.trees) jobs.push(api.saveTrees(bundle, doc.trees, keepalive).then(() => void (saved.current.trees = trees)));
    if (!jobs.length) return;
    setSave({ kind: "saving" });
    try {
      await Promise.all(jobs);
      if (mine === generation.current) setSave({ kind: "saved" });
    } catch (e) {
      if (mine === generation.current) setSave({ kind: "error", message: (e as Error).message });
    }
  }, [bundle, ready]);

  // load
  useEffect(() => {
    generation.current += 1;
    setSave({ kind: "idle" });
    setBuild(null);
    setLoadError(null);
    setReady(false);
    if (!bundle) {
      designStore.getState().reset(emptyDoc());
      return;
    }
    let cancelled = false;
    api.design(bundle).then(
      (d) => {
        if (cancelled) return;
        designStore.getState().reset(docFromApi(d));
        saved.current = { regions: JSON.stringify(d.regions.regions), layout: JSON.stringify(d.layout), bounds: JSON.stringify(d.bounds.areas), trees: JSON.stringify(d.trees) };
        setReady(true);
      },
      (e: Error) => !cancelled && setLoadError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [bundle]);

  // autosave
  useEffect(() => {
    if (!ready) return;
    let last = designStore.getState().doc;
    const unsub = designStore.subscribe((s) => {
      if (s.doc === last) return;
      last = s.doc;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    });
    const onHide = () => document.visibilityState === "hidden" && void flush(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      void flush(true);
    };
  }, [ready, flush]);

  /** Show a finished build: reload only the files it changed. A build already shown, or one that changed nothing the viewer reads, costs nothing. */
  const show = useCallback(async (status: BuildStatus, asked = false) => {
    const before = shown.current;
    if (before.id !== null && status.id <= before.id) return; // already shown (buildNow and the poll can both see the same build)
    shown.current = { id: status.id, files: status.files };
    // The poll's first look at the server's builds only notes where it stands: the scene was loaded just now, from files at least as new.
    // A build that was asked for always shows, against whatever the viewer has (everything, if it has seen no build yet).
    if (before.id === null && !asked) return;
    const changed = changedFiles(before.files, status.files);
    if (changed !== "all" && !changed.size) return;
    await sceneRef.current?.refresh?.({ changed, report: status.report });
  }, []);

  // follow builds
  useEffect(() => {
    if (!bundle || !ready) return;
    let cancelled = false;
    shown.current = { id: null, files: null };
    let busy = false;
    const poll = async () => {
      if (busy || cancelled || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const status = await api.buildStatus(bundle);
        if (cancelled) return;
        setBuild(status);
        await show(status);
      } catch {
        // the server may be restarting; try again next tick
      } finally {
        busy = false;
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [bundle, ready, show]);

  const buildNow = useCallback(async () => {
    if (!bundle) return;
    await flush();
    const status = await api.buildNow(bundle);
    setBuild(status);
    await show(status, true);
  }, [bundle, flush, show]);

  return { save, build, loadError, ready, buildNow, flush };
}
