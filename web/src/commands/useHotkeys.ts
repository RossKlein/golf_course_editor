import { useEffect, useRef } from "react";
import { createKeybindingsHandler } from "tinykeys";
import { activeCommands, buildKeymap, ignoreKeydown, type Command, type Scope } from "./keymap";

/**
 * Listen for the keys of every command in the active scopes. The listener is only rebuilt when the set of active
 * bindings changes (so a half-typed sequence like "g c" survives re-renders), and commands are looked up by id at
 * press time, so they always run with current state.
 */
export function useHotkeys(commands: Command[], scopes: Scope[], enabled = true) {
  const latest = useRef(commands);
  latest.current = commands;
  const active = activeCommands(commands, scopes);
  const signature = active.map((c) => `${c.id}:${c.keys.join(",")}`).join(";");

  useEffect(() => {
    if (!enabled) return;
    const handler = createKeybindingsHandler(buildKeymap(active, (id) => latest.current.find((c) => c.id === id)), { ignore: ignoreKeydown });
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled]);
}
