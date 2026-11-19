import { useEffect } from "react";
import { api } from "../core/api/api";
import { designStore } from "../model/design/store";
import type { TerrainSource } from "./scene";
import { Previewer, requestOf, sameSignature, signatureOf } from "./treePreview";

/**
 * While the Trees editor is open, show the trees of every change to the forest settings, placed trees and clearings as it is made, before
 * it is saved or built. The server plants them from the unsaved settings in a few hundredths of a second (it remembers each patch's trees,
 * so only the patch being changed is planted again), and the build that follows a release writes exactly what was shown.
 */
export function useTreesPreview({ bundle, terrain, enabled }: { bundle: string | null; terrain: TerrainSource | undefined; enabled: boolean }) {
  useEffect(() => {
    const show = terrain?.previewTrees;
    if (!bundle || !show || !enabled) return;
    const previewer = new Previewer(() => api.previewTrees(bundle, requestOf(designStore.getState().doc)), show);
    let last = signatureOf(designStore.getState().doc);
    return designStore.subscribe((s) => {
      const now = signatureOf(s.doc);
      if (sameSignature(last, now)) return; // something else in the design changed
      last = now;
      previewer.ask();
    });
  }, [bundle, terrain, enabled]);
}
