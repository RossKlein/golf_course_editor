import { describe, expect, it } from "vitest";
import type { EditorState } from "../../core/api/api";
import type { Scene, SceneLayer } from "../scene";
import { defaultEditorState, defaultViewer, mergeSaved, serialise, viewFromViewport, viewportFromView } from "./editorState";

const layer = (id: string, visible: boolean, opacity = 1): SceneLayer => ({ id, label: id, visible, opacity, adjustable: true, olLayer: null as never });
const scene = (...layers: SceneLayer[]): Scene => ({
  key: "bundle:x", kind: "bundle", title: "x", subtitle: () => "", extent: { x: 0, z: 0, w: 10, h: 10 }, layers, readout: () => [],
});
const saved = (patch: Partial<EditorState>): EditorState => ({ ...defaultEditorState(), ...patch });
const withTerrain = (hasSurfaces: boolean): Scene => ({ ...scene(), terrain: { renderer: { hasSurfaces } } as unknown as Scene["terrain"] });

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

describe("the 3D view's saved settings", () => {
  it("starts as its terrain suits when none were saved: the game's look where the terrain can show it", () => {
    expect(mergeSaved(withTerrain(true), null, 1).viewer).toEqual(defaultViewer(true));
    expect(mergeSaved(withTerrain(false), null, 1).viewer).toEqual(defaultViewer(false));
    expect(mergeSaved(withTerrain(true), saved({ viewer: null }), 1).viewer).toEqual(defaultViewer(true)); // a file from before they were saved
    expect(defaultViewer(true).game).toBe(true);
    expect(defaultViewer(false).game).toBe(false);
  });

  it("keeps what was saved: grass range and density, rough grass, outlines and the rest", () => {
    const viewer = { ...defaultViewer(true), grassRange: 120, grassDensity: 7.5, tufts: false, outlines: false, shadows: "high" as const, scale: 2.5, trees: false, water: false };
    expect(mergeSaved(withTerrain(true), saved({ viewer }), 1).viewer).toEqual(viewer);
  });

  it("does not turn the game's look on where the terrain cannot show it, whatever was saved", () => {
    const viewer = { ...defaultViewer(true), game: true };
    expect(mergeSaved(withTerrain(false), saved({ viewer }), 1).viewer?.game).toBe(false);
    expect(mergeSaved(scene(), saved({ viewer }), 1).viewer?.game).toBe(false); // no terrain at all
  });

  it("fills a setting a saved file lacks from the defaults", () => {
    const { grassRange, ...older } = { ...defaultViewer(true), grassDensity: 3 };
    expect(grassRange).toBeDefined();
    const merged = mergeSaved(withTerrain(true), saved({ viewer: older as EditorState["viewer"] }), 1).viewer;
    expect(merged?.grassDensity).toBe(3);
    expect(merged?.grassRange).toBe(defaultViewer(true).grassRange);
  });

  it("keeps whether the 3D view was open and which Look tab was, and starts with both closed", () => {
    expect(defaultEditorState()).toMatchObject({ view3d: false, lookTab: "sky", viewer: null });
    expect(mergeSaved(scene(), saved({ view3d: true, lookTab: "grass" }), 1)).toMatchObject({ view3d: true, lookTab: "grass" });
  });

  it("is part of what makes a state different, so a change is saved", () => {
    const a = saved({ viewer: defaultViewer(true) });
    const b = saved({ viewer: { ...defaultViewer(true), grassDensity: 5 } });
    expect(serialise(a, null)).not.toBe(serialise(b, null));
    expect(serialise(saved({ view3d: true }), null)).not.toBe(serialise(saved({ view3d: false }), null));
    expect(serialise(saved({ lookTab: "trees" }), null)).not.toBe(serialise(saved({ lookTab: "sky" }), null));
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
