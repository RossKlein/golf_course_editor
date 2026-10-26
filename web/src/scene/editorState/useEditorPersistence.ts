import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { api, type EditorState, type Viewport } from "../../core/api/api";
import { serialise, withViewport } from "./editorState";

export type SaveStatus = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

const DEBOUNCE_MS = 600;

/**
 * Autosave of the editor state into the bundle's .course_maker/editor.json: a trailing debounce after the last
 * change, a flush when the tab is hidden or the bundle changes, and no request when nothing differs from what is
 * already saved. A failed save never interrupts editing; the next change retries.
 *
 * `bundle` is null for views that have nothing to save into (GeoTIFFs). The viewport lives in a ref because it
 * changes on every pan and zoom; call `viewChanged` after updating it.
 */
export function useEditorPersistence(
  bundle: string | null,
  editor: EditorState,
  viewport: MutableRefObject<Viewport | null>,
) {
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const lastSaved = useRef<string | null>(null);
  const generation = useRef(0); // bumped whenever a different bundle opens, so a slow save of the old one is ignored
  const pending = useRef<{ bundle: string; state: EditorState } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ bundle, editor });
  latest.current = { bundle, editor };

  const flush = useCallback(async (keepalive = false) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const job = pending.current;
    pending.current = null;
    if (!job) return;
    const text = serialise(job.state, job.state.viewport);
    if (text === lastSaved.current) return;
    const mine = generation.current;
    setStatus({ kind: "saving" });
    try {
      await api.saveEditor(job.bundle, job.state, keepalive);
      if (mine !== generation.current) return;
      lastSaved.current = text;
      setStatus({ kind: "saved" });
    } catch (e) {
      if (mine === generation.current) setStatus({ kind: "error", message: (e as Error).message });
    }
  }, []);

  const schedule = useCallback(() => {
    const { bundle, editor } = latest.current;
    if (!bundle) return;
    pending.current = { bundle, state: withViewport(editor, viewport.current) };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
  }, [flush, viewport]);

  // A newly opened bundle's loaded state is the baseline, so opening it writes nothing. The cleanup flushes
  // changes still waiting when the user switches to another bundle.
  useEffect(() => {
    generation.current += 1;
    lastSaved.current = bundle ? serialise(latest.current.editor, viewport.current) : null;
    setStatus({ kind: "idle" });
    return () => void flush(true);
  }, [bundle, flush, viewport]);

  useEffect(schedule, [editor, schedule]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush(true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush]);

  return { status, viewChanged: schedule };
}
