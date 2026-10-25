import { describe, expect, it } from "vitest";
import type { EditorState } from "../api/api";
import type { Layer, Scene } from "../map/scene";
import { defaultEditorState, mergeSaved, serialise, viewFromViewport, viewportFromView } from "./editorState";

const layer = (id: string, visible: boolean, opacity = 1): Layer => ({ id, label: id, visible, opacity });
const scene = (...layers: Layer[]): Scene => ({
  key: "bundle:x", title: "x", subtitle: () => "", extent: { x: 0, z: 0, w: 10, h: 10 }, layers, readout: () => [],
});
const saved = (patch: Partial<EditorState>): EditorState => ({ ...defaultEditorState(), ...patch });

describe("mergeSaved", () => {
  it("uses the scene's defaults when nothing was saved", () => {
    const s = mergeSaved(scene(layer("aerial", true), layer("class", false, 0.6)), null, 3);
    expect(s.layers).toEqual({ aerial: { visible: true, opacity: 1 }, class: { visible: false, opacity: 0.6 } });
    expect(s).toMatchObject({ viewport: null, exaggeration: 3, hole: 1 });
  });

  it("overlays saved layer preferences on the scene's defaults", () => {
    const s = mergeSaved(
      scene(layer("aerial", true), layer("class", false, 0.6)),
      saved({ layers: { class: { visible: true, opacity: 0.25 } }, exaggeration: 7 }),
      3,
    );
    expect(s.layers.class).toEqual({ visible: true, opacity: 0.25 });
    expect(s.layers.aerial).toEqual({ visible: true, opacity: 1 }); // not in the file: keeps its default
    expect(s.exaggeration).toBe(7);
  });

  it("drops saved layers the scene does not have", () => {
    const s = mergeSaved(scene(layer("aerial", true)), saved({ layers: { gone: { visible: true, opacity: 1 } } }), 1);
    expect(Object.keys(s.layers)).toEqual(["aerial"]);
  });

  it("clamps the hole to the holes that exist", () => {
    expect(mergeSaved(scene(), saved({ hole: 14 }), 9).hole).toBe(9);
    expect(mergeSaved(scene(), saved({ hole: 5 }), 0).hole).toBe(1); // no holes yet
    expect(mergeSaved(scene(), saved({ hole: 5 }), 18).hole).toBe(5);
  });

  it("keeps the saved viewport", () => {
    const viewport = { x: 5, z: 6, scale: 2 };
    expect(mergeSaved(scene(), saved({ viewport }), 1).viewport).toEqual(viewport);
  });
});

describe("serialise", () => {
  it("is independent of key order and uses the given viewport", () => {
    const a = saved({ layers: { b: { visible: true, opacity: 1 }, a: { visible: false, opacity: 0.5 } } });
    const b = saved({ layers: { a: { visible: false, opacity: 0.5 }, b: { visible: true, opacity: 1 } } });
    expect(serialise(a, null)).toBe(serialise(b, null));
    expect(serialise(a, { x: 1, z: 2, scale: 3 })).not.toBe(serialise(a, null));
  });
});

describe("viewport", () => {
  it("round-trips through a view and survives a different window size", () => {
    const v = { x: 700, z: 880, scale: 0.5 };
    const view = viewFromViewport(v, 1000, 800);
    expect(viewportFromView(view, 1000, 800)).toEqual(v);
    // restoring into a different window size keeps the same centre and zoom
    expect(viewportFromView(viewFromViewport(v, 500, 400), 500, 400)).toEqual(v);
  });
});
