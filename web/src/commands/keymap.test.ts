import { createKeybindingsHandler } from "tinykeys";
import { describe, expect, it, vi } from "vitest";
import { activeCommands, buildKeymap, findConflicts, formatKey, ignoreKeydown, scopesOverlap, type Command, type Scope } from "./keymap";

const cmd = (id: string, scope: Scope, keys: string[], extra: Partial<Command> = {}): Command => ({ id, label: id, scope, keys, run: () => undefined, ...extra });

/** A keydown that tinykeys will accept, without a DOM. */
function press(handler: EventListener, key: string, mods: string[] = [], code?: string) {
  const event = {
    key, code: code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key), repeat: false, isComposing: false, target: null, currentTarget: null,
    getModifierState: (m: string) => mods.includes(m),
    preventDefault: vi.fn(),
  };
  handler(event as unknown as Event);
  return event;
}

const handlerFor = (cmds: Command[], scopes: Scope[]) =>
  createKeybindingsHandler(buildKeymap(activeCommands(cmds, scopes), (id) => cmds.find((c) => c.id === id)));

describe("running commands", () => {
  it("runs the command and prevents the browser default", () => {
    const run = vi.fn();
    const e = press(handlerFor([cmd("fit", "global", ["f"], { run })], ["global"]), "f");
    expect(run).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("matches modifiers exactly", () => {
    const run = vi.fn();
    const h = handlerFor([cmd("undo", "global", ["$mod+z"], { run })], ["global"]);
    press(h, "z");
    press(h, "z", ["Shift", "Control"]);
    expect(run).not.toHaveBeenCalled();
    press(h, "z", ["Control"]);
    expect(run).toHaveBeenCalledOnce();
  });

  it("supports sequences", () => {
    const run = vi.fn();
    const h = handlerFor([cmd("goto", "global", ["g c"], { run })], ["global"]);
    press(h, "g");
    expect(run).not.toHaveBeenCalled();
    press(h, "c");
    expect(run).toHaveBeenCalledOnce();
  });

  it("matches code names such as Equal and Shift+Equal", () => {
    const run = vi.fn();
    const h = handlerFor([cmd("zoom", "global", ["Equal", "Shift+Equal"], { run })], ["global"]);
    press(h, "=", [], "Equal");
    press(h, "+", ["Shift"], "Equal");
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("scopes", () => {
  const global = vi.fn(), editor = vi.fn(), tool = vi.fn();
  const all = [
    cmd("g", "global", ["Escape"], { run: global }),
    cmd("e", "editor:course", ["Escape"], { run: editor }),
    cmd("t", "tool:course/draw", ["Escape"], { run: tool }),
  ];

  it("the most specific scope wins", () => {
    press(handlerFor(all, ["global", "editor:course", "tool:course/draw"]), "Escape");
    expect([global.mock.calls.length, editor.mock.calls.length, tool.mock.calls.length]).toEqual([0, 0, 1]);
  });

  it("commands outside the active scopes do not run", () => {
    press(handlerFor(all, ["global"]), "Escape");
    expect(global).toHaveBeenCalledOnce();
    expect(editor).not.toHaveBeenCalled();
  });

  it("a disabled command lets a lower-priority one with the same key run", () => {
    const lower = vi.fn();
    const h = handlerFor([cmd("hi", "tool:course/draw", ["Escape"], { when: () => false }), cmd("lo", "global", ["Escape"], { run: lower })], ["global", "tool:course/draw"]);
    press(h, "Escape");
    expect(lower).toHaveBeenCalledOnce();
  });

  it("knows which scopes can be active together", () => {
    expect(scopesOverlap("global", "tool:course/draw")).toBe(true);
    expect(scopesOverlap("editor:course", "tool:course/draw")).toBe(true);
    expect(scopesOverlap("tool:course/draw", "tool:course/select")).toBe(false);
    expect(scopesOverlap("editor:course", "editor:greens")).toBe(false);
    expect(scopesOverlap("tool:course/draw", "tool:greens/sculpt")).toBe(false);
  });
});

describe("conflicts", () => {
  it("finds the same key twice in one scope", () => {
    const c = findConflicts([cmd("a", "global", ["f"]), cmd("b", "global", ["F"])]);
    expect(c).toMatchObject([{ a: "a", b: "b", kind: "same" }]);
  });

  it("allows the same key in different, nested scopes (an override)", () => {
    expect(findConflicts([cmd("a", "global", ["Escape"]), cmd("b", "tool:course/draw", ["Escape"])])).toEqual([]);
  });

  it("allows the same key in editors that are never open together", () => {
    expect(findConflicts([cmd("a", "editor:course", ["d"]), cmd("b", "editor:greens", ["d"])])).toEqual([]);
  });

  it("finds a key that would swallow the start of a sequence", () => {
    const c = findConflicts([cmd("a", "global", ["g"]), cmd("b", "global", ["g c"])]);
    expect(c).toMatchObject([{ kind: "prefix" }]);
  });

  it("treats Shift+key as different from key", () => {
    expect(findConflicts([cmd("a", "global", ["d"]), cmd("b", "global", ["Shift+D"])])).toEqual([]);
  });
});

describe("ignoreKeydown", () => {
  const target = (selector: string, type?: string) => ({ matches: (s: string) => s.split(",").includes(selector), type });
  const ev = (t: unknown, key = "z", extra = {}) => ({ repeat: false, isComposing: false, key, target: t, ...extra }) as never;

  it("lets shortcuts through from checkboxes, buttons and the page", () => {
    expect(ignoreKeydown(ev(target("input", "checkbox")))).toBe(false);
    expect(ignoreKeydown(ev(target("button")))).toBe(false);
    expect(ignoreKeydown(ev(null))).toBe(false);
  });

  it("keeps text entry for the text field", () => {
    expect(ignoreKeydown(ev(target("input", "text")))).toBe(true);
    expect(ignoreKeydown(ev(target("input", "number")))).toBe(true);
    expect(ignoreKeydown(ev(target("textarea")))).toBe(true);
    expect(ignoreKeydown(ev(target("select")))).toBe(true);
  });

  it("lets a slider keep its arrow keys but not other shortcuts", () => {
    expect(ignoreKeydown(ev(target("input", "range"), "ArrowLeft"))).toBe(true);
    expect(ignoreKeydown(ev(target("input", "range"), "z"))).toBe(false);
  });

  it("ignores key repeat", () => {
    expect(ignoreKeydown(ev(null, "z", { repeat: true }))).toBe(true);
  });
});

describe("formatKey", () => {
  it("names keys for the platform", () => {
    expect(formatKey("$mod+Shift+z", false)).toBe("Ctrl+Shift+Z");
    expect(formatKey("$mod+z", true)).toBe("⌘Z");
    expect(formatKey("g c", false)).toBe("G then C");
    expect(formatKey("Shift+Equal", false)).toBe("Shift+=");
    expect(formatKey("ArrowLeft", false)).toBe("←");
    expect(formatKey("Escape", false)).toBe("Esc");
  });
});
