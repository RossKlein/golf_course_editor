import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api, type Look } from "../core/api/api";
import { designStore } from "../model/design/store";
import { bakes } from "../terrain/look/diff";
import { LookApplier, type LookStatus } from "./lookApplier";
import type { Scene } from "./scene";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Connects the look in the design store to the course: when the store's look changes, the 3D view and the file follow after a
 * pause or a finishing event (see lookApplier.ts). Bundles only; `bundle` is null for a raster.
 *
 * `ready` is whether the design (and so the look) has been loaded into the store. Returns the applier's state, for the panel and
 * for views that read what is on screen, and `finish`, which a control calls when an edit is done.
 */
export function useLookBinding(bundle: string | null, scene: Scene | null, ready: boolean) {
  const terrain = scene?.terrain;
  const applier = useMemo(
    () =>
      new LookApplier({
        apply: async (look: Look) => {
          if (!terrain?.applyLook) return;
          await terrain.previewWater?.(look);
          const change = terrain.applyLook(look);
          if (bakes(change)) {
            // the bakes run a strip a frame in the 3D view; it is done when they are. A cap, because with no 3D view open nothing runs them.
            for (let i = 0; i < 180 && terrain.renderer.baking; i++) await nextFrame();
            await nextFrame();
          }
        },
        save: (look, keepalive) => (bundle ? api.saveLook(bundle, look, keepalive) : Promise.resolve()),
      }),
    [bundle, terrain],
  );

  useEffect(() => {
    if (!bundle || !ready) {
      applier.reset(null);
      return;
    }
    // the store has just been loaded with the file's look, which is what the scene was built with
    applier.reset(designStore.getState().doc.look);
    let last = designStore.getState().doc.look;
    const unsub = designStore.subscribe((s) => {
      const look = s.doc.look;
      if (look === last) return;
      last = look;
      if (look) applier.change(look);
    });
    const onHide = () => document.visibilityState === "hidden" && applier.saveNow();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      applier.saveNow(); // leaving the bundle: what was changed is still saved
    };
  }, [applier, bundle, ready]);

  const status = useSyncExternalStore<LookStatus>(applier.subscribe, () => applier.state);
  return { status, finish: () => applier.finish() };
}
