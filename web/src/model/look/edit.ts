import type { Look } from "../../core/api/api";
import { designStore } from "../design/store";

/**
 * Change the course's look: one undo step, with `label`. Inside `begin`/`end` it joins the drag that is going on. Does nothing
 * where there is no look to edit (a GeoTIFF).
 */
export function editLook(label: string, recipe: (look: Look) => void) {
  designStore.getState().commit(label, (doc) => {
    if (doc.look) recipe(doc.look);
  });
}
