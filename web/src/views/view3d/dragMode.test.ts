import { describe, expect, it } from "vitest";
import { dragMode } from "./dragMode";

const press = (button: number, mods: { shiftKey?: boolean; ctrlKey?: boolean } = {}) => ({ button, shiftKey: false, ctrlKey: false, ...mods });

describe("dragging the 3D camera", () => {
  it("orbits with the left button and pans with the others when no tool is out", () => {
    expect(dragMode(press(0), false, false)).toBe("orbit");
    expect(dragMode(press(0, { shiftKey: true }), false, false)).toBe("pan");
    expect(dragMode(press(0, { ctrlKey: true }), false, false)).toBe("pan");
    expect(dragMode(press(1), false, false)).toBe("pan");
    expect(dragMode(press(2), false, false)).toBe("pan");
  });

  it("leaves the left button to a tool, and orbits with the right", () => {
    expect(dragMode(press(0), true, false)).toBeNull();
    expect(dragMode(press(0, { shiftKey: true }), true, false)).toBeNull(); // Shift with the left is the tool's too
    expect(dragMode(press(2), true, false)).toBe("orbit");
  });

  it("pans with the middle button, Shift with the right, or Space with the left, while a tool is out", () => {
    expect(dragMode(press(1), true, false)).toBe("pan");
    expect(dragMode(press(2, { shiftKey: true }), true, false)).toBe("pan");
    expect(dragMode(press(0), true, true)).toBe("pan");
  });
});
