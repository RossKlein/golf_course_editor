import { useCallback, useEffect, useState } from "react";
import { api, type Look } from "../core/api/api";
import { designStore, useDesign } from "../model/design/store";
import { editLook } from "../model/look/edit";
import { assignPath, getPath, type Path } from "../model/look/path";
import { useLookSession } from "./lookSession";

let defaults: Promise<Look> | null = null;
/** The look a new course starts with, fetched once. */
const defaultLook = () => (defaults ??= api.defaultLook().catch((e) => ((defaults = null), Promise.reject(e))));

/**
 * How a control changes the look. A control calls `start` when the hand goes down, `set` as the value moves, and `finish` when it
 * is done: the drag is one undo step, and the course follows (see lookApplier.ts). A control that is a single event calls
 * `set` and then `finish`.
 */
export function useLookEditing() {
  const look = useDesign((s) => s.doc.look);
  const { finish: applyNow } = useLookSession();
  const [defaultValues, setDefaults] = useState<Look | null>(null);
  useEffect(() => {
    let cancelled = false;
    defaultLook().then((l) => !cancelled && setDefaults(l), () => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const start = useCallback((label: string) => designStore.getState().begin(label), []);
  const set = useCallback((label: string, path: Path, value: unknown) => editLook(label, (l) => assignPath(l, path, value)), []);
  const finish = useCallback(() => {
    designStore.getState().end();
    applyNow();
  }, [applyNow]);
  /** Put the field back to the default, as one undo step. */
  const reset = useCallback(
    (label: string, path: Path) => {
      if (!defaultValues) return;
      const value = getPath(defaultValues, path);
      designStore.getState().begin(label);
      editLook(label, (l) => assignPath(l, path, value === undefined ? null : structuredClone(value))); // an optional colour the default lacks is off
      finish();
    },
    [defaultValues, finish],
  );
  /** Put several fields back to the default together, as one undo step. */
  const resetAll = useCallback(
    (label: string, paths: Path[]) => {
      if (!defaultValues) return;
      designStore.getState().begin(label);
      editLook(label, (l) => {
        for (const path of paths) {
          const value = getPath(defaultValues, path);
          assignPath(l, path, value === undefined ? null : structuredClone(value));
        }
      });
      finish();
    },
    [defaultValues, finish],
  );
  /** A change that is one event, such as adding a tree part: one undo step, applied at once. */
  const change = useCallback(
    (label: string, recipe: (look: Look) => void) => {
      editLook(label, recipe);
      finish();
    },
    [finish],
  );
  return { look, defaults: defaultValues, start, set, finish, reset, resetAll, change };
}
