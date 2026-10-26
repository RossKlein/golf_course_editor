import type Map from "ol/Map";
import { useCallback, useRef, useState } from "react";
import type { Command } from "../../commands/keymap";
import { holeView } from "../../design/holes";
import { addHole, designStore } from "../../design/store";
import { flyToRect } from "../../map/view";

/** A short message for the sub-bar that clears itself. */
export function useNotice() {
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string) => {
    setNotice(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(""), 5000);
  }, []);
  return { notice, say };
}

export type HoleNav = { goHole: (n: number) => void; newHole: () => void };

/**
 * Moving between holes: make one active and glide to it. `withBounds` frames the hole's bounds too, for the editor that
 * draws them. `added` is what to tell the user after a hole is added.
 */
export function makeHoleNav(o: { map: Map | null; patch: (p: { hole: number }) => void; say: (t: string) => void; withBounds?: boolean; added: string }): HoleNav {
  return {
    goHole(n) {
      const count = designStore.getState().doc.layout.holes.length;
      if (n > Math.max(1, count)) return o.say(`There is no hole ${n} yet. Add one with the + button, or press H then N.`);
      const hole = Math.max(1, n);
      o.patch({ hole });
      const view = holeView(designStore.getState().doc, hole, o.withBounds);
      if (view && o.map) flyToRect(o.map, view);
      else o.say(`Hole ${hole} has no route or surfaces yet.`);
    },
    newHole() {
      const n = addHole();
      if (n === null) return o.say("That is the most holes a course can have.");
      o.patch({ hole: n });
      o.say(`Added hole ${n}. ${o.added}`);
    },
  };
}

/** The keys for moving between holes, the same in every editor that works hole by hole. */
export function holeCommands(editor: string, nav: () => HoleNav, hole: () => number): Command[] {
  const scope = `editor:${editor}` as const;
  return [
    { id: `${editor}.hole.next`, label: "Next hole", scope, keys: ["BracketRight"], group: "Holes", run: () => nav().goHole(hole() + 1) },
    { id: `${editor}.hole.prev`, label: "Previous hole", scope, keys: ["BracketLeft"], group: "Holes", run: () => nav().goHole(hole() - 1) },
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n): Command => ({ id: `${editor}.hole.${n}`, label: `Hole ${n}`, scope, keys: [`h ${n}`], group: "Holes", run: () => nav().goHole(n) })),
    { id: `${editor}.hole.new`, label: "Add a hole", scope, keys: ["h n"], group: "Holes", run: () => nav().newHole() },
  ];
}
