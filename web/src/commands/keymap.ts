import { parseKeybinding, type KeybindingHandler } from "tinykeys";

/**
 * Where a command applies. `tool:<editor>/<tool>` belongs to an editor, which belongs to the app, so the active scopes
 * are always global + the open editor + the active tool, and a more specific scope wins over a more general one.
 */
export type Scope = "global" | `editor:${string}` | `tool:${string}`;

export type Command = {
  id: string;
  label: string;
  scope: Scope;
  /** tinykeys strings: "$mod+z", "Shift+D", "Escape", and sequences "g c". Modifiers must match exactly. */
  keys: string[];
  group?: string;
  run: () => void;
  /** Evaluated when the key is pressed; false lets a lower-priority command with the same key run instead. */
  when?: () => boolean;
  /** Left out of the shortcut sheet. */
  hidden?: boolean;
};

export const scopePriority = (s: Scope) => (s.startsWith("tool:") ? 2 : s.startsWith("editor:") ? 1 : 0);

/** The editor a scope belongs to, or null for global. */
const editorOf = (s: Scope) => (s === "global" ? null : s.startsWith("editor:") ? s.slice(7) : s.slice(5).split("/")[0]);

/** Two commands can be active at once when their scopes can be. */
export function scopesOverlap(a: Scope, b: Scope): boolean {
  const ea = editorOf(a), eb = editorOf(b);
  if (ea === null || eb === null) return true;
  if (ea !== eb) return false;
  return a === b || a.startsWith("editor:") || b.startsWith("editor:");
}

type Press = ReturnType<typeof parseKeybinding>[number];

const signature = (presses: readonly Press[]) =>
  presses.map(([req, opt, key]) => `${[...req].sort().join("+")}|${[...opt].sort().join("+")}|${String(key).toUpperCase()}`).join(" ");

export const keySignature = (key: string) => signature(parseKeybinding(key));

export function activeCommands(all: Command[], active: Scope[]): Command[] {
  return all.filter((c) => active.includes(c.scope)).sort((a, b) => scopePriority(b.scope) - scopePriority(a.scope));
}

/** A tinykeys map for the given (already scope-filtered, priority-sorted) commands. */
export function buildKeymap(commands: Command[], resolve: (id: string) => Command | undefined): Record<string, KeybindingHandler> {
  const groups = new Map<string, { key: string; ids: string[] }>();
  for (const c of commands) {
    for (const key of c.keys) {
      const sig = keySignature(key);
      const g = groups.get(sig) ?? { key, ids: [] };
      g.ids.push(c.id);
      groups.set(sig, g);
    }
  }
  const map: Record<string, KeybindingHandler> = {};
  for (const { key, ids } of groups.values()) {
    map[key] = (event) => {
      for (const id of ids) {
        const c = resolve(id);
        if (c && (!c.when || c.when())) {
          event.preventDefault();
          c.run();
          return;
        }
      }
    };
  }
  return map;
}

const TEXT_INPUTS = new Set(["text", "search", "number", "email", "url", "tel", "password", "date", "time", "datetime-local", "month", "week", ""]);

/**
 * Whether a keydown belongs to the page element that has focus rather than to the shortcuts: text entry, selects and
 * editable text (they need their keys), and a slider's own arrow keys. Checkboxes, buttons and the rest of the page let
 * shortcuts through, so clicking a checkbox does not silence the keyboard.
 */
export function ignoreKeydown(event: Pick<KeyboardEvent, "repeat" | "isComposing" | "key" | "target">): boolean {
  if (event.repeat || event.isComposing) return true;
  const t = event.target as (Element & { type?: string }) | null;
  if (!t || typeof t.matches !== "function") return false;
  if (t.matches("[contenteditable],textarea,select")) return true;
  if (t.matches("input")) {
    if (t.type === "range") return /^(Arrow|Home$|End$|Page)/.test(event.key);
    return TEXT_INPUTS.has(t.type ?? "");
  }
  return false;
}

export type Conflict = { a: string; b: string; key: string; kind: "same" | "prefix" };

/** Bindings that would clash: the same key twice in one scope, or one sequence being the start of another. */
export function findConflicts(commands: Command[]): Conflict[] {
  const out: Conflict[] = [];
  const entries = commands.flatMap((c) => c.keys.map((key) => ({ c, key, presses: parseKeybinding(key) })));
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const x = entries[i], y = entries[j];
      if (x.c.id === y.c.id || !scopesOverlap(x.c.scope, y.c.scope)) continue;
      const sx = signature(x.presses), sy = signature(y.presses);
      if (sx === sy && x.c.scope === y.c.scope) out.push({ a: x.c.id, b: y.c.id, key: x.key, kind: "same" });
      else if (sx !== sy && (sy.startsWith(sx + " ") || sx.startsWith(sy + " "))) out.push({ a: x.c.id, b: y.c.id, key: `${x.key} / ${y.key}`, kind: "prefix" });
    }
  }
  return out;
}

// ---- display ---------------------------------------------------------------------------------------------------

const NAMES: Record<string, string> = {
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", Delete: "Del", Backspace: "⌫",
  Equal: "=", Minus: "-", NumpadAdd: "Num +", NumpadSubtract: "Num -", Slash: "/", BracketLeft: "[", BracketRight: "]", Space: "Space",
};

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** "$mod+Shift+z" -> "Ctrl+Shift+Z"; "g c" -> "G then C". */
export function formatKey(key: string, mac = isMac()): string {
  return key
    .split(" ")
    .map((press) => {
      const parts = press.split("+").filter((p, i, a) => p !== "" || i === a.length - 1);
      return parts
        .map((p) => (p === "$mod" ? (mac ? "⌘" : "Ctrl") : p === "Alt" && mac ? "⌥" : NAMES[p] ?? (p.length === 1 ? p.toUpperCase() : p)))
        .join(mac ? "" : "+");
    })
    .join(" then ");
}
