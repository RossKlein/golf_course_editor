import { useSyncExternalStore } from "react";

/** What is open, kept in the URL hash (#tif=<path> or #bundle=<path>) so reloads and links keep it. */
export type Selection = { kind: "tif" | "bundle"; path: string };

export function parseHash(hash: string): Selection | null {
  const m = /^#(tif|bundle)=(.+)$/.exec(hash);
  return m ? { kind: m[1] as Selection["kind"], path: decodeURIComponent(m[2]) } : null;
}

export const hashFor = (s: Selection) => `#${s.kind}=${encodeURIComponent(s.path)}`;

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export function useSelection(): Selection | null {
  return parseHash(useSyncExternalStore(subscribe, () => location.hash));
}
