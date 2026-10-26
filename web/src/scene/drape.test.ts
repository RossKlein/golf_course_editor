import { describe, expect, it } from "vitest";
import { emptyDoc, type Doc } from "../model/design/store";
import { paintDrape } from "./drape";

/** A drawing context that records what was done, in order. */
function recorder() {
  const calls: string[] = [];
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 0, lineJoin: "", globalCompositeOperation: "source-over",
    setTransform: (...a: number[]) => calls.push(`transform ${a.map((n) => +n.toFixed(4)).join(",")}`),
    clearRect: () => calls.push("clear"),
    beginPath: () => calls.push("begin"),
    moveTo: () => calls.push("move"),
    lineTo: () => calls.push("line"),
    closePath: () => calls.push("close"),
    fill: () => calls.push(`fill ${ctx.fillStyle} ${ctx.globalCompositeOperation}`),
    stroke: () => calls.push(`stroke ${ctx.strokeStyle} ${ctx.lineWidth.toFixed(3)}`),
    save: () => calls.push("save"),
    restore: () => { calls.push("restore"); ctx.globalCompositeOperation = "source-over"; },
  };
  return { ctx, calls };
}

const box = (x: number, z: number, s = 10): [number, number][] => [[x, z], [x + s, z], [x + s, z + s], [x, z + s], [x, z]];
const doc = (): Doc => {
  const d = emptyDoc();
  d.regions = {
    a: { id: "a", class: 1, hole: 1, outer: box(0, 0), inner: [], note: null },
    far: { id: "far", class: 5, hole: null, outer: box(5000, 5000), inner: [], note: null },
    b: { id: "b", class: 2, hole: 1, outer: box(2, 2, 4), inner: [], note: null },
  } as Doc["regions"];
  d.order = ["a", "far", "b"];
  d.layout.holes = [{ number: 1, par: 4, name: null, route: [[0, 0], [20, 20]] }] as Doc["layout"]["holes"];
  return d;
};

describe("painting the design for the 3D view", () => {
  it("scales course metres to the canvas and clears first", () => {
    const f = recorder(), l = recorder();
    paintDrape(f.ctx as never, l.ctx as never, doc(), { x: 100, z: 200, w: 512, h: 512 }, 1024);
    expect(f.calls.slice(0, 3)).toEqual(["transform 1,0,0,1,0,0", "clear", "transform 2,0,0,2,-200,-400"]);
  });

  it("paints surfaces in the build's order and skips ones outside the window", () => {
    const f = recorder(), l = recorder();
    paintDrape(f.ctx as never, l.ctx as never, doc(), { x: -50, z: -50, w: 200, h: 200 }, 400);
    const fills = f.calls.filter((c) => c.startsWith("fill"));
    expect(fills).toHaveLength(2); // the bunker at 5000 m is not in the window
    expect(fills[0]).toContain("143, 209, 79"); // fairway first
    expect(fills[1]).toContain("31, 170, 89"); // then the green over it
  });

  it("hides the outline of what a later surface covers", () => {
    const f = recorder(), l = recorder();
    paintDrape(f.ctx as never, l.ctx as never, doc(), { x: -50, z: -50, w: 200, h: 200 }, 400);
    // for each surface in turn: erase under it, then outline it
    const steps = l.calls.filter((c) => c.endsWith("destination-out") || c.startsWith("stroke rgba(255, 255, 255"));
    expect(steps.map((c) => (c.endsWith("destination-out") ? "erase" : "outline"))).toEqual(["erase", "outline", "erase", "outline"]);
  });

  it("draws the hole routes in the hole's colour, last", () => {
    const f = recorder(), l = recorder();
    paintDrape(f.ctx as never, l.ctx as never, doc(), { x: -50, z: -50, w: 200, h: 200 }, 400);
    const strokes = l.calls.filter((c) => c.startsWith("stroke"));
    expect(strokes[strokes.length - 1]).not.toContain("255, 255, 255");
  });

  it("keeps lines readable at any zoom: thin when the canvas is fine, never thinner than a minimum", () => {
    const l = recorder();
    paintDrape(recorder().ctx as never, l.ctx as never, doc(), { x: -5, z: -5, w: 20, h: 20 }, 2048);
    expect(l.calls.some((c) => c.startsWith("stroke rgba(255, 255, 255, 0.95) 0.040"))).toBe(true);
  });
});
