import { useSyncExternalStore } from "react";
import { createStore } from "zustand/vanilla";
import type { CropRect } from "./cropRect";

/** The rectangle the Crop tool is showing, shared by the map overlay and the panel. Null until the tool is first used. Not saved. */
export const cropStore = createStore<{ rect: CropRect | null }>(() => ({ rect: null }));

export const setCrop = (rect: CropRect | null) => cropStore.setState({ rect });
export const useCropRect = () => useSyncExternalStore(cropStore.subscribe, () => cropStore.getState().rect);
