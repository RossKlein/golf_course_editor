import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { testLook } from "../../terrain/look/look.fixture";
import type { Editing } from "./FieldView";
import GrassTab from "./GrassTab";
import LightTab from "./LightTab";
import SkySunTab from "./SkySunTab";
import SurfacesTab from "./SurfacesTab";
import TreesTab from "./TreesTab";

// Each tab drawn once, with the fixture look, to catch a control that cannot be drawn from the look's real shape. Whether it works
// when used is for the browser; this only shows that every field of every surface and tree part has something to draw.

const editing: Editing = {
  look: testLook,
  defaults: testLook,
  start: () => {},
  set: () => {},
  finish: () => {},
  reset: () => {},
  resetAll: () => {},
  change: () => {},
};

describe("the look editor's tabs draw", () => {
  it("the sky and the sun, with the dates the declination falls on and the time from solar noon", () => {
    const html = renderToString(<SkySunTab editing={editing} />);
    expect(html).toContain("Sky colour");
    expect(html).toContain("Latitude");
    expect(html).toContain("Time of year");
    expect(html).toContain("Jun"); // 23.44° is the June solstice
    expect(html).toContain("2.4 h before solar noon");
  });

  it("every surface, with the fields it uses and the others folded under More", () => {
    for (const name of Object.keys(testLook.surfaces)) {
      const html = renderToString(<SurfacesTab editing={editing} selected={name} onSelect={() => {}} />);
      expect(html, name).toContain("Grass grain");
      expect(html, name).toContain("Bump");
    }
    const fairway = renderToString(<SurfacesTab editing={editing} selected="fairway" onSelect={() => {}} />);
    expect(fairway).toContain("Stripe width"); // a fairway has stripes, so they are not under More
    expect(fairway).toContain("Second stripe colour");
    const water = renderToString(<SurfacesTab editing={editing} selected="water" onSelect={() => {}} />);
    expect(water).toContain("More:");
  });

  it("the grass, the light and the relief", () => {
    expect(renderToString(<GrassTab editing={editing} />)).toContain("Texture size");
    const light = renderToString(<LightTab editing={editing} />);
    for (const label of ["Strength", "Edge softness", "Exaggeration", "Shading", "Ambient light"]) expect(light).toContain(label);
  });

  it("every tree model with all its parts", () => {
    testLook.trees.kinds.forEach((kind, i) => {
      const html = renderToString(<TreesTab editing={editing} kind={i} onKind={() => {}} />);
      expect(html).toContain(kind.name);
      kind.parts.forEach((p, j) => expect(html).toContain(`${j + 1}. ${p.shape === "frustum" ? "Cone" : "Ball"}`));
    });
  });

  it("nothing, rather than an error, while there is no look", () => {
    expect(renderToString(<SurfacesTab editing={{ ...editing, look: null }} selected="fairway" onSelect={() => {}} />)).toBe("");
    expect(renderToString(<TreesTab editing={{ ...editing, look: null }} kind={0} onKind={() => {}} />)).toBe("");
  });
});
