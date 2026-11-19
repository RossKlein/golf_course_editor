import { createContext, useContext } from "react";
import type { LookStatus } from "./lookApplier";

/** What the look editor needs from the app: where applying and saving stand, and a way to say an edit is finished. */
export type LookSession = { status: LookStatus; finish: () => void };

export const LookSessionContext = createContext<LookSession>({ status: { phase: "idle", applied: null, error: null }, finish: () => {} });

export const useLookSession = () => useContext(LookSessionContext);
